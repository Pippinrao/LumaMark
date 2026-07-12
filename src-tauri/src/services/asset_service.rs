use std::fs;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use ureq::unversioned::resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver};
use ureq::unversioned::transport::DefaultConnector;

use crate::errors::AppError;
use crate::services::file_service::{normalize_path, write_bytes_atomically};

const MAX_REMOTE_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
const REMOTE_CACHE_DIRECTORY: &[&str] = &[".lumamark", "assets", "remote-cache"];
const IMAGE_ASSET_DIRECTORY_SUFFIX: &str = ".assets";
static IMAGE_IMPORT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Default)]
struct PublicAddressResolver {
    inner: DefaultResolver,
}

impl Resolver for PublicAddressResolver {
    fn resolve(
        &self,
        uri: &ureq::http::Uri,
        config: &ureq::config::Config,
        timeout: ureq::unversioned::transport::NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        let addresses = self.inner.resolve(uri, config, timeout)?;

        if addresses.iter().all(|address| is_public_ip(address.ip())) {
            Ok(addresses)
        } else {
            Err(ureq::Error::HostNotFound)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteImageCacheTarget {
    pub file_name: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedImageTarget {
    pub path: PathBuf,
    pub relative_markdown_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageResult {
    pub markdown_source: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftImageTarget {
    pub markdown_source: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FinalizeDraftImagesResult {
    pub text: String,
}

pub fn imported_image_target(
    document_path: &Path,
    mime_type: &str,
) -> Result<ImportedImageTarget, AppError> {
    let extension = image_extension_from_mime_type(mime_type)?;
    let document_directory = document_path.parent().ok_or_else(AppError::invalid_path)?;
    let document_stem = document_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(AppError::invalid_path)?;
    let asset_directory_name = format!("{document_stem}{IMAGE_ASSET_DIRECTORY_SUFFIX}");
    let asset_directory = document_directory.join(&asset_directory_name);

    for index in 1..=9999 {
        let file_name = format!("image-{index:03}.{extension}");
        let path = asset_directory.join(&file_name);

        if !path.exists() {
            return Ok(ImportedImageTarget {
                path,
                relative_markdown_path: format!("{asset_directory_name}/{file_name}"),
            });
        }
    }

    Err(AppError::new(
        "asset.image_name_exhausted",
        "No available image asset name could be created.",
        true,
    ))
}

pub fn import_image_bytes(
    document_path: &Path,
    mime_type: &str,
    bytes: &[u8],
) -> Result<ImportImageResult, AppError> {
    if bytes.is_empty() {
        return Err(AppError::new(
            "asset.image_read_failed",
            "Image data could not be read.",
            true,
        ));
    }

    if bytes.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
        return Err(AppError::new(
            "asset.image_too_large",
            "Image is too large.",
            true,
        ));
    }

    if !bytes_match_image_mime_type(bytes, mime_type) {
        return Err(AppError::new(
            "asset.image_data_invalid",
            "Image data is invalid or does not match its type.",
            true,
        ));
    }

    let _import_guard = lock_image_imports()?;
    let target = imported_image_target(document_path, mime_type)?;
    let directory = target.path.parent().ok_or_else(AppError::invalid_path)?;
    fs::create_dir_all(directory)?;
    write_bytes_atomically(&target.path, bytes)?;

    Ok(ImportImageResult {
        markdown_source: target.relative_markdown_path,
        path: path_to_string(&target.path),
    })
}

pub fn copy_local_image(
    document_path: &Path,
    source_path: &Path,
) -> Result<ImportImageResult, AppError> {
    let source_path = authorize_local_image(source_path)?;
    let mime_type = image_mime_type_from_path(&source_path)?;
    let bytes = fs::read(source_path)?;

    import_image_bytes(document_path, mime_type, &bytes)
}

pub fn import_draft_image_bytes(
    draft_directory: &Path,
    draft_id: &str,
    mime_type: &str,
    bytes: &[u8],
) -> Result<ImportImageResult, AppError> {
    validate_imported_image_bytes(bytes, mime_type)?;
    let _import_guard = lock_image_imports()?;
    let target = draft_image_target(draft_directory, draft_id, mime_type)?;
    let directory = target.path.parent().ok_or_else(AppError::invalid_path)?;
    fs::create_dir_all(directory)?;
    write_bytes_atomically(&target.path, bytes)?;

    Ok(ImportImageResult {
        markdown_source: target.markdown_source,
        path: path_to_string(&target.path),
    })
}

pub fn authorize_local_image(path: &Path) -> Result<PathBuf, AppError> {
    let metadata = fs::symlink_metadata(path)?;

    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::new(
            "asset.local_image_invalid",
            "Local image must be a regular file.",
            true,
        ));
    }

    if metadata.len() > MAX_REMOTE_IMAGE_BYTES {
        return Err(AppError::new(
            "asset.image_too_large",
            "Image is too large.",
            true,
        ));
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let supported = matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
    );

    if !supported {
        return Err(AppError::new(
            "asset.image_type_unsupported",
            "The selected file is not a supported image.",
            true,
        ));
    }

    Ok(path.to_path_buf())
}

pub fn resolve_local_image(
    document_path: Option<&Path>,
    source_path: &Path,
) -> Result<PathBuf, AppError> {
    let resolved = if source_path.is_absolute() {
        source_path.to_path_buf()
    } else {
        let document_path = document_path.ok_or_else(AppError::invalid_path)?;
        let directory = document_path.parent().ok_or_else(AppError::invalid_path)?;
        directory.join(source_path)
    };

    authorize_local_image(&normalize_path(&resolved)?)
}

pub fn resolve_draft_image(app_data_directory: &Path, source: &str) -> Result<PathBuf, AppError> {
    let relative = source
        .strip_prefix("lumamark-draft://")
        .ok_or_else(AppError::invalid_path)?;
    let mut parts = relative.split('/');
    let draft_id = parts.next().filter(|value| !value.is_empty());
    let file_name = parts.next().filter(|value| !value.is_empty());

    if draft_id.is_none() || file_name.is_none() || parts.next().is_some() {
        return Err(AppError::invalid_path());
    }

    let draft_id = draft_id.expect("checked above");
    let file_name = file_name.expect("checked above");
    if draft_id.contains(['/', '\\']) || file_name.contains(['/', '\\']) || file_name == ".." {
        return Err(AppError::invalid_path());
    }

    Ok(app_data_directory
        .join("draft-assets")
        .join(draft_id)
        .join(file_name))
}

pub fn draft_image_target(
    draft_directory: &Path,
    draft_id: &str,
    mime_type: &str,
) -> Result<DraftImageTarget, AppError> {
    let extension = image_extension_from_mime_type(mime_type)?;

    if draft_id.is_empty() || draft_id.contains(['/', '\\']) {
        return Err(AppError::new(
            "asset.draft_id_invalid",
            "Draft image identifier is invalid.",
            true,
        ));
    }

    for index in 1..=9999 {
        let file_name = format!("image-{index:03}.{extension}");
        let path = draft_directory.join(&file_name);

        if !path.exists() {
            return Ok(DraftImageTarget {
                markdown_source: format!("lumamark-draft://{draft_id}/{file_name}"),
                path,
            });
        }
    }

    Err(AppError::new(
        "asset.image_name_exhausted",
        "No available image asset name could be created.",
        true,
    ))
}

pub fn finalize_draft_images(
    document_path: &Path,
    draft_directory: &Path,
    draft_id: &str,
    text: &str,
) -> Result<FinalizeDraftImagesResult, AppError> {
    let _import_guard = lock_image_imports()?;
    let document_directory = document_path.parent().ok_or_else(AppError::invalid_path)?;
    let stem = document_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(AppError::invalid_path)?;
    let asset_directory_name = format!("{stem}{IMAGE_ASSET_DIRECTORY_SUFFIX}");
    let asset_directory = document_directory.join(&asset_directory_name);
    let prefix = format!("lumamark-draft://{draft_id}/");
    let mut next_text = text.to_owned();

    for entry in fs::read_dir(draft_directory)? {
        let entry = entry?;
        let metadata = entry.file_type()?;
        if metadata.is_symlink() || !metadata.is_file() {
            return Err(AppError::new(
                "asset.draft_image_invalid",
                "Draft image is invalid.",
                true,
            ));
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let placeholder = format!("{prefix}{file_name}");
        if !next_text.contains(&placeholder) {
            continue;
        }
        fs::create_dir_all(&asset_directory)?;
        let destination = asset_directory.join(&file_name);
        let bytes = fs::read(entry.path())?;
        if destination.exists() {
            if fs::read(&destination)? != bytes {
                return Err(AppError::new(
                    "asset.draft_migration_conflict",
                    "Draft image migration conflicted with an existing asset.",
                    true,
                ));
            }
        } else {
            write_bytes_atomically(&destination, &bytes)?;
        }
        next_text = next_text.replace(&placeholder, &format!("{asset_directory_name}/{file_name}"));
    }

    Ok(FinalizeDraftImagesResult { text: next_text })
}

fn lock_image_imports() -> Result<MutexGuard<'static, ()>, AppError> {
    IMAGE_IMPORT_LOCK.lock().map_err(|_| {
        AppError::new(
            "asset.image_import_lock_failed",
            "Image import coordination failed.",
            true,
        )
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheRemoteImageResult {
    pub byte_length: usize,
    pub cache_hit: bool,
    pub path: String,
}

pub fn remote_image_cache_target(
    document_path: &Path,
    source: &str,
) -> Result<RemoteImageCacheTarget, AppError> {
    let extension = image_extension_from_source(source)?;
    let document_directory = document_path.parent().ok_or_else(AppError::invalid_path)?;
    let file_name = format!("{}.{}", sha256_hex(source.as_bytes()), extension);
    let mut path = document_directory.to_path_buf();

    for segment in REMOTE_CACHE_DIRECTORY {
        path.push(segment);
    }

    path.push(&file_name);

    Ok(RemoteImageCacheTarget { file_name, path })
}

pub fn cache_remote_image(
    document_path: impl AsRef<Path>,
    source: &str,
) -> Result<CacheRemoteImageResult, AppError> {
    cache_remote_image_with_downloader(document_path.as_ref(), source, download_remote_image)
}

fn cache_remote_image_with_downloader<F>(
    document_path: &Path,
    source: &str,
    downloader: F,
) -> Result<CacheRemoteImageResult, AppError>
where
    F: FnOnce(&str) -> Result<Vec<u8>, AppError>,
{
    let target = remote_image_cache_target(document_path, source)?;
    let extension = image_extension_from_source(source)?;

    match fs::symlink_metadata(&target.path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(unsafe_remote_image_cache_entry());
            }

            if metadata.len() > MAX_REMOTE_IMAGE_BYTES {
                fs::remove_file(&target.path)?;
                return Err(AppError::new(
                    "asset.remote_image_too_large",
                    "Remote image is too large.",
                    true,
                ));
            }

            let cached_bytes = fs::read(&target.path)?;
            if validate_remote_image_bytes(extension, &cached_bytes).is_ok() {
                return Ok(CacheRemoteImageResult {
                    byte_length: cached_bytes.len(),
                    cache_hit: true,
                    path: path_to_string(&target.path),
                });
            }

            fs::remove_file(&target.path)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    let bytes = downloader(source)?;
    validate_remote_image_bytes(extension, &bytes)?;

    if let Some(directory) = target.path.parent() {
        fs::create_dir_all(directory)?;
    }

    write_bytes_atomically(&target.path, &bytes)?;

    Ok(CacheRemoteImageResult {
        byte_length: bytes.len(),
        cache_hit: false,
        path: path_to_string(&target.path),
    })
}

fn download_remote_image(source: &str) -> Result<Vec<u8>, AppError> {
    let config = ureq::Agent::config_builder()
        .max_redirects(0)
        .timeout_connect(Some(Duration::from_secs(5)))
        .timeout_global(Some(Duration::from_secs(15)))
        .build();
    let agent = ureq::Agent::with_parts(
        config,
        DefaultConnector::default(),
        PublicAddressResolver::default(),
    );
    download_remote_image_with_agent(&agent, source)
}

fn download_remote_image_with_agent(
    agent: &ureq::Agent,
    source: &str,
) -> Result<Vec<u8>, AppError> {
    let mut response = agent.get(source).call().map_err(|_| {
        AppError::new(
            "asset.remote_image_download_failed",
            "Remote image download failed.",
            true,
        )
    })?;

    if response.status().is_redirection() {
        return Err(AppError::new(
            "asset.remote_image_download_failed",
            "Remote image download failed.",
            true,
        ));
    }
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");

    let media_type = content_type.split(';').next().unwrap_or_default().trim();
    let is_image_media_type = media_type
        .get(.."image/".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("image/"));
    if !media_type.is_empty() && !is_image_media_type {
        return Err(AppError::new(
            "asset.remote_image_content_type_unsupported",
            "Remote image content type is unsupported.",
            true,
        ));
    }

    let bytes = read_limited(response.body_mut().as_reader(), MAX_REMOTE_IMAGE_BYTES)?;
    let extension = image_extension_from_uri_path(source)?;
    validate_remote_image_bytes(extension, &bytes)?;
    Ok(bytes)
}

fn read_limited(mut reader: impl Read, limit: u64) -> Result<Vec<u8>, AppError> {
    let mut limited = (&mut reader).take(limit + 1);
    let mut bytes = Vec::new();
    limited.read_to_end(&mut bytes)?;

    if bytes.len() as u64 > limit {
        return Err(AppError::new(
            "asset.remote_image_too_large",
            "Remote image is too large.",
            true,
        ));
    }

    Ok(bytes)
}

fn image_extension_from_source(source: &str) -> Result<&'static str, AppError> {
    let uri: ureq::http::Uri = source.parse().map_err(|_| unsupported_remote_image_url())?;
    let authority = uri.authority().ok_or_else(unsupported_remote_image_url)?;

    if !matches!(uri.scheme_str(), Some("http" | "https"))
        || authority.as_str().contains('@')
        || !is_public_remote_host(authority.host())
    {
        return Err(unsupported_remote_image_url());
    }

    image_extension_from_path(uri.path())
}

fn image_extension_from_uri_path(source: &str) -> Result<&'static str, AppError> {
    let uri: ureq::http::Uri = source.parse().map_err(|_| unsupported_remote_image_url())?;
    image_extension_from_path(uri.path())
}

fn image_extension_from_path(path: &str) -> Result<&'static str, AppError> {
    let path = path.to_ascii_lowercase();

    if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        return Ok("jpg");
    }

    if path.ends_with(".png") {
        return Ok("png");
    }

    if path.ends_with(".gif") {
        return Ok("gif");
    }

    if path.ends_with(".webp") {
        return Ok("webp");
    }

    if path.ends_with(".svg") {
        return Ok("svg");
    }

    Err(AppError::new(
        "asset.remote_image_extension_unsupported",
        "Remote image extension is unsupported.",
        true,
    ))
}

fn image_extension_from_mime_type(mime_type: &str) -> Result<&'static str, AppError> {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => Ok("jpg"),
        "image/png" => Ok("png"),
        "image/gif" => Ok("gif"),
        "image/webp" => Ok("webp"),
        "image/svg+xml" => Ok("svg"),
        _ => Err(AppError::new(
            "asset.image_type_unsupported",
            "The selected file is not a supported image.",
            true,
        )),
    }
}

fn image_mime_type_from_path(path: &Path) -> Result<&'static str, AppError> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "png" => Ok("image/png"),
        "gif" => Ok("image/gif"),
        "webp" => Ok("image/webp"),
        "svg" => Ok("image/svg+xml"),
        _ => Err(AppError::new(
            "asset.image_type_unsupported",
            "The selected file is not a supported image.",
            true,
        )),
    }
}

