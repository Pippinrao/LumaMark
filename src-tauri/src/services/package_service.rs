use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::result::ZipError;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::errors::AppError;
use crate::services::asset_service::{
    fetch_remote_image_bytes, resolve_draft_image, resolve_local_image,
};
use crate::services::export_service::validate_output_path;
use crate::services::file_service::write_bytes_atomically;

pub const PACKAGE_FORMAT: &str = "lumamark-markdown-package";
pub const PACKAGE_FORMAT_VERSION: u32 = 1;
pub const PACKAGE_MANIFEST_NAME: &str = "lumamark-package.json";
pub const MAX_PACKAGE_RESOURCE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ARCHIVE_PATH_CHARS: usize = 200;
const MAX_ARCHIVE_SEGMENT_CHARS: usize = 100;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const SESSION_KEEP_RECENT: usize = 20;
const SESSION_RETENTION: Duration = Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Debug, Clone, Copy)]
pub struct PackageLimits {
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for PackageLimits {
    fn default() -> Self {
        Self {
            max_entries: 4096,
            max_entry_bytes: 512 * 1024 * 1024,
            max_total_bytes: 2 * 1024 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageOpenResult {
    pub entry_path: String,
    pub entry_name: String,
    pub session_dir: String,
    pub zip_path: String,
    pub resource_count: usize,
    pub reused_session: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageExportResult {
    pub output_path: String,
    pub entry_name: String,
    pub resource_count: usize,
    pub total_bytes: u64,
    pub warnings: Vec<PackageResourceWarning>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageResourceWarning {
    pub source: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageExtractResult {
    pub entry_path: String,
    pub output_directory: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageExportInput {
    pub output_path: String,
    pub entry_name: String,
    pub entry_text: String,
    pub document_path: Option<String>,
    pub resources: Vec<PackageExportResource>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageExportResource {
    pub archive_path: String,
    pub source: String,
    pub kind: PackageResourceKind,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PackageResourceKind {
    Local,
    Draft,
    Remote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    format: String,
    format_version: u32,
    entry: String,
    generator: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionMeta {
    zip_path: String,
    fingerprint: String,
    entry_name: String,
    resource_count: usize,
}

#[derive(Debug, Clone)]
struct ZipEntryMeta {
    index: usize,
    name: String,
    is_dir: bool,
    size: u64,
}

pub fn open_package(
    cache_root: &Path,
    zip_path: &Path,
    limits: PackageLimits,
) -> Result<PackageOpenResult, AppError> {
    let metadata = fs::metadata(zip_path).map_err(|_| {
        AppError::new(
            "package.not_found",
            "The package file could not be found.",
            true,
        )
    })?;
    if !metadata.is_file() {
        return Err(AppError::invalid_path());
    }

    let fingerprint = package_fingerprint(zip_path, &metadata)?;
    let packages_root = cache_root.join("packages");
    fs::create_dir_all(&packages_root)?;
    let session_dir = packages_root.join(&fingerprint);
    let meta_path = packages_root.join(format!("{fingerprint}.meta.json"));

    if let Some(result) = reusable_session(&session_dir, &meta_path, zip_path, &fingerprint) {
        touch_meta(&meta_path);
        prune_sessions(&packages_root, SystemTime::now());
        return Ok(result);
    }

    let temp_dir = packages_root.join(format!(".{fingerprint}.tmp-{}", Uuid::new_v4()));
    fs::create_dir_all(&temp_dir)?;
    let (entry_name, resource_count) = match extract_archive(zip_path, &temp_dir, limits) {
        Ok(extracted) => extracted,
        Err(error) => {
            let _ = fs::remove_dir_all(&temp_dir);
            return Err(error);
        }
    };

    if session_dir.exists() {
        let _ = fs::remove_dir_all(&session_dir);
    }
    if let Err(error) = fs::rename(&temp_dir, &session_dir) {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err(AppError::from(error));
    }

    let meta = SessionMeta {
        zip_path: path_to_string(zip_path),
        fingerprint,
        entry_name: entry_name.clone(),
        resource_count,
    };
    let meta_bytes = serde_json::to_vec_pretty(&meta).map_err(|_| {
        AppError::new(
            "package.open_failed",
            "The package session metadata could not be serialized.",
            true,
        )
    })?;
    write_bytes_atomically(&meta_path, &meta_bytes)?;

    let entry_path = session_dir.join(&entry_name);
    prune_sessions(&packages_root, SystemTime::now());

    Ok(PackageOpenResult {
        entry_path: path_to_string(&entry_path),
        entry_name,
        session_dir: path_to_string(&session_dir),
        zip_path: path_to_string(zip_path),
        resource_count,
        reused_session: false,
    })
}

pub fn export_package(
    input: PackageExportInput,
    app_data_directory: &Path,
    limits: PackageLimits,
) -> Result<PackageExportResult, AppError> {
    let output_path = validate_output_path(&input.output_path, "zip")?;
    validate_entry_name(&input.entry_name)?;

    if input.resources.len() > limits.max_entries {
        return Err(too_large("The package contains too many resources."));
    }

    let mut used = HashSet::new();
    used.insert(PACKAGE_MANIFEST_NAME.to_ascii_lowercase());
    used.insert(input.entry_name.to_ascii_lowercase());
    let mut resources = Vec::with_capacity(input.resources.len());
    for resource in &input.resources {
        let archive_path = validate_archive_path(&resource.archive_path)?;
        if !used.insert(archive_path.to_ascii_lowercase()) {
            return Err(unsafe_entry(
                "Package resource paths must be unique and must not collide with the entry.",
            ));
        }
        if resource.source.trim().is_empty() {
            return Err(AppError::invalid_path());
        }
        resources.push((archive_path, resource.clone()));
    }
    resources.sort_by(|left, right| left.0.cmp(&right.0));

    let manifest = PackageManifest {
        format: PACKAGE_FORMAT.to_string(),
        format_version: PACKAGE_FORMAT_VERSION,
        entry: input.entry_name.clone(),
        generator: format!("LumaMark {}", env!("CARGO_PKG_VERSION")),
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|_| {
        AppError::new(
            "package.export_failed",
            "The package manifest could not be serialized.",
            true,
        )
    })?;

    let temp_path = temp_output_path(&output_path);
    let written = write_package(
        &temp_path,
        &input,
        &resources,
        &manifest_bytes,
        app_data_directory,
        limits,
    );
    let (resource_count, total_bytes) = match written {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
    };

    if let Err(first_error) = fs::rename(&temp_path, &output_path) {
        if !output_path.exists() {
            let _ = fs::remove_file(&temp_path);
            return Err(AppError::from(first_error));
        }
        fs::remove_file(&output_path)?;
        if let Err(error) = fs::rename(&temp_path, &output_path) {
            let _ = fs::remove_file(&temp_path);
            return Err(AppError::from(error));
        }
    }

    Ok(PackageExportResult {
        output_path: path_to_string(&output_path),
        entry_name: input.entry_name,
        resource_count,
        total_bytes,
        warnings: Vec::new(),
    })
}

pub fn extract_package(
    zip_path: &Path,
    parent_directory: &Path,
    limits: PackageLimits,
) -> Result<PackageExtractResult, AppError> {
    let parent_metadata = fs::metadata(parent_directory).map_err(|_| AppError::invalid_path())?;
    if !parent_metadata.is_dir() {
        return Err(AppError::invalid_path());
    }

    let stem = zip_path
        .file_stem()
        .and_then(|value| value.to_str())
        .map(sanitize_directory_name)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "package".to_string());
    let target = parent_directory.join(stem);
    if target.exists() {
        return Err(AppError::new(
            "package.target_not_empty",
            "The destination folder already exists.",
            true,
        ));
    }
    fs::create_dir(&target)?;

    match extract_archive(zip_path, &target, limits) {
        Ok((entry_name, _)) => Ok(PackageExtractResult {
            entry_path: path_to_string(&target.join(entry_name)),
            output_directory: path_to_string(&target),
        }),
        Err(error) => {
            let _ = fs::remove_dir_all(&target);
            Err(error)
        }
    }
}

fn write_package(
    temp_path: &Path,
    input: &PackageExportInput,
    resources: &[(String, PackageExportResource)],
    manifest_bytes: &[u8],
    app_data_directory: &Path,
    limits: PackageLimits,
) -> Result<(usize, u64), AppError> {
    let file = File::create(temp_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let mut total = 0u64;

    zip.start_file(PACKAGE_MANIFEST_NAME, options)
        .map_err(map_write_error)?;
    zip.write_all(manifest_bytes)?;
    total = checked_total(total, manifest_bytes.len() as u64, limits)?;

    let entry_bytes = input.entry_text.as_bytes();
    if entry_bytes.len() as u64 > limits.max_entry_bytes {
        return Err(too_large("The package entry is too large."));
    }
    zip.start_file(&input.entry_name, options)
        .map_err(map_write_error)?;
    zip.write_all(entry_bytes)?;
    total = checked_total(total, entry_bytes.len() as u64, limits)?;

    for (archive_path, resource) in resources {
        match resource.kind {
            PackageResourceKind::Local => {
                let path = resolve_local_image(
                    input.document_path.as_deref().map(Path::new),
                    Path::new(&resource.source),
                )
                .map_err(|_| resource_error("package.resource_unavailable", &resource.source))?;
                total = write_local_resource(
                    &mut zip,
                    archive_path,
                    &path,
                    options,
                    total,
                    limits,
                )?;
            }
            PackageResourceKind::Draft => {
                let path = resolve_draft_image(app_data_directory, &resource.source)
                    .map_err(|_| resource_error("package.resource_unavailable", &resource.source))?;
                total = write_local_resource(
                    &mut zip,
                    archive_path,
                    &path,
                    options,
                    total,
                    limits,
                )?;
            }
            PackageResourceKind::Remote => {
                let bytes = fetch_remote_image_bytes(&resource.source).map_err(|_| {
                    resource_error("package.resource_unavailable", &resource.source)
                })?;
                total = checked_total(total, bytes.len() as u64, limits)?;
                zip.start_file(archive_path, options)
                    .map_err(map_write_error)?;
                zip.write_all(&bytes)?;
            }
        }
    }

    let file = zip.finish().map_err(map_write_error)?;
    file.sync_all()?;

    Ok((resources.len(), total))
}

fn write_local_resource<W: Write + io::Seek>(
    zip: &mut ZipWriter<W>,
    archive_path: &str,
    source_path: &Path,
    options: SimpleFileOptions,
    total: u64,
    limits: PackageLimits,
) -> Result<u64, AppError> {
    let metadata = fs::metadata(source_path)
        .map_err(|_| resource_error("package.resource_unavailable", &path_to_string(source_path)))?;
    if !metadata.is_file() {
        return Err(resource_error(
            "package.resource_unavailable",
            &path_to_string(source_path),
        ));
    }
    if metadata.len() > MAX_PACKAGE_RESOURCE_BYTES {
        return Err(resource_error(
            "package.resource_too_large",
            &path_to_string(source_path),
        ));
    }
    if metadata.len() > limits.max_entry_bytes {
        return Err(too_large("A package resource is too large."));
    }
    let total = checked_total(total, metadata.len(), limits)?;

    zip.start_file(archive_path, options)
        .map_err(map_write_error)?;
    let mut source = File::open(source_path)?;
    let copied = io::copy(&mut source, zip)?;
    if copied != metadata.len() {
        return Err(resource_error(
            "package.resource_unavailable",
            &path_to_string(source_path),
        ));
    }

    Ok(total)
}

fn checked_total(total: u64, added: u64, limits: PackageLimits) -> Result<u64, AppError> {
    let total = total
        .checked_add(added)
        .ok_or_else(|| too_large("The package is too large."))?;
    if total > limits.max_total_bytes {
        return Err(too_large("The package is too large."));
    }
    Ok(total)
}

fn extract_archive(
    zip_path: &Path,
    destination: &Path,
    limits: PackageLimits,
) -> Result<(String, usize), AppError> {
    let file = File::open(zip_path).map_err(map_open_error)?;
    let mut archive = ZipArchive::new(file).map_err(map_zip_error)?;
    if archive.len() > limits.max_entries {
        return Err(too_large("The package contains too many entries."));
    }

    let manifest = read_manifest(&mut archive)?;
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(map_zip_error)?;
        let raw_name = entry.name().to_string();
        let is_dir = entry.is_dir();
        let size = entry.size();
        let encrypted = entry.encrypted();
        let unix_mode = entry.unix_mode();
        drop(entry);

        if is_junk_entry(&raw_name) {
            continue;
        }
        if encrypted {
            return Err(AppError::new(
                "package.unsupported",
                "Encrypted packages are not supported.",
                false,
            ));
        }
        if unix_mode.is_some_and(|mode| mode & 0o170000 == 0o120000) {
            return Err(unsafe_entry("Package entries must not be symbolic links."));
        }
        let name = normalize_archive_entry(&raw_name)?;
        entries.push(ZipEntryMeta {
            index,
            name,
            is_dir,
            size,
        });
    }

    let mut seen = HashSet::new();
    let mut declared_total = 0u64;
    for entry in &entries {
        if entry.is_dir {
            continue;
        }
        if !seen.insert(entry.name.to_ascii_lowercase()) {
            return Err(unsafe_entry("Package entries must have unique names."));
        }
        if entry.size > limits.max_entry_bytes {
            return Err(too_large("A package entry is too large."));
        }
        declared_total = declared_total
            .checked_add(entry.size)
            .ok_or_else(|| too_large("The package is too large."))?;
        if declared_total > limits.max_total_bytes {
            return Err(too_large("The package is too large."));
        }
    }

    let entry_name = resolve_entry_name(manifest.as_ref(), &entries)?;

    let mut extracted_files = 0usize;
    let mut written_total = 0u64;
    for entry in &entries {
        let target = safe_join(destination, &entry.name)?;
        if entry.is_dir {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut source = archive.by_index(entry.index).map_err(map_zip_error)?;
        let mut target_file = File::create(&target)?;
        let mut limited = (&mut source).take(limits.max_entry_bytes + 1);
        let copied = io::copy(&mut limited, &mut target_file)?;
        target_file.sync_all()?;
        if copied > limits.max_entry_bytes {
            return Err(too_large("A package entry is too large."));
        }
        written_total = written_total
            .checked_add(copied)
            .ok_or_else(|| too_large("The package is too large."))?;
        if written_total > limits.max_total_bytes {
            return Err(too_large("The package is too large."));
        }
        if entry.name != PACKAGE_MANIFEST_NAME {
            extracted_files += 1;
        }
    }

    if !destination.join(&entry_name).is_file() {
        return Err(entry_missing());
    }

    Ok((entry_name, extracted_files.saturating_sub(1)))
}

fn read_manifest(archive: &mut ZipArchive<File>) -> Result<Option<PackageManifest>, AppError> {
    let file = match archive.by_name(PACKAGE_MANIFEST_NAME) {
        Ok(file) => file,
        Err(ZipError::FileNotFound) => return Ok(None),
        Err(error) => return Err(map_zip_error(error)),
    };
    let mut bytes = Vec::new();
    file.take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid_manifest())?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(invalid_manifest());
    }
    let manifest: PackageManifest =
        serde_json::from_slice(&bytes).map_err(|_| invalid_manifest())?;
    if manifest.format != PACKAGE_FORMAT {
        return Err(invalid_manifest());
    }
    if manifest.format_version != PACKAGE_FORMAT_VERSION {
        return Err(AppError::new(
            "package.unsupported_version",
            "The package format version is not supported.",
            false,
        ));
    }
    validate_entry_name(&manifest.entry)?;
    Ok(Some(manifest))
}

fn resolve_entry_name(
    manifest: Option<&PackageManifest>,
    entries: &[ZipEntryMeta],
) -> Result<String, AppError> {
    if let Some(manifest) = manifest {
        let name = validate_archive_path(&manifest.entry)?;
        if name.contains('/') {
            return Err(invalid_manifest());
        }
        if entries
            .iter()
            .any(|entry| !entry.is_dir && entry.name == name)
        {
            return Ok(name);
        }
        return Err(entry_missing());
    }

    let mut candidates = entries
        .iter()
        .filter(|entry| !entry.is_dir && !entry.name.contains('/') && is_markdown_name(&entry.name))
        .map(|entry| entry.name.clone());
    match (candidates.next(), candidates.next()) {
        (Some(name), None) => Ok(name),
        (None, _) => Err(entry_missing()),
        (Some(_), Some(_)) => Err(AppError::new(
            "package.entry_ambiguous",
            "The package contains more than one root Markdown document.",
            false,
        )),
    }
}

fn normalize_archive_entry(raw: &str) -> Result<String, AppError> {
    if raw.is_empty() || raw.len() > MAX_ARCHIVE_PATH_CHARS {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    if raw.starts_with('/') || raw.contains('\\') || raw.contains(':') {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    let normalized = raw.trim_end_matches('/');
    if normalized.is_empty() {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    for segment in normalized.split('/') {
        validate_archive_segment(segment)?;
    }
    Ok(normalized.to_string())
}

fn validate_archive_path(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_ARCHIVE_PATH_CHARS {
        return Err(unsafe_entry("A package resource path is invalid."));
    }
    if trimmed.starts_with('/') || trimmed.contains('\\') || trimmed.contains(':') {
        return Err(unsafe_entry("A package resource path is invalid."));
    }
    let normalized = trimmed.trim_end_matches('/');
    if normalized.is_empty() {
        return Err(unsafe_entry("A package resource path is invalid."));
    }
    for segment in normalized.split('/') {
        validate_archive_segment(segment)?;
    }
    Ok(normalized.to_string())
}

fn validate_entry_name(name: &str) -> Result<(), AppError> {
    if name.contains('/') || name.contains('\\') || name.is_empty() {
        return Err(invalid_manifest());
    }
    validate_archive_segment(name)?;
    if !is_markdown_name(name) {
        return Err(invalid_manifest());
    }
    Ok(())
}

fn validate_archive_segment(segment: &str) -> Result<(), AppError> {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.len() > MAX_ARCHIVE_SEGMENT_CHARS
    {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    if segment.chars().any(char::is_control) {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    if segment
        .chars()
        .any(|character| matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    if segment.ends_with('.') || segment.ends_with(' ') {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    let stem = segment.split('.').next().unwrap_or(segment);
    if is_windows_reserved(stem) {
        return Err(unsafe_entry("A package entry name is reserved."));
    }
    Ok(())
}

fn is_windows_reserved(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return true;
    }
    let bytes = upper.as_bytes();
    (upper.starts_with("COM") || upper.starts_with("LPT"))
        && bytes.len() == 4
        && (b'1'..=b'9').contains(&bytes[3])
}

fn safe_join(root: &Path, name: &str) -> Result<PathBuf, AppError> {
    let mut path = root.to_path_buf();
    for segment in name.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(unsafe_entry("A package entry name is invalid."));
        }
        path.push(segment);
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| unsafe_entry("A package entry name is invalid."))?;
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(unsafe_entry("A package entry name is invalid."));
    }
    Ok(path)
}

fn is_junk_entry(name: &str) -> bool {
    name == "__MACOSX"
        || name.starts_with("__MACOSX/")
        || name == ".DS_Store"
        || name.ends_with("/.DS_Store")
        || name == "Thumbs.db"
        || name.ends_with("/Thumbs.db")
}

fn is_markdown_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "md" | "markdown" | "mdown"))
        .unwrap_or(false)
}

fn reusable_session(
    session_dir: &Path,
    meta_path: &Path,
    zip_path: &Path,
    fingerprint: &str,
) -> Option<PackageOpenResult> {
    let bytes = fs::read(meta_path).ok()?;
    let meta: SessionMeta = serde_json::from_slice(&bytes).ok()?;
    if meta.fingerprint != fingerprint || meta.zip_path != path_to_string(zip_path) {
        return None;
    }
    let entry_path = session_dir.join(&meta.entry_name);
    if !entry_path.is_file() {
        return None;
    }
    Some(PackageOpenResult {
        entry_path: path_to_string(&entry_path),
        entry_name: meta.entry_name,
        session_dir: path_to_string(session_dir),
        zip_path: path_to_string(zip_path),
        resource_count: meta.resource_count,
        reused_session: true,
    })
}

fn touch_meta(meta_path: &Path) {
    let _ = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(meta_path)
        .and_then(|file| file.set_modified(SystemTime::now()));
}

fn prune_sessions(packages_root: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(packages_root) else {
        return;
    };
    let mut metas: Vec<(PathBuf, SystemTime)> = entries
        .filter_map(|entry| {
            let path = entry.ok()?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                return None;
            }
            let modified = fs::metadata(&path).ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect();
    metas.sort_by(|left, right| right.1.cmp(&left.1));

    for (index, (meta_path, modified)) in metas.into_iter().enumerate() {
        if index < SESSION_KEEP_RECENT {
            continue;
        }
        let too_old = now
            .duration_since(modified)
            .map(|age| age > SESSION_RETENTION)
            .unwrap_or(false);
        if !too_old {
            continue;
        }
        let Some(file_name) = meta_path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if let Some(hash) = file_name.strip_suffix(".meta.json") {
            let _ = fs::remove_dir_all(packages_root.join(hash));
        }
        let _ = fs::remove_file(&meta_path);
    }
}

fn package_fingerprint(zip_path: &Path, metadata: &fs::Metadata) -> Result<String, AppError> {
    let canonical = zip_path
        .canonicalize()
        .unwrap_or_else(|_| zip_path.to_path_buf());
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_le_bytes());
    hasher.update(modified.to_le_bytes());
    Ok(to_hex(&hasher.finalize()).chars().take(16).collect())
}

fn temp_output_path(output_path: &Path) -> PathBuf {
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("package");
    output_path.with_file_name(format!(".{stem}.tmp-{}.zip", Uuid::new_v4()))
}

fn sanitize_directory_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '|' | '?' | '*' | '/' | '\\'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let trimmed = sanitized.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        String::new()
    } else {
        trimmed.chars().take(MAX_ARCHIVE_SEGMENT_CHARS).collect()
    }
}

fn map_open_error(_error: io::Error) -> AppError {
    AppError::new(
        "package.not_found",
        "The package file could not be opened.",
        true,
    )
}

fn map_zip_error(error: ZipError) -> AppError {
    match error {
        ZipError::FileNotFound => entry_missing(),
        ZipError::Io(error) => AppError::from(error),
        ZipError::InvalidArchive(_) => AppError::new(
            "package.invalid_zip",
            "The package is not a valid zip archive.",
            false,
        ),
        ZipError::UnsupportedArchive(_) | ZipError::InvalidPassword => AppError::new(
            "package.unsupported",
            "The package uses an unsupported archive feature.",
            false,
        ),
        _ => AppError::new(
            "package.invalid_zip",
            "The package is not a valid zip archive.",
            false,
        ),
    }
}

fn map_write_error(error: ZipError) -> AppError {
    match error {
        ZipError::Io(error) => AppError::from(error),
        _ => AppError::new(
            "package.export_failed",
            "The package could not be written.",
            true,
        ),
    }
}

fn invalid_manifest() -> AppError {
    AppError::new(
        "package.invalid_manifest",
        "The package manifest is invalid.",
        false,
    )
}

fn entry_missing() -> AppError {
    AppError::new(
        "package.entry_missing",
        "The package does not contain a Markdown entry.",
        false,
    )
}

fn unsafe_entry(message: &str) -> AppError {
    AppError::new("package.unsafe_entry", message, false)
}

fn too_large(message: &str) -> AppError {
    AppError::new("package.too_large", message, false)
}

fn resource_error(code: &str, source: &str) -> AppError {
    AppError::new(
        code,
        format!("Package resource could not be read: {source}"),
        true,
    )
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
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
            "lumamark-package-{name}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("temp directory");
        directory
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).expect("zip file");
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        for (name, bytes) in entries {
            zip.start_file(*name, options).expect("zip entry");
            zip.write_all(bytes).expect("zip bytes");
        }
        zip.finish().expect("zip finish");
    }

    fn local_input(
        root: &Path,
        bundle: &Path,
        resources: Vec<PackageExportResource>,
    ) -> PackageExportInput {
        let document = root.join("notes").join("note.md");
        PackageExportInput {
            output_path: path_to_string(bundle),
            entry_name: "note.md".to_string(),
            entry_text: "# Note\n\n![a](assets/a.png)\n".to_string(),
            document_path: Some(path_to_string(&document)),
            resources,
        }
    }

    #[test]
    fn export_and_open_round_trip_keeps_entry_and_resources() {
        let root = temp_directory("roundtrip");
        let notes = root.join("notes");
        fs::create_dir_all(notes.join("assets")).expect("notes");
        fs::write(notes.join("assets").join("a.png"), b"PNG-BYTES").expect("image");
        let bundle = root.join("bundle.zip");
        let input = local_input(
            &root,
            &bundle,
            vec![PackageExportResource {
                archive_path: "assets/a.png".to_string(),
                source: "assets/a.png".to_string(),
                kind: PackageResourceKind::Local,
            }],
        );

        let result = export_package(input, &root.join("app-data"), PackageLimits::default())
            .expect("export");
        assert_eq!(result.resource_count, 1);
        assert!(bundle.is_file());

        let opened = open_package(&root.join("cache"), &bundle, PackageLimits::default())
            .expect("open");
        assert_eq!(opened.entry_name, "note.md");
        assert_eq!(
            fs::read_to_string(&opened.entry_path).expect("entry"),
            "# Note\n\n![a](assets/a.png)\n"
        );
        assert_eq!(
            fs::read(Path::new(&opened.session_dir).join("assets").join("a.png"))
                .expect("image"),
            b"PNG-BYTES"
        );
        assert_eq!(opened.resource_count, 1);
    }

    #[test]
    fn export_uses_draft_image_from_application_data() {
        let root = temp_directory("draft");
        let app_data = root.join("app-data");
        let draft = app_data.join("draft-assets").join("draft-1");
        fs::create_dir_all(&draft).expect("draft directory");
        fs::write(draft.join("image-001.png"), b"DRAFT").expect("draft image");
        let bundle = root.join("draft.zip");
        let mut input = local_input(&root, &bundle, Vec::new());
        input.entry_text = "![d](lumamark-draft://draft-1/image-001.png)".to_string();
        input.resources = vec![PackageExportResource {
            archive_path: "lumamark-assets/draft-1.png".to_string(),
            source: "lumamark-draft://draft-1/image-001.png".to_string(),
            kind: PackageResourceKind::Draft,
        }];

        export_package(input, &app_data, PackageLimits::default()).expect("export");
        let opened = open_package(&root.join("cache"), &bundle, PackageLimits::default())
            .expect("open");
        assert_eq!(
            fs::read(
                Path::new(&opened.session_dir)
                    .join("lumamark-assets")
                    .join("draft-1.png"),
            )
            .expect("draft image"),
            b"DRAFT"
        );
    }

    #[test]
    fn export_fails_without_writing_when_a_resource_is_missing() {
        let root = temp_directory("missing");
        fs::create_dir_all(root.join("notes")).expect("notes");
        let bundle = root.join("missing.zip");
        let input = local_input(
            &root,
            &bundle,
            vec![PackageExportResource {
                archive_path: "assets/a.png".to_string(),
                source: "assets/a.png".to_string(),
                kind: PackageResourceKind::Local,
            }],
        );

        let error = export_package(input, &root.join("app-data"), PackageLimits::default())
            .expect_err("missing resource should fail");
        assert_eq!(error.code, "package.resource_unavailable");
        assert!(!bundle.exists());
    }

    #[test]
    fn export_rejects_unsafe_and_duplicate_archive_paths() {
        let root = temp_directory("unsafe");
        let unsafe_input = local_input(
            &root,
            &root.join("unsafe.zip"),
            vec![PackageExportResource {
                archive_path: "../evil.png".to_string(),
                source: "assets/a.png".to_string(),
                kind: PackageResourceKind::Local,
            }],
        );
        assert_eq!(
            export_package(unsafe_input, &root.join("app-data"), PackageLimits::default())
                .expect_err("unsafe path")
                .code,
            "package.unsafe_entry"
        );

        let duplicate_input = local_input(
            &root,
            &root.join("duplicate.zip"),
            vec![
                PackageExportResource {
                    archive_path: "assets/a.png".to_string(),
                    source: "assets/a.png".to_string(),
                    kind: PackageResourceKind::Local,
                },
                PackageExportResource {
                    archive_path: "assets/A.PNG".to_string(),
                    source: "assets/a.png".to_string(),
                    kind: PackageResourceKind::Local,
                },
            ],
        );
        assert_eq!(
            export_package(
                duplicate_input,
                &root.join("app-data"),
                PackageLimits::default()
            )
            .expect_err("duplicate path")
            .code,
            "package.unsafe_entry"
        );
    }

    #[test]
    fn open_manifestless_package_uses_single_root_markdown() {
        let root = temp_directory("manifestless");
        let bundle = root.join("plain.zip");
        write_zip(
            &bundle,
            &[
                ("note.md", b"# Note"),
                ("assets/a.png", b"PNG"),
                ("readme.txt", b"ignore"),
            ],
        );

        let opened =
            open_package(&root.join("cache"), &bundle, PackageLimits::default()).expect("open");
        assert_eq!(opened.entry_name, "note.md");
        assert_eq!(
            fs::read_to_string(&opened.entry_path).expect("entry"),
            "# Note"
        );
    }

    #[test]
    fn open_rejects_ambiguous_or_missing_entry() {
        let root = temp_directory("ambiguous");
        let ambiguous = root.join("ambiguous.zip");
        write_zip(&ambiguous, &[("a.md", b"a"), ("b.md", b"b")]);
        assert_eq!(
            open_package(&root.join("cache"), &ambiguous, PackageLimits::default())
                .expect_err("ambiguous")
                .code,
            "package.entry_ambiguous"
        );

        let missing = root.join("missing.zip");
        write_zip(&missing, &[("image.png", b"PNG")]);
        assert_eq!(
            open_package(&root.join("cache"), &missing, PackageLimits::default())
                .expect_err("missing")
                .code,
            "package.entry_missing"
        );
    }

    #[test]
    fn open_rejects_path_traversal_entries() {
        let root = temp_directory("traversal");
        let bundle = root.join("evil.zip");
        write_zip(&bundle, &[("../evil.md", b"evil")]);
        let error =
            open_package(&root.join("cache"), &bundle, PackageLimits::default()).expect_err("evil");
        assert_eq!(error.code, "package.unsafe_entry");
        assert!(!root.join("cache").join("evil.md").exists());
    }

    #[test]
    fn open_enforces_entry_limits() {
        let root = temp_directory("limits");
        let bundle = root.join("limits.zip");
        write_zip(&bundle, &[("note.md", b"# Note"), ("image.png", b"PNG")]);
        let limits = PackageLimits {
            max_entries: 1,
            ..PackageLimits::default()
        };
        assert_eq!(
            open_package(&root.join("cache"), &bundle, limits)
                .expect_err("too many entries")
                .code,
            "package.too_large"
        );
    }

    #[test]
    fn open_reuses_session_for_the_same_zip() {
        let root = temp_directory("reuse");
        let bundle = root.join("reuse.zip");
        write_zip(&bundle, &[("note.md", b"# Note")]);
        let cache = root.join("cache");
        let first = open_package(&cache, &bundle, PackageLimits::default()).expect("first");
        let second = open_package(&cache, &bundle, PackageLimits::default()).expect("second");
        assert!(!first.reused_session);
        assert!(second.reused_session);
        assert_eq!(first.entry_path, second.entry_path);
    }

    #[test]
    fn extract_creates_a_new_folder_and_refuses_existing_target() {
        let root = temp_directory("extract");
        let bundle = root.join("bundle.zip");
        write_zip(&bundle, &[("note.md", b"# Note"), ("a.png", b"PNG")]);
        let parent = root.join("out");
        fs::create_dir_all(&parent).expect("parent");

        let extracted =
            extract_package(&bundle, &parent, PackageLimits::default()).expect("extract");
        assert_eq!(
            extracted.output_directory,
            path_to_string(&parent.join("bundle"))
        );
        assert!(Path::new(&extracted.entry_path).is_file());

        assert_eq!(
            extract_package(&bundle, &parent, PackageLimits::default())
                .expect_err("existing target")
                .code,
            "package.target_not_empty"
        );
    }

    #[test]
    fn archive_names_reject_windows_reserved_and_invalid_segments() {
        for name in ["../evil.md", "a\\b.md", "/abs.md", "C:/abs.md", "CON.md", "a?.md"] {
            assert!(
                validate_archive_path(name).is_err(),
                "expected {name} to be rejected"
            );
        }
        assert!(validate_archive_path("assets/my image.png").is_ok());
    }

    #[test]
    fn manifest_entry_must_be_a_root_markdown_document() {
        assert!(validate_entry_name("note.md").is_ok());
        assert!(validate_entry_name("folder/note.md").is_err());
        assert!(validate_entry_name("note.txt").is_err());
    }
}
