pub mod commands {
    pub mod assets;
    pub mod debug_log;
    pub mod document_claims;
    pub mod file_watch;
    pub mod files;
    pub mod open_requests;
    pub mod opener;
    pub mod recent_files;
    pub mod settings;
    pub mod workspace;
}

pub mod errors;

pub mod services {
    pub mod asset_service;
    pub mod debug_log_service;
    pub mod desktop_window_service;
    pub mod document_claim_service;
    pub(crate) mod document_path_identity;
    pub mod file_service;
    pub mod file_watch_service;
    pub mod file_watch_session_hub;
    pub mod open_request_lifecycle;
    pub mod open_request_service;
    pub mod opener_service;
    pub mod recent_files_service;
    pub mod settings_service;
    pub mod workspace_mutation_service;
    pub mod workspace_service;
    pub mod workspace_session_service;
}

use commands::assets::{
    assets_authorize_local_image, assets_cache_remote_image, assets_copy_local_image,
    assets_finalize_draft_images, assets_import_document_image, assets_import_draft_image,
};
use commands::debug_log::debug_append_log;
use commands::document_claims::{
    desktop_focus_window, document_claim_begin_session, document_claim_commit,
    document_claim_release, document_claim_release_owned, document_claim_release_session,
    document_claim_reserve, document_claim_takeover_session,
};
use commands::file_watch::{replace_local_image_targets, unwatch_document, watch_document};
use commands::files::{
    files_read_text, files_read_text_claimed, files_show_open_file_dialog,
    files_show_open_image_dialog, files_show_save_file_dialog, files_write_text,
    files_write_text_claimed,
};
use commands::open_requests::{
    open_requests_abandon, open_requests_acknowledge, open_requests_claim,
    open_requests_record_applied, open_requests_recover,
};
use commands::opener::{opener_open_url, opener_reveal_path};
use commands::recent_files::{
    recent_files_add, recent_files_clear, recent_files_get, recent_files_import_legacy,
};
use commands::settings::{
    acceptance_settings_config_dir_from_environment, settings_acceptance_config_dir,
    settings_acceptance_mark_close_entered, settings_acceptance_write_barrier_dir, settings_get,
    settings_set,
};
use commands::workspace::{
    workspace_create_directory, workspace_create_file, workspace_delete_entry,
    workspace_list_children, workspace_open_directory, workspace_open_path, workspace_rename_entry,
};
use services::debug_log_service::DebugLogService;
use services::desktop_window_service::DesktopWindowRoutingService;
use services::document_claim_service::{ClaimError, DocumentClaimService, ReleasedWindowClaims};
use services::file_watch_service::FILE_WATCH_CHANGED_EVENT;
use services::file_watch_session_hub::FileWatchSessionHub;
use services::open_request_service::OpenRequestService;
use services::recent_files_service::RecentFilesService;
use services::workspace_session_service::WorkspaceSession;
use tauri::{Emitter, Manager};

const ROUTING_ACCEPTANCE_MODE_ENV: &str = "LUMAMARK_ROUTING_ACCEPTANCE_MODE";
const OPEN_REQUEST_STATE_STARTUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

#[derive(Default)]
struct OpenRequestStateReadiness {
    ready: std::sync::Mutex<bool>,
    changed: std::sync::Condvar,
}

impl OpenRequestStateReadiness {
    fn mark_ready(&self) -> Result<(), crate::errors::AppError> {
        let mut ready = self.ready.lock().map_err(|_| {
            crate::errors::AppError::new(
                "desktop.open_request_state_readiness_unavailable",
                "The desktop open-request readiness state is unavailable.",
                false,
            )
        })?;
        *ready = true;
        self.changed.notify_all();
        Ok(())
    }

