use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;

use crate::errors::AppError;
use crate::services::asset_service::{
    fetch_remote_image_bytes, resolve_draft_image, resolve_local_image,
};
use crate::services::file_service::write_bytes_atomically;

pub const MAX_EXPORT_HTML_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_EXPORT_ASSET_BYTES: u64 = 12 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteExportResult {
    pub byte_length: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedExportImage {
    pub byte_length: u64,
    pub data_uri: String,
    pub mime_type: String,
}

pub fn validate_output_path(
    path: &str,
    expected_extension: &str,
) -> Result<PathBuf, AppError> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_path());
    }

    let mut path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::invalid_path());
    }

    if path.extension().is_none() {
        path.set_extension(expected_extension);
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if extension != expected_extension {
        return Err(AppError::invalid_path());
    }

    if let Some(parent) = path.parent() {
        if !parent.is_dir() {
            return Err(AppError::invalid_path());
        }
    }

    Ok(path)
}

pub fn write_export_html(
    path: &str,
    html: &str,
    force: bool,
) -> Result<WriteExportResult, AppError> {
    let path = validate_output_path(path, "html")?;
    let byte_length = html.len() as u64;
    if byte_length > MAX_EXPORT_HTML_BYTES {
        return Err(AppError::new(
            "export.html_too_large",
            "The exported HTML is too large.",
            true,
        ));
    }

    if force {
        write_bytes_atomically(&path, html.as_bytes())?;
    } else {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    AppError::new(
                        "export.output_exists",
                        "The output file already exists.",
                        true,
                    )
                } else {
                    AppError::from(error)
                }
            })?;
        file.write_all(html.as_bytes())?;
    }

    Ok(WriteExportResult {
        byte_length,
        path: path.to_string_lossy().into_owned(),
    })
}

pub fn embed_image(
    document_path: Option<&Path>,
    source: &str,
    app_data_directory: &Path,
) -> Result<EmbeddedExportImage, AppError> {
    let source = source.trim();
    if source.is_empty() {
        return Err(unsupported_image());
    }

    if source.starts_with("data:") {
        return embed_data_uri(source);
    }

    let (bytes, mime_type) = if source.starts_with("lumamark-draft://") {
        let path = resolve_draft_image(app_data_directory, source)?;
        let bytes = read_image(&path)?;
        let mime = mime_type_for_path(&path)
            .ok()
            .or_else(|| mime_type_for_bytes(&bytes))
            .ok_or_else(unsupported_image)?;
        (bytes, mime)
    } else if source.starts_with("http://") || source.starts_with("https://") {
        let bytes = fetch_remote_image_bytes(source).map_err(|_| {
            AppError::new(
                "export.image_remote_failed",
                "Remote image could not be downloaded.",
                true,
            )
        })?;
        let mime = mime_type_for_remote(source)
            .ok()
            .or_else(|| mime_type_for_bytes(&bytes))
            .ok_or_else(unsupported_image)?;
        (bytes, mime)
    } else {
        if document_path.is_none() && Path::new(source).is_relative() {
            return Err(AppError::new(
                "export.image_relative_without_document",
                "Relative image requires a document path.",
                true,
            ));
        }
        let path = resolve_local_image(document_path, Path::new(source))?;
        let bytes = read_image(&path)?;
        let mime = mime_type_for_path(&path)
            .ok()
            .or_else(|| mime_type_for_bytes(&bytes))
            .ok_or_else(unsupported_image)?;
        (bytes, mime)
    };

    if bytes.len() as u64 > MAX_EXPORT_ASSET_BYTES {
        return Err(AppError::new(
            "export.image_too_large",
            "Image is too large to embed.",
            true,
        ));
    }

    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(EmbeddedExportImage {
        byte_length: bytes.len() as u64,
        data_uri: format!("data:{mime_type};base64,{encoded}"),
        mime_type: mime_type.to_owned(),
    })
}

fn embed_data_uri(source: &str) -> Result<EmbeddedExportImage, AppError> {
    let Some(rest) = source.strip_prefix("data:") else {
        return Err(unsupported_image());
    };
    let Some((metadata, payload)) = rest.split_once(',') else {
        return Err(unsupported_image());
    };
    let mut parts = metadata.split(';');
    let mime_type = parts.next().unwrap_or_default();
    let is_base64 = parts.any(|part| part.eq_ignore_ascii_case("base64"));
    if !is_base64 || !mime_type.starts_with("image/") {
        return Err(unsupported_image());
    }

    let byte_length = source.len() as u64;
    if byte_length > (MAX_EXPORT_ASSET_BYTES / 3) * 4 + 4 {
        return Err(AppError::new(
            "export.image_too_large",
            "Image is too large to embed.",
            true,
        ));
    }
    if payload.is_empty() {
        return Err(unsupported_image());
    }

    Ok(EmbeddedExportImage {
        byte_length,
        data_uri: source.to_owned(),
        mime_type: mime_type.to_owned(),
    })
}

