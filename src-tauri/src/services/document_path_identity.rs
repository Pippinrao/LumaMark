use std::{error::Error, ffi::OsString, fmt, fs, path::PathBuf};

use serde::{de::Error as DeserializeError, Deserialize, Deserializer, Serialize, Serializer};

#[cfg(test)]
std::thread_local! {
    static RESOLUTION_ATTEMPTS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[derive(Clone, Eq, PartialEq)]
pub(crate) struct DocumentPathIdentity {
    lexical_alias: PathIdentityKey,
    resolved: PathIdentityKey,
}

#[derive(Clone, Eq, Hash, PartialEq)]
pub(crate) struct PathIdentityKey(String);

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DocumentPathIdentitySnapshot {
    lexical_alias: String,
    resolved: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PathIdentityError {
    InvalidPath,
    Unavailable,
}

impl fmt::Display for PathIdentityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPath => formatter.write_str("document path is invalid"),
            Self::Unavailable => formatter.write_str("document path identity is unavailable"),
        }
    }
}

impl Error for PathIdentityError {}

impl Serialize for DocumentPathIdentity {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        DocumentPathIdentitySnapshot {
            lexical_alias: self.lexical_alias.0.clone(),
            resolved: self.resolved.0.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for DocumentPathIdentity {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let snapshot = DocumentPathIdentitySnapshot::deserialize(deserializer)?;
        let lexical_alias = validate_snapshot_key(snapshot.lexical_alias)
            .map_err(|_| D::Error::custom("invalid document path identity snapshot"))?;
        let resolved = validate_snapshot_key(snapshot.resolved)
            .map_err(|_| D::Error::custom("invalid document path identity snapshot"))?;
        Ok(Self {
            lexical_alias,
            resolved,
        })
    }
}

impl DocumentPathIdentity {
    pub(crate) fn lexical(path: &str) -> Result<PathIdentityKey, PathIdentityError> {
        if path.is_empty() || path.contains('\0') {
            return Err(PathIdentityError::InvalidPath);
        }
        parse_lexical(path, None)
    }

