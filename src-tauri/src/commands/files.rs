use std::path::{Path, PathBuf};

use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::commands::document_claims::claim_error_to_app_error;
use crate::errors::AppError;
use crate::services::document_claim_service::DocumentClaimService;
use crate::services::file_service::{read_text, write_text, ReadTextResult, WriteTextResult};
use crate::services::file_watch_service::FileWatchError;
use crate::services::file_watch_session_hub::FileWatchSessionHub;

#[tauri::command]
pub fn files_read_text(path: String) -> Result<ReadTextResult, AppError> {
    read_text(PathBuf::from(path))
}

#[tauri::command]
pub fn files_read_text_claimed(
    path: String,
    session_id: String,
    operation_id: u64,
    window: WebviewWindow,
    claims: State<'_, DocumentClaimService>,
) -> Result<ReadTextResult, AppError> {
    read_text_with_claim(&claims, window.label(), &session_id, operation_id, &path)
}

#[tauri::command]
pub fn files_write_text(
    path: String,
    text: String,
    window: WebviewWindow,
    watcher: State<'_, FileWatchSessionHub>,
) -> Result<WriteTextResult, AppError> {
    write_text_and_record(&watcher, window.label(), Path::new(&path), &text)
}

#[tauri::command]
pub fn files_write_text_claimed(
    path: String,
    text: String,
    session_id: String,
    operation_id: u64,
    window: WebviewWindow,
    claims: State<'_, DocumentClaimService>,
    watcher: State<'_, FileWatchSessionHub>,
) -> Result<WriteTextResult, AppError> {
    write_text_with_claim_and_record(
        &claims,
        &watcher,
        window.label(),
        &session_id,
        operation_id,
        &path,
        &text,
    )
}

fn read_text_with_claim(
    claims: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
    operation_id: u64,
    document_path: &str,
) -> Result<ReadTextResult, AppError> {
    let mut result = claims
        .with_validated_operation_io(
            window_label,
            session_id,
            operation_id,
            document_path,
            |io_target| read_text(io_target),
        )
        .map_err(claim_error_to_app_error)??;
    result.path = document_path.to_owned();
    Ok(result)
}

#[cfg(test)]
fn write_text_with_claim(
    claims: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
    operation_id: u64,
    document_path: &str,
    text: &str,
) -> Result<WriteTextResult, AppError> {
    let mut result = claims
        .with_validated_operation_io(
            window_label,
            session_id,
            operation_id,
            document_path,
            |io_target| write_text(io_target, text),
        )
        .map_err(claim_error_to_app_error)??;
    result.path = document_path.to_owned();
    Ok(result)
}

fn write_text_with_claim_and_record(
    claims: &DocumentClaimService,
    watcher: &FileWatchSessionHub,
    window_label: &str,
    session_id: &str,
    operation_id: u64,
    document_path: &str,
    text: &str,
) -> Result<WriteTextResult, AppError> {
    let mut result = claims
        .with_validated_operation_io(
            window_label,
            session_id,
            operation_id,
            document_path,
            |io_target| {
                let result = write_text(io_target, text)?;
                let record_result = watcher.record_document_saved(
                    window_label,
                    Path::new(document_path),
                    text.as_bytes(),
                );
                Ok::<_, AppError>(preserve_successful_write(result, record_result))
            },
        )
        .map_err(claim_error_to_app_error)??;
    result.path = document_path.to_owned();
    Ok(result)
}