    fn wait_until_ready(
        &self,
        timeout: std::time::Duration,
    ) -> Result<(), crate::errors::AppError> {
        let ready = self.ready.lock().map_err(|_| {
            crate::errors::AppError::new(
                "desktop.open_request_state_readiness_unavailable",
                "The desktop open-request readiness state is unavailable.",
                false,
            )
        })?;
        let (ready, _) = self
            .changed
            .wait_timeout_while(ready, timeout, |ready| !*ready)
            .map_err(|_| {
                crate::errors::AppError::new(
                    "desktop.open_request_state_readiness_unavailable",
                    "The desktop open-request readiness state is unavailable.",
                    false,
                )
            })?;
        if *ready {
            Ok(())
        } else {
            Err(crate::errors::AppError::new(
                "desktop.open_request_state_startup_timeout",
                "Desktop open-request state did not become ready before the startup deadline.",
                false,
            ))
        }
    }
}

fn should_register_single_instance(
    validated_acceptance_config_dir: Option<&std::path::Path>,
    routing_acceptance_mode: Option<&std::ffi::OsStr>,
) -> Result<bool, crate::errors::AppError> {
    match routing_acceptance_mode {
        None => Ok(validated_acceptance_config_dir.is_none()),
        Some(mode) if mode != std::ffi::OsStr::new("1") => Err(crate::errors::AppError::new(
            "desktop.routing_acceptance_mode_invalid",
            "Routing acceptance mode must be exactly 1 when it is configured.",
            false,
        )),
        Some(_) if validated_acceptance_config_dir.is_none() => Err(crate::errors::AppError::new(
            "desktop.routing_acceptance_config_required",
            "Routing acceptance mode requires a validated scoped settings config directory.",
            false,
        )),
        Some(_) => Ok(true),
    }
}

fn release_document_claims_for_window_event(
    service: &DocumentClaimService,
    window_label: &str,
    event: &tauri::WindowEvent,
) -> Result<Option<ReleasedWindowClaims>, ClaimError> {
    if matches!(event, tauri::WindowEvent::Destroyed) {
        service.release_window(window_label).map(Some)
    } else {
        Ok(None)
    }
}

fn handle_document_claim_window_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if !matches!(event, tauri::WindowEvent::Destroyed) {
        return;
    }
    let Some(service) = window.try_state::<DocumentClaimService>() else {
        eprintln!(
            "document claim state is unavailable while destroying window `{}`",
            window.label()
        );
        return;
    };
    if let Err(error) =
        release_document_claims_for_window_event(service.inner(), window.label(), event)
    {
        eprintln!(
            "failed to release document claims for destroyed window `{}`: {error}",
            window.label()
        );
    }
}

fn handle_file_watch_window_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if !matches!(event, tauri::WindowEvent::Destroyed) {
        return;
    }
    let Some(watcher) = window.try_state::<FileWatchSessionHub>() else {
        eprintln!(
            "file watch state is unavailable while destroying window `{}`",
            window.label()
        );
        return;
    };
    if let Err(error) = watcher.remove_session(window.label()) {
        eprintln!(
            "failed to remove file watch session for destroyed window `{}`: {error}",
            window.label()
        );
    }
}

fn release_open_requests_for_window_event(
    service: &OpenRequestService,
    window_label: &str,
    event: &tauri::WindowEvent,
) -> Result<Option<usize>, crate::errors::AppError> {
    if matches!(event, tauri::WindowEvent::Destroyed) {
        service.release_window(window_label).map(Some)
    } else {
        Ok(None)
    }
}

fn handle_open_request_window_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if !matches!(event, tauri::WindowEvent::Destroyed) {
        return;
    }
    let Some(service) = window.try_state::<OpenRequestService>() else {
        eprintln!(
            "open request state is unavailable while destroying window `{}`",
            window.label()
        );
        return;
    };
    if let Err(error) =
        release_open_requests_for_window_event(service.inner(), window.label(), event)
    {
        eprintln!(
            "failed to release open requests for destroyed window `{}`: {}",
            window.label(),
            error.message
        );
    }
}

fn configure_document_claim_state<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    service: DocumentClaimService,
) -> tauri::Builder<R> {
    builder
        .manage(service)
        .on_window_event(handle_document_claim_window_event)
}

