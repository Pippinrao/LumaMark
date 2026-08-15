use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::State;

use crate::errors::AppError;
use crate::services::trash_service::{
    TrashArchiveOutcome, TrashArchiveRequest, TrashDocument, TrashEmptyOutcome, TrashEntry,
    TrashReason, TrashRemoveOutcome, TrashService,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashArchiveCommandRequest {
    pub reason: TrashReason,
    pub source_path: Option<String>,
    pub text: String,
}

#[tauri::command]
pub fn trash_archive(
    request: TrashArchiveCommandRequest,
    service: State<'_, TrashService>,
) -> Result<TrashArchiveOutcome, AppError> {
    archive_at(&service, request, current_time_ms()?)
}

#[tauri::command]
pub fn trash_list(service: State<'_, TrashService>) -> Result<Vec<TrashEntry>, AppError> {
    service.list()
}

#[tauri::command]
pub fn trash_read(id: String, service: State<'_, TrashService>) -> Result<TrashDocument, AppError> {
    service.read(&id)
}

#[tauri::command]
pub fn trash_restore(
    id: String,
    service: State<'_, TrashService>,
) -> Result<TrashDocument, AppError> {
    service.restore(&id)
}

#[tauri::command]
pub fn trash_remove(
    id: String,
    service: State<'_, TrashService>,
) -> Result<TrashRemoveOutcome, AppError> {
    service.remove(&id)
}

#[tauri::command]
pub fn trash_empty(service: State<'_, TrashService>) -> Result<TrashEmptyOutcome, AppError> {
    service.empty()
}

fn archive_at(
    service: &TrashService,
    request: TrashArchiveCommandRequest,
    created_at_ms: u64,
) -> Result<TrashArchiveOutcome, AppError> {
    service.archive(TrashArchiveRequest {
        created_at_ms,
        reason: request.reason,
        source_path: request.source_path,
        text: request.text,
    })
}

fn current_time_ms() -> Result<u64, AppError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| {
            AppError::new(
                "trash.clock_unavailable",
                "The system clock is unavailable.",
                true,
            )
        })?
        .as_millis();
    u64::try_from(millis).map_err(|_| {
        AppError::new(
            "trash.clock_unavailable",
            "The system clock is unavailable.",
            true,
        )
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{archive_at, TrashArchiveCommandRequest};
    use crate::services::trash_service::{TrashLimits, TrashReason, TrashService};

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-trash-command-{name}-{nanos}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    #[test]
    fn archive_command_maps_frontend_request_to_the_shared_service() {
        let directory = unique_test_dir("archive");
        let service = TrashService::open(
            directory.clone(),
            TrashLimits {
                max_entries: 100,
                max_total_bytes: 1024,
            },
        )
        .expect("trash service should open");

        let entry = archive_at(
            &service,
            TrashArchiveCommandRequest {
                reason: TrashReason::CloseDiscard,
                source_path: Some("E:/notes/note.md".to_string()),
                text: "# exact\r\n".to_string(),
            },
            1_786_550_000_000,
        )
        .expect("request should be archived");

        assert_eq!(entry.created_at_ms, 1_786_550_000_000);
        assert!(!entry.cleanup_pending);
        assert_eq!(
            service.read(&entry.id).expect("entry should exist").text,
            "# exact\r\n"
        );

        fs::remove_dir_all(directory).expect("test directory should be removed");
    }
}
