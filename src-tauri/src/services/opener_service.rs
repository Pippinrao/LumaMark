use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::AppError;
use crate::services::file_service::normalize_path;
use crate::services::workspace_service::is_markdown_file_path;

pub trait UrlOpener {
    fn open_url(&self, url: &str) -> Result<(), AppError>;
}

pub trait PathRevealer {
    fn reveal_item(&self, path: &Path) -> Result<(), AppError>;
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlResult {
    pub opened: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealPathResult {
    pub revealed: bool,
}

pub fn classify_external_url(url: &str) -> Result<(), AppError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::new("link.empty", "URL is empty.", true));
    }

    let scheme = trimmed
        .split_once(':')
        .map(|(scheme, _)| scheme.to_ascii_lowercase());

    match scheme.as_deref() {
        Some("http") | Some("https") | Some("mailto") => Ok(()),
        Some("javascript") => Err(AppError::new(
            "link.protocol_javascript",
            "javascript: URLs are not allowed.",
            true,
        )),
        Some("data") => Err(AppError::new(
            "link.protocol_data",
            "data: URLs are not allowed.",
            true,
        )),
        Some("file") => Err(AppError::new(
            "link.protocol_file",
            "file: URLs are not allowed.",
            true,
        )),
        Some(_) => Err(AppError::new(
            "link.protocol_rejected",
            "URL protocol is not allowed.",
            true,
        )),
        None => Err(AppError::new(
            "link.protocol_rejected",
            "Relative URLs cannot be opened externally.",
            true,
        )),
    }
}

pub fn open_external_url<O: UrlOpener>(
    url: &str,
    opener: &O,
) -> Result<OpenExternalUrlResult, AppError> {
    classify_external_url(url)?;
    opener.open_url(url.trim())?;
    Ok(OpenExternalUrlResult { opened: true })
}

pub fn authorize_reveal_path(
    path: &Path,
    workspace_root: Option<&Path>,
    document_path: Option<&Path>,
) -> Result<PathBuf, AppError> {
    if path.as_os_str().is_empty() {
        return Err(AppError::invalid_path());
    }

    let normalized = normalize_path(path).map_err(|_| AppError::invalid_path())?;

    if !normalized.exists() {
        return Err(AppError::new("file.not_found", "File was not found.", true));
    }

    let allowed = is_path_allowed(&normalized, workspace_root, document_path)?;
    if !allowed {
        return Err(AppError::invalid_path());
    }

    Ok(normalized)
}

pub fn reveal_path_in_os<R: PathRevealer>(
    path: &Path,
    workspace_root: Option<&Path>,
    document_path: Option<&Path>,
    revealer: &R,
) -> Result<RevealPathResult, AppError> {
    let authorized = authorize_reveal_path(path, workspace_root, document_path)?;
    revealer.reveal_item(&authorized)?;
    Ok(RevealPathResult { revealed: true })
}

