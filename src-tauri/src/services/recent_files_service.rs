use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

use serde::{Deserialize, Serialize};

use crate::{
    errors::AppError,
    services::{
        document_path_identity::{DocumentPathIdentity, PathIdentityError, PathIdentityKey},
        file_service::write_bytes_atomically,
    },
};

const MAX_RECENT_FILES: usize = 20;
const RECENT_FILES_FILE_NAME: &str = "recent-files.json";
const RECENT_FILES_VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub name: String,
    pub opened_at: u64,
    pub path: String,
}

pub type RecentFileInput = RecentFile;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFilesSnapshot {
    pub files: Vec<RecentFile>,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentFilesDocument {
    files: Vec<RecentFile>,
    #[serde(default)]
    legacy_imported: bool,
    revision: u64,
    version: u32,
}

impl Default for RecentFilesDocument {
    fn default() -> Self {
        Self {
            files: Vec::new(),
            legacy_imported: false,
            revision: 0,
            version: RECENT_FILES_VERSION,
        }
    }
}

pub struct RecentFilesService {
    config_dir: PathBuf,
    state: Mutex<Option<RecentFilesDocument>>,
}

struct RecentPathIdentity {
    lexical: PathIdentityKey,
    resolved: Option<PathIdentityKey>,
}

impl RecentFilesService {
    pub fn new(config_dir: PathBuf) -> Self {
        Self {
            config_dir,
            state: Mutex::new(None),
        }
    }

    pub fn get(&self) -> Result<RecentFilesSnapshot, AppError> {
        let mut state = self.lock_state()?;
        let current = self.load_if_needed(&mut state)?;
        Ok(snapshot(current))
    }

    pub fn add(&self, file: RecentFileInput) -> Result<RecentFilesSnapshot, AppError> {
        validate_recent_file(&file)?;
        let identity = recent_path_identity(&file.path)?;
        let mut state = self.lock_state()?;
        let mut next = self.load_if_needed(&mut state)?.clone();
        next.revision = next.revision.checked_add(1).ok_or_else(write_failed)?;
        next.files
            .retain(|recent| !recent_file_matches_identity(recent, &identity));
        next.files.insert(0, file);
        next.files.truncate(MAX_RECENT_FILES);
        self.persist(&next)?;
        let result = snapshot(&next);
        *state = Some(next);
        Ok(result)
    }

    pub fn clear(&self) -> Result<RecentFilesSnapshot, AppError> {
        let mut state = self.lock_state()?;
        let mut next = self.load_if_needed(&mut state)?.clone();
        next.revision = next.revision.checked_add(1).ok_or_else(write_failed)?;
        next.files.clear();
        self.persist(&next)?;
        let result = snapshot(&next);
        *state = Some(next);
        Ok(result)
    }

    pub fn import_legacy(
        &self,
        files: Vec<RecentFileInput>,
    ) -> Result<RecentFilesSnapshot, AppError> {
        if files.len() > MAX_RECENT_FILES
            || files.iter().any(|file| validate_recent_file(file).is_err())
        {
            return Err(AppError::new(
                "recent_files.invalid_entry",
                "Recent file entry is invalid.",
                true,
            ));
        }
        let files = files
            .into_iter()
            .map(|file| {
                let identity = recent_path_identity(&file.path)?;
                Ok((file, identity))
            })
            .collect::<Result<Vec<_>, AppError>>()?;

        let mut state = self.lock_state()?;
        let current = self.load_if_needed(&mut state)?;
        if current.legacy_imported {
            return Ok(snapshot(current));
        }

        let mut next = current.clone();
        next.revision = next.revision.checked_add(1).ok_or_else(write_failed)?;
        for (file, identity) in files {
            if !next
                .files
                .iter()
                .any(|recent| recent_file_matches_identity(recent, &identity))
            {
                next.files.push(file);
            }
        }
        next.files.truncate(MAX_RECENT_FILES);
        next.legacy_imported = true;
        self.persist(&next)?;
        let result = snapshot(&next);
        *state = Some(next);
        Ok(result)
    }

    fn load_if_needed<'a>(
        &self,
        state: &'a mut Option<RecentFilesDocument>,
    ) -> Result<&'a RecentFilesDocument, AppError> {
        if state.is_none() {
            *state = Some(load_document(&self.config_dir)?);
        }
        state.as_ref().ok_or_else(read_failed)
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, Option<RecentFilesDocument>>, AppError> {
        self.state.lock().map_err(|_| {
            AppError::new(
                "recent_files.state_unavailable",
                "Recent files state is unavailable.",
                true,
            )
        })
    }

    fn persist(&self, document: &RecentFilesDocument) -> Result<(), AppError> {
        fs::create_dir_all(&self.config_dir).map_err(|_| write_failed())?;
        let bytes = serde_json::to_vec_pretty(document).map_err(|_| write_failed())?;
        write_bytes_atomically(&recent_files_path(&self.config_dir), &bytes)
            .map_err(|_| write_failed())
    }
}

