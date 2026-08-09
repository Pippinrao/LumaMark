use tauri::{AppHandle, Manager, State};

use crate::{
    errors::AppError,
    services::debug_log_service::{debug_log_directory, DebugLogService},
};

#[tauri::command]
pub fn debug_append_log(
    app: AppHandle,
    service: State<'_, DebugLogService>,
    line: String,
) -> Result<bool, AppError> {
    let app_data = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            "debug.app_data_unavailable",
            "Application data directory is unavailable.",
            true,
        )
    })?;

    service.append_line(&debug_log_directory(&app_data), &line)
}
