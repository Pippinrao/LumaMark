pub mod commands {
    pub mod files;
}

pub mod errors;

pub mod services {
    pub mod file_service;
}

use commands::files::{
    files_read_text, files_show_open_file_dialog, files_show_save_file_dialog, files_write_text,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            files_read_text,
            files_write_text,
            files_show_open_file_dialog,
            files_show_save_file_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running LumaMark");
}
