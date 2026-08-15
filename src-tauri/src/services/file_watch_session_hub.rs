use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::file_watch_service::{
    FileWatchError, FileWatchEvent, FileWatchService, WatchDocumentResult,
};

type SessionEventSink = dyn Fn(&str, FileWatchEvent) + Send + Sync;

/// Owns one independent file watcher for each native window label.
pub struct FileWatchSessionHub {
    sessions: Mutex<HashMap<String, Arc<FileWatchService>>>,
    sink: Arc<SessionEventSink>,
}

impl FileWatchSessionHub {
    /// Creates a hub whose sink receives the owning window label with every event.
    pub fn new<F>(sink: F) -> Self
    where
        F: Fn(&str, FileWatchEvent) + Send + Sync + 'static,
    {
        Self {
            sessions: Mutex::new(HashMap::new()),
            sink: Arc::new(sink),
        }
    }

    /// Replaces the document watched by one window session.
    pub fn watch_document(
        &self,
        window_label: &str,
        path: &Path,
    ) -> Result<WatchDocumentResult, FileWatchError> {
        self.session(window_label)?.watch_document(path)
    }

    /// Replaces the local-image targets watched by one window session.
    pub fn replace_local_image_targets(
        &self,
        window_label: &str,
        paths: &[PathBuf],
    ) -> Result<(), FileWatchError> {
        self.session(window_label)?
            .replace_local_image_targets(paths)
    }

    /// Stops watching the current document without affecting other windows.
    pub fn unwatch_document(&self, window_label: &str) -> Result<(), FileWatchError> {
        let Some(session) = self.existing_session(window_label)? else {
            return Ok(());
        };
        session.unwatch_document()
    }

    /// Records a successful save only in the caller's existing watcher session.
    pub fn record_document_saved(
        &self,
        window_label: &str,
        path: &Path,
        bytes: &[u8],
    ) -> Result<(), FileWatchError> {
        let Some(session) = self.existing_session(window_label)? else {
            return Ok(());
        };
        session.record_document_saved(path, bytes)
    }

    /// Drops all file-watch state owned by one destroyed window.
    pub fn remove_session(&self, window_label: &str) -> Result<(), FileWatchError> {
        let removed = self
            .sessions
            .lock()
            .map_err(|_| FileWatchError::StatePoisoned)?
            .remove(window_label);
        drop(removed);
        Ok(())
    }

    fn session(&self, window_label: &str) -> Result<Arc<FileWatchService>, FileWatchError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| FileWatchError::StatePoisoned)?;
        if let Some(session) = sessions.get(window_label) {
            return Ok(Arc::clone(session));
        }

        let sink = Arc::clone(&self.sink);
        let owned_window_label = window_label.to_owned();
        let session = Arc::new(FileWatchService::new(move |event| {
            sink(&owned_window_label, event);
        }));
        sessions.insert(window_label.to_owned(), Arc::clone(&session));
        Ok(session)
    }

    fn existing_session(
        &self,
        window_label: &str,
    ) -> Result<Option<Arc<FileWatchService>>, FileWatchError> {
        self.sessions
            .lock()
            .map_err(|_| FileWatchError::StatePoisoned)
            .map(|sessions| sessions.get(window_label).map(Arc::clone))
    }
}
