use std::fs::{self, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::services::file_service::{normalize_path, read_text};
use crate::services::trash_service::{TrashArchiveRequest, TrashReason, TrashService};
use crate::services::workspace_service::{
    display_name_for_entry, is_markdown_file_path, path_to_string_for_entry, WorkspaceEntry,
    WorkspaceEntryKind,
};

pub trait TrashMover {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError>;
}

pub fn create_file(
    workspace_root: impl AsRef<Path>,
    parent_path: impl AsRef<Path>,
    name: &str,
) -> Result<WorkspaceEntry, AppError> {
    let validated_name = validate_entry_name(name)?;
    let target = resolve_child_path(
        workspace_root.as_ref(),
        parent_path.as_ref(),
        validated_name,
    )?;
    if !is_markdown_file_path(&target) {
        return Err(AppError::new(
            "workspace.invalid_entry_name",
            "New workspace files must use a Markdown extension.",
            true,
        ));
    }
    ensure_does_not_exist(&target)?;
    ensure_parent_is_directory(parent_path.as_ref(), workspace_root.as_ref())?;
    create_file_exclusively(&target)?;
    entry_from_path(&target)
}

pub fn create_directory(
    workspace_root: impl AsRef<Path>,
    parent_path: impl AsRef<Path>,
    name: &str,
) -> Result<WorkspaceEntry, AppError> {
    let target = resolve_child_path(workspace_root.as_ref(), parent_path.as_ref(), name)?;
    ensure_does_not_exist(&target)?;
    ensure_parent_is_directory(parent_path.as_ref(), workspace_root.as_ref())?;
    fs::create_dir(&target)?;
    Ok(WorkspaceEntry {
        kind: WorkspaceEntryKind::Directory,
        name: display_name_for_entry(&target, &path_to_string_for_entry(&target)?),
        path: path_to_string_for_entry(&target)?,
    })
}

pub fn rename_entry(
    workspace_root: impl AsRef<Path>,
    path: impl AsRef<Path>,
    new_name: &str,
) -> Result<WorkspaceEntry, AppError> {
    let root = authorize_workspace_root(workspace_root.as_ref())?;
    let source = authorize_existing_entry(&root, path.as_ref())?;
    if existing_paths_are_same(&source, &root)? {
        return Err(AppError::invalid_path());
    }
    let source_kind = entry_from_path(&source)?.kind;
    let validated_name = validate_entry_name(new_name)?;
    let parent = source.parent().ok_or_else(AppError::invalid_path)?;
    let target = parent.join(validated_name);
    let normalized_target = normalize_path(&target).map_err(|_| AppError::invalid_path())?;
    ensure_new_path_parent_inside_workspace(&root, &normalized_target)?;
    if source_kind == WorkspaceEntryKind::MarkdownFile && !is_markdown_file_path(&normalized_target)
    {
        return Err(AppError::new(
            "workspace.invalid_entry_name",
            "Workspace files must use a Markdown extension.",
            true,
        ));
    }
    if normalized_target != source {
        ensure_does_not_exist(&normalized_target)?;
        fs::rename(&source, &normalized_target)?;
    }
    entry_from_path(&normalized_target)
}

pub fn delete_entry<T: TrashMover>(
    workspace_root: impl AsRef<Path>,
    path: impl AsRef<Path>,
    trash: &T,
) -> Result<(), AppError> {
    let root = authorize_workspace_root(workspace_root.as_ref())?;
    let target = authorize_existing_entry(&root, path.as_ref())?;
    if existing_paths_are_same(&target, &root)? {
        return Err(AppError::invalid_path());
    }
    entry_from_path(&target)?;
    trash.move_to_trash(&target)?;
    Ok(())
}

pub fn delete_entry_with_app_archive<T: TrashMover>(
    workspace_root: impl AsRef<Path>,
    path: impl AsRef<Path>,
    os_trash: &T,
    app_trash: &TrashService,
    created_at_ms: u64,
) -> Result<(), AppError> {
    let root = authorize_workspace_root(workspace_root.as_ref())?;
    let target = authorize_existing_entry(&root, path.as_ref())?;
    if existing_paths_are_same(&target, &root)? {
        return Err(AppError::invalid_path());
    }
    entry_from_path(&target)?;
    archive_markdown_targets(&target, app_trash, created_at_ms)?;
    os_trash.move_to_trash(&target)?;
    Ok(())
}

fn archive_markdown_targets(
    target: &Path,
    app_trash: &TrashService,
    created_at_ms: u64,
) -> Result<(), AppError> {
    for file in collect_markdown_files(target)? {
        let text = read_text(&file)?.text;
        app_trash.archive(TrashArchiveRequest {
            created_at_ms,
            reason: TrashReason::Delete,
            source_path: Some(path_to_string_for_entry(&file)?),
            text,
        })?;
    }
    Ok(())
}

fn collect_markdown_files(path: &Path) -> Result<Vec<PathBuf>, AppError> {
    let mut files = Vec::new();
    collect_markdown_files_into(path, &mut files)?;
    Ok(files)
}

fn collect_markdown_files_into(
    path: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), AppError> {
    let metadata = fs::metadata(path)?;
    if metadata.is_file() {
        if is_markdown_file_path(path) {
            files.push(path.to_path_buf());
        }
        return Ok(());
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path)? {
            collect_markdown_files_into(&entry?.path(), files)?;
        }
    }
    Ok(())
}

