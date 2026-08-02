pub mod commands {
    pub mod assets;
    pub mod file_watch;
    pub mod files;
    pub mod workspace;
}

pub mod errors;

pub mod services {
    pub mod asset_service;
    pub mod file_service;
    pub mod file_watch_service;
    pub mod workspace_service;
}

use commands::assets::{
    assets_authorize_local_image, assets_cache_remote_image, assets_copy_local_image,
    assets_finalize_draft_images, assets_import_document_image, assets_import_draft_image,
};
use commands::file_watch::{replace_local_image_targets, unwatch_document, watch_document};
use commands::files::{
    files_read_text, files_show_open_file_dialog, files_show_open_image_dialog,
    files_show_save_file_dialog, files_write_text,
};
use commands::workspace::{workspace_list_children, workspace_open_directory};
use services::file_watch_service::{FileWatchService, FILE_WATCH_CHANGED_EVENT};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
            workspace_list_children
        ])
        .run(tauri::generate_context!())
        .expect("error while running LumaMark");
}