fn read_image(path: &Path) -> Result<Vec<u8>, AppError> {
    let metadata = fs::metadata(path).map_err(|_| {
        AppError::new(
            "export.image_read_failed",
            "Image file could not be read.",
            true,
        )
    })?;
    if !metadata.is_file() {
        return Err(AppError::new(
            "export.image_read_failed",
            "Image file could not be read.",
            true,
        ));
    }
    if metadata.len() > MAX_EXPORT_ASSET_BYTES {
        return Err(AppError::new(
            "export.image_too_large",
            "Image is too large to embed.",
            true,
        ));
    }

    fs::read(path).map_err(|_| {
        AppError::new(
            "export.image_read_failed",
            "Image file could not be read.",
            true,
        )
    })
}

fn mime_type_for_path(path: &Path) -> Result<&'static str, AppError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    mime_type_for_extension(&extension).ok_or_else(unsupported_image)
}

fn mime_type_for_remote(source: &str) -> Result<&'static str, AppError> {
    let path = source
        .split(['?', '#'])
        .next()
        .unwrap_or(source)
        .rsplit('/')
        .next()
        .unwrap_or_default();
    let extension = path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    mime_type_for_extension(&extension).ok_or_else(unsupported_image)
}

fn mime_type_for_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn mime_type_for_bytes(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    let text = std::str::from_utf8(bytes).ok()?.trim_start();
    if text.starts_with("<svg") || (text.starts_with("<?xml") && text.contains("<svg")) {
        return Some("image/svg+xml");
    }
    None
}

fn unsupported_image() -> AppError {
    AppError::new(
        "export.image_unsupported",
        "Image type is not supported for export.",
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_directory(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "lumamark-export-service-{name}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("temp directory");
        directory
    }

    #[test]
    fn output_paths_require_an_absolute_supported_extension() {
        let directory = temp_directory("paths");
        let output = directory.join("note");

        let resolved = validate_output_path(output.to_str().unwrap(), "html").expect("valid");
        assert_eq!(resolved.extension().and_then(|value| value.to_str()), Some("html"));

        let wrong = directory.join("note.pdf");
        assert_eq!(
            validate_output_path(wrong.to_str().unwrap(), "html")
                .expect_err("wrong extension")
                .code,
            "file.invalid_path"
        );
        assert_eq!(
            validate_output_path("relative.html", "html")
                .expect_err("relative path")
                .code,
            "file.invalid_path"
        );
    }

    #[test]
    fn html_write_refuses_existing_files_unless_forced() {
        let directory = temp_directory("write");
        let path = directory.join("note.html");
        let path_string = path.to_str().unwrap();

        let first = write_export_html(path_string, "<p>one</p>", false).expect("first write");
        assert_eq!(first.byte_length, 10);
        assert_eq!(
            write_export_html(path_string, "<p>two</p>", false)
                .expect_err("existing output")
                .code,
            "export.output_exists"
        );

        write_export_html(path_string, "<p>two</p>", true).expect("forced write");
        assert_eq!(fs::read_to_string(&path).expect("read"), "<p>two</p>");
    }

    #[test]
    fn local_images_are_embedded_as_data_uris() {
        let directory = temp_directory("image");
        let document = directory.join("note.md");
        fs::write(&document, "").expect("document");
        let image = directory.join("pic.png");
        fs::write(&image, [0x89, b'P', b'N', b'G']).expect("image");

        let embedded = embed_image(
            Some(&document),
            "pic.png",
            &directory.join("app-data"),
        )
        .expect("embed");

        assert_eq!(embedded.mime_type, "image/png");
        assert!(embedded.data_uri.starts_with("data:image/png;base64,"));
        assert_eq!(embedded.byte_length, 4);
    }

    #[test]
    fn image_bytes_are_detected_without_a_filename_extension() {
        assert_eq!(mime_type_for_bytes(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(mime_type_for_bytes(b"\xff\xd8\xff\xe0"), Some("image/jpeg"));
        assert_eq!(mime_type_for_bytes(b"GIF89a"), Some("image/gif"));
        assert_eq!(
            mime_type_for_bytes(b"RIFF\0\0\0\0WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(
            mime_type_for_bytes(b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"),
            Some("image/svg+xml")
        );
        assert_eq!(mime_type_for_bytes(b"not an image"), None);
    }

    #[test]
    fn relative_images_without_a_document_fail_with_a_stable_code() {
        let directory = temp_directory("relative");
        let error = embed_image(None, "pic.png", &directory.join("app-data"))
            .expect_err("relative image");
        assert_eq!(error.code, "export.image_relative_without_document");
    }

    #[test]
    fn data_uri_images_are_passed_through_after_validation() {
        let directory = temp_directory("data");
        let source = "data:image/png;base64,AAAA";
        let embedded = embed_image(None, source, &directory.join("app-data")).expect("data uri");
        assert_eq!(embedded.data_uri, source);
        assert_eq!(embedded.mime_type, "image/png");
    }
}