pub struct OsTrashMover;

impl TrashMover for OsTrashMover {
    fn move_to_trash(&self, path: &Path) -> Result<(), AppError> {
        move_path_to_recycle_bin(path)
    }
}

fn move_path_to_recycle_bin(path: &Path) -> Result<(), AppError> {
    #[cfg(windows)]
    {
        windows_move_to_recycle_bin(path)
    }

    #[cfg(not(windows))]
    {
        let _ = path;
        Err(AppError::new(
            "workspace.trash_unavailable",
            "Moving files to the Recycle Bin is unavailable on this platform.",
            true,
        ))
    }
}

#[cfg(windows)]
fn windows_move_to_recycle_bin(path: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;

    if !path.exists() {
        return Err(AppError::new("file.not_found", "File was not found.", true));
    }

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    // Double-null termination required by SHFileOperationW.
    wide.push(0);
    wide.push(0);

    // FO_DELETE = 0x0003, FOF_ALLOWUNDO = 0x0040, FOF_NOCONFIRMATION = 0x0010,
    // FOF_SILENT = 0x0004, FOF_NOERRORUI = 0x0400
    const FO_DELETE: u32 = 0x0003;
    const FOF_ALLOWUNDO: u16 = 0x0040;
    const FOF_NOCONFIRMATION: u16 = 0x0010;
    const FOF_SILENT: u16 = 0x0004;
    const FOF_NOERRORUI: u16 = 0x0400;

    #[repr(C)]
    struct ShFileOpStructW {
        hwnd: *mut core::ffi::c_void,
        w_func: u32,
        p_from: *const u16,
        p_to: *const u16,
        f_flags: u16,
        f_any_operations_aborted: i32,
        h_name_mappings: *mut core::ffi::c_void,
        lpsz_progress_title: *const u16,
    }

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHFileOperationW(file_op: *mut ShFileOpStructW) -> i32;
    }

    let mut file_op = ShFileOpStructW {
        hwnd: core::ptr::null_mut(),
        w_func: FO_DELETE,
        p_from: wide.as_ptr(),
        p_to: core::ptr::null(),
        f_flags: FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI,
        f_any_operations_aborted: 0,
        h_name_mappings: core::ptr::null_mut(),
        lpsz_progress_title: core::ptr::null(),
    };

    // SAFETY: wide is double-null terminated and lives for the call duration.
    let result = unsafe { SHFileOperationW(&mut file_op) };
    if result != 0 || file_op.f_any_operations_aborted != 0 || path.exists() {
        return Err(AppError::new(
            "workspace.trash_unavailable",
            "Unable to move path to the Recycle Bin.",
            true,
        ));
    }

    Ok(())
}

fn resolve_child_path(
    workspace_root: &Path,
    parent_path: &Path,
    name: &str,
) -> Result<PathBuf, AppError> {
    let root = authorize_workspace_root(workspace_root)?;
    let parent = authorize_inside_workspace(&root, parent_path)?;
    let validated_name = validate_entry_name(name)?;
    let target = parent.join(validated_name);
    let normalized = normalize_path(&target).map_err(|_| AppError::invalid_path())?;
    ensure_new_path_parent_inside_workspace(&root, &normalized)?;
    Ok(normalized)
}

fn ensure_parent_is_directory(parent_path: &Path, workspace_root: &Path) -> Result<(), AppError> {
    let root = authorize_workspace_root(workspace_root)?;
    let parent = authorize_inside_workspace(&root, parent_path)?;
    let metadata = fs::metadata(&parent)?;
    if !metadata.is_dir() {
        return Err(AppError::workspace_not_directory());
    }
    Ok(())
}

