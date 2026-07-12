use std::fs;
use std::io;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use atomic_write_file::AtomicWriteFile;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::errors::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadTextResult {
    pub byte_length: usize,
    pub fingerprint: String,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTextResult {
    pub byte_length: usize,
    pub fingerprint: String,
    pub path: String,
}

pub fn read_text(path: impl AsRef<Path>) -> Result<ReadTextResult, AppError> {
    let path = path.as_ref();
    let bytes = fs::read(path)?;
    let byte_length = bytes.len();
    let fingerprint = content_fingerprint(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| AppError::invalid_encoding())?;

    Ok(ReadTextResult {
        byte_length,
        fingerprint,
        path: path_to_string(path),
        text,
    })
}

pub fn write_text(path: impl AsRef<Path>, text: &str) -> Result<WriteTextResult, AppError> {
    let path = path.as_ref();
    write_bytes_atomically(path, text.as_bytes())?;

    Ok(WriteTextResult {
        byte_length: text.len(),
        fingerprint: content_fingerprint(text.as_bytes()),
        path: path_to_string(path),
    })
}

pub(crate) fn content_fingerprint(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn normalize_path(path: &Path) -> io::Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut normalized = PathBuf::new();

    for component in absolute.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    Ok(normalized)
}

pub(crate) fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    write_with_atomic_file(path, |file| {
        file.write_all(bytes)?;
        file.sync_all()
    })
}

fn write_with_atomic_file<F>(path: &Path, write_file: F) -> Result<(), AppError>
where
    F: FnOnce(&mut AtomicWriteFile) -> io::Result<()>,
{
    let mut file = AtomicWriteFile::open(path)?;

    if let Err(error) = write_file(&mut file) {
        let _ = file.discard();
        return Err(error.into());
    }

    file.commit().map_err(AppError::from)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
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
        let dir = std::env::temp_dir().join(format!("lumamark-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("test directory should be created");
        dir
    }

    #[test]
    fn read_text_should_return_utf8_markdown_content() {
        let dir = unique_test_dir("read-text");
        let path = dir.join("note.md");
        fs::write(&path, "# 标题\n\nHello LumaMark").expect("fixture should be written");

        let result = read_text(&path).expect("markdown file should be readable");

        assert_eq!(result.text, "# 标题\n\nHello LumaMark");
        fs::remove_dir_all(dir).expect("test directory should be removed");
    }

    #[test]
    fn read_text_should_return_the_content_sha256_fingerprint() {
        let dir = unique_test_dir("read-fingerprint");
        let path = dir.join("note.md");
        fs::write(&path, "abc").expect("fixture should be written");

        let result = read_text(&path).expect("markdown file should be readable");

        assert_eq!(
            result.fingerprint,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_dir_all(dir).expect("test directory should be removed");
    }

    #[test]
    fn write_text_should_preserve_exact_utf8_markdown_content() {
        let dir = unique_test_dir("write-text");
        let path = dir.join("note.md");

        write_text(&path, "# 标题\n\n**LumaMark**").expect("markdown file should be written");
        let result = fs::read_to_string(&path).expect("written markdown should be readable");

        assert_eq!(result, "# 标题\n\n**LumaMark**");
        fs::remove_dir_all(dir).expect("test directory should be removed");
    }

    #[test]
    fn write_text_should_return_the_written_content_sha256_fingerprint() {
        let dir = unique_test_dir("write-fingerprint");
        let path = dir.join("note.md");

        let result = write_text(&path, "abc").expect("markdown file should be written");

        assert_eq!(
            result.fingerprint,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_dir_all(dir).expect("test directory should be removed");
    }

    #[test]
    fn write_with_atomic_file_should_leave_existing_file_untouched_when_write_fails() {
        let dir = unique_test_dir("failed-write");
        let path = dir.join("note.md");
        fs::write(&path, "original").expect("original file should be written");

        let result = write_with_atomic_file(&path, |file| {
            file.write_all(b"new")?;
            Err(io::Error::other("synthetic write failure"))
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&path).expect("original file should still exist"),
            "original"
        );
        fs::remove_dir_all(dir).expect("test directory should be removed");
    }
}
