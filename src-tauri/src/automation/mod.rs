//! Bundled CLI/MCP automation host.
//!
//! The desktop executable also serves Mermaid/PlantUML checks and renders to
//! shells and MCP hosts. `main` routes to this module before the editor starts;
//! rendering reuses the app's own WebView through a hidden window, so no Node,
//! browser download or PATH entry is required. Usage lives in `--help`.

pub mod cli;
pub mod commands;
pub mod help;
pub mod host;
pub mod invocation;
pub mod mcp;
pub mod messages;
pub mod report;

use std::io::Write;
use std::sync::Arc;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::automation::host::{RenderHost, RENDERER_PAGE, RENDERER_WINDOW_LABEL};
use crate::automation::invocation::{Invocation, Request};
use crate::automation::messages::{Locale, Messages};
use crate::automation::report::{ToolError, EXIT_OK, EXIT_USAGE_ERROR, RENDERER_READY_TIMEOUT_MS};

pub use invocation::{detect, Detection};

/// Entry point used by `main` before the editor starts. Never returns.
pub fn run(request: Request) -> ! {
    ensure_console_output();
    let messages = Messages::new(Locale::from_environment());
    let invocation = match request.invocation {
        Ok(invocation) => invocation,
        Err(error) => {
            cli::fail(&error, request.json);
            flush_and_exit(EXIT_USAGE_ERROR);
        }
    };

    match invocation {
        // Fast paths: no WebView, no window, no desktop session required.
        Invocation::Help => {
            cli::write_stdout(&help::help_text(messages.locale()));
            flush_and_exit(EXIT_OK);
        }
        Invocation::Version => {
            cli::write_stdout(&format!("{}\n", help::version()));
            flush_and_exit(EXIT_OK);
        }
        Invocation::McpConfig => {
            cli::write_stdout(&mcp_config_json());
            flush_and_exit(EXIT_OK);
        }
        rendering => run_renderer(rendering, messages),
    }
}

/// Windows desktop binaries are not attached to the console that launched them,
/// and shells do not hand a GUI-subsystem child their redirected handles. When
/// no usable standard handle was inherited, attach to the parent console so
/// `--help` and report output are actually readable. Pipes and redirected
/// handles are left untouched, which keeps MCP hosts and scripts working.
#[cfg(windows)]
fn ensure_console_output() {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, GetFileType, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, FILE_TYPE_UNKNOWN, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{
        AttachConsole, GetStdHandle, SetStdHandle, ATTACH_PARENT_PROCESS, STD_ERROR_HANDLE,
        STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
    };

    fn usable(handle: windows_sys::Win32::Foundation::HANDLE) -> bool {
        // SAFETY: reading the file type of an inherited handle is side-effect free.
        unsafe {
            !handle.is_null() && handle != INVALID_HANDLE_VALUE && GetFileType(handle) != FILE_TYPE_UNKNOWN
        }
    }

    // SAFETY: every call only touches this process' standard handles.
    unsafe {
        if usable(GetStdHandle(STD_OUTPUT_HANDLE)) {
            return;
        }
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            return;
        }

        let open = |name: &[u16], access: u32| {
            CreateFileW(
                name.as_ptr(),
                access,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };

        let output = open(&to_wide("CONOUT$"), FILE_GENERIC_WRITE);
        if output != INVALID_HANDLE_VALUE {
            SetStdHandle(STD_OUTPUT_HANDLE, output);
            SetStdHandle(STD_ERROR_HANDLE, output);
        }

        let input = open(&to_wide("CONIN$"), FILE_GENERIC_READ | FILE_GENERIC_WRITE);
        if input != INVALID_HANDLE_VALUE {
            SetStdHandle(STD_INPUT_HANDLE, input);
        }
    }
}

#[cfg(windows)]
fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(not(windows))]
fn ensure_console_output() {}

