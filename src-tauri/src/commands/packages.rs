use std::path::Path;

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::errors::AppError;
use crate::services::package_service::{
    export_package, extract_package, open_package, PackageExportInput, PackageExportResult,
    PackageExtractResult, PackageLimits, PackageOpenResult,
};

#[tauri::command]
pub async fn package_open(app: AppHandle, path: String) -> Result<PackageOpenResult, AppError> {
    let cache_directory = app.path().app_cache_dir().map_err(|_| {
        AppError::new(
            "package.cache_unavailable",
            "Application cache directory is unavailable.",
            true,
        )
    })?;

    tauri::async_runtime::spawn_blocking(move || {
        open_package(&cache_directory, Path::new(&path), PackageLimits::default())
    })
    .await
    .map_err(|_| {
        AppError::new("package.open_failed", "Package open task failed.", true)
    })?
}

#[tauri::command]
pub async fn package_export(
    app: AppHandle,
    input: PackageExportInput,
) -> Result<PackageExportResult, AppError> {
    let app_data_directory = app.path().app_data_dir().map_err(|_| {
        AppError::new(
            "package.export_failed",
            "Application data directory is unavailable.",
            true,
        )
    })?;

    tauri::async_runtime::spawn_blocking(move || {
        export_package(input, &app_data_directory, PackageLimits::default())
    })
    .await
    .map_err(|_| {
        AppError::new("package.export_failed", "Package export task failed.", true)
    })?
}

#[tauri::command]
pub async fn package_extract(
    path: String,
    parent_directory: String,
) -> Result<PackageExtractResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        extract_package(
            Path::new(&path),
            Path::new(&parent_directory),
            PackageLimits::default(),
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            "package.extract_failed",
            "Package extract task failed.",
            true,
        )
    })?
}

#[tauri::command]
pub async fn package_show_extract_dialog(
    app: AppHandle,
) -> Result<Option<String>, AppError> {
    let selected = app.dialog().file().blocking_pick_folder();

    selected.map(dialog_path_to_string).transpose()
}

fn dialog_path_to_string(path: tauri_plugin_dialog::FilePath) -> Result<String, AppError> {
    let path = path.into_path().map_err(|_| AppError::invalid_path())?;

    Ok(path.to_string_lossy().into_owned())
}