    pub(crate) fn resolve(path: &str) -> Result<Self, PathIdentityError> {
        #[cfg(test)]
        RESOLUTION_ATTEMPTS.with(|attempts| attempts.set(attempts.get() + 1));
        let lexical_alias = Self::lexical(path)?;
        let resolved = resolved_document_identity(path, &lexical_alias)?;
        Ok(Self {
            lexical_alias,
            resolved,
        })
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn reset_resolution_attempts() {
        RESOLUTION_ATTEMPTS.with(|attempts| attempts.set(0));
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub(crate) fn resolution_attempts() -> usize {
        RESOLUTION_ATTEMPTS.with(std::cell::Cell::get)
    }

    pub(crate) fn lexical_alias(&self) -> &PathIdentityKey {
        &self.lexical_alias
    }

    pub(crate) fn resolved(&self) -> &PathIdentityKey {
        &self.resolved
    }

    pub(crate) fn overlaps(&self, other: &Self) -> bool {
        self.lexical_alias == other.lexical_alias
            || self.lexical_alias == other.resolved
            || self.resolved == other.lexical_alias
            || self.resolved == other.resolved
    }
}

fn validate_snapshot_key(value: String) -> Result<PathIdentityKey, PathIdentityError> {
    let normalized = if let Some(path) = value.strip_prefix("windows-verbatim-drive:") {
        normalize_drive_path(path, WindowsMode::Verbatim)?
    } else if let Some(path) = value.strip_prefix("windows-drive:") {
        normalize_drive_path(path, WindowsMode::Normal)?
    } else if let Some(path) = value.strip_prefix("windows-verbatim-unc:") {
        normalize_unc_path(path, WindowsMode::Verbatim)?
    } else if let Some(path) = value.strip_prefix("windows-unc:") {
        normalize_unc_path(path, WindowsMode::Normal)?
    } else if let Some(path) = value.strip_prefix("posix:") {
        normalize_posix_path(path)?
    } else {
        return Err(PathIdentityError::InvalidPath);
    };
    if normalized.0 != value {
        return Err(PathIdentityError::InvalidPath);
    }
    Ok(normalized)
}

fn parse_lexical(
    path: &str,
    _forced_windows_mode: Option<WindowsMode>,
) -> Result<PathIdentityKey, PathIdentityError> {
    #[cfg(unix)]
    if path.starts_with('/') {
        return normalize_posix_path(path);
    }

    #[cfg(windows)]
    if path.starts_with('/') && !path.starts_with("//") {
        return Err(PathIdentityError::InvalidPath);
    }

    #[cfg(any(windows, test))]
    return parse_windows_lexical(path, _forced_windows_mode);

    #[cfg(not(any(windows, test)))]
    Err(PathIdentityError::InvalidPath)
}

#[cfg(any(windows, test))]
fn parse_windows_lexical(
    path: &str,
    forced_windows_mode: Option<WindowsMode>,
) -> Result<PathIdentityKey, PathIdentityError> {
    let windows_path = path.replace('\\', "/");
    if let Some(unc_path) = strip_ascii_prefix(&windows_path, "//?/UNC/") {
        return normalize_unc_path(
            unc_path,
            forced_windows_mode.unwrap_or(WindowsMode::Verbatim),
        );
    }
    if let Some(drive_path) = strip_ascii_prefix(&windows_path, "//?/") {
        return normalize_drive_path(
            drive_path,
            forced_windows_mode.unwrap_or(WindowsMode::Verbatim),
        );
    }
    if windows_path.starts_with("//./") {
        return Err(PathIdentityError::InvalidPath);
    }
    if let Some(unc_path) = windows_path.strip_prefix("//") {
        return normalize_unc_path(unc_path, forced_windows_mode.unwrap_or(WindowsMode::Normal));
    }

    normalize_drive_path(
        &windows_path,
        forced_windows_mode.unwrap_or(WindowsMode::Normal),
    )
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum WindowsMode {
    Normal,
    Verbatim,
}

fn strip_ascii_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let candidate = value.get(..prefix.len())?;
    if candidate.eq_ignore_ascii_case(prefix) {
        value.get(prefix.len()..)
    } else {
        None
    }
}

fn normalize_drive_path(
    path: &str,
    mode: WindowsMode,
) -> Result<PathIdentityKey, PathIdentityError> {
    let bytes = path.as_bytes();
    if bytes.len() < 3 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'/' {
        return Err(PathIdentityError::InvalidPath);
    }

    let drive = (bytes[0] as char).to_ascii_lowercase();
    let segments = normalize_windows_segments(&path[3..], mode)?;
    let suffix = join_segments(&segments);
    let namespace = windows_namespace("windows-drive", "windows-verbatim-drive", mode, &segments);
    Ok(PathIdentityKey(format!("{namespace}:{drive}:/{suffix}")))
}

fn normalize_unc_path(path: &str, mode: WindowsMode) -> Result<PathIdentityKey, PathIdentityError> {
    let mut segments = path.split('/');
    let server = normalize_unc_root_segment(segments.next(), mode)?;
    let share = normalize_unc_root_segment(segments.next(), mode)?;
    let remainder = segments.collect::<Vec<_>>().join("/");
    let normalized = normalize_windows_segments(&remainder, mode)?;
    let suffix = join_segments(&normalized);
    let has_verbatim_component = has_verbatim_suffix(&server)
        || has_verbatim_suffix(&share)
        || normalized
            .iter()
            .any(|segment| has_verbatim_suffix(segment));
    let namespace = if mode == WindowsMode::Verbatim && has_verbatim_component {
        "windows-verbatim-unc"
    } else {
        "windows-unc"
    };

    Ok(PathIdentityKey(format!(
        "{namespace}:{server}/{share}/{suffix}"
    )))
}

fn normalize_unc_root_segment(
    segment: Option<&str>,
    mode: WindowsMode,
) -> Result<String, PathIdentityError> {
    let value = segment.ok_or(PathIdentityError::InvalidPath)?;
    let normalized = normalize_windows_component(value, mode)?;
    normalized.ok_or(PathIdentityError::InvalidPath)
}

fn normalize_windows_segments(
    path: &str,
    mode: WindowsMode,
) -> Result<Vec<String>, PathIdentityError> {
    let mut normalized = Vec::new();
    for segment in path.split('/') {
        let space_trimmed = if mode == WindowsMode::Normal {
            segment.trim_end_matches(' ')
        } else {
            segment
        };
        match space_trimmed {
            "" | "." => {}
            ".." => {
                if normalized.pop().is_none() {
                    return Err(PathIdentityError::InvalidPath);
                }
            }
            value => {
                let component = normalize_windows_component(value, mode)?
                    .ok_or(PathIdentityError::InvalidPath)?;
                normalized.push(component);
            }
        }
    }
    Ok(normalized)
}

fn normalize_windows_component(
    value: &str,
    mode: WindowsMode,
) -> Result<Option<String>, PathIdentityError> {
    if value.contains('\0') {
        return Err(PathIdentityError::InvalidPath);
    }
    let normalized = if mode == WindowsMode::Normal {
        value.trim_end_matches([' ', '.'])
    } else {
        value
    };
    if normalized.is_empty() || normalized == "." || normalized == ".." {
        return Ok(None);
    }
    Ok(Some(normalized.to_lowercase()))
}

fn windows_namespace<'a>(
    normal: &'a str,
    verbatim: &'a str,
    mode: WindowsMode,
    segments: &[String],
) -> &'a str {
    if mode == WindowsMode::Verbatim && segments.iter().any(|segment| has_verbatim_suffix(segment))
    {
        verbatim
    } else {
        normal
    }
}

fn has_verbatim_suffix(segment: &str) -> bool {
    segment.ends_with([' ', '.'])
}

#[cfg(windows)]
fn resolved_document_identity(
    path: &str,
    lexical: &PathIdentityKey,
) -> Result<PathIdentityKey, PathIdentityError> {
    if !lexical.0.starts_with("windows-") {
        return Ok(lexical.clone());
    }

    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let canonical = fs::canonicalize(path).map_err(|_| PathIdentityError::Unavailable)?;
            let canonical_path = canonical.to_str().ok_or(PathIdentityError::Unavailable)?;
            parse_lexical(canonical_path, Some(windows_mode(path)))
        }
        Ok(_) => Err(PathIdentityError::InvalidPath),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            canonicalized_missing_windows_identity(path, lexical)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => {
            Err(PathIdentityError::InvalidPath)
        }
        Err(_) => Err(PathIdentityError::Unavailable),
    }
}