/// Starts the hidden renderer window and runs the requested work. Never returns.
fn run_renderer(invocation: Invocation, messages: Messages) -> ! {
    let host = RenderHost::new(messages).shared();
    let worker_host = Arc::clone(&host);
    let worker_invocation = invocation.clone();
    let json = matches!(
        worker_invocation,
        Invocation::Check { json: true, .. } | Invocation::DiagramRender { json: true, .. }
    );
    // Each automation process owns its WebView data directory; concurrent
    // processes sharing one folder block instead of rendering.
    let data_directory = host::automation_data_directory();

    // Backstop for a renderer that never comes up: fail, never hang.
    let watchdog_host = Arc::clone(&host);
    std::thread::spawn(move || {
        if let Err(error) = watchdog_host.wait_until_ready(RENDERER_READY_TIMEOUT_MS) {
            cli::fail(&error, json);
            flush_and_exit(EXIT_USAGE_ERROR);
        }
    });

    let builder = tauri::Builder::default()
        .manage(Arc::clone(&host))
        .invoke_handler(tauri::generate_handler![
            commands::automation_host_ready,
            commands::automation_render_next,
            commands::automation_render_progress,
            commands::automation_render_result,
        ])
        .setup(move |app| {
            if let Err(error) = create_renderer_window(app.handle(), data_directory.clone()) {
                cli::fail(
                    &ToolError::new("renderer.unavailable", messages.unavailable(&error.to_string())),
                    json,
                );
                host::remove_data_directory(&data_directory);
                flush_and_exit(EXIT_USAGE_ERROR);
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let code = execute_worker(&worker_invocation, &worker_host);
                worker_host.shutdown();
                close_renderer_window(&handle);
                host::remove_data_directory(&data_directory);
                flush_and_exit(code);
            });
            Ok(())
        });

    let mut context = crate::app_context();
    // The automation window is the only window this mode may create.
    for window in context.config_mut().app.windows.iter_mut() {
        window.create = false;
    }

    match builder.build(context) {
        Ok(app) => {
            // `AppHandle::exit` drops the requested process code, so the worker
            // tears the window down and exits itself; automatic
            // exit-on-last-window must not race that code away.
            app.run(|_, event| {
                if let tauri::RunEvent::ExitRequested { api, .. } = event {
                    api.prevent_exit();
                }
            });
            flush_and_exit(EXIT_USAGE_ERROR)
        }
        Err(error) => {
            cli::fail(
                &ToolError::new("renderer.unavailable", messages.unavailable(&error.to_string())),
                json,
            );
            flush_and_exit(EXIT_USAGE_ERROR);
        }
    }
}

fn execute_worker(invocation: &Invocation, host: &Arc<RenderHost>) -> i32 {
    match invocation {
        Invocation::Mcp => {
            match tauri::async_runtime::block_on(mcp::serve(Arc::clone(host))) {
                Ok(()) => EXIT_OK,
                Err(error) => {
                    cli::write_stderr(&format!("{error}\n"));
                    EXIT_USAGE_ERROR
                }
            }
        }
        other => cli::execute(other, host),
    }
}

/// Creates the hidden renderer window used by every rendering invocation.
///
/// It is deliberately invisible: the window only exists to host the app's own
/// WebView engines. `skip_taskbar` keeps it out of the shell, and the dedicated
/// data directory keeps concurrent automation processes from contending.
fn create_renderer_window(
    app: &tauri::AppHandle,
    data_directory: std::path::PathBuf,
) -> tauri::Result<tauri::WebviewWindow> {
    WebviewWindowBuilder::new(
        app,
        RENDERER_WINDOW_LABEL,
        WebviewUrl::App(RENDERER_PAGE.into()),
    )
    .title("LumaMark automation")
    .visible(false)
    .skip_taskbar(true)
    .inner_size(1280.0, 720.0)
    .data_directory(data_directory)
    .build()
}

/// Destroys the hidden window and waits for the WebView to be released.
///
/// Exiting the process while the browser is still alive makes Chromium log a
/// window-class teardown error on stderr, which would pollute a CLI session.
fn close_renderer_window(handle: &tauri::AppHandle) {
    if handle.get_webview_window(RENDERER_WINDOW_LABEL).is_none() {
        return;
    }

    if let Some(window) = handle.get_webview_window(RENDERER_WINDOW_LABEL) {
        let _ = window.destroy();
    }

    for _ in 0..50 {
        if handle.get_webview_window(RENDERER_WINDOW_LABEL).is_none() {
            // Let the runtime finish releasing the browser host.
            std::thread::sleep(std::time::Duration::from_millis(60));
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/// MCP host configuration for this exact executable.
fn mcp_config_json() -> String {
    let command = cli::current_executable().to_string_lossy().into_owned();
    let config = serde_json::json!({
        "mcpServers": {
            "lumamark": {
                "command": command,
                "args": ["mcp"],
            }
        }
    });

    format!(
        "{}\n",
        serde_json::to_string_pretty(&config).unwrap_or_else(|_| String::from("{}"))
    )
}

fn flush_and_exit(code: i32) -> ! {
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    std::process::exit(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_configuration_points_at_this_executable() {
        let config: serde_json::Value =
            serde_json::from_str(&mcp_config_json()).expect("configuration is JSON");

        let server = &config["mcpServers"]["lumamark"];
        assert!(server["command"].as_str().is_some_and(|value| !value.is_empty()));
        assert_eq!(server["args"], serde_json::json!(["mcp"]));
        assert!(server.get("env").is_none(), "no environment is required");
    }
}