pub fn recent_files_path(config_dir: &Path) -> PathBuf {
    config_dir.join(RECENT_FILES_FILE_NAME)
}

fn load_document(config_dir: &Path) -> Result<RecentFilesDocument, AppError> {
    let path = recent_files_path(config_dir);
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RecentFilesDocument::default());
        }
        Err(_) => return Err(read_failed()),
    };
    let document: RecentFilesDocument =
        serde_json::from_slice(&bytes).map_err(|_| read_failed())?;
    if document.version != RECENT_FILES_VERSION
        || document.files.len() > MAX_RECENT_FILES
        || document
            .files
            .iter()
            .any(|file| validate_recent_file(file).is_err())
    {
        return Err(read_failed());
    }
    Ok(document)
}

fn validate_recent_file(file: &RecentFile) -> Result<(), AppError> {
    if file.name.trim().is_empty()
        || file.path.trim().is_empty()
        || file.name.contains('\0')
        || file.path.contains('\0')
    {
        return Err(AppError::new(
            "recent_files.invalid_entry",
            "Recent file entry is invalid.",
            true,
        ));
    }
    Ok(())
}

fn recent_path_identity(path: &str) -> Result<RecentPathIdentity, AppError> {
    let lexical = DocumentPathIdentity::lexical(path).map_err(|_| invalid_entry())?;
    let resolved = match DocumentPathIdentity::resolve(path) {
        Ok(identity) => Some(identity.resolved().clone()),
        Err(PathIdentityError::Unavailable) => None,
        Err(PathIdentityError::InvalidPath) => return Err(invalid_entry()),
    };
    Ok(RecentPathIdentity { lexical, resolved })
}

fn recent_file_matches_identity(recent: &RecentFile, incoming: &RecentPathIdentity) -> bool {
    let Ok(existing_lexical) = DocumentPathIdentity::lexical(&recent.path) else {
        return false;
    };
    if existing_lexical == incoming.lexical {
        return true;
    }
    let Some(incoming_resolved) = &incoming.resolved else {
        return false;
    };
    match DocumentPathIdentity::resolve(&recent.path) {
        Ok(existing) => existing.resolved() == incoming_resolved,
        Err(_) => false,
    }
}

fn invalid_entry() -> AppError {
    AppError::new(
        "recent_files.invalid_entry",
        "Recent file entry is invalid.",
        true,
    )
}

fn snapshot(document: &RecentFilesDocument) -> RecentFilesSnapshot {
    RecentFilesSnapshot {
        files: document.files.clone(),
        revision: document.revision,
    }
}

fn read_failed() -> AppError {
    AppError::new(
        "recent_files.read_failed",
        "Recent files could not be read.",
        true,
    )
}

fn write_failed() -> AppError {
    AppError::new(
        "recent_files.write_failed",
        "Recent files could not be written.",
        true,
    )
}
