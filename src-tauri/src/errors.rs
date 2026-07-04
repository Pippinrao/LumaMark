use std::io;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, recoverable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recoverable,
        }
    }

    pub fn invalid_path() -> Self {
        Self::new(
            "file.invalid_path",
            "File path is invalid or unavailable.",
            true,
        )
    }

    pub fn invalid_encoding() -> Self {
        Self::new("file.invalid_encoding", "File is not valid UTF-8.", true)
    }
}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        let (code, message) = match error.kind() {
            io::ErrorKind::NotFound => ("file.not_found", "File was not found."),
            io::ErrorKind::PermissionDenied => {
                ("file.permission_denied", "File access was denied.")
            }
            io::ErrorKind::AlreadyExists => ("file.already_exists", "File already exists."),
            io::ErrorKind::InvalidData => ("file.invalid_encoding", "File is not valid UTF-8."),
            _ => ("file.io_error", "File operation failed."),
        };

        Self::new(code, message, true)
    }
}

#[cfg(test)]
mod tests {
    use std::io;

    use super::*;

    #[test]
    fn from_io_error_should_use_stable_error_message() {
        let error = io::Error::new(io::ErrorKind::PermissionDenied, "localized os text");

        let app_error = AppError::from(error);

        assert_eq!(app_error.message, "File access was denied.");
    }
}
