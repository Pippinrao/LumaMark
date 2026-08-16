use std::path::{Path, PathBuf};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::trash_service::TrashService;
use crate::services::workspace_mutation_service::{
    create_directory, create_file, delete_entry_with_app_archive, rename_entry, OsTrashMover,
};
use crate::services::workspace_service::{
    list_children, open_directory, WorkspaceDirectory, WorkspaceEntry,
};
use crate::services::workspace_session_service::WorkspaceSession;

#[tauri::command]
pub async fn workspace_open_directory(
    app: AppHandle,
    workspace_session: State<'_, WorkspaceSession>,
) -> Result<Option<WorkspaceDirectory>, AppError> {
    let selected = app.dialog().file().blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = dialog_path_to_path_buf(selected)?;
    open_workspace_path_and_activate(&path, &workspace_session).map(Some)
}

#[tauri::command]
pub fn workspace_open_path(
    path: String,
    workspace_session: State<'_, WorkspaceSession>,
) -> Result<WorkspaceDirectory, AppError> {
    open_workspace_path_and_activate(Path::new(&path), &workspace_session)
}

#[tauri::command]
pub fn workspace_list_children(path: String) -> Result<Vec<WorkspaceEntry>, AppError> {
    list_children(PathBuf::from(path))
}

#[tauri::command]
pub fn workspace_create_file(
    workspace_root: String,
    parent_path: String,
    name: String,
    workspace_session: State<'_, WorkspaceSession>,
) -> Result<WorkspaceEntry, AppError> {
    create_file_for_active_workspace(
        &workspace_session,
        Path::new(&workspace_root),
        Path::new(&parent_path),
        &name,
    )
}

#[tauri::command]
pub fn workspace_create_directory(
    workspace_root: String,
    parent_path: String,
    name: String,
    workspace_session: State<'_, WorkspaceSession>,
) -> Result<WorkspaceEntry, AppError> {
    let active_root = workspace_session.authorize_claimed_root(Path::new(&workspace_root))?;
    create_directory(active_root.path(), Path::new(&parent_path), &name)
}

#[tauri::command]
pub fn workspace_rename_entry(
    workspace_root: String,
    path: String,
    new_name: String,
    workspace_session: State<'_, WorkspaceSession>,
) -> Result<WorkspaceEntry, AppError> {
    let active_root = workspace_session.authorize_claimed_root(Path::new(&workspace_root))?;
    rename_entry(active_root.path(), Path::new(&path), &new_name)
}

#[tauri::command]
pub fn workspace_delete_entry(
    workspace_root: String,
    path: String,
    workspace_session: State<'_, WorkspaceSession>,
    trash_service: State<'_, TrashService>,
) -> Result<(), AppError> {
    let active_root = workspace_session.authorize_claimed_root(Path::new(&workspace_root))?;
    let created_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| {
            AppError::new(
                "trash.clock_unavailable",
                "The system clock is unavailable.",
                true,
            )
        })?
        .as_millis() as u64;
    delete_entry_with_app_archive(
        active_root.path(),
        Path::new(&path),
        &OsTrashMover,
        trash_service.inner(),
        created_at_ms,
    )
}

fn open_workspace_path_and_activate(
    path: &Path,
    workspace_session: &WorkspaceSession,
) -> Result<WorkspaceDirectory, AppError> {
    let workspace = open_directory(path)?;
    workspace_session.activate(path)?;
    Ok(workspace)
}

fn create_file_for_active_workspace(
    workspace_session: &WorkspaceSession,
    claimed_root: &Path,
    parent_path: &Path,
    name: &str,
) -> Result<WorkspaceEntry, AppError> {
    let active_root = workspace_session.authorize_claimed_root(claimed_root)?;
    create_file(active_root.path(), parent_path, name)
}

fn dialog_path_to_path_buf(path: tauri_plugin_dialog::FilePath) -> Result<PathBuf, AppError> {
    path.into_path().map_err(|_| AppError::invalid_path())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::services::workspace_session_service::WorkspaceSession;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumamark-workspace-command-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[test]
    fn opening_a_workspace_path_activates_it_for_mutations() {
        let root = unique_test_dir("activate");
        let session = WorkspaceSession::default();

        let workspace = open_workspace_path_and_activate(&root, &session)
            .expect("opening a directory should activate its canonical root");
        let entry = create_file_for_active_workspace(&session, &root, &root, "active.md")
            .expect("active workspace should authorize mutation");

        assert_eq!(workspace.path, root.to_string_lossy());
        assert_eq!(PathBuf::from(entry.path), root.join("active.md"));
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn mutation_rejects_claim_when_no_workspace_was_opened() {
        let root = unique_test_dir("inactive");
        let session = WorkspaceSession::default();

        let error = create_file_for_active_workspace(&session, &root, &root, "blocked.md")
            .expect_err("mutation must not trust an unactivated claimed root");

        assert_eq!(error.code, "file.invalid_path");
        assert!(!root.join("blocked.md").exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn mutation_rejects_a_different_claimed_root_after_activation() {
        let active = unique_test_dir("claimed-active");
        let other = unique_test_dir("claimed-other");
        let session = WorkspaceSession::default();
        open_workspace_path_and_activate(&active, &session).expect("activate workspace");

        let error = create_file_for_active_workspace(&session, &other, &other, "blocked.md")
            .expect_err("a caller-provided root must match the active workspace");

        assert_eq!(error.code, "file.invalid_path");
        assert!(!other.join("blocked.md").exists());
        fs::remove_dir_all(active).expect("cleanup active");
        fs::remove_dir_all(other).expect("cleanup other");
    }

    #[test]
    fn failed_workspace_switch_preserves_the_previous_active_root() {
        let active = unique_test_dir("failed-switch-active");
        let other = unique_test_dir("failed-switch-other");
        let not_a_directory = other.join("note.md");
        fs::write(&not_a_directory, "# note").expect("file");
        let session = WorkspaceSession::default();
        open_workspace_path_and_activate(&active, &session).expect("activate workspace");

        let error = open_workspace_path_and_activate(&not_a_directory, &session)
            .expect_err("a file cannot replace the active workspace");

        assert_eq!(error.code, "workspace.not_directory");
        create_file_for_active_workspace(&session, &active, &active, "still-active.md")
            .expect("failed switch must leave the previous active workspace intact");
        assert!(active.join("still-active.md").exists());
        fs::remove_dir_all(active).expect("cleanup active");
        fs::remove_dir_all(other).expect("cleanup other");
    }
}