#[cfg(windows)]
fn canonicalized_missing_windows_identity(
    path: &str,
    lexical: &PathIdentityKey,
) -> Result<PathIdentityKey, PathIdentityError> {
    let mode = windows_mode(path);
    let mut ancestor = PathBuf::from(path);
    let mut missing_components = Vec::<OsString>::new();

    loop {
        match fs::canonicalize(&ancestor) {
            Ok(mut canonical) => {
                for component in missing_components.iter().rev() {
                    canonical.push(component);
                }
                let canonical_path = canonical.to_str().ok_or(PathIdentityError::Unavailable)?;
                return parse_lexical(canonical_path, Some(mode));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(component) = ancestor.file_name() else {
                    return Ok(lexical.clone());
                };
                let component = normalize_missing_windows_component(component, mode)?;
                missing_components.push(component);
                if !ancestor.pop() {
                    return Ok(lexical.clone());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => {
                return Err(PathIdentityError::InvalidPath);
            }
            Err(_) => return Err(PathIdentityError::Unavailable),
        }
    }
}

#[cfg(windows)]
fn normalize_missing_windows_component(
    component: &std::ffi::OsStr,
    mode: WindowsMode,
) -> Result<OsString, PathIdentityError> {
    let component = component.to_str().ok_or(PathIdentityError::Unavailable)?;
    let normalized =
        normalize_windows_component(component, mode)?.ok_or(PathIdentityError::InvalidPath)?;
    Ok(OsString::from(normalized))
}

#[cfg(windows)]
fn windows_mode(path: &str) -> WindowsMode {
    let normalized = path.replace('\\', "/");
    if strip_ascii_prefix(&normalized, "//?/").is_some() {
        WindowsMode::Verbatim
    } else {
        WindowsMode::Normal
    }
}

#[cfg(unix)]
fn resolved_document_identity(
    path: &str,
    lexical: &PathIdentityKey,
) -> Result<PathIdentityKey, PathIdentityError> {
    if !lexical.0.starts_with("posix:") {
        return Ok(lexical.clone());
    }

    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            let canonical = fs::canonicalize(path).map_err(|_| PathIdentityError::Unavailable)?;
            let canonical_path = canonical.to_str().ok_or(PathIdentityError::Unavailable)?;
            normalize_posix_path(canonical_path)
        }
        Ok(_) => Err(PathIdentityError::InvalidPath),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            canonicalized_missing_posix_identity(path, lexical)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => {
            Err(PathIdentityError::InvalidPath)
        }
        Err(_) => Err(PathIdentityError::Unavailable),
    }
}

#[cfg(unix)]
fn canonicalized_missing_posix_identity(
    path: &str,
    lexical: &PathIdentityKey,
) -> Result<PathIdentityKey, PathIdentityError> {
    let mut ancestor = PathBuf::from(path);
    let mut missing_components = Vec::<OsString>::new();

    loop {
        match fs::canonicalize(&ancestor) {
            Ok(mut canonical) => {
                for component in missing_components.iter().rev() {
                    canonical.push(component);
                }
                let canonical_path = canonical.to_str().ok_or(PathIdentityError::Unavailable)?;
                return normalize_posix_path(canonical_path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let Some(component) = ancestor.file_name() else {
                    return Ok(lexical.clone());
                };
                missing_components.push(component.to_owned());
                if !ancestor.pop() {
                    return Ok(lexical.clone());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => {
                return Err(PathIdentityError::InvalidPath);
            }
            Err(_) => return Err(PathIdentityError::Unavailable),
        }
    }
}

#[cfg(not(any(windows, unix)))]
fn resolved_document_identity(
    _path: &str,
    lexical: &PathIdentityKey,
) -> Result<PathIdentityKey, PathIdentityError> {
    Ok(lexical.clone())
}

fn normalize_posix_path(path: &str) -> Result<PathIdentityKey, PathIdentityError> {
    let mut normalized = Vec::new();
    for segment in path.split('/').skip(1) {
        match segment {
            "" | "." => {}
            ".." => {
                if normalized.pop().is_none() {
                    return Err(PathIdentityError::InvalidPath);
                }
            }
            value if value.contains('\0') => return Err(PathIdentityError::InvalidPath),
            value => normalized.push(value.to_owned()),
        }
    }
    let suffix = join_segments(&normalized);
    Ok(PathIdentityKey(format!("posix:/{suffix}")))
}

fn join_segments(segments: &[String]) -> String {
    segments.join("/")
}