fn write_text_and_record(
    watcher: &FileWatchSessionHub,
    window_label: &str,
    path: &Path,
    text: &str,
) -> Result<WriteTextResult, AppError> {
    let result = write_text(path, text)?;
    let record_result = watcher.record_document_saved(window_label, path, text.as_bytes());
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
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[cfg(windows)]
    use std::process::Command;

    use super::{
        preserve_successful_write, read_text_with_claim, write_text_and_record,
        write_text_with_claim, write_text_with_claim_and_record,
    };
    use crate::services::document_claim_service::{
        ClaimOperation, CommitOutcome, DocumentClaimService, ReleaseOperationOutcome,
        ReserveOutcome,
    };
    use crate::services::file_service::WriteTextResult;
    use crate::services::file_watch_service::{FileWatchError, FileWatchEventKind};
    use crate::services::file_watch_session_hub::FileWatchSessionHub;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-files-command-{name}-{nanos}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    #[cfg(windows)]
    fn create_directory_alias(target: &Path, alias: &Path) {
        if std::os::windows::fs::symlink_dir(target, alias).is_ok() {
            return;
        }
        let output = Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(alias)
            .arg(target)
            .output()
            .expect("junction creation should launch");
        assert!(
            output.status.success(),
            "junction creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(unix)]
    fn create_directory_alias(target: &Path, alias: &Path) {
        std::os::unix::fs::symlink(target, alias).expect("directory symlink should be created");
    }

    fn retarget_directory_alias(alias: &Path, target: &Path) {
        #[cfg(windows)]
        fs::remove_dir(alias).expect("junction should be removable");
        #[cfg(unix)]
        fs::remove_file(alias).expect("symlink should be removable");
        create_directory_alias(target, alias);
    }

    fn reserve_alias_path(claims: &DocumentClaimService, path: &Path, operation_id: u64) {
        assert!(matches!(
            claims
                .reserve(
                    "window-a",
                    ClaimOperation::new("session-a", operation_id),
                    path.to_str().expect("test path should be Unicode"),
                )
                .expect("alias path should reserve"),
            ReserveOutcome::Reserved { .. }
        ));
    }

    #[test]
    fn claimed_read_rejects_an_alias_retarget_before_reading_the_new_target() {
        let directory = unique_test_dir("claimed-read-retarget");
        let target_a = directory.join("target-a");
        let target_b = directory.join("target-b");
        let alias = directory.join("alias");
        fs::create_dir_all(&target_a).expect("first target should exist");
        fs::create_dir_all(&target_b).expect("second target should exist");
        fs::write(target_a.join("note.md"), "content-a").expect("first file should exist");
        fs::write(target_b.join("note.md"), "content-b").expect("second file should exist");
        create_directory_alias(&target_a, &alias);
        let alias_path = alias.join("note.md");
        let claims = DocumentClaimService::new().expect("claim service should initialize");
        reserve_alias_path(&claims, &alias_path, 1);
        retarget_directory_alias(&alias, &target_b);

        let error = read_text_with_claim(
            &claims,
            "window-a",
            "session-a",
            1,
            alias_path.to_str().expect("test path should be Unicode"),
        )
        .expect_err("the real read boundary must reject the retargeted alias");

        assert_eq!(error.code, "document_claim.path_identity_changed");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn claimed_write_rejects_an_alias_retarget_without_modifying_the_new_target() {
        let directory = unique_test_dir("claimed-write-retarget");
        let target_a = directory.join("target-a");
        let target_b = directory.join("target-b");
        let alias = directory.join("alias");
        fs::create_dir_all(&target_a).expect("first target should exist");
        fs::create_dir_all(&target_b).expect("second target should exist");
        fs::write(target_a.join("note.md"), "content-a").expect("first file should exist");
        fs::write(target_b.join("note.md"), "content-b").expect("second file should exist");
        create_directory_alias(&target_a, &alias);
        let alias_path = alias.join("note.md");
        let claims = DocumentClaimService::new().expect("claim service should initialize");
        reserve_alias_path(&claims, &alias_path, 2);
        retarget_directory_alias(&alias, &target_b);
        let watcher = FileWatchSessionHub::new(|_, _| {});

        let error = write_text_with_claim_and_record(
            &claims,
            &watcher,
            "window-a",
            "session-a",
            2,
            alias_path.to_str().expect("test path should be Unicode"),
            "must-not-write",
        )
        .expect_err("the real write boundary must reject the retargeted alias");

        assert_eq!(error.code, "document_claim.path_identity_changed");
        assert_eq!(
            fs::read_to_string(target_b.join("note.md")).expect("second file should remain"),
            "content-b"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn claimed_io_uses_the_stable_canonical_target_but_preserves_the_display_path() {
        let directory = unique_test_dir("claimed-stable-target");
        let target = directory.join("target");
        let alias = directory.join("alias");
        fs::create_dir_all(&target).expect("target should exist");
        fs::write(target.join("note.md"), "content-a").expect("file should exist");
        create_directory_alias(&target, &alias);
        let alias_path = alias.join("note.md");
        let display_path = alias_path.to_str().expect("test path should be Unicode");
        let claims = DocumentClaimService::new().expect("claim service should initialize");
        reserve_alias_path(&claims, &alias_path, 3);

        let read = read_text_with_claim(&claims, "window-a", "session-a", 3, display_path)
            .expect("stable claimed path should read");
        let write = write_text_with_claim(
            &claims,
            "window-a",
            "session-a",
            3,
            display_path,
            "updated-a",
        )
        .expect("stable claimed path should write");

        assert_eq!(read.text, "content-a");
        assert_eq!(read.path, display_path);
        assert_eq!(write.path, display_path);
        assert_eq!(
            fs::read_to_string(target.join("note.md")).expect("target should be readable"),
            "updated-a"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn claimed_io_rejects_a_released_terminal_tuple_without_writing() {
        let directory = unique_test_dir("claimed-released-terminal");
        let document = directory.join("note.md");
        fs::write(&document, "before").expect("file should exist");
        let display_path = document.to_str().expect("test path should be Unicode");
        let claims = DocumentClaimService::new().expect("claim service should initialize");
        reserve_alias_path(&claims, &document, 4);
        assert_eq!(
            claims
                .release_operation("window-a", "session-a", 4, display_path)
                .expect("reservation should release"),
            ReleaseOperationOutcome::Released
        );
        let watcher = FileWatchSessionHub::new(|_, _| {});

        let error = write_text_with_claim_and_record(
            &claims,
            &watcher,
            "window-a",
            "session-a",
            4,
            display_path,
            "must-not-write",
        )
        .expect_err("released terminal tuple must not perform I/O");

        assert_eq!(error.code, "document_claim.stale_operation");
        assert_eq!(
            fs::read_to_string(&document).expect("file should remain readable"),
            "before"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn claimed_alias_save_suppresses_the_callers_watch_but_not_an_equivalent_observer() {
        let directory = unique_test_dir("claimed-alias-watch");
        let target = directory.join("target");
        let alias = directory.join("alias");
        fs::create_dir_all(&target).expect("target should exist");
        let canonical_path = target.join("note.md");
        fs::write(&canonical_path, "before").expect("test document should exist");
        create_directory_alias(&target, &alias);
        let alias_path = alias.join("note.md");
        let display_path = alias_path.to_str().expect("test path should be Unicode");
        let (sender, receiver) = mpsc::channel();
        let watcher = FileWatchSessionHub::new(move |label, event| {
            sender
                .send((label.to_owned(), event))
                .expect("test event receiver should remain connected");
        });
        watcher
            .watch_document("window-a", &alias_path)
            .expect("caller should watch its display alias");
        watcher
            .watch_document("window-b", &canonical_path)
            .expect("other window should watch the equivalent canonical path");
        while receiver.try_recv().is_ok() {}

        let claims = DocumentClaimService::new().expect("claim service should initialize");
        reserve_alias_path(&claims, &alias_path, 5);
        assert_eq!(
            claims
                .commit_operation("window-a", "session-a", 5, display_path)
                .expect("the alias reservation should commit"),
            CommitOutcome::Committed
        );
        write_text_with_claim_and_record(
            &claims,
            &watcher,
            "window-a",
            "session-a",
            5,
            display_path,
            "saved through alias",
        )
        .expect("claimed alias save should succeed");

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let (label, event) = receiver
                .recv_timeout(remaining)
                .expect("the equivalent observer should receive the write");
            if event.kind != FileWatchEventKind::Document {
                continue;
            }
            assert_ne!(
                label, "window-a",
                "the caller's alias watcher must suppress its own claimed save"
            );
            if label == "window-b" {
                assert_eq!(PathBuf::from(event.path), canonical_path);
                break;
            }
        }
        let quiet_deadline = std::time::Instant::now() + Duration::from_millis(700);
        while let Ok((label, event)) = receiver
            .recv_timeout(quiet_deadline.saturating_duration_since(std::time::Instant::now()))
        {
            assert!(
                label != "window-a" || event.kind != FileWatchEventKind::Document,
                "the caller's alias watcher emitted its own claimed save"
            );
            if std::time::Instant::now() >= quiet_deadline {
                break;
            }
        }
        assert_eq!(
            fs::read_to_string(&canonical_path).expect("canonical target should remain readable"),
            "saved through alias"
        );
        drop(watcher);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn write_text_should_not_emit_the_watchers_own_atomic_save() {
        let directory = unique_test_dir("self-save");
        let document = directory.join("note.md");
        fs::write(&document, "before").expect("initial document should be written");
        let (sender, receiver) = mpsc::channel();
        let watcher = FileWatchSessionHub::new(move |label, event| {
            sender
                .send((label.to_owned(), event))
                .expect("test event receiver should remain connected");
        });
        watcher
            .watch_document("window-a", &document)
            .expect("document should be watched");

        write_text_and_record(&watcher, "window-a", &document, "saved by lumamark")
            .expect("document should be saved");

        assert!(receiver.recv_timeout(Duration::from_millis(700)).is_err());
        drop(watcher);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn write_text_should_record_the_saved_fingerprint_for_only_the_calling_window() {
        let directory = unique_test_dir("caller-fingerprint");
        let document = directory.join("note.md");
        fs::write(&document, "before").expect("initial document should be written");
        let (sender, receiver) = mpsc::channel();
        let watcher = FileWatchSessionHub::new(move |label, event| {
            sender
                .send((label.to_owned(), event))
                .expect("test event receiver should remain connected");
        });
        watcher
            .watch_document("window-a", &document)
            .expect("first window should watch the document");
        watcher
            .watch_document("window-b", &document)
            .expect("second window should watch the document");
        while receiver.try_recv().is_ok() {}

        write_text_and_record(&watcher, "window-a", &document, "saved by window a")
            .expect("document should be saved");
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let (label, event) = loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let observed = receiver
                .recv_timeout(remaining)
                .expect("the other window should observe the saved content");
            if observed.1.kind == FileWatchEventKind::Document {
                break observed;
            }
        };

        assert_eq!(label, "window-b");
        assert_eq!(PathBuf::from(event.path), document);
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