fn is_path_allowed(
    path: &Path,
    workspace_root: Option<&Path>,
    document_path: Option<&Path>,
) -> Result<bool, AppError> {
    let canonical_path = fs::canonicalize(path).map_err(|_| AppError::invalid_path())?;

    if let Some(root) = workspace_root {
        let canonical_root = canonicalize_workspace_root(root)?;
        if is_same_or_descendant(&canonical_path, &canonical_root) {
            return Ok(true);
        }
    }

    if let Some(document) = document_path {
        let canonical_document_dir = canonicalize_document_directory(document)?;
        if is_same_or_descendant(&canonical_path, &canonical_document_dir) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn canonicalize_workspace_root(root: &Path) -> Result<PathBuf, AppError> {
    let normalized = normalize_path(root).map_err(|_| AppError::invalid_path())?;
    let metadata = fs::metadata(&normalized).map_err(|_| AppError::invalid_path())?;
    if !metadata.is_dir() {
        return Err(AppError::invalid_path());
    }
    fs::canonicalize(normalized).map_err(|_| AppError::invalid_path())
}

fn canonicalize_document_directory(document: &Path) -> Result<PathBuf, AppError> {
    let normalized = normalize_path(document).map_err(|_| AppError::invalid_path())?;
    let metadata = fs::metadata(&normalized).map_err(|_| AppError::invalid_path())?;
    if !metadata.is_file() || !is_markdown_file_path(&normalized) {
        return Err(AppError::invalid_path());
    }
    let canonical_document = fs::canonicalize(normalized).map_err(|_| AppError::invalid_path())?;
    canonical_document
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(AppError::invalid_path)
}

fn is_same_or_descendant(path: &Path, root: &Path) -> bool {
    if path == root {
        return true;
    }

    path.strip_prefix(root).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct RecordingOpener {
        calls: RefCell<Vec<String>>,
    }

    impl UrlOpener for RecordingOpener {
        fn open_url(&self, url: &str) -> Result<(), AppError> {
            self.calls.borrow_mut().push(url.to_string());
            Ok(())
        }
    }

    struct RecordingRevealer {
        calls: RefCell<Vec<PathBuf>>,
    }

    impl PathRevealer for RecordingRevealer {
        fn reveal_item(&self, path: &Path) -> Result<(), AppError> {
            self.calls.borrow_mut().push(path.to_path_buf());
            Ok(())
        }
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lumamark-opener-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("fixture directory should exist");
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

    #[test]
    fn rejects_javascript_without_calling_opener() {
        let opener = RecordingOpener {
            calls: RefCell::new(Vec::new()),
        };

        let error = open_external_url("javascript:alert(1)", &opener).unwrap_err();

        assert_eq!(error.code, "link.protocol_javascript");
        assert!(opener.calls.borrow().is_empty());
    }

    #[test]
    fn rejects_data_and_file_protocols_without_calling_opener() {
        let opener = RecordingOpener {
            calls: RefCell::new(Vec::new()),
        };

        assert_eq!(
            open_external_url("data:text/html,hi", &opener)
                .unwrap_err()
                .code,
            "link.protocol_data"
        );
        assert_eq!(
            open_external_url("file:///C:/temp/note.md", &opener)
                .unwrap_err()
                .code,
            "link.protocol_file"
        );
        assert!(opener.calls.borrow().is_empty());
    }

    #[test]
    fn opens_allowed_http_urls_through_injected_opener() {
        let opener = RecordingOpener {
            calls: RefCell::new(Vec::new()),
        };

        let result = open_external_url("https://example.com", &opener).expect("should open");

        assert!(result.opened);
        assert_eq!(opener.calls.borrow().as_slice(), ["https://example.com"]);
    }

    #[test]
    fn opens_mailto_urls() {
        let opener = RecordingOpener {
            calls: RefCell::new(Vec::new()),
        };

        open_external_url("mailto:user@example.com", &opener).expect("should open");
        assert_eq!(
            opener.calls.borrow().as_slice(),
            ["mailto:user@example.com"]
        );
    }

    #[test]
    fn reveals_paths_inside_the_workspace_root() {
        let root = unique_test_dir("workspace-root");
        let image = root.join("assets").join("pic.png");
        fs::create_dir_all(image.parent().expect("parent")).expect("assets dir");
        fs::write(&image, b"png").expect("image");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let result = reveal_path_in_os(&image, Some(&root), None, &revealer)
            .expect("workspace path should reveal");

        assert!(result.revealed);
        assert_eq!(
            revealer.calls.borrow().as_slice(),
            [normalize_path(&image).unwrap()]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn reveals_document_local_paths_without_workspace_root() {
        let directory = unique_test_dir("doc-local");
        let document = directory.join("note.md");
        let image = directory.join("assets").join("pic.png");
        fs::create_dir_all(image.parent().expect("parent")).expect("assets dir");
        fs::write(&document, "# note").expect("document");
        fs::write(&image, b"png").expect("image");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let result = reveal_path_in_os(&image, None, Some(&document), &revealer)
            .expect("document-local path should reveal");

        assert!(result.revealed);
        assert_eq!(
            revealer.calls.borrow().as_slice(),
            [normalize_path(&image).unwrap()]
        );
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn reveal_failure_returns_explicit_error_without_panic() {
        struct FailingRevealer;

        impl PathRevealer for FailingRevealer {
            fn reveal_item(&self, _path: &Path) -> Result<(), AppError> {
                Err(AppError::new(
                    "image.reveal_failed",
                    "Reveal is unavailable on this platform.",
                    true,
                ))
            }
        }

        let directory = unique_test_dir("reveal-fail");
        let document = directory.join("note.md");
        fs::write(&document, "# note").expect("document");

        let error = reveal_path_in_os(&document, None, Some(&document), &FailingRevealer)
            .expect_err("reveal failure should surface");

        assert_eq!(error.code, "image.reveal_failed");
        assert!(document.exists());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn rejects_escaped_paths_without_calling_revealer() {
        let root = unique_test_dir("escape-root");
        let outside = unique_test_dir("escape-outside");
        let secret = outside.join("secret.png");
        fs::write(&secret, b"png").expect("secret");
        let escaped = root
            .join("..")
            .join(outside.file_name().unwrap())
            .join("secret.png");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let error =
            reveal_path_in_os(&escaped, Some(&root), None, &revealer).expect_err("escape rejected");

        assert_eq!(error.code, "file.invalid_path");
        assert!(revealer.calls.borrow().is_empty());
        fs::remove_dir_all(root).expect("cleanup");
        fs::remove_dir_all(outside).expect("cleanup");
    }

    #[test]
    fn rejects_workspace_directory_link_escape_without_calling_revealer() {
        let root = unique_test_dir("workspace-link-root");
        let outside = unique_test_dir("workspace-link-outside");
        let linked_outside = root.join("linked-outside");
        let secret = outside.join("secret.png");
        fs::write(&secret, b"png").expect("secret");
        create_directory_link(&outside, &linked_outside).expect("directory link fixture");
        let escaped = linked_outside.join("secret.png");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let error = reveal_path_in_os(&escaped, Some(&root), None, &revealer)
            .expect_err("a linked workspace path must not authorize an outside target");

        assert_eq!(error.code, "file.invalid_path");
        assert!(revealer.calls.borrow().is_empty());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn rejects_document_directory_link_escape_without_calling_revealer() {
        let document_dir = unique_test_dir("document-link-root");
        let outside = unique_test_dir("document-link-outside");
        let document = document_dir.join("note.md");
        let linked_outside = document_dir.join("linked-outside");
        let secret = outside.join("secret.png");
        fs::write(&document, "# note").expect("document");
        fs::write(&secret, b"png").expect("secret");
        create_directory_link(&outside, &linked_outside).expect("directory link fixture");
        let escaped = linked_outside.join("secret.png");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let error = reveal_path_in_os(&escaped, None, Some(&document), &revealer)
            .expect_err("a linked document-local path must not authorize an outside target");

        assert_eq!(error.code, "file.invalid_path");
        assert!(revealer.calls.borrow().is_empty());
        fs::remove_dir_all(document_dir).expect("cleanup document directory");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn nonexistent_document_cannot_authorize_an_existing_sibling() {
        let directory = unique_test_dir("missing-document");
        let missing_document = directory.join("missing.md");
        let target = directory.join("target.png");
        fs::write(&target, b"png").expect("target");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let error = reveal_path_in_os(&target, None, Some(&missing_document), &revealer)
            .expect_err("an unverified document path must not grant reveal authority");

        assert_eq!(error.code, "file.invalid_path");
        assert!(revealer.calls.borrow().is_empty());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn non_markdown_document_cannot_authorize_an_existing_sibling() {
        let directory = unique_test_dir("non-markdown-document");
        let text_document = directory.join("notes.txt");
        let target = directory.join("target.png");
        fs::write(&text_document, "notes").expect("text document");
        fs::write(&target, b"png").expect("target");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let error = reveal_path_in_os(&target, None, Some(&text_document), &revealer)
            .expect_err("only an opened Markdown document may establish document-local authority");

        assert_eq!(error.code, "file.invalid_path");
        assert!(revealer.calls.borrow().is_empty());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn workspace_root_must_be_an_existing_directory() {
        let directory = unique_test_dir("workspace-root-file");
        let file = directory.join("not-a-workspace.md");
        fs::write(&file, "# note").expect("file");
        let revealer = RecordingRevealer {
            calls: RefCell::new(Vec::new()),
        };

        let error = reveal_path_in_os(&file, Some(&file), None, &revealer)
            .expect_err("a file cannot establish a workspace boundary");

        assert_eq!(error.code, "file.invalid_path");
        assert!(revealer.calls.borrow().is_empty());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[test]
    fn reveal_authorization_preserves_the_normalized_noncanonical_path() {
        let directory = unique_test_dir("linked-workspace-alias");
        let real_root = directory.join("real-root");
        let linked_root = directory.join("linked-root");
        fs::create_dir_all(&real_root).expect("real root");
        create_directory_link(&real_root, &linked_root).expect("directory link fixture");
        let linked_target = linked_root.join("note.md");
        fs::write(real_root.join("note.md"), "# note").expect("target");

        let authorized = authorize_reveal_path(&linked_target, Some(&linked_root), None)
            .expect("a target reached through the authorized root alias should remain valid");

        assert_eq!(authorized, normalize_path(&linked_target).unwrap());
        assert_ne!(authorized, fs::canonicalize(&linked_target).unwrap());
        fs::remove_dir_all(directory).expect("cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn reveal_accepts_normal_target_when_workspace_root_uses_different_case() {
        let root = unique_test_dir("workspace-root-case");
        let target = root.join("note.md");
        fs::write(&target, "# note").expect("target");
        let root_name = root.file_name().expect("root name").to_string_lossy();
        let alternate_name = root_name.to_ascii_uppercase();
        assert_ne!(alternate_name, root_name);
        let alternate_root = root.with_file_name(alternate_name);

        let authorized = authorize_reveal_path(&target, Some(&alternate_root), None)
            .expect("Windows path casing must not change the canonical boundary");

        assert_eq!(authorized, normalize_path(&target).unwrap());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn reveal_accepts_normal_target_when_workspace_root_uses_verbatim_prefix() {
        let root = unique_test_dir("workspace-root-prefix");
        let target = root.join("note.md");
        fs::write(&target, "# note").expect("target");
        let verbatim_root = PathBuf::from(format!(r"\\?\{}", root.display()));

        let authorized = authorize_reveal_path(&target, Some(&verbatim_root), None)
            .expect("equivalent Windows path prefixes must share a canonical boundary");

        assert_eq!(authorized, normalize_path(&target).unwrap());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
