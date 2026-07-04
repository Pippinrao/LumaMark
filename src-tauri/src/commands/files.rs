use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::file_service::{read_text, write_text, ReadTextResult, WriteTextResult};

#[tauri::command]
pub fn files_read_text(path: String) -> Result<ReadTextResult, AppError> {
    read_text(PathBuf::from(path))
}

#[tauri::command]
pub fn files_write_text(path: String, text: String) -> Result<WriteTextResult, AppError> {
    write_text(PathBuf::from(path), &text)
}

#[tauri::command]
pub async fn files_show_open_file_dialog(app: AppHandle) -> Result<Option<String>, AppError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown"])
        .blocking_pick_file();

    selected.map(dialog_path_to_string).transpose()
}

#[tauri::command]
pub async fn files_show_save_file_dialog(app: AppHandle) -> Result<Option<String>, AppError> {
    let selected = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown"])
        .blocking_save_file();

    selected.map(dialog_path_to_string).transpose()
}

fn dialog_path_to_string(path: tauri_plugin_dialog::FilePath) -> Result<String, AppError> {
    let path = path.into_path().map_err(|_| AppError::invalid_path())?;

    Ok(path.to_string_lossy().into_owned())
}