fn bytes_match_image_mime_type(bytes: &[u8], mime_type: &str) -> bool {
    image_extension_from_mime_type(mime_type)
        .is_ok_and(|extension| bytes_match_image_extension(bytes, extension))
}

fn validate_remote_image_bytes(extension: &str, bytes: &[u8]) -> Result<(), AppError> {
    if bytes.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
        return Err(AppError::new(
            "asset.remote_image_too_large",
            "Remote image is too large.",
            true,
        ));
    }

    if !bytes_match_image_extension(bytes, extension) {
        return Err(AppError::new(
            "asset.remote_image_data_invalid",
            "Remote image data is invalid or does not match its type.",
            true,
        ));
    }

    Ok(())
}

fn bytes_match_image_extension(bytes: &[u8], extension: &str) -> bool {
    match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "svg" => bytes_have_svg_root(bytes),
        _ => false,
    }
}

fn bytes_have_svg_root(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let mut remaining = text.strip_prefix('\u{feff}').unwrap_or(text).trim_start();

    loop {
        if remaining.starts_with("<?xml") {
            let Some(end) = remaining.find("?>") else {
                return false;
            };
            remaining = remaining[end + 2..].trim_start();
            continue;
        }

        if remaining.starts_with("<!--") {
            let Some(end) = remaining.find("-->") else {
                return false;
            };
            remaining = remaining[end + 3..].trim_start();
            continue;
        }

        if let Some(doctype) = remaining.strip_prefix("<!DOCTYPE") {
            let Some(after_name) = doctype.trim_start().strip_prefix("svg") else {
                return false;
            };
            if !matches!(after_name.chars().next(), None | Some('>') | Some('['))
                && !after_name
                    .chars()
                    .next()
                    .is_some_and(|character| character.is_ascii_whitespace())
            {
                return false;
            }
            let Some(end) = remaining.find('>') else {
                return false;
            };
            remaining = remaining[end + 1..].trim_start();
            continue;
        }

        break;
    }

    let Some(after_root_name) = remaining.strip_prefix("<svg") else {
        return false;
    };
    match after_root_name.chars().next() {
        None => true,
        Some(character) => character == '>' || character.is_ascii_whitespace(),
    }
}

