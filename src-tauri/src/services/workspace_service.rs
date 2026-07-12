use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::errors::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind {
    Directory,
    MarkdownFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDirectory {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub kind: WorkspaceEntryKind,
    pub name: String,
    pub path: String,
}

pub fn open_directory(path: impl AsRef<Path>) -> Result<WorkspaceDirectory, AppError> {
    let path = path.as_ref();
    let metadata = fs::metadata(path)?;

    if !metadata.is_dir() {
        return Err(AppError::workspace_not_directory());
    }

    let path_string = path_to_string(path)?;

    Ok(WorkspaceDirectory {
        name: display_name(path, &path_string),
        path: path_string,
    })
}

pub fn list_children(path: impl AsRef<Path>) -> Result<Vec<WorkspaceEntry>, AppError> {
    let path = path.as_ref();
    open_directory(path)?;
    let mut entries = Vec::new();

    for entry in fs::read_dir(path)?.flatten() {
        if let Some(workspace_entry) = workspace_entry_from_dir_entry(entry) {
            entries.push(workspace_entry);
        }
    }

    entries.sort_by(|left, right| {
        entry_kind_order(&left.kind)
            .cmp(&entry_kind_order(&right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(entries)
}

fn workspace_entry_from_dir_entry(entry: fs::DirEntry) -> Option<WorkspaceEntry> {
    let entry_path = entry.path();
    let file_type = entry.file_type().ok()?;
    let kind = if file_type.is_dir() {
        Some(WorkspaceEntryKind::Directory)
    } else if file_type.is_file() && is_markdown_file(&entry_path) {
        Some(WorkspaceEntryKind::MarkdownFile)
    } else {
        None
    }?;
    let path = path_to_string(&entry_path).ok()?;

    Some(WorkspaceEntry {
        kind,
        name: display_name(&entry_path, &path),
        path,
    })
}

fn entry_kind_order(kind: &WorkspaceEntryKind) -> u8 {
    match kind {
        WorkspaceEntryKind::Directory => 0,
        WorkspaceEntryKind::MarkdownFile => 1,
    }
}

fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown"
            )
        })
        .unwrap_or(false)
}

fn display_name(path: &Path, fallback: &str) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| fallback.to_owned())
}

fn path_to_string(path: &Path) -> Result<String, AppError> {
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(AppError::invalid_path)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumamark-workspace-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[test]
    fn list_children_should_return_directories_and_markdown_files_only() {
        let dir = unique_test_dir("list-children");
        fs::create_dir_all(dir.join("Drafts")).expect("directory should be created");
        fs::write(dir.join("notes.txt"), "ignore").expect("text file should be written");
        fs::write(dir.join("README.md"), "# Readme").expect("markdown file should be written");
        fs::write(dir.join("journal.markdown"), "# Journal")
            .expect("markdown file should be written");

        let entries = list_children(&dir).expect("children should be listed");

        assert_eq!(
            entries
                .iter()
                .map(|entry| (&entry.name, &entry.kind))
                .collect::<Vec<_>>(),
            vec![
                (&"Drafts".to_string(), &WorkspaceEntryKind::Directory),
                (
                    &"journal.markdown".to_string(),
                    &WorkspaceEntryKind::MarkdownFile
                ),
                (&"README.md".to_string(), &WorkspaceEntryKind::MarkdownFile),
            ]
        );
        fs::remove_dir_all(dir).expect("test directory should be removed");
    }

    #[test]
    fn open_directory_should_reject_non_directory_paths_with_stable_error() {
        let dir = unique_test_dir("not-directory");
        let file = dir.join("note.md");
        fs::write(&file, "# Note").expect("file should be written");

        let error = open_directory(&file).expect_err("file path should be rejected");

        assert_eq!(error.code, "workspace.not_directory");
        fs::remove_dir_all(dir).expect("test directory should be removed");
    }
}