fn authorize_workspace_root(workspace_root: &Path) -> Result<PathBuf, AppError> {
    let root = normalize_path(workspace_root).map_err(|_| AppError::invalid_path())?;
    let metadata = fs::metadata(&root).map_err(|_| AppError::invalid_path())?;
    if !metadata.is_dir() {
        return Err(AppError::workspace_not_directory());
    }
    Ok(root)
}

fn authorize_inside_workspace(root: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let normalized = normalize_path(path).map_err(|_| AppError::invalid_path())?;
    ensure_existing_path_inside_workspace(root, &normalized)?;
    Ok(normalized)
}

fn authorize_existing_entry(root: &Path, path: &Path) -> Result<PathBuf, AppError> {
    let normalized = normalize_path(path).map_err(|_| AppError::invalid_path())?;
    if !normalized.exists() {
        return Err(AppError::new("file.not_found", "File was not found.", true));
    }
    ensure_existing_path_inside_workspace(root, &normalized)?;
    Ok(normalized)
}

fn ensure_existing_path_inside_workspace(root: &Path, path: &Path) -> Result<(), AppError> {
    let canonical_root = fs::canonicalize(root).map_err(|_| AppError::invalid_path())?;
    let canonical_path = fs::canonicalize(path).map_err(|_| AppError::invalid_path())?;

    if canonical_path == canonical_root || canonical_path.strip_prefix(&canonical_root).is_ok() {
        return Ok(());
    }

    Err(AppError::invalid_path())
}

fn existing_paths_are_same(left: &Path, right: &Path) -> Result<bool, AppError> {
    let canonical_left = fs::canonicalize(left).map_err(|_| AppError::invalid_path())?;
    let canonical_right = fs::canonicalize(right).map_err(|_| AppError::invalid_path())?;
    Ok(canonical_left == canonical_right)
}

fn ensure_new_path_parent_inside_workspace(root: &Path, path: &Path) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(AppError::invalid_path)?;
    ensure_existing_path_inside_workspace(root, parent)
}

fn ensure_does_not_exist(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(entry_already_exists()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::from(error)),
    }
}

fn create_file_exclusively(path: &Path) -> Result<(), AppError> {
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(entry_already_exists()),
        Err(error) => Err(AppError::from(error)),
    }
}

fn entry_already_exists() -> AppError {
    AppError::new("file.already_exists", "File already exists.", true)
}

fn validate_entry_name(name: &str) -> Result<&str, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
        || !is_windows_compatible_entry_name(trimmed)
    {
        return Err(AppError::invalid_path());
    }
    Ok(trimmed)
}

