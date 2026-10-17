use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::export_service::{
    embed_image, validate_output_path, write_export_html, EmbeddedExportImage,
    WriteExportResult, MAX_EXPORT_ASSET_BYTES, MAX_EXPORT_HTML_BYTES,
};
use crate::services::pdf_export_service::{print_webview_to_pdf, PdfPrintOptions};

const ACCEPTANCE_MODE_ENV: &str = "LUMAMARK_ACCEPTANCE_MODE";
const ACCEPTANCE_PATH_ENV: &str = "LUMAMARK_EXPORT_ACCEPTANCE_PATH";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCapabilities {
    pub max_asset_bytes: u64,
    pub max_html_bytes: u64,
    pub pdf_mode: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintedPdf {
    pub byte_length: u64,
    pub path: String,
}

#[tauri::command]
pub fn export_capabilities() -> ExportCapabilities {
    ExportCapabilities {
        max_asset_bytes: MAX_EXPORT_ASSET_BYTES,
        max_html_bytes: MAX_EXPORT_HTML_BYTES,
        pdf_mode: if cfg!(windows) {
            "direct"
        } else {
            "print-dialog"
        },
    }
}

#[tauri::command]
pub async fn export_show_save_dialog(
    app: AppHandle,
    kind: String,
    suggested_name: String,
    suggested_directory: Option<String>,
    document_path: Option<String>,
) -> Result<Option<String>, AppError> {
    let extension = match kind.as_str() {
        "html" => "html",
        "pdf" => "pdf",
        _ => return Err(AppError::invalid_path()),
    };

    if let Some(path) = acceptance_output_path()? {
        let path = validate_output_path(&path, extension)?;
        return Ok(Some(path.to_string_lossy().into_owned()));
    }

    let file_name = sanitize_suggested_name(&suggested_name, extension);
    let mut builder = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter(extension.to_ascii_uppercase(), &[extension]);

    let preferred_directory =
        preferred_export_directory(document_path.as_deref(), suggested_directory.as_deref());
    if let Some(directory) = preferred_directory {
        builder = builder.set_directory(directory);
    }

    let selected = builder.blocking_save_file();
    selected.map(dialog_path_to_string).transpose()
}

#[tauri::command]
pub fn export_write_html(
    path: String,
    html: String,
    force: bool,
) -> Result<WriteExportResult, AppError> {
    write_export_html(&path, &html, force)
}

#[tauri::command]
pub async fn export_embed_image(
    app: AppHandle,
    document_path: Option<String>,
    source: String,
) -> Result<EmbeddedExportImage, AppError> {
    let app_data_directory = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            "export.image_read_failed",
            "Application data directory is unavailable.",
            true,
        )
    })?;
    let document_path = document_path.map(PathBuf::from);

    tauri::async_runtime::spawn_blocking(move || {
        embed_image(document_path.as_deref(), &source, &app_data_directory)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "export.image_read_failed",
            "Image embedding task failed.",
            true,
        )
    })?
}

#[tauri::command]
pub async fn export_print_pdf(
    window: WebviewWindow,
    path: String,
) -> Result<PrintedPdf, AppError> {
    let path_for_print = path.clone();
    let byte_length = tauri::async_runtime::spawn_blocking(move || {
        print_webview_to_pdf(
            &window,
            &path_for_print,
            PdfPrintOptions {
                replace_existing: true,
            },
        )
    })
    .await
    .map_err(|_| {
        AppError::new("export.pdf_failed", "PDF print task failed.", true)
    })??;

    Ok(PrintedPdf {
        byte_length,
        path,
    })
}

fn acceptance_output_path() -> Result<Option<String>, AppError> {
    if std::env::var(ACCEPTANCE_MODE_ENV).ok().as_deref() != Some("1") {
        return Ok(None);
    }
    let path = std::env::var(ACCEPTANCE_PATH_ENV).ok();
    if path.as_deref().is_some_and(|value| !value.trim().is_empty()) {
        Ok(path)
    } else {
        Ok(None)
    }
}

fn sanitize_suggested_name(name: &str, extension: &str) -> String {
    let trimmed = name.trim();
    let file_name = if trimmed.is_empty() {
        "export"
    } else {
        Path::new(trimmed)
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("export")
    };
    format!("{file_name}.{extension}")
}

fn preferred_export_directory(
    document_path: Option<&str>,
    suggested_directory: Option<&str>,
) -> Option<PathBuf> {
    let document_directory = document_path
        .and_then(|path| Path::new(path).parent())
        .map(Path::to_path_buf)
        .filter(|directory| directory.is_dir());
    document_directory
        .or_else(|| suggested_directory.map(PathBuf::from))
        .filter(|directory| directory.is_dir())
}

fn dialog_path_to_string(path: tauri_plugin_dialog::FilePath) -> Result<String, AppError> {
    let path = path.into_path().map_err(|_| AppError::invalid_path())?;
    Ok(path.to_string_lossy().into_owned())
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
            "lumamark-export-dialog-{name}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("temp directory");
        directory
    }

    #[test]
    fn export_defaults_to_the_document_directory() {
        let directory = temp_directory("document");
        let document = directory.join("note.md");
        assert_eq!(
            preferred_export_directory(Some(document.to_str().unwrap()), None),
            Some(directory.clone())
        );
    }

    #[test]
    fn suggested_directory_is_only_a_fallback() {
        let directory = temp_directory("suggested");
        let document_directory = temp_directory("document-2");
        let document = document_directory.join("note.md");
        assert_eq!(
            preferred_export_directory(
                Some(document.to_str().unwrap()),
                Some(directory.to_str().unwrap()),
            ),
            Some(document_directory)
        );
        assert_eq!(
            preferred_export_directory(None, Some(directory.to_str().unwrap())),
            Some(directory)
        );
    }

    #[test]
    fn missing_directories_do_not_become_the_dialog_default() {
        assert_eq!(
            preferred_export_directory(Some("Z:\\missing\\note.md"), None),
            None
        );
    }

    #[test]
    fn suggested_names_always_use_the_export_extension() {
        assert_eq!(sanitize_suggested_name("note.md", "html"), "note.html");
        assert_eq!(sanitize_suggested_name("note", "pdf"), "note.pdf");
        assert_eq!(sanitize_suggested_name("  ", "html"), "export.html");
    }
}
