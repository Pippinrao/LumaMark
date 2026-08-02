use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::file_service::{read_text, write_text, ReadTextResult, WriteTextResult};
use crate::services::file_watch_service::{FileWatchError, FileWatchService};

#[tauri::command]
pub fn files_read_text(path: String) -> Result<ReadTextResult, AppError> {
    read_text(PathBuf::from(path))
}

#[tauri::command]
pub fn files_write_text(
    path: String,
    text: String,
    watcher: State<'_, FileWatchService>,
) -> Result<WriteTextResult, AppError> {
    write_text_and_record(&watcher, Path::new(&path), &text)
}

fn write_text_and_record(
    watcher: &FileWatchService,
    path: &Path,
    text: &str,
) -> Result<WriteTextResult, AppError> {
    let result = write_text(path, text)?;
    let record_result = watcher.record_document_saved(path, text.as_bytes());
    Ok(preserve_successful_write(result, record_result))
}

fn preserve_successful_write(
    result: WriteTextResult,
    record_result: Result<(), FileWatchError>,
) -> WriteTextResult {
    if let Err(error) = record_result {
        eprintln!("failed to record saved document fingerprint: {error}");
    }
    result
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
pub async fn files_show_open_image_dialog(
    app: AppHandle,
    filter_label: String,
) -> Result<Option<Vec<String>>, AppError> {
    let selected = app
        .dialog()
        .file()
        .add_filter(
            filter_label,
            &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
        )
        .blocking_pick_files();

    selected
        .map(|paths| paths.into_iter().map(dialog_path_to_string).collect())
        .transpose()
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use super::{preserve_successful_write, write_text_and_record};
    use crate::services::file_service::WriteTextResult;
    use crate::services::file_watch_service::{FileWatchError, FileWatchService};

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-files-command-{name}-{nanos}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    #[test]
    fn write_text_should_not_emit_the_watchers_own_atomic_save() {
        let directory = unique_test_dir("self-save");
        let document = directory.join("note.md");
        fs::write(&document, "before").expect("initial document should be written");
        let (sender, receiver) = mpsc::channel();
        let watcher = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        watcher
            .watch_document(&document)
            .expect("document should be watched");

        write_text_and_record(&watcher, &document, "saved by lumamark")
            .expect("document should be saved");

        assert!(receiver.recv_timeout(Duration::from_millis(700)).is_err());
        drop(watcher);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn successful_write_should_remain_successful_when_watch_recording_fails() {
        let write_result = WriteTextResult {
            byte_length: 7,
            fingerprint: "fingerprint".to_string(),
            path: "note.md".to_string(),
        };

        let completed =
            preserve_successful_write(write_result.clone(), Err(FileWatchError::StatePoisoned));

        assert_eq!(completed, write_result);
    }
}
