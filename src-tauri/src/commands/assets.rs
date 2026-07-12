use std::path::PathBuf;

use crate::errors::AppError;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

use crate::services::asset_service::{
    cache_remote_image, copy_local_image, finalize_draft_images, import_draft_image_bytes,
    import_image_bytes, resolve_draft_image, resolve_local_image, CacheRemoteImageResult,
    ImportImageResult,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentImageImportMetadata {
    document_path: String,
    mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftImageImportMetadata {
    draft_id: String,
    mime_type: String,
}

#[tauri::command]
pub async fn assets_cache_remote_image(
    app: AppHandle,
    document_path: String,
    source: String,
) -> Result<CacheRemoteImageResult, AppError> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        cache_remote_image(PathBuf::from(document_path), &source)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "asset.remote_image_task_failed",
            "Remote image cache task failed.",
            true,
        )
    })??;
    authorize_asset_file(&app, &PathBuf::from(&result.path))?;
    Ok(result)
}

#[tauri::command]
pub async fn assets_import_document_image(
    app: AppHandle,
    request: Request<'_>,
) -> Result<ImportImageResult, AppError> {
    let (metadata, bytes) = decode_image_import_request::<DocumentImageImportMetadata>(&request)?;
    let document_path = metadata.document_path;
    let mime_type = metadata.mime_type;
    let result = tauri::async_runtime::spawn_blocking(move || {
        import_image_bytes(&PathBuf::from(document_path), &mime_type, &bytes)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "asset.image_import_task_failed",
            "Image import task failed.",
            true,
        )
    })??;
    authorize_asset_file(&app, &PathBuf::from(&result.path))?;
    Ok(result)
}

#[tauri::command]
pub fn assets_authorize_local_image(
    app: AppHandle,
    document_path: Option<String>,
    source: String,
) -> Result<String, AppError> {
    let path = if source.starts_with("lumamark-draft://") {
        let app_data_directory = app.path().app_data_dir().map_err(|_| {
            AppError::new(
                "asset.draft_directory_unavailable",
                "Draft image storage is unavailable.",
                true,
            )
        })?;
        let path = resolve_draft_image(&app_data_directory, &source)?;
        crate::services::asset_service::authorize_local_image(&path)?
    } else {
        let document_path = document_path.as_deref().map(PathBuf::from);
        resolve_local_image(document_path.as_deref(), &PathBuf::from(source))?
    };
    authorize_asset_file(&app, &path)?;

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn assets_copy_local_image(
    app: AppHandle,
    document_path: String,
    source_path: String,
) -> Result<ImportImageResult, AppError> {
    let result = tauri::async_runtime::spawn_blocking(move || {
        copy_local_image(&PathBuf::from(document_path), &PathBuf::from(source_path))
    })
    .await
    .map_err(|_| {
        AppError::new(
            "asset.image_copy_task_failed",
            "Local image copy task failed.",
            true,
        )
    })??;
    authorize_asset_file(&app, &PathBuf::from(&result.path))?;
    Ok(result)
}

fn authorize_asset_file(app: &AppHandle, path: &PathBuf) -> Result<(), AppError> {
    app.asset_protocol_scope().allow_file(path).map_err(|_| {
        AppError::new(
            "asset.scope_authorization_failed",
            "Local image could not be authorized.",
            true,
        )
    })
}

#[tauri::command]
pub async fn assets_import_draft_image(
    app: AppHandle,
    request: Request<'_>,
) -> Result<ImportImageResult, AppError> {
    let (metadata, bytes) = decode_image_import_request::<DraftImageImportMetadata>(&request)?;
    let draft_id = metadata.draft_id;
    let mime_type = metadata.mime_type;
    let draft_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            AppError::new(
                "asset.draft_directory_unavailable",
                "Draft image storage is unavailable.",
                true,
            )
        })?
        .join("draft-assets")
        .join(&draft_id);
    let result = tauri::async_runtime::spawn_blocking(move || {
        import_draft_image_bytes(&draft_directory, &draft_id, &mime_type, &bytes)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "asset.image_import_task_failed",
            "Image import task failed.",
            true,
        )
    })??;
    app.asset_protocol_scope()
        .allow_file(&result.path)
        .map_err(|_| {
            AppError::new(
                "asset.scope_authorization_failed",
                "Draft image could not be authorized.",
                true,
            )
        })?;
    Ok(result)
}

fn decode_image_import_request<T: DeserializeOwned>(
    request: &Request<'_>,
) -> Result<(T, Vec<u8>), AppError> {
    let InvokeBody::Raw(payload) = request.body() else {
        return Err(invalid_image_import_request());
    };
    let (metadata, bytes) = decode_image_import_payload(payload)?;
    Ok((metadata, bytes.to_vec()))
}

fn decode_image_import_payload<T: DeserializeOwned>(
    payload: &[u8],
) -> Result<(T, &[u8]), AppError> {
    let length_bytes: [u8; 4] = payload
        .get(..4)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(invalid_image_import_request)?;
    let metadata_length = u32::from_le_bytes(length_bytes) as usize;
    let metadata_end = 4usize
        .checked_add(metadata_length)
        .filter(|end| *end <= payload.len())
        .ok_or_else(invalid_image_import_request)?;
    let metadata = serde_json::from_slice(&payload[4..metadata_end])
        .map_err(|_| invalid_image_import_request())?;
    Ok((metadata, &payload[metadata_end..]))
}

fn invalid_image_import_request() -> AppError {
    AppError::new(
        "asset.image_import_request_invalid",
        "Image import request is invalid.",
        true,
    )
}

#[tauri::command]
pub async fn assets_finalize_draft_images(
    app: AppHandle,
    document_path: String,
    draft_id: String,
    text: String,
) -> Result<String, AppError> {
    let draft_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            AppError::new(
                "asset.draft_directory_unavailable",
                "Draft image storage is unavailable.",
                true,
            )
        })?
        .join("draft-assets")
        .join(&draft_id);
    let result = tauri::async_runtime::spawn_blocking(move || {
        finalize_draft_images(
            &PathBuf::from(document_path),
            &draft_directory,
            &draft_id,
            &text,
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            "asset.draft_migration_failed",
            "Draft image migration failed.",
            true,
        )
    })??;
    Ok(result.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_image_import_payload_should_preserve_unicode_metadata_and_raw_bytes() {
        let metadata = r#"{"documentPath":"E:\\笔记\\图片.md","mimeType":"image/png"}"#.as_bytes();
        let image = b"\x89PNG\r\n\x1a\nraw";
        let mut payload = Vec::new();
        payload.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
        payload.extend_from_slice(metadata);
        payload.extend_from_slice(image);

        let (decoded, bytes) = decode_image_import_payload::<DocumentImageImportMetadata>(&payload)
            .expect("valid binary image payload should decode");

        assert_eq!(decoded.document_path, "E:\\笔记\\图片.md");
        assert_eq!(decoded.mime_type, "image/png");
        assert_eq!(bytes, image);
    }

    #[test]
    fn decode_image_import_payload_should_reject_invalid_metadata_lengths() {
        let error = decode_image_import_payload::<DocumentImageImportMetadata>(&[20, 0, 0, 0])
            .expect_err("truncated metadata should be rejected");

        assert_eq!(error.code, "asset.image_import_request_invalid");
    }
}
