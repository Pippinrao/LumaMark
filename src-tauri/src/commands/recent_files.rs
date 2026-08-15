use tauri::{AppHandle, Emitter, Manager};

use crate::{
    errors::AppError,
    services::recent_files_service::{RecentFileInput, RecentFilesService, RecentFilesSnapshot},
};

pub const RECENT_FILES_CHANGED_EVENT: &str = "recent-files://changed";

#[tauri::command]
pub async fn recent_files_get(app: AppHandle) -> Result<RecentFilesSnapshot, AppError> {
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || worker_app.state::<RecentFilesService>().get())
        .await
        .map_err(|_| recent_files_task_failed())?
}

#[tauri::command]
pub async fn recent_files_add(
    app: AppHandle,
    file: RecentFileInput,
) -> Result<RecentFilesSnapshot, AppError> {
    let worker_app = app.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        worker_app.state::<RecentFilesService>().add(file)
    })
    .await
    .map_err(|_| recent_files_task_failed())??;
    emit_changed(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn recent_files_clear(app: AppHandle) -> Result<RecentFilesSnapshot, AppError> {
    let worker_app = app.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        worker_app.state::<RecentFilesService>().clear()
    })
    .await
    .map_err(|_| recent_files_task_failed())??;
    emit_changed(&app, &snapshot)?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn recent_files_import_legacy(
    app: AppHandle,
    files: Vec<RecentFileInput>,
) -> Result<RecentFilesSnapshot, AppError> {
    let worker_app = app.clone();
    let snapshot = tauri::async_runtime::spawn_blocking(move || {
        worker_app
            .state::<RecentFilesService>()
            .import_legacy(files)
    })
    .await
    .map_err(|_| recent_files_task_failed())??;
    emit_changed(&app, &snapshot)?;
    Ok(snapshot)
}

fn emit_changed(app: &AppHandle, snapshot: &RecentFilesSnapshot) -> Result<(), AppError> {
    app.emit(RECENT_FILES_CHANGED_EVENT, snapshot).map_err(|_| {
        AppError::new(
            "recent_files.event_failed",
            "Recent files change could not be broadcast.",
            true,
        )
    })
}

fn recent_files_task_failed() -> AppError {
    AppError::new(
        "recent_files.task_failed",
        "Recent files operation could not complete.",
        true,
    )
}
