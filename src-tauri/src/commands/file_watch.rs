use std::path::{Path, PathBuf};

use tauri::{State, WebviewWindow};

use crate::errors::AppError;
use crate::services::file_watch_service::{FileWatchError, WatchDocumentResult};
use crate::services::file_watch_session_hub::FileWatchSessionHub;

#[tauri::command]
pub fn watch_document(
    path: String,
    window: WebviewWindow,
    watcher: State<'_, FileWatchSessionHub>,
) -> Result<WatchDocumentResult, AppError> {
    watcher
        .watch_document(window.label(), Path::new(&path))
        .map_err(file_watch_error_to_app_error)
}

#[tauri::command]
pub fn replace_local_image_targets(
    paths: Vec<String>,
    window: WebviewWindow,
    watcher: State<'_, FileWatchSessionHub>,
) -> Result<(), AppError> {
    let paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    watcher
        .replace_local_image_targets(window.label(), &paths)
        .map_err(file_watch_error_to_app_error)
}

#[tauri::command]
pub fn unwatch_document(
    window: WebviewWindow,
    watcher: State<'_, FileWatchSessionHub>,
) -> Result<(), AppError> {
    watcher
        .unwatch_document(window.label())
        .map_err(file_watch_error_to_app_error)
}

pub(crate) fn file_watch_error_to_app_error(error: FileWatchError) -> AppError {
    AppError::new("file.watch_error", error.to_string(), true)
}

#[cfg(test)]
mod tests {
    use super::file_watch_error_to_app_error;
    use crate::services::file_watch_service::FileWatchError;

    #[test]
    fn watch_error_should_map_to_a_stable_recoverable_app_error() {
        let app_error = file_watch_error_to_app_error(FileWatchError::StatePoisoned);

        assert_eq!(app_error.code, "file.watch_error");
        assert!(app_error.recoverable);
    }
}
