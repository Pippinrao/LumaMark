use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::AppError;
use crate::services::file_service::{content_fingerprint, write_bytes_atomically};

const MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_MAX_ENTRIES: usize = 100;
pub const DEFAULT_MAX_TOTAL_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrashLimits {
    pub max_entries: usize,
    pub max_total_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrashReason {
    CloseDiscard,
    NewDocumentDiscard,
    OpenReplace,
    ExternalReload,
    RecoveryDraftDiscard,
    Delete,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub byte_length: u64,
    pub created_at_ms: u64,
    pub fingerprint: String,
    pub id: String,
    pub reason: TrashReason,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashDocument {
    pub entry: TrashEntry,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashArchiveRequest {
    pub created_at_ms: u64,
    pub reason: TrashReason,
    pub source_path: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashArchiveOutcome {
    pub cleanup_pending: bool,
    pub entry: TrashEntry,
}

impl std::ops::Deref for TrashArchiveOutcome {
    type Target = TrashEntry;

    fn deref(&self) -> &Self::Target {
        &self.entry
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashRemoveOutcome {
    pub cleanup_pending: bool,
    pub entry: TrashEntry,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEmptyOutcome {
    pub cleanup_pending: bool,
    pub removed_count: usize,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashManifest {
    schema_version: u32,
    entries: Vec<TrashEntry>,
}

pub struct TrashService {
    limits: TrashLimits,
    root: PathBuf,
    transaction: Mutex<()>,
}

struct StagedContent {
    original: PathBuf,
    staged: PathBuf,
}

impl TrashService {
    pub fn open(root: PathBuf, limits: TrashLimits) -> Result<Self, AppError> {
        if limits.max_entries == 0 || limits.max_total_bytes == 0 {
            return Err(AppError::new(
                "trash.invalid_limits",
                "Trash capacity limits must be greater than zero.",
                false,
            ));
        }

        Ok(Self {
            limits,
            root,
            transaction: Mutex::new(()),
        })
    }

    pub fn archive(&self, request: TrashArchiveRequest) -> Result<TrashArchiveOutcome, AppError> {
        let _guard = self.lock()?;
        let byte_length = request.text.len() as u64;
        if byte_length > self.limits.max_total_bytes {
            return Err(AppError::new(
                "trash.item_too_large",
                "The document is larger than the trash capacity.",
                true,
            ));
        }

        let mut manifest = self.load_reconciled_manifest()?;
        let entry = TrashEntry {
            byte_length,
            created_at_ms: request.created_at_ms,
            fingerprint: content_fingerprint(request.text.as_bytes()),
            id: Uuid::new_v4().simple().to_string(),
            reason: request.reason,
            source_path: request.source_path,
        };
        let content_path = self.content_path(&entry.id);
        write_bytes_atomically(&content_path, request.text.as_bytes())
            .map_err(|_| trash_io_error())?;
        manifest.entries.push(entry.clone());
        let evicted = match self.enforce_limits(&mut manifest, &entry.id) {
            Ok(evicted) => evicted,
            Err(error) => {
                let _ = fs::remove_file(&content_path);
                return Err(error);
            }
        };
        if let Err(error) = self.validate_entry_contents(&evicted) {
            let _ = fs::remove_file(&content_path);
            return Err(error);
        }
        let staged = match self.stage_entries(&evicted) {
            Ok(staged) => staged,
            Err(error) => {
                let _ = fs::remove_file(&content_path);
                return Err(error);
            }
        };

        if let Err(error) = self.write_manifest(&manifest) {
            self.rollback_staged(&staged)?;
            let _ = fs::remove_file(content_path);
            return Err(error);
        }
        let cleanup_pending = self.cleanup_staged(&staged);

        Ok(TrashArchiveOutcome {
            cleanup_pending,
            entry,
        })
    }

    pub fn list(&self) -> Result<Vec<TrashEntry>, AppError> {
        let _guard = self.lock()?;
        let mut entries = self.load_reconciled_manifest()?.entries;
        entries.sort_by(|left, right| {
            right
                .created_at_ms
                .cmp(&left.created_at_ms)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(entries)
    }

    pub fn read(&self, id: &str) -> Result<TrashDocument, AppError> {
        let _guard = self.lock()?;
        let manifest = self.load_reconciled_manifest()?;
        let entry = manifest
            .entries
            .into_iter()
            .find(|entry| entry.id == id)
            .ok_or_else(trash_not_found)?;
        let bytes = fs::read(self.content_path(&entry.id)).map_err(trash_content_read_error)?;
        if bytes.len() as u64 != entry.byte_length
            || content_fingerprint(&bytes) != entry.fingerprint
        {
            return Err(AppError::new(
                "trash.content_corrupt",
                "Trash content does not match its manifest metadata.",
                true,
            ));
        }
        let text = String::from_utf8(bytes).map_err(|_| {
            AppError::new(
                "trash.content_corrupt",
                "Trash content is not valid UTF-8.",
                true,
            )
        })?;

        Ok(TrashDocument { entry, text })
    }

    pub fn restore(&self, id: &str) -> Result<TrashDocument, AppError> {
        self.read(id)
    }

    pub fn remove(&self, id: &str) -> Result<TrashRemoveOutcome, AppError> {
        let _guard = self.lock()?;
        let mut manifest = self.load_reconciled_manifest()?;
        let index = manifest
            .entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(trash_not_found)?;
        let entry = manifest.entries.remove(index);
        self.validate_entry_contents(std::slice::from_ref(&entry))?;
        let staged = self.stage_entries(std::slice::from_ref(&entry))?;

        if let Err(error) = self.write_manifest(&manifest) {
            self.rollback_staged(&staged)?;
            return Err(error);
        }
        let cleanup_pending = self.cleanup_staged(&staged);

        Ok(TrashRemoveOutcome {
            cleanup_pending,
            entry,
        })
    }

    pub fn empty(&self) -> Result<TrashEmptyOutcome, AppError> {
        let _guard = self.lock()?;
        let manifest = self.load_reconciled_manifest()?;
        let removed_count = manifest.entries.len();
        if removed_count == 0 {
            return Ok(TrashEmptyOutcome {
                cleanup_pending: false,
                removed_count: 0,
            });
        }

        self.validate_entry_contents(&manifest.entries)?;
        let staged = self.stage_entries(&manifest.entries)?;

        let empty_manifest = TrashManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            entries: Vec::new(),
        };
        if let Err(error) = self.write_manifest(&empty_manifest) {
            self.rollback_staged(&staged)?;
            return Err(error);
        }
        let cleanup_pending = self.cleanup_staged(&staged);

        Ok(TrashEmptyOutcome {
            cleanup_pending,
            removed_count,
        })
    }

    fn content_path(&self, id: &str) -> PathBuf {
        self.items_dir().join(format!("{id}.md"))
    }

    fn items_dir(&self) -> PathBuf {
        self.root.join("items")
    }

    fn load_reconciled_manifest(&self) -> Result<TrashManifest, AppError> {
        fs::create_dir_all(self.items_dir()).map_err(trash_storage_error)?;
        let manifest = self.load_manifest()?;
        self.reconcile_content(&manifest)?;
        self.ensure_manifest_content_exists(&manifest)?;
        Ok(manifest)
    }

    fn reconcile_content(&self, manifest: &TrashManifest) -> Result<(), AppError> {
        let referenced = manifest
            .entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<HashSet<_>>();
        for item in fs::read_dir(self.items_dir()).map_err(trash_storage_error)? {
            let item = item.map_err(trash_storage_error)?;
            let file_name = item.file_name();
            let Some(file_name) = file_name.to_str() else {
                continue;
            };
            if let Some(id) = staged_entry_id(file_name) {
                let staged = item.path();
                let original = self.content_path(id);
                if referenced.contains(id) && !original.exists() {
                    fs::rename(staged, original).map_err(trash_storage_error)?;
                } else {
                    fs::remove_file(staged).map_err(trash_storage_error)?;
                }
                continue;
            }
            let Some(id) = file_name.strip_suffix(".md") else {
                continue;
            };
            if is_safe_entry_id(id) && !referenced.contains(id) {
                fs::remove_file(item.path()).map_err(trash_storage_error)?;
            }
        }
        Ok(())
    }

    fn ensure_manifest_content_exists(&self, manifest: &TrashManifest) -> Result<(), AppError> {
        for entry in &manifest.entries {
            let metadata =
                fs::metadata(self.content_path(&entry.id)).map_err(trash_content_read_error)?;
            if !metadata.is_file() {
                return Err(AppError::new(
                    "trash.content_missing",
                    "Trash content referenced by the manifest is missing.",
                    true,
                ));
            }
        }
        Ok(())
    }

    fn stage_entries(&self, entries: &[TrashEntry]) -> Result<Vec<StagedContent>, AppError> {
        let mut staged_contents = Vec::with_capacity(entries.len());
        for entry in entries {
            let original = self.content_path(&entry.id);
            let staged = self.items_dir().join(format!(
                ".lm-delete-{}-{}",
                entry.id,
                Uuid::new_v4().simple()
            ));
            if let Err(error) = fs::rename(&original, &staged) {
                self.rollback_staged(&staged_contents)?;
                return Err(trash_storage_error(error));
            }
            staged_contents.push(StagedContent { original, staged });
        }
        Ok(staged_contents)
    }

    fn validate_entry_contents(&self, entries: &[TrashEntry]) -> Result<(), AppError> {
        for entry in entries {
            let bytes = fs::read(self.content_path(&entry.id)).map_err(trash_content_read_error)?;
            if bytes.len() as u64 != entry.byte_length
                || content_fingerprint(&bytes) != entry.fingerprint
            {
                return Err(AppError::new(
                    "trash.content_corrupt",
                    "Trash content does not match its manifest metadata.",
                    true,
                ));
            }
        }
        Ok(())
    }

    fn rollback_staged(&self, staged_contents: &[StagedContent]) -> Result<(), AppError> {
        for content in staged_contents.iter().rev() {
            fs::rename(&content.staged, &content.original).map_err(|_| {
                AppError::new(
                    "trash.transaction_recovery_failed",
                    "Trash storage transaction recovery failed.",
                    true,
                )
            })?;
        }
        Ok(())
    }

    fn cleanup_staged(&self, staged_contents: &[StagedContent]) -> bool {
        let mut cleanup_pending = false;
        for content in staged_contents {
            if fs::remove_file(&content.staged).is_err() {
                cleanup_pending = true;
            }
        }
        cleanup_pending
    }

    fn enforce_limits(
        &self,
        manifest: &mut TrashManifest,
        protected_id: &str,
    ) -> Result<Vec<TrashEntry>, AppError> {
        manifest.entries.sort_by(|left, right| {
            left.created_at_ms
                .cmp(&right.created_at_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        let mut total_bytes = manifest.entries.iter().try_fold(0_u64, |total, entry| {
            total
                .checked_add(entry.byte_length)
                .ok_or_else(trash_manifest_corrupt)
        })?;
        let mut evicted = Vec::new();
        while manifest.entries.len() > self.limits.max_entries
            || total_bytes > self.limits.max_total_bytes
        {
            let index = manifest
                .entries
                .iter()
                .position(|entry| entry.id != protected_id)
                .ok_or_else(|| {
                    AppError::new(
                        "trash.item_too_large",
                        "The document is larger than the trash capacity.",
                        true,
                    )
                })?;
            let entry = manifest.entries.remove(index);
            total_bytes = total_bytes.saturating_sub(entry.byte_length);
            evicted.push(entry);
        }
        Ok(evicted)
    }

    fn load_manifest(&self) -> Result<TrashManifest, AppError> {
        let path = self.root.join("manifest.json");
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(TrashManifest {
                    schema_version: MANIFEST_SCHEMA_VERSION,
                    entries: Vec::new(),
                });
            }
            Err(_) => return Err(trash_io_error()),
        };
        let manifest: TrashManifest = serde_json::from_slice(&bytes).map_err(|_| {
            AppError::new(
                "trash.manifest_corrupt",
                "The trash manifest is corrupt.",
                true,
            )
        })?;
        if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
            return Err(AppError::new(
                "trash.manifest_unsupported",
                "The trash manifest version is not supported.",
                true,
            ));
        }
        if manifest
            .entries
            .iter()
            .any(|entry| !is_safe_entry_id(&entry.id))
        {
            return Err(AppError::new(
                "trash.unsafe_entry_id",
                "The trash manifest contains an unsafe entry identifier.",
                true,
            ));
        }
        let mut ids = HashSet::with_capacity(manifest.entries.len());
        let mut total_bytes = 0_u64;
        for entry in &manifest.entries {
            if !ids.insert(entry.id.as_str())
                || entry.fingerprint.len() != 64
                || !entry
                    .fingerprint
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(trash_manifest_corrupt());
            }
            total_bytes = total_bytes
                .checked_add(entry.byte_length)
                .ok_or_else(trash_manifest_corrupt)?;
        }
        Ok(manifest)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, ()>, AppError> {
        self.transaction.lock().map_err(|_| {
            AppError::new(
                "trash.unavailable",
                "The trash service is unavailable.",
                true,
            )
        })
    }

    fn write_manifest(&self, manifest: &TrashManifest) -> Result<(), AppError> {
        let bytes = serde_json::to_vec(manifest).map_err(|_| trash_io_error())?;
        write_bytes_atomically(&self.root.join("manifest.json"), &bytes)
            .map_err(|_| trash_io_error())
    }
}

fn trash_io_error() -> AppError {
    AppError::new("trash.io_error", "Trash storage operation failed.", true)
}

fn trash_storage_error(error: std::io::Error) -> AppError {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        return AppError::new(
            "trash.permission_denied",
            "Trash storage access was denied.",
            true,
        );
    }
    trash_io_error()
}

fn trash_content_read_error(error: std::io::Error) -> AppError {
    match error.kind() {
        std::io::ErrorKind::NotFound => AppError::new(
            "trash.content_missing",
            "Trash content referenced by the manifest is missing.",
            true,
        ),
        std::io::ErrorKind::PermissionDenied => AppError::new(
            "trash.permission_denied",
            "Trash storage access was denied.",
            true,
        ),
        _ => trash_io_error(),
    }
}

fn trash_not_found() -> AppError {
    AppError::new("trash.not_found", "Trash entry was not found.", true)
}

fn trash_manifest_corrupt() -> AppError {
    AppError::new(
        "trash.manifest_corrupt",
        "The trash manifest is corrupt.",
        true,
    )
}

fn is_safe_entry_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn staged_entry_id(file_name: &str) -> Option<&str> {
    let remainder = file_name.strip_prefix(".lm-delete-")?;
    let (id, transaction) = remainder.split_once('-')?;
    if is_safe_entry_id(id) && !transaction.is_empty() {
        Some(id)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{StagedContent, TrashArchiveRequest, TrashLimits, TrashReason, TrashService};
    use crate::services::file_service::content_fingerprint;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-trash-{name}-{nanos}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    #[test]
    fn archive_and_read_preserve_exact_utf8_bytes_and_metadata() {
        let directory = unique_test_dir("exact-bytes");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 100 * 1024 * 1024,
            },
        )
        .expect("trash service should open");
        let text = "\u{feff}# 标题\r\n\r\nline 2\n";

        let entry = service
            .archive(TrashArchiveRequest {
                created_at_ms: 1_786_550_000_000,
                reason: TrashReason::CloseDiscard,
                source_path: Some("E:/notes/精确.md".to_string()),
                text: text.to_string(),
            })
            .expect("snapshot should be archived");
        let restored = service
            .read(&entry.id)
            .expect("snapshot should be readable");

        assert_eq!(restored.text.as_bytes(), text.as_bytes());
        assert_eq!(restored.entry.byte_length, text.len() as u64);
        assert_eq!(restored.entry.created_at_ms, 1_786_550_000_000);
        assert_eq!(restored.entry.reason, TrashReason::CloseDiscard);
        assert_eq!(
            restored.entry.source_path.as_deref(),
            Some("E:/notes/精确.md")
        );
        assert_eq!(
            service.list().expect("manifest should be readable"),
            vec![entry.entry]
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn archive_evicts_the_oldest_entry_when_the_count_limit_is_exceeded() {
        let directory = unique_test_dir("count-eviction");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 2,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");

        let oldest = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "oldest".to_string(),
            })
            .expect("oldest snapshot should be archived");
        let middle = service
            .archive(TrashArchiveRequest {
                created_at_ms: 20,
                reason: TrashReason::NewDocumentDiscard,
                source_path: None,
                text: "middle".to_string(),
            })
            .expect("middle snapshot should be archived");
        let newest = service
            .archive(TrashArchiveRequest {
                created_at_ms: 30,
                reason: TrashReason::OpenReplace,
                source_path: None,
                text: "newest".to_string(),
            })
            .expect("newest snapshot should be archived");

        assert!(!newest.cleanup_pending);
        assert_eq!(
            service.list().expect("manifest should be readable"),
            vec![newest.entry, middle.entry]
        );
        let evicted = service
            .read(&oldest.id)
            .expect_err("oldest entry should be evicted");
        assert_eq!(evicted.code, "trash.not_found");
        assert!(!directory
            .join("items")
            .join(format!("{}.md", oldest.id))
            .exists());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn archive_evicts_oldest_entries_until_the_total_byte_limit_is_met() {
        let directory = unique_test_dir("byte-eviction");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 10,
            },
        )
        .expect("trash service should open");

        let oldest = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "123456".to_string(),
            })
            .expect("oldest snapshot should be archived");
        let newest = service
            .archive(TrashArchiveRequest {
                created_at_ms: 20,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "abcdef".to_string(),
            })
            .expect("newest snapshot should be archived");

        assert_eq!(
            service.list().expect("manifest should be readable"),
            vec![newest.entry]
        );
        assert_eq!(
            service
                .read(&oldest.id)
                .expect_err("oldest entry should be evicted")
                .code,
            "trash.not_found"
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn archive_rejects_an_item_larger_than_the_total_capacity() {
        let directory = unique_test_dir("oversized");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 5,
            },
        )
        .expect("trash service should open");

        let error = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "123456".to_string(),
            })
            .expect_err("oversized item should be rejected");

        assert_eq!(error.code, "trash.item_too_large");
        assert!(service
            .list()
            .expect("manifest should be readable")
            .is_empty());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn remove_deletes_both_the_manifest_entry_and_content_file() {
        let directory = unique_test_dir("remove");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        let entry = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::Delete,
                source_path: Some("E:/notes/delete.md".to_string()),
                text: "deleted text".to_string(),
            })
            .expect("snapshot should be archived");

        let removed = service.remove(&entry.id).expect("entry should be removed");

        assert_eq!(removed.entry, entry.entry);
        assert!(!removed.cleanup_pending);
        assert!(service
            .list()
            .expect("manifest should be readable")
            .is_empty());
        assert!(!directory
            .join("items")
            .join(format!("{}.md", entry.id))
            .exists());
        assert_eq!(
            service
                .remove(&entry.id)
                .expect_err("removed entry should not exist")
                .code,
            "trash.not_found"
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn empty_removes_every_entry_and_returns_the_removed_count() {
        let directory = unique_test_dir("empty");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        for created_at_ms in [10, 20] {
            service
                .archive(TrashArchiveRequest {
                    created_at_ms,
                    reason: TrashReason::Delete,
                    source_path: None,
                    text: format!("snapshot-{created_at_ms}"),
                })
                .expect("snapshot should be archived");
        }

        let emptied = service.empty().expect("trash should be emptied");
        assert_eq!(emptied.removed_count, 2);
        assert!(!emptied.cleanup_pending);
        assert!(service
            .list()
            .expect("manifest should be readable")
            .is_empty());
        assert_eq!(
            fs::read_dir(directory.join("items"))
                .expect("items directory should exist")
                .count(),
            0
        );
        assert_eq!(
            service
                .empty()
                .expect("empty trash should stay empty")
                .removed_count,
            0
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn corrupt_manifest_returns_a_stable_error_without_overwriting_it() {
        let directory = unique_test_dir("corrupt-manifest");
        let corrupt_bytes = b"{not-json";
        fs::write(directory.join("manifest.json"), corrupt_bytes)
            .expect("corrupt manifest fixture should be written");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");

        let error = service
            .list()
            .expect_err("corrupt manifest should be rejected");

        assert_eq!(error.code, "trash.manifest_corrupt");
        assert_eq!(
            fs::read(directory.join("manifest.json"))
                .expect("corrupt manifest should remain available for diagnosis"),
            corrupt_bytes
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn manifest_entry_ids_cannot_escape_the_items_directory() {
        let directory = unique_test_dir("path-traversal");
        fs::write(
            directory.join("manifest.json"),
            r#"{"schemaVersion":1,"entries":[{"byteLength":1,"createdAtMs":1,"fingerprint":"x","id":"../../outside","reason":"delete","sourcePath":null}]}"#,
        )
        .expect("malicious manifest fixture should be written");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");

        let error = service
            .read("../../outside")
            .expect_err("path traversal entry should be rejected");

        assert_eq!(error.code, "trash.unsafe_entry_id");

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn read_rejects_content_that_no_longer_matches_manifest_metadata() {
        let directory = unique_test_dir("content-corruption");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        let entry = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "original".to_string(),
            })
            .expect("snapshot should be archived");
        fs::write(
            directory.join("items").join(format!("{}.md", entry.id)),
            "tampered",
        )
        .expect("content fixture should be corrupted");

        let error = service
            .read(&entry.id)
            .expect_err("mismatched content should be rejected");

        assert_eq!(error.code, "trash.content_corrupt");

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn restore_returns_a_new_unsaved_snapshot_without_touching_the_source_path() {
        let directory = unique_test_dir("restore");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        let entry = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::ExternalReload,
                source_path: Some("E:/notes/original.md".to_string()),
                text: "# restore me".to_string(),
            })
            .expect("snapshot should be archived");

        let restored = service
            .restore(&entry.id)
            .expect("snapshot should be prepared for restoration");

        assert_eq!(restored.text, "# restore me");
        assert_eq!(
            restored.entry.source_path.as_deref(),
            Some("E:/notes/original.md")
        );
        assert_eq!(
            service
                .list()
                .expect("entry should remain until the caller loads it"),
            vec![entry.entry]
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn concurrent_archives_share_one_valid_manifest_without_losing_entries() {
        let directory = unique_test_dir("concurrent");
        let service = Arc::new(
            TrashService::open(
                directory.clone(),
                TrashLimits {
                    max_entries: 100,
                    max_total_bytes: 1024 * 1024,
                },
            )
            .expect("trash service should open"),
        );
        let barrier = Arc::new(Barrier::new(16));
        let threads = (0..16)
            .map(|index| {
                let service = Arc::clone(&service);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    service.archive(TrashArchiveRequest {
                        created_at_ms: index,
                        reason: TrashReason::CloseDiscard,
                        source_path: Some(format!("E:/notes/{index}.md")),
                        text: format!("snapshot-{index}"),
                    })
                })
            })
            .collect::<Vec<_>>();

        for archive_thread in threads {
            archive_thread
                .join()
                .expect("archive thread should not panic")
                .expect("concurrent snapshot should be archived");
        }
        let entries = service.list().expect("manifest should remain readable");
        let ids = entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<HashSet<_>>();

        assert_eq!(entries.len(), 16);
        assert_eq!(ids.len(), 16);

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn archive_does_not_commit_a_new_entry_when_existing_content_is_missing() {
        let directory = unique_test_dir("missing-existing-content");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 1,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        let existing = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "existing".to_string(),
            })
            .expect("existing snapshot should be archived");
        fs::remove_file(directory.join("items").join(format!("{}.md", existing.id)))
            .expect("existing content should be removed to simulate corruption");

        let error = service
            .archive(TrashArchiveRequest {
                created_at_ms: 20,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "new".to_string(),
            })
            .expect_err("corrupt trash should reject the new archive transaction");

        assert_eq!(error.code, "trash.content_missing");
        let manifest = fs::read_to_string(directory.join("manifest.json"))
            .expect("manifest should remain readable for diagnosis");
        assert!(manifest.contains(&existing.id));
        assert!(!manifest.contains("\"createdAtMs\":20"));

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn archive_rejects_manifest_byte_totals_that_overflow_without_poisoning_the_service() {
        let directory = unique_test_dir("manifest-overflow");
        let items = directory.join("items");
        fs::create_dir_all(&items).expect("items directory should be created");
        let first_id = "11111111111111111111111111111111";
        let second_id = "22222222222222222222222222222222";
        fs::write(items.join(format!("{first_id}.md")), "a")
            .expect("first content fixture should be written");
        fs::write(items.join(format!("{second_id}.md")), "b")
            .expect("second content fixture should be written");
        fs::write(
            directory.join("manifest.json"),
            format!(
                r#"{{"schemaVersion":1,"entries":[{{"byteLength":{},"createdAtMs":1,"fingerprint":"{}","id":"{first_id}","reason":"delete","sourcePath":null}},{{"byteLength":2,"createdAtMs":2,"fingerprint":"{}","id":"{second_id}","reason":"delete","sourcePath":null}}]}}"#,
                u64::MAX,
                "0".repeat(64),
                "1".repeat(64),
            ),
        )
        .expect("overflow manifest fixture should be written");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");

        let error = service
            .archive(TrashArchiveRequest {
                created_at_ms: 3,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "new".to_string(),
            })
            .expect_err("overflowing manifest should be rejected");

        assert_eq!(error.code, "trash.manifest_corrupt");
        assert_ne!(
            service
                .list()
                .expect_err("corrupt manifest should remain rejected")
                .code,
            "trash.unavailable"
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn archive_removes_new_content_when_adding_it_overflows_manifest_totals() {
        let directory = unique_test_dir("manifest-overflow-after-write");
        let items = directory.join("items");
        fs::create_dir_all(&items).expect("items directory should be created");
        let existing_id = "11111111111111111111111111111111";
        fs::write(items.join(format!("{existing_id}.md")), "a")
            .expect("existing content fixture should be written");
        fs::write(
            directory.join("manifest.json"),
            format!(
                r#"{{"schemaVersion":1,"entries":[{{"byteLength":{},"createdAtMs":1,"fingerprint":"{}","id":"{existing_id}","reason":"delete","sourcePath":null}}]}}"#,
                u64::MAX,
                content_fingerprint(b"a"),
            ),
        )
        .expect("near-overflow manifest fixture should be written");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: u64::MAX,
            },
        )
        .expect("trash service should open");

        let error = service
            .archive(TrashArchiveRequest {
                created_at_ms: 2,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "new".to_string(),
            })
            .expect_err("overflow discovered after writing should reject the archive");

        assert_eq!(error.code, "trash.manifest_corrupt");
        let content_files = fs::read_dir(&items)
            .expect("items directory should remain readable")
            .map(|item| {
                item.expect("content entry should be readable")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(content_files, vec![format!("{existing_id}.md")]);

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn archive_removes_new_content_when_eviction_preflight_finds_corruption() {
        let directory = unique_test_dir("corrupt-eviction-after-write");
        let items = directory.join("items");
        fs::create_dir_all(&items).expect("items directory should be created");
        let existing_id = "11111111111111111111111111111111";
        fs::write(items.join(format!("{existing_id}.md")), "existing")
            .expect("existing content fixture should be written");
        fs::write(
            directory.join("manifest.json"),
            format!(
                r#"{{"schemaVersion":1,"entries":[{{"byteLength":8,"createdAtMs":1,"fingerprint":"{}","id":"{existing_id}","reason":"delete","sourcePath":null}}]}}"#,
                "0".repeat(64),
            ),
        )
        .expect("corrupt manifest fixture should be written");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 1,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");

        let error = service
            .archive(TrashArchiveRequest {
                created_at_ms: 2,
                reason: TrashReason::CloseDiscard,
                source_path: None,
                text: "new".to_string(),
            })
            .expect_err("corrupt eviction candidate should reject the archive");

        assert_eq!(error.code, "trash.content_corrupt");
        let content_files = fs::read_dir(&items)
            .expect("items directory should remain readable")
            .map(|item| {
                item.expect("content entry should be readable")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(content_files, vec![format!("{existing_id}.md")]);

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn empty_does_not_delete_any_content_when_a_later_entry_is_missing() {
        let directory = unique_test_dir("empty-preflight");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        let first = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::Delete,
                source_path: None,
                text: "first".to_string(),
            })
            .expect("first snapshot should be archived");
        let second = service
            .archive(TrashArchiveRequest {
                created_at_ms: 20,
                reason: TrashReason::Delete,
                source_path: None,
                text: "second".to_string(),
            })
            .expect("second snapshot should be archived");
        fs::remove_file(directory.join("items").join(format!("{}.md", second.id)))
            .expect("second content should be removed to simulate corruption");

        let error = service
            .empty()
            .expect_err("corrupt trash should not be emptied");

        assert_eq!(error.code, "trash.content_missing");
        assert!(directory
            .join("items")
            .join(format!("{}.md", first.id))
            .is_file());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn list_recovers_content_staged_before_a_manifest_commit() {
        let directory = unique_test_dir("recover-staged-delete");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        let entry = service
            .archive(TrashArchiveRequest {
                created_at_ms: 10,
                reason: TrashReason::Delete,
                source_path: None,
                text: "recover me".to_string(),
            })
            .expect("snapshot should be archived");
        let original = directory.join("items").join(format!("{}.md", entry.id));
        let staged = directory
            .join("items")
            .join(format!(".lm-delete-{}-transaction", entry.id));
        fs::rename(&original, &staged).expect("content should be staged to simulate a crash");

        assert_eq!(
            service.list().expect("staged content should be recovered"),
            vec![entry.entry]
        );
        assert!(original.is_file());
        assert!(!staged.exists());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn list_cleans_staged_and_unreferenced_content_after_a_manifest_commit() {
        let directory = unique_test_dir("cleanup-committed-delete");
        let items = directory.join("items");
        fs::create_dir_all(&items).expect("items directory should be created");
        let removed_id = "33333333333333333333333333333333";
        let orphan_id = "44444444444444444444444444444444";
        let staged = items.join(format!(".lm-delete-{removed_id}-transaction"));
        let orphan = items.join(format!("{orphan_id}.md"));
        fs::write(&staged, "staged").expect("staged fixture should be written");
        fs::write(&orphan, "orphan").expect("orphan fixture should be written");
        fs::write(
            directory.join("manifest.json"),
            r#"{"schemaVersion":1,"entries":[]}"#,
        )
        .expect("empty committed manifest should be written");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");

        assert!(service.list().expect("cleanup should succeed").is_empty());
        assert!(!staged.exists());
        assert!(!orphan.exists());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn committed_cleanup_failure_is_reported_as_pending_instead_of_archive_failure() {
        let directory = unique_test_dir("cleanup-pending");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");
        let staged_directory = directory.join("items").join("staged-directory");
        fs::create_dir_all(&staged_directory).expect("staged directory fixture should be created");

        let cleanup_pending = service.cleanup_staged(&[StagedContent {
            original: directory.join("items").join("original.md"),
            staged: staged_directory.clone(),
        }]);

        assert!(cleanup_pending);
        assert!(staged_directory.is_dir());

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }
}