fn is_windows_compatible_entry_name(name: &str) -> bool {
    if name.ends_with('.')
        || name.chars().any(|character| {
            character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
        })
    {
        return false;
    }

    let device_base = name
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    !matches!(
        device_base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn entry_from_path(path: &Path) -> Result<WorkspaceEntry, AppError> {
    let metadata = fs::metadata(path)?;
    let path_string = path_to_string_for_entry(path)?;
    let kind = if metadata.is_dir() {
        WorkspaceEntryKind::Directory
    } else if metadata.is_file() && is_markdown_file_path(path) {
        WorkspaceEntryKind::MarkdownFile
    } else {
        return Err(AppError::invalid_path());
    };

    Ok(WorkspaceEntry {
        kind,
        name: display_name_for_entry(path, &path_string),
        path: path_string,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct RecordingTrash {
        calls: RefCell<Vec<PathBuf>>,
        fail: bool,
    }

    impl TrashMover for RecordingTrash {
        fn move_to_trash(&self, path: &Path) -> Result<(), AppError> {
            self.calls.borrow_mut().push(path.to_path_buf());
            if self.fail {
                return Err(AppError::new(
                    "workspace.trash_unavailable",
                    "Unable to move path to the Recycle Bin.",
                    true,
                ));
            }
            // Simulate recycle-bin success by removing the path from the fixture tree.
            if path.is_dir() {
                fs::remove_dir_all(path).map_err(AppError::from)?;
            } else {
                fs::remove_file(path).map_err(AppError::from)?;
            }
            Ok(())
        }
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumamark-workspace-mutation-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[cfg(windows)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        if std::os::windows::fs::symlink_dir(target, link).is_ok() {
            return Ok(());
        }

        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()?;
        if status.success() {
            Ok(())
        } else {
            Err(std::io::Error::other("directory link is unavailable"))
        }
    }

    #[cfg(unix)]
    fn create_directory_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[cfg(windows)]
    fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_file(target, link)
    }

    #[cfg(unix)]
    fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    #[test]
    fn create_file_happy_path_creates_empty_markdown_file() {
        let root = unique_test_dir("create-file");
        let entry = create_file(&root, &root, "note.md").expect("file should be created");

        assert_eq!(entry.kind, WorkspaceEntryKind::MarkdownFile);
        assert_eq!(entry.name, "note.md");
        assert!(PathBuf::from(&entry.path).is_file());
        assert_eq!(fs::read_to_string(&entry.path).unwrap(), "");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn create_directory_happy_path() {
        let root = unique_test_dir("create-dir");
        let entry = create_directory(&root, &root, "Drafts").expect("directory should be created");

        assert_eq!(entry.kind, WorkspaceEntryKind::Directory);
        assert_eq!(entry.name, "Drafts");
        assert!(PathBuf::from(&entry.path).is_dir());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rename_entry_happy_path() {
        let root = unique_test_dir("rename");
        let source = root.join("old.md");
        fs::write(&source, "# old").expect("write");

        let entry = rename_entry(&root, &source, "new.md").expect("rename should succeed");

        assert_eq!(entry.name, "new.md");
        assert!(!source.exists());
        assert!(PathBuf::from(&entry.path).is_file());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_entry_happy_path_uses_trash_api() {
        let root = unique_test_dir("delete");
        let file = root.join("gone.md");
        fs::write(&file, "# gone").expect("write");
        let trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: false,
        };

        delete_entry(&root, &file, &trash).expect("delete should succeed");

        assert_eq!(
            trash.calls.borrow().as_slice(),
            [normalize_path(&file).unwrap()]
        );
        assert!(!file.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_markdown_file_archives_into_app_trash_before_os_recycle_bin() {
        let root = unique_test_dir("delete-archive");
        let trash_root = unique_test_dir("delete-archive-trash");
        let file = root.join("gone.md");
        fs::write(&file, "\u{feff}# 标题\r\n").expect("write");
        let app_trash = crate::services::trash_service::TrashService::open(
            trash_root.join("trash"),
            crate::services::trash_service::TrashLimits {
                max_entries: 10,
                max_total_bytes: 10_000,
            },
        )
        .expect("open trash");
        let os_trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: false,
        };

        delete_entry_with_app_archive(&root, &file, &os_trash, &app_trash, 1_700_000_000_000)
            .expect("delete should succeed");

        assert_eq!(
            os_trash.calls.borrow().as_slice(),
            [normalize_path(&file).unwrap()]
        );
        assert!(!file.exists());
        let entries = app_trash.list().expect("list");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].reason,
            crate::services::trash_service::TrashReason::Delete
        );
        let restored = app_trash.read(&entries[0].id).expect("read");
        assert_eq!(restored.text, "\u{feff}# 标题\r\n");
        fs::remove_dir_all(root).expect("cleanup");
        fs::remove_dir_all(trash_root).expect("cleanup");
    }

    #[test]
    fn delete_does_not_os_trash_when_archive_fails() {
        let root = unique_test_dir("delete-archive-fail");
        let trash_root = unique_test_dir("delete-archive-fail-trash");
        let file = root.join("huge.md");
        fs::write(&file, "too-big").expect("write");
        let app_trash = crate::services::trash_service::TrashService::open(
            trash_root.join("trash"),
            crate::services::trash_service::TrashLimits {
                max_entries: 1,
                max_total_bytes: 3,
            },
        )
        .expect("open trash");
        let os_trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: false,
        };

        let error = delete_entry_with_app_archive(&root, &file, &os_trash, &app_trash, 1)
            .expect_err("archive should fail");
        assert_eq!(error.code, "trash.item_too_large");
        assert!(file.exists());
        assert!(os_trash.calls.borrow().is_empty());
        fs::remove_dir_all(root).expect("cleanup");
        fs::remove_dir_all(trash_root).expect("cleanup");
    }

    #[test]
    fn path_escape_with_parent_segments_returns_invalid_path_without_mutation() {
        let root = unique_test_dir("escape-root");
        let outside = unique_test_dir("escape-outside");
        let escaped_parent = root.join("..").join(outside.file_name().unwrap());

        let error = create_file(&root, &escaped_parent, "evil.md")
            .expect_err("escaped parent should be rejected");

        assert_eq!(error.code, "file.invalid_path");
        assert!(!outside.join("evil.md").exists());
        fs::remove_dir_all(root).expect("cleanup");
        fs::remove_dir_all(outside).expect("cleanup");
    }

    #[test]
    fn symlinked_parent_cannot_escape_the_workspace() {
        let root = unique_test_dir("symlink-root");
        let outside = unique_test_dir("symlink-outside");
        let linked_parent = root.join("linked-outside");

        if create_directory_link(&outside, &linked_parent).is_err() {
            fs::remove_dir_all(root).expect("cleanup root after unavailable symlink");
            fs::remove_dir_all(outside).expect("cleanup outside after unavailable symlink");
            return;
        }

        let error = create_file(&root, &linked_parent, "escaped.md")
            .expect_err("a linked parent outside the workspace must be rejected");

        assert_eq!(error.code, "file.invalid_path");
        assert!(!outside.join("escaped.md").exists());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn dangling_file_link_is_a_conflict_and_cannot_create_outside_workspace() {
        let root = unique_test_dir("dangling-link-root");
        let outside = unique_test_dir("dangling-link-outside");
        let outside_target = outside.join("escaped.md");
        let linked_target = root.join("note.md");

        if create_file_link(&outside_target, &linked_target).is_err() {
            fs::remove_dir_all(root).expect("cleanup root after unavailable symlink");
            fs::remove_dir_all(outside).expect("cleanup outside after unavailable symlink");
            return;
        }

        let error = create_file(&root, &root, "note.md")
            .expect_err("a dangling file link must be treated as an occupied target");

        assert_eq!(error.code, "file.already_exists");
        assert!(!outside_target.exists());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[cfg(windows)]
    #[test]
    fn create_file_accepts_normal_parent_when_workspace_root_uses_different_case() {
        let root = unique_test_dir("root-case");
        let root_name = root.file_name().expect("root name").to_string_lossy();
        let alternate_name = root_name.to_ascii_uppercase();
        assert_ne!(alternate_name, root_name);
        let alternate_root = root.with_file_name(alternate_name);

        let entry = create_file(&alternate_root, &root, "note.md")
            .expect("Windows path casing must not change the canonical boundary");

        assert_eq!(
            PathBuf::from(entry.path),
            normalize_path(&root.join("note.md")).unwrap()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn rename_accepts_normal_source_when_workspace_root_uses_verbatim_prefix() {
        let root = unique_test_dir("root-prefix");
        let source = root.join("old.md");
        fs::write(&source, "# old").expect("source");
        let verbatim_root = PathBuf::from(format!(r"\\?\{}", root.display()));

        let entry = rename_entry(&verbatim_root, &source, "new.md")
            .expect("equivalent Windows path prefixes must share a canonical boundary");

        assert_eq!(
            PathBuf::from(entry.path),
            normalize_path(&root.join("new.md")).unwrap()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn path_escape_via_name_returns_invalid_path() {
        let root = unique_test_dir("escape-name");

        let error = create_directory(&root, &root, "../outside")
            .expect_err("escaped name should be rejected");

        assert_eq!(error.code, "file.invalid_path");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn entry_names_reject_windows_prefix_device_and_normalization_hazards() {
        for invalid in [
            "C:escaped.md",
            "CON.md",
            "lpt1.markdown",
            "question?.md",
            "trailing-dot.",
        ] {
            let error = validate_entry_name(invalid)
                .expect_err("workspace entry names must remain portable to Windows");
            assert_eq!(error.code, "file.invalid_path", "name: {invalid}");
        }
    }

    #[test]
    fn name_conflict_returns_explicit_error_without_overwrite() {
        let root = unique_test_dir("conflict");
        let existing = root.join("note.md");
        fs::write(&existing, "keep me").expect("write");

        let error = create_file(&root, &root, "note.md").expect_err("conflict");

        assert_eq!(error.code, "file.already_exists");
        assert_eq!(fs::read_to_string(&existing).unwrap(), "keep me");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn exclusive_file_creation_refuses_an_existing_target_without_truncation() {
        let root = unique_test_dir("exclusive-create-conflict");
        let existing = root.join("note.md");
        fs::write(&existing, "keep me").expect("existing file");

        let error = create_file_exclusively(&existing)
            .expect_err("exclusive file creation must not replace an existing target");

        assert_eq!(error.code, "file.already_exists");
        assert_eq!(fs::read_to_string(&existing).unwrap(), "keep me");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rename_conflict_does_not_overwrite() {
        let root = unique_test_dir("rename-conflict");
        let left = root.join("left.md");
        let right = root.join("right.md");
        fs::write(&left, "left").expect("write");
        fs::write(&right, "right").expect("write");

        let error = rename_entry(&root, &left, "right.md").expect_err("conflict");

        assert_eq!(error.code, "file.already_exists");
        assert_eq!(fs::read_to_string(&left).unwrap(), "left");
        assert_eq!(fs::read_to_string(&right).unwrap(), "right");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rename_markdown_file_rejects_non_markdown_target_without_mutation() {
        let root = unique_test_dir("rename-non-markdown-target");
        let source = root.join("note.md");
        let rejected_target = root.join("note.txt");
        fs::write(&source, "# note").expect("source");

        let error = rename_entry(&root, &source, "note.txt")
            .expect_err("file-tree files must remain Markdown files");

        assert_eq!(error.code, "workspace.invalid_entry_name");
        assert_eq!(fs::read_to_string(&source).unwrap(), "# note");
        assert!(!rejected_target.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_rejects_non_workspace_file_kind_without_calling_trash() {
        let root = unique_test_dir("delete-non-workspace-kind");
        let text_file = root.join("notes.txt");
        fs::write(&text_file, "keep").expect("text file");
        let trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: false,
        };

        let error = delete_entry(&root, &text_file, &trash)
            .expect_err("hidden non-workspace file kinds must not be mutable through the tree API");

        assert_eq!(error.code, "file.invalid_path");
        assert!(trash.calls.borrow().is_empty());
        assert_eq!(fs::read_to_string(&text_file).unwrap(), "keep");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_leaves_file_when_trash_unavailable() {
        let root = unique_test_dir("trash-fail");
        let file = root.join("keep.md");
        fs::write(&file, "keep").expect("write");
        let trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: true,
        };

        let error = delete_entry(&root, &file, &trash).expect_err("trash failure");

        assert_eq!(error.code, "workspace.trash_unavailable");
        assert!(file.exists());
        assert_eq!(fs::read_to_string(&file).unwrap(), "keep");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_rejects_workspace_root() {
        let root = unique_test_dir("delete-root");
        let trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: false,
        };

        let error = delete_entry(&root, &root, &trash).expect_err("root delete rejected");

        assert_eq!(error.code, "file.invalid_path");
        assert!(trash.calls.borrow().is_empty());
        assert!(root.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_rejects_workspace_root_reached_through_an_equivalent_alias() {
        let container = unique_test_dir("delete-root-alias");
        let real_root = container.join("real-root");
        let linked_root = container.join("linked-root");
        fs::create_dir_all(&real_root).expect("real root");
        create_directory_link(&real_root, &linked_root).expect("directory link fixture");
        let trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: true,
        };

        let error = delete_entry(&linked_root, &real_root, &trash)
            .expect_err("canonical workspace root aliases must remain undeletable");

        assert_eq!(error.code, "file.invalid_path");
        assert!(trash.calls.borrow().is_empty());
        assert!(real_root.exists());
        fs::remove_dir_all(container).expect("cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn delete_rejects_workspace_root_when_input_casing_differs() {
        let root = unique_test_dir("delete-root-case");
        let root_name = root.file_name().expect("root name").to_string_lossy();
        let alternate_name = root_name.to_ascii_uppercase();
        assert_ne!(alternate_name, root_name);
        let alternate_root = root.with_file_name(alternate_name);
        let trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: true,
        };

        let error = delete_entry(&alternate_root, &root, &trash)
            .expect_err("Windows path casing must not weaken root deletion protection");

        assert_eq!(error.code, "file.invalid_path");
        assert!(trash.calls.borrow().is_empty());
        assert!(root.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn delete_api_has_no_permanent_delete_flag() {
        // Compile-time contract: delete_entry only accepts trash mover, never a force flag.
        let root = unique_test_dir("no-force");
        let file = root.join("a.md");
        fs::write(&file, "a").expect("write");
        let trash = RecordingTrash {
            calls: RefCell::new(Vec::new()),
            fail: false,
        };
        delete_entry(&root, &file, &trash).expect("trash delete");
        assert!(!file.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