fn open_request_state_plugin<R: tauri::Runtime>(
    acceptance_config_dir: Option<std::path::PathBuf>,
) -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("open-request-state")
        .setup(move |app, _api| {
            let app_config_dir = match acceptance_config_dir.clone() {
                Some(config_dir) => config_dir,
                None => app.path().app_config_dir().map_err(|_| {
                    std::io::Error::other("application config directory is unavailable")
                })?,
            };
            let open_request_service = OpenRequestService::new(app_config_dir)
                .map_err(|error| std::io::Error::other(error.message))?;
            if !app.manage(open_request_service) {
                return Err(std::io::Error::other("open request state is already managed").into());
            }
            Ok(())
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let acceptance_config_dir = match acceptance_settings_config_dir_from_environment() {
        Ok(config_dir) => config_dir,
        Err(error) => panic!("invalid acceptance settings configuration: {}", error.code),
    };
    let register_single_instance = match should_register_single_instance(
        acceptance_config_dir.as_deref(),
        std::env::var_os(ROUTING_ACCEPTANCE_MODE_ENV).as_deref(),
    ) {
        Ok(register) => register,
        Err(error) => panic!("invalid routing acceptance configuration: {}", error.code),
    };
    let document_claim_service = match DocumentClaimService::new() {
        Ok(service) => service,
        Err(error) => panic!("failed to initialize document claim state: {error}"),
    };
    let builder = configure_document_claim_state(
        tauri::Builder::default()
            .manage(DebugLogService::default())
            .manage(DesktopWindowRoutingService::default())
            .manage(OpenRequestStateReadiness::default())
            .manage(WorkspaceSession::default()),
        document_claim_service,
    )
    .on_window_event(handle_file_watch_window_event)
    .on_window_event(handle_open_request_window_event);
    let secondary_route_config_dir = acceptance_config_dir.clone();
    let builder = if register_single_instance {
        builder.plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            let app_handle = app.clone();
            let cwd = std::path::PathBuf::from(cwd);
            let route_config_dir = secondary_route_config_dir.clone();
            let _route_task = tauri::async_runtime::spawn_blocking(move || {
                let Some(readiness) = app_handle.try_state::<OpenRequestStateReadiness>() else {
                    eprintln!("desktop open-request readiness state is unavailable");
                    return;
                };
                if let Err(error) =
                    readiness.wait_until_ready(OPEN_REQUEST_STATE_STARTUP_TIMEOUT)
                {
                    eprintln!(
                        "desktop window routing readiness failed [{}]: {}",
                        error.code, error.message
                    );
                    return;
                }
                let config_dir = match route_config_dir {
                    Some(config_dir) => config_dir,
                    None => match app_handle.path().app_config_dir() {
                        Ok(config_dir) => config_dir,
                        Err(error) => {
                            eprintln!(
                                "failed to resolve the config directory for desktop window routing: {error}"
                            );
                            return;
                        }
                    },
                };
                let Some(router) = app_handle.try_state::<DesktopWindowRoutingService>() else {
                    eprintln!("desktop window routing state is unavailable");
                    return;
                };
                if let Err(error) =
                    router.route_utf8_args(&app_handle, &config_dir, &args, &cwd)
                {
                    eprintln!(
                        "desktop window routing failed [{}]: {error}",
                        error.code()
                    );
                }
            });
        }))
    } else {
        builder
    };
    builder
        .plugin(open_request_state_plugin(acceptance_config_dir.clone()))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
            let cwd = std::env::current_dir()?;
            let app_config_dir = match acceptance_config_dir.clone() {
                Some(config_dir) => config_dir,
                None => app.path().app_config_dir().map_err(|_| {
                    std::io::Error::other("application config directory is unavailable")
                })?,
            };
            let app_handle = app.handle().clone();
            let watcher = FileWatchSessionHub::new(move |window_label, event| {
                if let Err(error) =
                    app_handle.emit_to(window_label, FILE_WATCH_CHANGED_EVENT, event)
                {
                    eprintln!("failed to emit file watch event: {error}");
                }
            });
            if !app.manage(watcher) {
                return Err(std::io::Error::other("file watcher state is already managed").into());
            }
            if !app.manage(RecentFilesService::new(app_config_dir.clone())) {
                return Err(std::io::Error::other("recent files state is already managed").into());
            }
            let startup_route_app = app.handle().clone();
            let startup_route_config_dir = app_config_dir.clone();
            let _startup_route_task = tauri::async_runtime::spawn_blocking(move || {
                let Some(router) = startup_route_app.try_state::<DesktopWindowRoutingService>()
                else {
                    eprintln!("desktop window routing state is unavailable during startup");
                    return;
                };
                if let Err(error) = router.recover_and_route_os_args(
                    &startup_route_app,
                    &startup_route_config_dir,
                    &args,
                    &cwd,
                ) {
                    eprintln!(
                        "desktop startup recovery and routing failed [{}]: {error}",
                        error.code()
                    );
                    return;
                }
                let Some(readiness) = startup_route_app.try_state::<OpenRequestStateReadiness>()
                else {
                    eprintln!(
                        "desktop open-request readiness state is unavailable after startup routing"
                    );
                    return;
                };
                if let Err(error) = readiness.mark_ready() {
                    eprintln!(
                        "desktop startup routing readiness publication failed [{}]: {}",
                        error.code, error.message
                    );
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_focus_window,
            document_claim_begin_session,
            document_claim_takeover_session,
            document_claim_release_session,
            document_claim_reserve,
            document_claim_commit,
            document_claim_release,
            document_claim_release_owned,
            files_read_text,
            files_read_text_claimed,
            files_write_text,
            files_write_text_claimed,
            files_show_open_file_dialog,
            files_show_open_image_dialog,
            files_show_save_file_dialog,
            watch_document,
            replace_local_image_targets,
            unwatch_document,
            assets_cache_remote_image,
            assets_import_document_image,
            assets_authorize_local_image,
            assets_copy_local_image,
            assets_import_draft_image,
            assets_finalize_draft_images,
            workspace_open_directory,
            workspace_open_path,
            workspace_list_children,
            workspace_create_file,
            workspace_create_directory,
            workspace_rename_entry,
            workspace_delete_entry,
            open_requests_recover,
            open_requests_claim,
            open_requests_record_applied,
            open_requests_acknowledge,
            open_requests_abandon,
            opener_open_url,
            opener_reveal_path,
            recent_files_get,
            recent_files_add,
            recent_files_clear,
            recent_files_import_legacy,
            settings_get,
            settings_set,
            settings_acceptance_config_dir,
            settings_acceptance_write_barrier_dir,
            settings_acceptance_mark_close_entered,
            debug_append_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running LumaMark");
}

#[cfg(test)]
mod document_claim_bootstrap_contract {
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::services::document_claim_service::{
        BeginSessionOutcome, ClaimOperation, CommitOutcome, DocumentClaimService,
        ReleasedWindowClaims, ReserveOutcome,
    };

    static NEXT_TEST_PATH: AtomicU64 = AtomicU64::new(1);

    fn test_document_path(label: &str) -> String {
        let sequence = NEXT_TEST_PATH.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir()
            .join(format!(
                "lumamark-document-claim-bootstrap-{}-{sequence}-{label}.md",
                std::process::id()
            ))
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn invoke_handler_registers_every_document_claim_command() {
        let source = include_str!("lib.rs");
        let handler = source
            .split_once(".invoke_handler(tauri::generate_handler![")
            .and_then(|(_, handler)| handler.split_once("])"))
            .map(|(handler, _)| handler)
            .expect("production invoke handler should remain discoverable");
        let expected_commands = [
            "desktop_focus_window",
            "document_claim_begin_session",
            "document_claim_takeover_session",
            "document_claim_release_session",
            "document_claim_reserve",
            "document_claim_commit",
            "document_claim_release",
            "document_claim_release_owned",
            "files_read_text_claimed",
            "files_write_text_claimed",
        ];

        for command in expected_commands {
            assert!(
                handler
                    .lines()
                    .any(|line| line.trim() == format!("{command},")),
                "document claim command `{command}` must be registered in generate_handler"
            );
        }
    }

    #[test]
    fn document_claim_service_is_managed_by_the_application() {
        let source = include_str!("lib.rs");
        let configuration = source
            .split_once("fn configure_document_claim_state")
            .and_then(|(_, configuration)| configuration.split_once("\n}\n"))
            .map(|(configuration, _)| configuration)
            .expect("document claim state configuration should remain discoverable");
        let run = source
            .split_once("pub fn run() {")
            .and_then(|(_, run)| run.split_once("\n}\n\n#[cfg(test)]"))
            .map(|(run, _)| run)
            .expect("application run function should remain discoverable");

        assert!(configuration.contains(".manage(service)"));
        assert!(run.contains("let document_claim_service = match DocumentClaimService::new()"));
        assert!(run.contains("let builder = configure_document_claim_state("));
        assert!(run.contains("document_claim_service,"));
    }

    #[test]
    fn destroyed_window_releases_only_its_document_claims() {
        let service = DocumentClaimService::new().expect("test claim service should initialize");
        let window_a_owned = test_document_path("window-a-owned");
        let window_a_pending = test_document_path("window-a-pending");
        let window_b_owned = test_document_path("window-b-owned");
        let window_b_pending = test_document_path("window-b-pending");

        assert!(matches!(
            service.begin_session("window-a", "session-a"),
            Ok(BeginSessionOutcome::Began { .. })
        ));
        assert!(matches!(
            service.reserve(
                "window-a",
                ClaimOperation::new("session-a", 1),
                &window_a_owned,
            ),
            Ok(ReserveOutcome::Reserved { .. })
        ));
        assert_eq!(
            service.commit_operation("window-a", "session-a", 1, &window_a_owned),
            Ok(CommitOutcome::Committed)
        );
        assert!(matches!(
            service.reserve(
                "window-a",
                ClaimOperation::new("session-a", 2),
                &window_a_pending,
            ),
            Ok(ReserveOutcome::Reserved { .. })
        ));

        assert!(matches!(
            service.begin_session("window-b", "session-b"),
            Ok(BeginSessionOutcome::Began { .. })
        ));
        assert!(matches!(
            service.reserve(
                "window-b",
                ClaimOperation::new("session-b", 1),
                &window_b_owned,
            ),
            Ok(ReserveOutcome::Reserved { .. })
        ));
        assert_eq!(
            service.commit_operation("window-b", "session-b", 1, &window_b_owned),
            Ok(CommitOutcome::Committed)
        );
        assert!(matches!(
            service.reserve(
                "window-b",
                ClaimOperation::new("session-b", 2),
                &window_b_pending,
            ),
            Ok(ReserveOutcome::Reserved { .. })
        ));

        assert_eq!(
            super::release_document_claims_for_window_event(
                &service,
                "window-a",
                &tauri::WindowEvent::Focused(false),
            ),
            Ok(None)
        );
        assert_eq!(
            super::release_document_claims_for_window_event(
                &service,
                "window-a",
                &tauri::WindowEvent::Destroyed,
            ),
            Ok(Some(ReleasedWindowClaims {
                reservations: 1,
                owned_documents: 1,
            }))
        );
        assert!(matches!(
            service.begin_session("window-a", "session-a-next"),
            Ok(BeginSessionOutcome::Began { .. })
        ));

        assert!(matches!(
            service.begin_session("window-c", "session-c"),
            Ok(BeginSessionOutcome::Began { .. })
        ));
        assert!(matches!(
            service.reserve(
                "window-c",
                ClaimOperation::new("session-c", 1),
                &window_a_owned,
            ),
            Ok(ReserveOutcome::Reserved { .. })
        ));
        assert!(matches!(
            service.reserve(
                "window-c",
                ClaimOperation::new("session-c", 2),
                &window_a_pending,
            ),
            Ok(ReserveOutcome::Reserved { .. })
        ));
        assert_eq!(
            service.reserve(
                "window-c",
                ClaimOperation::new("session-c", 3),
                &window_b_owned,
            ),
            Ok(ReserveOutcome::OwnedBy {
                window_label: "window-b".to_owned(),
            })
        );
        assert_eq!(
            service.reserve(
                "window-c",
                ClaimOperation::new("session-c", 4),
                &window_b_pending,
            ),
            Ok(ReserveOutcome::OwnedBy {
                window_label: "window-b".to_owned(),
            })
        );
    }

    #[test]
    fn document_claim_window_lifecycle_handler_is_registered() {
        let source = include_str!("lib.rs");
        let configuration = source
            .split_once("fn configure_document_claim_state")
            .and_then(|(_, configuration)| configuration.split_once("\n}\n"))
            .map(|(configuration, _)| configuration)
            .expect("document claim state configuration should remain discoverable");

        assert!(configuration.contains(".on_window_event(handle_document_claim_window_event)"));
    }
}

#[cfg(test)]
mod open_request_bootstrap_contract {
    use std::{
        ffi::OsString,
        fs,
        path::PathBuf,
        sync::{mpsc, Arc},
        thread,
        time::{Duration, SystemTime},
    };

    use crate::services::open_request_service::OpenRequestService;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be available")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "lumamark-open-bootstrap-{}-{nonce}-{name}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("test directory should be created");
        path
    }

    #[test]
    fn invoke_handler_registers_the_exactly_once_open_request_commands() {
        let source = include_str!("lib.rs");
        let handler = source
            .split_once(".invoke_handler(tauri::generate_handler![")
            .and_then(|(_, handler)| handler.split_once("])"))
            .map(|(handler, _)| handler)
            .expect("production invoke handler should remain discoverable");

        for command in [
            "open_requests_recover",
            "open_requests_claim",
            "open_requests_record_applied",
            "open_requests_acknowledge",
            "open_requests_abandon",
        ] {
            assert!(
                handler
                    .lines()
                    .any(|line| line.trim() == format!("{command},")),
                "open request command `{command}` must be registered"
            );
        }
        assert!(!handler
            .lines()
            .any(|line| line.trim() == "open_requests_drain,"));
    }

    #[test]
    fn destroyed_window_releases_only_its_processing_open_requests() {
        let config_dir = unique_test_dir("destroyed");
        let service =
            OpenRequestService::new(config_dir.clone()).expect("service should initialize");
        for (target, path) in [
            ("window-a", "a-applied.md"),
            ("window-a", "a-processing.md"),
            ("window-b", "b-processing.md"),
        ] {
            service
                .enqueue_os_args(
                    target,
                    &[OsString::from("LumaMark.exe"), OsString::from(path)],
                    &config_dir,
                )
                .expect("request should persist");
        }
        let window_a = service
            .claim_for_window("window-a")
            .expect("window-a should claim its requests");
        let window_b = service
            .claim_for_window("window-b")
            .expect("window-b should claim its request");
        service
            .record_applied(
                "window-a",
                &window_a[0].request_id,
                &window_a[0].attempt_token,
            )
            .expect("first window-a request should enter applied-pending");

        let non_destroyed = super::release_open_requests_for_window_event(
            &service,
            "window-a",
            &tauri::WindowEvent::Focused(false),
        )
        .expect("non-destroyed event should be ignored");
        let destroyed = super::release_open_requests_for_window_event(
            &service,
            "window-a",
            &tauri::WindowEvent::Destroyed,
        )
        .expect("destroyed event should release processing leases");
        assert_eq!(non_destroyed, None);
        assert_eq!(destroyed, Some(1));
        assert_eq!(
            service
                .recover_for_window("window-a")
                .expect("applied-pending should survive cleanup")
                .len(),
            1
        );
        let reclaimed = service
            .claim_for_window("window-a")
            .expect("released processing should requeue");
        assert_eq!(reclaimed.len(), 1);
        assert_ne!(reclaimed[0].attempt_token, window_a[1].attempt_token);
        assert_eq!(
            service
                .claim_for_window("window-b")
                .expect("other owner processing should remain untouched"),
            window_b
        );
    }

    #[test]
    fn secondary_instance_callback_only_dispatches_the_serial_window_worker() {
        let source = include_str!("lib.rs");
        assert!(source.contains("let open_request_service = OpenRequestService::new("));
        assert!(source.contains("app.manage(open_request_service)"));
        let callback = source
            .split_once(".plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {")
            .and_then(|(_, callback)| callback.split_once("\n        }))"))
            .map(|(callback, _)| callback)
            .expect("single-instance callback should remain discoverable");
        let worker_boundary = callback
            .find("tauri::async_runtime::spawn_blocking")
            .expect("callback must dispatch an off-thread worker");
        let synchronous_prefix = &callback[..worker_boundary];

        assert!(synchronous_prefix.contains("let app_handle = app.clone()"));
        assert!(synchronous_prefix.contains("let cwd = std::path::PathBuf::from(cwd)"));
        assert!(synchronous_prefix
            .contains("let route_config_dir = secondary_route_config_dir.clone()"));
        for forbidden in [
            "load_open_window_mode",
            "parse_open_request",
            "enqueue_utf8_args",
            "WebviewWindowBuilder",
        ] {
            assert!(
                !synchronous_prefix.contains(forbidden),
                "synchronous callback must not perform `{forbidden}`"
            );
        }
        assert!(callback.contains("match route_config_dir"));
        assert!(callback.contains("wait_until_ready"));
        assert!(callback.contains("router.route_utf8_args("));
    }

    #[test]
    fn single_instance_is_the_first_plugin_and_state_bootstrap_follows_it() {
        let source = include_str!("lib.rs");
        let run = source
            .split_once("pub fn run() {")
            .and_then(|(_, run)| run.split_once("\n}\n\n#[cfg(test)]"))
            .map(|(run, _)| run)
            .expect("application run function should remain discoverable");
        let single_instance = run
            .find(".plugin(tauri_plugin_single_instance::init(")
            .expect("single-instance plugin should be registered");
        let state_bootstrap = run
            .find(".plugin(open_request_state_plugin(")
            .expect("open-request state bootstrap should be registered");
        let clipboard = run
            .find(".plugin(tauri_plugin_clipboard_manager::init())")
            .expect("ordinary UI plugins should remain registered");

        assert!(single_instance < state_bootstrap && state_bootstrap < clipboard);
        assert_eq!(
            run.match_indices(".plugin(").next().map(|(index, _)| index),
            Some(single_instance),
            "single-instance must be the first Tauri plugin"
        );
    }

    #[test]
    fn open_request_readiness_wait_is_bounded_and_becomes_permanently_ready() {
        let readiness = super::OpenRequestStateReadiness::default();
        let timeout = readiness
            .wait_until_ready(Duration::from_millis(1))
            .expect_err("an uninitialized open-request state must time out");
        assert_eq!(timeout.code, "desktop.open_request_state_startup_timeout");

        readiness
            .mark_ready()
            .expect("state bootstrap should publish readiness");
        readiness
            .wait_until_ready(Duration::ZERO)
            .expect("published readiness should not wait again");
    }

    #[test]
    fn callback_waiting_during_primary_setup_resumes_after_state_bootstrap() {
        let readiness = Arc::new(super::OpenRequestStateReadiness::default());
        let waiting_readiness = Arc::clone(&readiness);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (completed_tx, completed_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            entered_tx
                .send(())
                .expect("worker entry should be observable");
            let result = waiting_readiness.wait_until_ready(Duration::from_secs(1));
            completed_tx
                .send(result)
                .expect("worker completion should be observable");
        });

        entered_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("worker should enter the readiness wait");
        assert!(completed_rx.try_recv().is_err());
        readiness
            .mark_ready()
            .expect("state bootstrap should publish readiness");
        completed_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("callback worker should resume")
            .expect("published readiness should release the callback worker");
        worker.join().expect("callback worker should not panic");
    }

    #[test]
    fn production_and_routing_acceptance_register_single_instance() {
        assert!(super::should_register_single_instance(None, None,)
            .expect("production should register single-instance"));
        assert!(super::should_register_single_instance(
            Some(std::path::Path::new("validated-settings-config")),
            Some(std::ffi::OsStr::new("1")),
        )
        .expect("routing acceptance should register single-instance"));
    }

    #[test]
    fn menu_acceptance_without_routing_marker_skips_single_instance() {
        assert!(!super::should_register_single_instance(
            Some(std::path::Path::new("validated-settings-config")),
            None,
        )
        .expect("menu acceptance should skip single-instance"));
    }

    #[test]
    fn routing_acceptance_marker_fails_closed_without_validated_config_or_exact_value() {
        let missing_config =
            super::should_register_single_instance(None, Some(std::ffi::OsStr::new("1")))
                .expect_err("routing acceptance must require a validated config directory");
        assert_eq!(
            missing_config.code,
            "desktop.routing_acceptance_config_required"
        );

        for invalid in ["", "0", "true"] {
            let error = super::should_register_single_instance(
                Some(std::path::Path::new("validated-settings-config")),
                Some(std::ffi::OsStr::new(invalid)),
            )
            .expect_err("routing acceptance marker must be exactly 1");
            assert_eq!(error.code, "desktop.routing_acceptance_mode_invalid");
        }
    }

    #[test]
    fn secondary_routing_is_released_only_after_ordered_primary_startup() {
        let source = include_str!("lib.rs");
        let run = source
            .split_once("pub fn run() {")
            .and_then(|(_, run)| run.split_once("\n}\n\n#[cfg(test)]"))
            .map(|(run, _)| run)
            .expect("application run function should remain discoverable");
        let state_plugin = run
            .find(".plugin(open_request_state_plugin(")
            .expect("durable open request state plugin should be registered");
        let single_instance = run
            .find(".plugin(tauri_plugin_single_instance::init(")
            .expect("single-instance plugin should be registered");
        let user_setup = run
            .find(".setup(move |app|")
            .expect("primary user setup should remain discoverable");
        let initial_route = run[user_setup..]
            .find("router.recover_and_route_os_args(")
            .map(|offset| user_setup + offset)
            .expect("primary user setup should recover and route through one worker");
        let routing_ready = run[user_setup..]
            .find("readiness.mark_ready()")
            .map(|offset| user_setup + offset)
            .expect("primary startup worker should publish routing readiness");
        let state_setup = source
            .split_once("fn open_request_state_plugin")
            .and_then(|(_, function)| function.split_once("\n}\n"))
            .map(|(function, _)| function)
            .expect("open request state plugin should remain discoverable");

        let readiness_state = run
            .find(".manage(OpenRequestStateReadiness::default())")
            .expect("readiness gate should be managed before plugins run");

        assert!(readiness_state < single_instance && single_instance < state_plugin);
        assert!(state_plugin < user_setup);
        assert!(user_setup < initial_route && initial_route < routing_ready);
        assert!(run[user_setup..initial_route].contains("tauri::async_runtime::spawn_blocking"));
        assert!(!run[user_setup..initial_route].contains("enqueue_os_args"));
        assert!(state_setup.contains("OpenRequestService::new("));
        assert!(state_setup.contains("app.manage(open_request_service)"));
        assert!(!state_setup.contains("try_state::<OpenRequestStateReadiness>()"));
        assert!(!state_setup.contains(".mark_ready()"));
        assert!(!state_setup.contains("enqueue_os_args"));
    }

    #[test]
    fn startup_recovery_and_initial_argv_are_dispatched_by_one_ordered_worker() {
        let source = include_str!("lib.rs");
        let setup = source
            .split_once(".setup(move |app| {")
            .and_then(|(_, setup)| setup.split_once(".invoke_handler"))
            .map(|(setup, _)| setup)
            .expect("application setup should remain discoverable");

        assert_eq!(setup.matches("spawn_blocking").count(), 1);
        assert!(setup.contains("router.recover_and_route_os_args("));
        assert!(!setup.contains("router.route_os_args("));
        assert!(!setup.contains("router.recover_active_targets_for_app("));
    }
}