fn validate_imported_image_bytes(bytes: &[u8], mime_type: &str) -> Result<(), AppError> {
    if bytes.is_empty() {
        return Err(AppError::new(
            "asset.image_read_failed",
            "Image data could not be read.",
            true,
        ));
    }
    if bytes.len() as u64 > MAX_REMOTE_IMAGE_BYTES {
        return Err(AppError::new(
            "asset.image_too_large",
            "Image is too large.",
            true,
        ));
    }
    if !bytes_match_image_mime_type(bytes, mime_type) {
        return Err(AppError::new(
            "asset.image_data_invalid",
            "Image data is invalid or does not match its type.",
            true,
        ));
    }
    Ok(())
}

fn unsupported_remote_image_url() -> AppError {
    AppError::new(
        "asset.remote_image_url_unsupported",
        "Remote image URL is unsupported.",
        true,
    )
}

fn unsafe_remote_image_cache_entry() -> AppError {
    AppError::new(
        "asset.remote_image_cache_unsafe",
        "Remote image cache entry is unsafe.",
        true,
    )
}

fn is_public_remote_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();

    if normalized == "localhost" || normalized.ends_with(".localhost") {
        return false;
    }

    match normalized.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => is_public_ipv4(address),
        Ok(IpAddr::V6(address)) => is_public_ipv6(address),
        Err(_) => !normalized.is_empty(),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let octets = address.octets();

    !address.is_private()
        && !address.is_loopback()
        && !address.is_link_local()
        && !address.is_broadcast()
        && !address.is_unspecified()
        && !address.is_multicast()
        && octets[0] != 0
        && !(octets[0] == 100 && (64..=127).contains(&octets[1]))
        && octets[0] < 240
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped_ipv4) = address.to_ipv4_mapped() {
        return is_public_ipv4(mapped_ipv4);
    }

    let segments = address.segments();
    let is_unique_local = (segments[0] & 0xfe00) == 0xfc00;
    let is_link_local = (segments[0] & 0xffc0) == 0xfe80;

    !address.is_loopback()
        && !address.is_unspecified()
        && !address.is_multicast()
        && !is_unique_local
        && !is_link_local
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);

    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }

    hex
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::collections::HashSet;
    use std::io;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::Duration;

    use super::*;

    fn unique_test_directory(name: &str) -> PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-asset-{name}-{suffix}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    fn spawn_single_http_response(
        status: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> (String, thread::JoinHandle<()>) {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("test server should bind to an ephemeral port");
        let address = listener
            .local_addr()
            .expect("test server should expose its address");
        let mut response = format!("HTTP/1.1 {status}\r\n").into_bytes();
        for (name, value) in headers {
            response.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
        }
        response.extend_from_slice(
            format!(
                "Content-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .as_bytes(),
        );
        response.extend_from_slice(body);
        let server = thread::spawn(move || {
            let (mut connection, _) = listener
                .accept()
                .expect("test server should receive one request");
            let mut request = [0; 1024];
            let _ = connection
                .read(&mut request)
                .expect("test request should be readable");
            connection
                .write_all(&response)
                .expect("test response should be written");
        });

        (format!("http://{address}"), server)
    }

    fn test_http_agent() -> ureq::Agent {
        ureq::Agent::config_builder()
            .max_redirects(0)
            .build()
            .into()
    }

    #[test]
    fn remote_image_cache_target_should_store_hashed_image_next_to_document() {
        let result = remote_image_cache_target(
            &PathBuf::from("E:\\workspace\\notes\\doc.md"),
            "https://example.com/assets/pic.png?size=large",
        )
        .expect("valid image URL should create a cache target");

        assert!(result.file_name.ends_with(".png"));
        assert!(
            result
                .path
                .ends_with(".lumamark\\assets\\remote-cache\\e87813ce909809e542a68584391b31d247758c2ebc1db3d8d95ae49d8dce029d.png"),
            "cache path was {:?}",
            result.path
        );
    }

    #[test]
    fn imported_image_target_should_use_the_document_assets_directory_and_increment_names() {
        let directory = std::env::temp_dir().join("lumamark-imported-image-target");
        fs::create_dir_all(directory.join("note.assets")).expect("fixture directory should exist");
        fs::write(
            directory.join("note.assets").join("image-001.png"),
            b"existing",
        )
        .expect("existing image should be written");

        let target = imported_image_target(&directory.join("note.md"), "image/png")
            .expect("a supported image should receive a document asset target");

        assert_eq!(target.relative_markdown_path, "note.assets/image-002.png");
        assert!(target.path.ends_with("note.assets\\image-002.png"));
        fs::remove_dir_all(directory).expect("fixture directory should be removed");
    }

    #[test]
    fn imported_image_target_should_reject_non_image_mime_types() {
        let error = imported_image_target(
            &PathBuf::from("E:\\workspace\\notes\\note.md"),
            "text/plain",
        )
        .expect_err("text files must not be imported as images");

        assert_eq!(error.code, "asset.image_type_unsupported");
    }

    #[test]
    fn import_image_bytes_should_write_a_relative_document_asset() {
        let directory = std::env::temp_dir().join("lumamark-import-image-bytes");
        let document_path = directory.join("note.md");

        let result = import_image_bytes(&document_path, "image/png", b"\x89PNG\r\n\x1a\npng bytes")
            .expect("image bytes should be stored next to their document");

        assert_eq!(result.markdown_source, "note.assets/image-001.png");
        assert_eq!(
            fs::read(&result.path).expect("stored bytes should be readable"),
            b"\x89PNG\r\n\x1a\npng bytes"
        );
        fs::remove_dir_all(directory).expect("fixture directory should be removed");
    }

    #[test]
    fn concurrent_image_imports_should_allocate_distinct_asset_names() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-concurrent-import-{suffix}"));
        let document_path = Arc::new(directory.join("note.md"));
        let import_count = 8;
        let barrier = Arc::new(Barrier::new(import_count));
        let tasks = (0..import_count)
            .map(|index| {
                let barrier = Arc::clone(&barrier);
                let document_path = Arc::clone(&document_path);
                thread::spawn(move || {
                    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
                    bytes.extend_from_slice(format!("image-{index}").as_bytes());
                    barrier.wait();
                    import_image_bytes(document_path.as_ref(), "image/png", &bytes)
                        .expect("concurrent image import should succeed")
                })
            })
            .collect::<Vec<_>>();
        let results = tasks
            .into_iter()
            .map(|task| task.join().expect("image import thread should finish"))
            .collect::<Vec<_>>();
        let sources = results
            .iter()
            .map(|result| result.markdown_source.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(sources.len(), import_count);
        assert!(sources.contains("note.assets/image-001.png"));
        assert!(sources.contains("note.assets/image-008.png"));
        fs::remove_dir_all(directory).expect("fixture directory should be removed");
    }

    #[test]
    fn import_image_bytes_should_reject_data_that_does_not_match_its_declared_mime_type() {
        let error = import_image_bytes(
            &PathBuf::from("E:\\workspace\\notes\\note.md"),
            "image/png",
            b"this is not a PNG",
        )
        .expect_err("declared image MIME types must not bypass byte validation");

        assert_eq!(error.code, "asset.image_data_invalid");
    }

    #[test]
    fn copy_local_image_should_copy_a_valid_image_without_modifying_the_source() {
        let root = std::env::temp_dir().join("lumamark-copy-local-image");
        let source_directory = root.join("source");
        let document_directory = root.join("document");
        let source = source_directory.join("original.png");
        let document = document_directory.join("note.md");
        fs::create_dir_all(&source_directory).expect("source directory should exist");
        fs::create_dir_all(&document_directory).expect("document directory should exist");
        fs::write(&source, b"\x89PNG\r\n\x1a\nlocal image")
            .expect("source image should be written");

        let result =
            copy_local_image(&document, &source).expect("valid local image should be copied");

        assert_eq!(result.markdown_source, "note.assets/image-001.png");
        assert_eq!(
            fs::read(&result.path).expect("copied image should be readable"),
            b"\x89PNG\r\n\x1a\nlocal image"
        );
        assert_eq!(
            fs::read(&source).expect("source image should remain unchanged"),
            b"\x89PNG\r\n\x1a\nlocal image"
        );
        fs::remove_dir_all(root).expect("fixture directory should be removed");
    }

    #[test]
    fn authorize_local_image_should_reject_non_image_files_and_directories() {
        let directory = std::env::temp_dir().join("lumamark-authorize-local-image");
        fs::create_dir_all(&directory).expect("fixture directory should exist");
        let text_file = directory.join("not-image.txt");
        fs::write(&text_file, "not an image").expect("fixture file should be written");

        let text_error = authorize_local_image(&text_file)
            .expect_err("non-image files must not receive asset authorization");
        let directory_error = authorize_local_image(&directory)
            .expect_err("directories must not receive asset authorization");

        assert_eq!(text_error.code, "asset.image_type_unsupported");
        assert_eq!(directory_error.code, "asset.local_image_invalid");
        fs::remove_dir_all(directory).expect("fixture directory should be removed");
    }

    #[test]
    fn resolve_local_image_should_return_a_lexically_normalized_path() {
        let directory = unique_test_directory("normalize-local-image");
        let asset_directory = directory.join("assets");
        let image = asset_directory.join("pic.png");
        fs::create_dir_all(&asset_directory).expect("asset directory should exist");
        fs::write(&image, b"\x89PNG\r\n\x1a\nlocal image")
            .expect("fixture image should be written");

        let resolved = resolve_local_image(
            Some(&directory.join("note.md")),
            Path::new("./assets/../assets/pic.png"),
        )
        .expect("relative image should resolve");

        assert_eq!(resolved, image);
        fs::remove_dir_all(directory).expect("fixture directory should be removed");
    }

    #[test]
    fn draft_image_target_should_use_a_stable_placeholder_and_incremented_file_name() {
        let directory = PathBuf::from("E:\\temp\\lumamark-drafts\\draft-42");
        let target = draft_image_target(&directory, "draft-42", "image/png")
            .expect("supported draft images should receive a placeholder target");

        assert_eq!(
            target.markdown_source,
            "lumamark-draft://draft-42/image-001.png"
        );
        assert!(target.path.ends_with("draft-42\\image-001.png"));
    }

    #[test]
    fn resolve_draft_image_should_restore_a_placeholder_from_app_data() {
        let app_data = PathBuf::from("C:\\AppData\\LumaMark");

        let path = resolve_draft_image(&app_data, "lumamark-draft://draft-old/image-001.png")
            .expect("valid recovered draft source should resolve");

        assert_eq!(
            path,
            app_data
                .join("draft-assets")
                .join("draft-old")
                .join("image-001.png")
        );
    }

    #[test]
    fn resolve_draft_image_should_reject_nested_or_traversal_paths() {
        let app_data = PathBuf::from("C:\\AppData\\LumaMark");

        for source in [
            "lumamark-draft://draft-old/../secret.png",
            "lumamark-draft://draft-old/sub/image.png",
            "lumamark-draft:///image.png",
        ] {
            let error = resolve_draft_image(&app_data, source)
                .expect_err("unsafe recovered draft source should be rejected");
            assert_eq!(error.code, "file.invalid_path");
        }
    }

    #[test]
    fn import_draft_image_bytes_should_write_the_image_and_keep_a_draft_markdown_source() {
        let directory = std::env::temp_dir().join("lumamark-import-draft-image");
        let result = import_draft_image_bytes(
            &directory,
            "draft-99",
            "image/png",
            b"\x89PNG\r\n\x1a\ndraft",
        )
        .expect("draft image bytes should be stored");

        assert_eq!(
            result.markdown_source,
            "lumamark-draft://draft-99/image-001.png"
        );
        assert_eq!(
            fs::read(&result.path).expect("draft bytes should be readable"),
            b"\x89PNG\r\n\x1a\ndraft"
        );
        fs::remove_dir_all(directory).expect("fixture directory should be removed");
    }

    #[test]
    fn finalize_draft_images_should_copy_assets_and_replace_only_matching_placeholders() {
        let root = std::env::temp_dir().join("lumamark-finalize-draft-images");
        let draft_directory = root.join("draft-7");
        fs::create_dir_all(&draft_directory).expect("draft directory should exist");
        fs::write(
            draft_directory.join("image-001.png"),
            b"\x89PNG\r\n\x1a\ndraft",
        )
        .expect("draft image should be written");
        let document = root.join("note.md");
        let source = "before\n![Draft](lumamark-draft://draft-7/image-001.png)\nafter";

        let result = finalize_draft_images(&document, &draft_directory, "draft-7", source)
            .expect("draft image should be finalized");

        assert_eq!(
            result.text,
            "before\n![Draft](note.assets/image-001.png)\nafter"
        );
        assert_eq!(
            fs::read(root.join("note.assets/image-001.png")).expect("asset should be copied"),
            b"\x89PNG\r\n\x1a\ndraft"
        );
        fs::remove_dir_all(root).expect("fixture directory should be removed");
    }

    #[test]
    fn finalize_draft_images_should_be_retry_safe_when_the_asset_bytes_match() {
        let root = std::env::temp_dir().join("lumamark-finalize-draft-images-retry");
        let draft_directory = root.join("draft-retry");
        fs::create_dir_all(&draft_directory).expect("draft directory should exist");
        fs::write(
            draft_directory.join("image-001.png"),
            b"\x89PNG\r\n\x1a\ndraft",
        )
        .expect("draft image should be written");
        let document = root.join("note.md");
        let source = "![Draft](lumamark-draft://draft-retry/image-001.png)";

        let first = finalize_draft_images(&document, &draft_directory, "draft-retry", source)
            .expect("first migration should succeed");
        let retry = finalize_draft_images(&document, &draft_directory, "draft-retry", source)
            .expect("retrying the same migration should succeed");

        assert_eq!(first.text, "![Draft](note.assets/image-001.png)");
        assert_eq!(retry.text, first.text);
        fs::remove_dir_all(root).expect("fixture directory should be removed");
    }

    #[test]
    fn remote_image_cache_target_should_reject_non_http_urls() {
        let error = remote_image_cache_target(
            &PathBuf::from("E:\\workspace\\notes\\doc.md"),
            "file:///E:/workspace/notes/pic.png",
        )
        .expect_err("file URLs must not be downloaded");

        assert_eq!(error.code, "asset.remote_image_url_unsupported");
    }

    #[test]
    fn remote_image_cache_target_should_reject_loopback_image_urls() {
        let error = remote_image_cache_target(
            &PathBuf::from("E:\\workspace\\notes\\doc.md"),
            "http://127.0.0.1/internal.png",
        )
        .expect_err("loopback URLs must not be downloaded");

        assert_eq!(error.code, "asset.remote_image_url_unsupported");
    }

    #[test]
    fn cache_remote_image_should_reject_non_file_cache_hits() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-asset-test-{suffix}"));
        let document_path = directory.join("doc.md");
        let source = "https://example.com/pic.png";
        let target = remote_image_cache_target(&document_path, source)
            .expect("test URL should resolve to a cache target");
        fs::create_dir_all(&target.path).expect("cache target directory should be created");

        let error = cache_remote_image(&document_path, source)
            .expect_err("non-file cache hits must be rejected");

        assert_eq!(error.code, "asset.remote_image_cache_unsafe");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn cache_remote_image_should_reject_oversized_cache_hits() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-asset-test-{suffix}"));
        let document_path = directory.join("doc.md");
        let source = "https://example.com/pic.png";
        let target = remote_image_cache_target(&document_path, source)
            .expect("test URL should resolve to a cache target");

        fs::create_dir_all(target.path.parent().expect("cache target has a parent"))
            .expect("cache directory should be created");
        fs::write(&target.path, vec![0; (MAX_REMOTE_IMAGE_BYTES + 1) as usize])
            .expect("oversized cache entry should be written");

        let error = cache_remote_image(&document_path, source)
            .expect_err("oversized cache hits must be rejected");

        assert_eq!(error.code, "asset.remote_image_too_large");
        assert!(
            !target.path.exists(),
            "an oversized cache entry must be removed"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn remote_image_bytes_should_accept_png_signature() {
        validate_remote_image_bytes("png", b"\x89PNG\r\n\x1a\nbody")
            .expect("a PNG signature should be accepted");
    }

    #[test]
    fn remote_image_bytes_should_accept_jpeg_signature() {
        validate_remote_image_bytes("jpg", b"\xff\xd8\xff\xe0body")
            .expect("a JPEG signature should be accepted");
    }

    #[test]
    fn remote_image_bytes_should_accept_gif_signature() {
        validate_remote_image_bytes("gif", b"GIF89abody")
            .expect("a GIF signature should be accepted");
    }

    #[test]
    fn remote_image_bytes_should_accept_webp_riff_structure() {
        validate_remote_image_bytes("webp", b"RIFF\x04\0\0\0WEBPbody")
            .expect("a WebP RIFF signature should be accepted");
    }

    #[test]
    fn remote_image_bytes_should_accept_svg_root_after_xml_declaration() {
        validate_remote_image_bytes(
            "svg",
            b"\xef\xbb\xbf  <?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
        )
        .expect("an SVG root after an XML declaration should be accepted");
    }

    #[test]
    fn remote_image_bytes_should_accept_svg_doctype_before_root() {
        validate_remote_image_bytes(
            "svg",
            b"<?xml version=\"1.0\"?>\n<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
        )
        .expect("an SVG doctype immediately before the root should be accepted");
    }

    #[test]
    fn remote_image_bytes_should_reject_xml_without_svg_root() {
        let error = validate_remote_image_bytes("svg", b"<?xml version=\"1.0\"?><html></html>")
            .expect_err("an XML declaration alone must not be accepted as SVG");

        assert_eq!(error.code, "asset.remote_image_data_invalid");
    }

    #[test]
    fn download_remote_image_should_reject_invalid_bytes_without_content_type() {
        let (base_url, server) = spawn_single_http_response("200 OK", &[], b"this is not an image");
        let error = download_remote_image_with_agent(
            &test_http_agent(),
            &format!("{base_url}/missing-header.png"),
        )
        .expect_err("missing content type must not allow invalid image bytes");

        assert_eq!(error.code, "asset.remote_image_data_invalid");
        server.join().expect("test server should exit");
    }

    #[test]
    fn download_remote_image_should_reject_invalid_bytes_disguised_as_image() {
        let (base_url, server) = spawn_single_http_response(
            "200 OK",
            &[("Content-Type", "image/png")],
            b"this is not a PNG",
        );
        let error = download_remote_image_with_agent(
            &test_http_agent(),
            &format!("{base_url}/disguised.png"),
        )
        .expect_err("an image content type must not bypass byte validation");

        assert_eq!(error.code, "asset.remote_image_data_invalid");
        server.join().expect("test server should exit");
    }

    #[test]
    fn download_remote_image_should_reject_http_errors() {
        let (base_url, server) = spawn_single_http_response(
            "503 Service Unavailable",
            &[("Content-Type", "image/png")],
            b"temporary failure",
        );
        let error = download_remote_image_with_agent(
            &test_http_agent(),
            &format!("{base_url}/unavailable.png"),
        )
        .expect_err("HTTP errors must fail the download");

        assert_eq!(error.code, "asset.remote_image_download_failed");
        server.join().expect("test server should exit");
    }

    #[test]
    fn download_remote_image_should_reject_non_image_content_type() {
        let (base_url, server) = spawn_single_http_response(
            "200 OK",
            &[("Content-Type", "text/html; charset=utf-8")],
            b"\x89PNG\r\n\x1a\nbody",
        );
        let error = download_remote_image_with_agent(
            &test_http_agent(),
            &format!("{base_url}/not-an-image.png"),
        )
        .expect_err("an explicit non-image content type must be rejected");

        assert_eq!(error.code, "asset.remote_image_content_type_unsupported");
        server.join().expect("test server should exit");
    }

    #[test]
    fn cache_remote_image_should_replace_an_invalid_existing_cache_entry() {
        let directory = unique_test_directory("invalid-cache-refetch");
        let document_path = directory.join("doc.md");
        let source = "https://example.com/assets/pic.png";
        let target = remote_image_cache_target(&document_path, source)
            .expect("test URL should create a cache target");
        fs::create_dir_all(
            target
                .path
                .parent()
                .expect("cache target should have a parent"),
        )
        .expect("cache directory should be created");
        fs::write(&target.path, b"corrupt cache bytes")
            .expect("corrupt cache entry should be written");
        let download_calls = Cell::new(0);
        let valid_png = b"\x89PNG\r\n\x1a\nrefetched";

        let result = cache_remote_image_with_downloader(&document_path, source, |_| {
            download_calls.set(download_calls.get() + 1);
            Ok(valid_png.to_vec())
        })
        .expect("an invalid cache entry should be replaced by a valid download");

        assert!(!result.cache_hit);
        assert_eq!(download_calls.get(), 1);
        assert_eq!(
            fs::read(&target.path).expect("replacement cache entry should be readable"),
            valid_png
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn cache_remote_image_should_leave_no_file_after_download_failure() {
        let directory = unique_test_directory("http-failure-cleanup");
        let document_path = directory.join("doc.md");
        let source = "https://example.com/assets/pic.png";
        let target = remote_image_cache_target(&document_path, source)
            .expect("test URL should create a cache target");

        let error = cache_remote_image_with_downloader(&document_path, source, |_| {
            Err(AppError::new(
                "asset.remote_image_download_failed",
                "Remote image download failed.",
                true,
            ))
        })
        .expect_err("a failed download must not create a cache file");

        assert_eq!(error.code, "asset.remote_image_download_failed");
        assert!(!target.path.exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn cache_remote_image_should_remove_bad_cache_when_refetch_is_invalid() {
        let directory = unique_test_directory("invalid-refetch-cleanup");
        let document_path = directory.join("doc.md");
        let source = "https://example.com/assets/pic.png";
        let target = remote_image_cache_target(&document_path, source)
            .expect("test URL should create a cache target");
        fs::create_dir_all(
            target
                .path
                .parent()
                .expect("cache target should have a parent"),
        )
        .expect("cache directory should be created");
        fs::write(&target.path, b"old corrupt cache")
            .expect("corrupt cache entry should be written");

        let error = cache_remote_image_with_downloader(&document_path, source, |_| {
            Ok(b"new corrupt response".to_vec())
        })
        .expect_err("invalid replacement bytes must not be cached");

        assert_eq!(error.code, "asset.remote_image_data_invalid");
        assert!(!target.path.exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn cache_remote_image_should_leave_no_file_after_oversized_response() {
        let directory = unique_test_directory("oversized-response-cleanup");
        let document_path = directory.join("doc.md");
        let source = "https://example.com/assets/pic.png";
        let target = remote_image_cache_target(&document_path, source)
            .expect("test URL should create a cache target");

        let error = cache_remote_image_with_downloader(&document_path, source, |_| {
            Ok(vec![0; (MAX_REMOTE_IMAGE_BYTES + 1) as usize])
        })
        .expect_err("an oversized response must not be cached");

        assert_eq!(error.code, "asset.remote_image_too_large");
        assert!(!target.path.exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn download_remote_image_should_not_follow_redirects() {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("test server should bind to an ephemeral port");
        let address = listener
            .local_addr()
            .expect("test server should expose its address");
        let redirect_target = format!("http://{address}/image.png");
        let server = thread::spawn(move || {
            let (mut redirect_connection, _) = listener
                .accept()
                .expect("test server should receive the redirect request");
            let mut request = [0; 512];
            let _ = redirect_connection
                .read(&mut request)
                .expect("redirect request should be readable");
            write!(
                redirect_connection,
                "HTTP/1.1 302 Found\r\nLocation: {redirect_target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .expect("redirect response should be written");

            listener
                .set_nonblocking(true)
                .expect("test server should become nonblocking");
            for _ in 0..20 {
                match listener.accept() {
                    Ok((mut image_connection, _)) => {
                        let _ = image_connection
                            .read(&mut request)
                            .expect("redirected request should be readable");
                        image_connection
                            .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\nConnection: close\r\n\r\npng")
                            .expect("image response should be written");
                        return;
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("test server accept failed: {error}"),
                }
            }
        });

        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .build()
            .into();
        let error =
            download_remote_image_with_agent(&agent, &format!("http://{address}/redirect.png"))
                .expect_err("remote image redirects must not be followed");

        assert_eq!(error.code, "asset.remote_image_download_failed");
        server.join().expect("test server thread should exit");
    }

    #[test]
    fn read_limited_should_reject_images_over_the_size_limit() {
        let bytes = vec![0; 4];
        let error = read_limited(io::Cursor::new(bytes), 3)
            .expect_err("oversized image should be rejected");

        assert_eq!(error.code, "asset.remote_image_too_large");
    }
}
