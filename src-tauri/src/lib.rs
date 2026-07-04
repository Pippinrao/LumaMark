pub mod commands {
    pub mod files;
    pub mod workspace;
}

pub mod errors;

pub mod services {
    pub mod file_service;
    pub mod workspace_service;
}

use commands::files::{
    files_read_text, files_show_open_file_dialog, files_show_save_file_dialog, files_write_text,
};
use commands::workspace::{workspace_list_children, workspace_open_directory};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            files_read_text,
            files_write_text,
            files_show_open_file_dialog,
            files_show_save_file_dialog,
            workspace_open_directory,
            workspace_list_children
        ])
        .run(tauri::generate_context!())
        .expect("error while running LumaMark");
}
