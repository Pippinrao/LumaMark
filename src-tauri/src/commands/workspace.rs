use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::workspace_service::{
    list_children, open_directory, WorkspaceDirectory, WorkspaceEntry,
};

#[tauri::command]
pub async fn workspace_open_directory(
    app: AppHandle,
) -> Result<Option<WorkspaceDirectory>, AppError> {
    let selected = app.dialog().file().blocking_pick_folder();

    selected
        .map(|path| dialog_path_to_path_buf(path).and_then(open_directory))
        .transpose()
}

#[tauri::command]
pub fn workspace_list_children(path: String) -> Result<Vec<WorkspaceEntry>, AppError> {
    list_children(PathBuf::from(path))
}

fn dialog_path_to_path_buf(path: tauri_plugin_dialog::FilePath) -> Result<PathBuf, AppError> {
    path.into_path().map_err(|_| AppError::invalid_path())
}
