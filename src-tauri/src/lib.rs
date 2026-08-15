pub mod commands {
    pub mod assets;
    pub mod debug_log;
    pub mod file_watch;
    pub mod files;
    pub mod open_requests;
    pub mod opener;
    pub mod settings;
    pub mod workspace;
}

pub mod errors;

pub mod services {
    pub mod asset_service;
    pub mod debug_log_service;
    pub mod file_service;
    pub mod file_watch_service;
    pub mod open_request_service;
    pub mod opener_service;
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
use commands::file_watch::{replace_local_image_targets, unwatch_document, watch_document};
use commands::files::{
    files_read_text, files_show_open_file_dialog, files_show_open_image_dialog,
    files_show_save_file_dialog, files_write_text,
};
use commands::open_requests::open_requests_drain;
use commands::opener::{opener_open_url, opener_reveal_path};
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
use services::file_watch_service::{FileWatchService, FILE_WATCH_CHANGED_EVENT};
use services::open_request_service::{OpenRequestQueue, OPEN_REQUESTS_AVAILABLE_EVENT};
use services::workspace_session_service::WorkspaceSession;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let acceptance_config_dir = match acceptance_settings_config_dir_from_environment() {
        Ok(config_dir) => config_dir,
        Err(error) => panic!("invalid acceptance settings configuration: {}", error.code),
    };
    let builder = tauri::Builder::default()
        .manage(OpenRequestQueue::default())
        .manage(DebugLogService::default())
        .manage(WorkspaceSession::default());
    let builder = if acceptance_config_dir.is_some() {
        builder
    } else {
        builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let should_notify = match app
                .state::<OpenRequestQueue>()
                .enqueue_utf8_args(&args, std::path::Path::new(&cwd))
            {
                Ok(queued) => queued,
                Err(error) => {
                    eprintln!("failed to queue desktop open request: {}", error.message);
                    true
                }
            };
            if should_notify {
                if let Err(error) = app.emit(OPEN_REQUESTS_AVAILABLE_EVENT, ()) {
                    eprintln!("failed to emit desktop open request event: {error}");
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.unminimize() {
                    eprintln!("failed to restore main window: {error}");
                }
                if let Err(error) = window.show() {
                    eprintln!("failed to show main window: {error}");
                }
                if let Err(error) = window.set_focus() {
                    eprintln!("failed to focus main window: {error}");
                }
            }
        }))
    };
    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
            let cwd = std::env::current_dir()?;
            if let Err(error) = app.state::<OpenRequestQueue>().enqueue_os_args(&args, &cwd) {
                eprintln!(
                    "failed to queue initial desktop open request: {}",
                    error.message
                );
            }

            let app_handle = app.handle().clone();
            let watcher = FileWatchService::new(move |event| {
                if let Err(error) = app_handle.emit(FILE_WATCH_CHANGED_EVENT, event) {
                    eprintln!("failed to emit file watch event: {error}");
                }
            });
            if !app.manage(watcher) {
                return Err(std::io::Error::other("file watcher state is already managed").into());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            files_read_text,
            files_write_text,
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
            open_requests_drain,
            opener_open_url,
            opener_reveal_path,
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
