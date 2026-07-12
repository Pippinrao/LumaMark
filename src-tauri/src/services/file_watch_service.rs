use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fmt;
use std::fs;
use std::io;
use std::mem;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use notify_debouncer_full::notify::{
    self, ErrorKind as NotifyErrorKind, RecommendedWatcher, RecursiveMode,
};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;

use crate::services::file_service::{content_fingerprint, normalize_path};

pub const FILE_WATCH_CHANGED_EVENT: &str = "file-watch://changed";
const FILE_WATCH_DEBOUNCE: Duration = Duration::from_millis(200);
const INVALIDATION_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(30), Duration::from_millis(60)];

type WatchDebouncer = Debouncer<RecommendedWatcher, RecommendedCache>;
type EventSink = dyn Fn(FileWatchEvent) + Send + Sync;
type FingerprintReader = dyn Fn(&Path) -> io::Result<Option<String>> + Send + Sync;

trait WatcherOps: Send {
    fn watch_non_recursive(&mut self, path: &Path) -> notify::Result<()>;
    fn unwatch(&mut self, path: &Path) -> notify::Result<()>;
}

impl WatcherOps for WatchDebouncer {
    fn watch_non_recursive(&mut self, path: &Path) -> notify::Result<()> {
        self.watch(path, RecursiveMode::NonRecursive)
    }

    fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
        self.unwatch(path)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileWatchEventKind {
    Document,
    Error,
    Image,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWatchEvent {
    pub kind: FileWatchEventKind,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchDocumentResult {
    pub fingerprint: Option<String>,
}

#[derive(Debug)]
pub enum FileWatchError {
    Io(io::Error),
    Notify(notify_debouncer_full::notify::Error),
    StatePoisoned,
    Unavailable(String),
}

impl fmt::Display for FileWatchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "file watch I/O failed: {error}"),
            Self::Notify(error) => write!(formatter, "file watcher failed: {error}"),
            Self::StatePoisoned => formatter.write_str("file watcher state is unavailable"),
            Self::Unavailable(message) => {
                write!(formatter, "file watcher is unavailable: {message}")
            }
        }
    }
}

impl Error for FileWatchError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Notify(error) => Some(error),
            Self::StatePoisoned | Self::Unavailable(_) => None,
        }
    }
}

impl From<io::Error> for FileWatchError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<notify_debouncer_full::notify::Error> for FileWatchError {
    fn from(error: notify_debouncer_full::notify::Error) -> Self {
        Self::Notify(error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PathKey(String);

impl PathKey {
    fn new(path: &Path) -> io::Result<Self> {
        let normalized = normalize_path(path)?;
        let value = normalized.to_string_lossy().into_owned();

        #[cfg(windows)]
        let value = value.to_lowercase();

        Ok(Self(value))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TargetKind {
    Document,
    Image,
}

impl TargetKind {
    fn event_kind(self) -> FileWatchEventKind {
        match self {
            Self::Document => FileWatchEventKind::Document,
            Self::Image => FileWatchEventKind::Image,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Target {
    key: PathKey,
    kind: TargetKind,
    parent_key: PathKey,
    path: PathBuf,
    fingerprint: Option<String>,
}

impl Target {
    fn from_path(path: &Path, kind: TargetKind) -> io::Result<Self> {
        let path = normalize_path(path)?;
        let parent = path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "watched path has no parent")
        })?;

        Ok(Self {
            key: PathKey::new(&path)?,
            kind,
            parent_key: PathKey::new(parent)?,
            fingerprint: file_fingerprint(&path)?,
            path,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WatchedParent {
    path: PathBuf,
    ref_count: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TargetRegistry {
    document: Option<Target>,
    images: HashMap<PathKey, Target>,
    parents: HashMap<PathKey, WatchedParent>,
    revision: u64,
}

impl TargetRegistry {
    pub(crate) fn replace_document(&mut self, path: &Path) -> io::Result<()> {
        self.document = Some(Target::from_path(path, TargetKind::Document)?);
        self.rebuild_parent_ref_counts()
    }

    pub(crate) fn remove_document(&mut self) -> io::Result<()> {
        self.document = None;
        self.rebuild_parent_ref_counts()
    }

    pub(crate) fn replace_images<'a>(
        &mut self,
        paths: impl IntoIterator<Item = &'a Path>,
    ) -> io::Result<()> {
        let mut images = HashMap::new();
        for path in paths {
            let target = Target::from_path(path, TargetKind::Image)?;
            images.insert(target.key.clone(), target);
        }
        self.images = images;
        self.rebuild_parent_ref_counts()
    }

    #[cfg(test)]
    fn parent_ref_count(&self, path: &Path) -> usize {
        PathKey::new(path)
            .ok()
            .and_then(|key| self.parents.get(&key).map(|parent| parent.ref_count))
            .unwrap_or_default()
    }

    pub(crate) fn record_document_saved(&mut self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        let key = PathKey::new(path)?;
        let Some(document) = self
            .document
            .as_mut()
            .filter(|document| document.key == key)
        else {
            return Ok(());
        };
        document.fingerprint = Some(content_fingerprint(bytes));
        Ok(())
    }

    pub(crate) fn invalidate_paths<'a>(
        &mut self,
        paths: impl IntoIterator<Item = &'a Path>,
    ) -> io::Result<Vec<FileWatchEvent>> {
        self.invalidate_paths_with(paths, &file_fingerprint)
    }

    fn invalidate_paths_with<'a>(
        &mut self,
        paths: impl IntoIterator<Item = &'a Path>,
        reader: &FingerprintReader,
    ) -> io::Result<Vec<FileWatchEvent>> {
        let mut next = self.clone();
        let events = next.invalidate_paths_in_place(paths, reader)?;
        *self = next;
        Ok(events)
    }

    fn invalidate_paths_in_place<'a>(
        &mut self,
        paths: impl IntoIterator<Item = &'a Path>,
        reader: &FingerprintReader,
    ) -> io::Result<Vec<FileWatchEvent>> {
        let keys = paths
            .into_iter()
            .map(PathKey::new)
            .collect::<io::Result<HashSet<_>>>()?;
        let keys = self.expand_parent_event_keys(keys);
        let mut changed_targets = Vec::new();

        if let Some(document) = self.document.as_mut() {
            if keys.contains(&document.key) {
                if let Some(event) = update_target(document, reader)? {
                    changed_targets.push(event);
                }
            }
        }

        for (key, image) in &mut self.images {
            if keys.contains(key) {
                if let Some(event) = update_target(image, reader)? {
                    changed_targets.push(event);
                }
            }
        }

        Ok(changed_targets
            .into_iter()
            .map(|(kind, path, fingerprint)| {
                self.revision = self.revision.saturating_add(1);
                FileWatchEvent {
                    kind,
                    path,
                    fingerprint,
                    revision: self.revision,
                }
            })
            .collect())
    }

    fn error_event(&mut self, path: &Path) -> FileWatchEvent {
        self.revision = self.revision.saturating_add(1);
        FileWatchEvent {
            kind: FileWatchEventKind::Error,
            path: path.to_string_lossy().into_owned(),
            fingerprint: None,
            revision: self.revision,
        }
    }

    fn rebuild_parent_ref_counts(&mut self) -> io::Result<()> {
        let mut parents: HashMap<PathKey, WatchedParent> = HashMap::new();
        for target in self.document.iter().chain(self.images.values()) {
            let parent = target.path.parent().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "watched path has no parent")
            })?;
            let entry = parents
                .entry(target.parent_key.clone())
                .or_insert_with(|| WatchedParent {
                    path: parent.to_path_buf(),
                    ref_count: 0,
                });
            entry.ref_count += 1;
        }
        self.parents = parents;
        Ok(())
    }

    fn parent_paths(&self) -> HashMap<PathKey, PathBuf> {
        self.parents
            .iter()
            .map(|(key, parent)| (key.clone(), parent.path.clone()))
            .collect()
    }

    fn target_paths(&self) -> Vec<PathBuf> {
        self.document
            .iter()
            .chain(self.images.values())
            .map(|target| target.path.clone())
            .collect()
    }

    fn target_paths_for_events<'a>(
        &self,
        paths: impl IntoIterator<Item = &'a Path>,
    ) -> io::Result<HashSet<PathBuf>> {
        let keys = paths
            .into_iter()
            .map(PathKey::new)
            .collect::<io::Result<HashSet<_>>>()?;
        let keys = self.expand_parent_event_keys(keys);
        Ok(self
            .document
            .iter()
            .chain(self.images.values())
            .filter(|target| keys.contains(&target.key))
            .map(|target| target.path.clone())
            .collect())
    }

    fn document_fingerprint(&self) -> Option<String> {
        self.document
            .as_ref()
            .and_then(|document| document.fingerprint.clone())
    }

    fn expand_parent_event_keys(&self, mut keys: HashSet<PathKey>) -> HashSet<PathKey> {
        let affected_parents = keys
            .iter()
            .filter(|key| self.parents.contains_key(*key))
            .cloned()
            .collect::<HashSet<_>>();
        if affected_parents.is_empty() {
            return keys;
        }

        for target in self.document.iter().chain(self.images.values()) {
            if affected_parents.contains(&target.parent_key) {
                keys.insert(target.key.clone());
            }
        }
        keys
    }
}

#[derive(Default)]
struct PendingDispatch {
    error: Option<(PathBuf, String)>,
    events: HashMap<PathBuf, FileWatchEvent>,
    paths: HashSet<PathBuf>,
}

impl PendingDispatch {
    fn take(&mut self) -> Option<PendingDispatch> {
        if self.paths.is_empty() && self.events.is_empty() && self.error.is_none() {
            None
        } else {
            Some(mem::take(self))
        }
    }
}

#[derive(Clone)]
struct InvalidationDispatcher {
    pending: Arc<Mutex<PendingDispatch>>,
    registry: Arc<Mutex<TargetRegistry>>,
    signal: Option<SyncSender<()>>,
    sink: Arc<EventSink>,
}

impl InvalidationDispatcher {
    fn new(
        registry: Arc<Mutex<TargetRegistry>>,
        sink: Arc<EventSink>,
        reader: Arc<FingerprintReader>,
    ) -> Self {
        let pending = Arc::new(Mutex::new(PendingDispatch::default()));
        let (signal, receiver) = sync_channel(1);
        let worker_pending = Arc::clone(&pending);
        let worker_registry = Arc::clone(&registry);
        let worker_sink = Arc::clone(&sink);
        let spawn_result = std::thread::Builder::new()
            .name("lumamark-file-invalidation".to_string())
            .spawn(move || {
                run_dispatch_worker(
                    worker_registry,
                    worker_sink,
                    reader,
                    worker_pending,
                    receiver,
                );
            });
        let signal = match spawn_result {
            Ok(_) => Some(signal),
            Err(error) => {
                eprintln!("failed to start file invalidation worker: {error}");
                None
            }
        };

        Self {
            pending,
            registry,
            signal,
            sink,
        }
    }

    fn schedule_invalidation(&self, paths: Vec<PathBuf>) {
        let target_paths = match self.registry.lock() {
            Ok(registry) => registry
                .target_paths_for_events(paths.iter().map(PathBuf::as_path))
                .unwrap_or_else(|error| {
                    eprintln!("file watcher failed to normalize invalidation paths: {error}");
                    HashSet::new()
                }),
            Err(_) => {
                eprintln!("file watcher state is unavailable while scheduling invalidation");
                HashSet::new()
            }
        };
        if target_paths.is_empty() {
            return;
        }

        match self.pending.lock() {
            Ok(mut pending) => pending.paths.extend(target_paths),
            Err(_) => {
                self.emit_dispatcher_failure("file invalidation queue is unavailable");
                return;
            }
        }
        if !self.signal_worker() {
            self.emit_dispatcher_failure("file invalidation worker is unavailable");
        }
    }

    fn schedule_error(&self, paths: Vec<PathBuf>, message: String) {
        let path = paths.into_iter().next().unwrap_or_default();
        match self.pending.lock() {
            Ok(mut pending) => pending.error = Some((path, message)),
            Err(_) => {
                self.emit_dispatcher_failure("file invalidation queue is unavailable");
                return;
            }
        }
        if !self.signal_worker() {
            self.emit_dispatcher_failure("file invalidation worker is unavailable");
        }
    }

    fn dispatch_events(&self, events: Vec<FileWatchEvent>) -> bool {
        if events.is_empty() {
            return true;
        }
        match self.pending.lock() {
            Ok(mut pending) => {
                for event in events {
                    let path = PathBuf::from(&event.path);
                    match pending.events.get(&path) {
                        Some(current) if current.revision >= event.revision => {}
                        _ => {
                            pending.events.insert(path, event);
                        }
                    }
                }
            }
            Err(_) => return false,
        }
        self.signal_worker()
    }

    fn signal_worker(&self) -> bool {
        let Some(signal) = &self.signal else {
            return false;
        };
        match signal.try_send(()) {
            Ok(()) | Err(TrySendError::Full(())) => true,
            Err(TrySendError::Disconnected(())) => false,
        }
    }

    fn emit_dispatcher_failure(&self, message: &str) {
        emit_invalidation_error(&self.registry, self.sink.as_ref(), &[], message);
    }
}

fn run_dispatch_worker(
    registry: Arc<Mutex<TargetRegistry>>,
    sink: Arc<EventSink>,
    reader: Arc<FingerprintReader>,
    pending: Arc<Mutex<PendingDispatch>>,
    receiver: Receiver<()>,
) {
    while receiver.recv().is_ok() {
        loop {
            let batch = match pending.lock() {
                Ok(mut pending) => pending.take(),
                Err(_) => {
                    emit_invalidation_error(
                        &registry,
                        sink.as_ref(),
                        &[],
                        "file invalidation queue is unavailable",
                    );
                    return;
                }
            };
            let Some(batch) = batch else {
                break;
            };

            if !batch.events.is_empty() {
                let mut events = batch.events.into_values().collect::<Vec<_>>();
                events.sort_by_key(|event| event.revision);
                for event in events {
                    sink(event);
                }
            }
            if !batch.paths.is_empty() {
                retry_invalidation(
                    Arc::clone(&registry),
                    Arc::clone(&sink),
                    batch.paths.into_iter().collect(),
                    Arc::clone(&reader),
                );
            }
            if let Some((path, message)) = batch.error {
                emit_invalidation_error(&registry, sink.as_ref(), &[path], &message);
            }
        }
    }
}

struct WatcherController {
    installed: HashMap<PathKey, PathBuf>,
    ops: Box<dyn WatcherOps>,
}

impl WatcherController {
    fn new(ops: Box<dyn WatcherOps>) -> Self {
        Self {
            installed: HashMap::new(),
            ops,
        }
    }

    fn reconcile(&mut self, desired: &HashMap<PathKey, PathBuf>) -> Result<(), FileWatchError> {
        let mut additions = desired
            .iter()
            .filter(|(key, _)| !self.installed.contains_key(*key))
            .map(|(key, path)| (key.clone(), path.clone()))
            .collect::<Vec<_>>();
        let mut removals = self
            .installed
            .iter()
            .filter(|(key, _)| !desired.contains_key(*key))
            .map(|(key, path)| (key.clone(), path.clone()))
            .collect::<Vec<_>>();
        additions.sort_by(|left, right| left.1.cmp(&right.1));
        removals.sort_by(|left, right| left.1.cmp(&right.1));

        for (key, path) in additions {
            self.ops.watch_non_recursive(&path)?;
            self.installed.insert(key, path);
        }

        for (key, path) in removals {
            match self.ops.unwatch(&path) {
                Ok(()) => {
                    self.installed.remove(&key);
                }
                Err(error)
                    if matches!(
                        error.kind,
                        NotifyErrorKind::PathNotFound | NotifyErrorKind::WatchNotFound
                    ) =>
                {
                    self.installed.remove(&key);
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }
}

enum WatcherAvailability {
    Available(WatcherController),
    Unavailable(String),
}

pub struct FileWatchService {
    dispatcher: InvalidationDispatcher,
    registry: Arc<Mutex<TargetRegistry>>,
    watcher: Mutex<WatcherAvailability>,
}

impl FileWatchService {
    pub fn new<F>(sink: F) -> Self
    where
        F: Fn(FileWatchEvent) + Send + Sync + 'static,
    {
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        let sink: Arc<EventSink> = Arc::new(sink);
        let reader: Arc<FingerprintReader> = Arc::new(file_fingerprint);
        let dispatcher =
            InvalidationDispatcher::new(Arc::clone(&registry), Arc::clone(&sink), reader);
        let callback_dispatcher = dispatcher.clone();
        let watcher = new_debouncer(
            FILE_WATCH_DEBOUNCE,
            None,
            move |result: DebounceEventResult| {
                process_debounced_events(&callback_dispatcher, result);
            },
        )
        .map(|debouncer| Box::new(debouncer) as Box<dyn WatcherOps>)
        .map_err(FileWatchError::from);

        Self::from_parts(registry, watcher, dispatcher)
    }

    fn from_parts(
        registry: Arc<Mutex<TargetRegistry>>,
        watcher: Result<Box<dyn WatcherOps>, FileWatchError>,
        dispatcher: InvalidationDispatcher,
    ) -> Self {
        let watcher = match watcher {
            Ok(watcher) => WatcherAvailability::Available(WatcherController::new(watcher)),
            Err(error) => WatcherAvailability::Unavailable(error.to_string()),
        };
        Self {
            dispatcher,
            registry,
            watcher: Mutex::new(watcher),
        }
    }

    pub fn watch_document(&self, path: &Path) -> Result<WatchDocumentResult, FileWatchError> {
        self.update_registry(|registry| registry.replace_document(path))?;
        Ok(WatchDocumentResult {
            fingerprint: lock(&self.registry)?.document_fingerprint(),
        })
    }

    pub fn replace_local_image_targets(&self, paths: &[PathBuf]) -> Result<(), FileWatchError> {
        self.update_registry(|registry| registry.replace_images(paths.iter().map(PathBuf::as_path)))
    }

    pub fn unwatch_document(&self) -> Result<(), FileWatchError> {
        self.update_registry(TargetRegistry::remove_document)
    }

    pub fn record_document_saved(&self, path: &Path, bytes: &[u8]) -> Result<(), FileWatchError> {
        lock(&self.registry)?.record_document_saved(path, bytes)?;
        Ok(())
    }

    fn update_registry<F>(&self, update: F) -> Result<(), FileWatchError>
    where
        F: FnOnce(&mut TargetRegistry) -> io::Result<()>,
    {
        let mut registry = lock(&self.registry)?;
        let mut next = registry.clone();
        update(&mut next)?;
        let desired_parents = next.parent_paths();
        let mut watcher = lock(&self.watcher)?;
        match &mut *watcher {
            WatcherAvailability::Available(controller) => {
                controller.reconcile(&desired_parents)?;
            }
            WatcherAvailability::Unavailable(message) => {
                return Err(FileWatchError::Unavailable(message.clone()));
            }
        }
        drop(watcher);

        let target_paths = next.target_paths();
        let events = next.invalidate_paths(target_paths.iter().map(PathBuf::as_path))?;
        *registry = next;
        drop(registry);
        let dispatched = self.dispatcher.dispatch_events(events);
        if !dispatched {
            self.dispatcher
                .emit_dispatcher_failure("file invalidation worker is unavailable");
        }
        Ok(())
    }
}

fn process_debounced_events(dispatcher: &InvalidationDispatcher, result: DebounceEventResult) {
    let events = match result {
        Ok(events) => events,
        Err(errors) => {
            let paths = errors
                .iter()
                .flat_map(|error| error.paths.iter().cloned())
                .collect::<Vec<_>>();
            let message = errors
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join("; ");
            for error in errors {
                eprintln!("file watcher notification failed: {error}");
            }
            dispatcher.schedule_error(paths, message);
            return;
        }
    };
    let paths = events
        .into_iter()
        .flat_map(|event| event.event.paths)
        .collect::<Vec<_>>();
    dispatcher.schedule_invalidation(paths);
}

#[derive(Debug)]
enum InvalidationAttemptError {
    Read(io::Error),
    StateChanged,
    StatePoisoned,
}

fn retry_invalidation(
    registry: Arc<Mutex<TargetRegistry>>,
    sink: Arc<EventSink>,
    paths: Vec<PathBuf>,
    reader: Arc<FingerprintReader>,
) {
    let mut last_error = String::new();
    for attempt in 0..=INVALIDATION_RETRY_DELAYS.len() {
        match invalidate_registry_once(&registry, &paths, reader.as_ref()) {
            Ok(events) => {
                for event in events {
                    sink(event);
                }
                return;
            }
            Err(InvalidationAttemptError::Read(error)) => {
                last_error = error.to_string();
            }
            Err(InvalidationAttemptError::StateChanged) => {
                return;
            }
            Err(InvalidationAttemptError::StatePoisoned) => {
                last_error = "file watcher state is unavailable".to_string();
            }
        }

        if let Some(delay) = INVALIDATION_RETRY_DELAYS.get(attempt) {
            std::thread::sleep(*delay);
        }
    }

    emit_invalidation_error(
        &registry,
        sink.as_ref(),
        &paths,
        &format!("file invalidation retries exhausted: {last_error}"),
    );
}

fn invalidate_registry_once(
    registry: &Mutex<TargetRegistry>,
    paths: &[PathBuf],
    reader: &FingerprintReader,
) -> Result<Vec<FileWatchEvent>, InvalidationAttemptError> {
    let before = registry
        .lock()
        .map_err(|_| InvalidationAttemptError::StatePoisoned)?
        .clone();
    let mut after = before.clone();
    let events = after
        .invalidate_paths_in_place(paths.iter().map(PathBuf::as_path), reader)
        .map_err(InvalidationAttemptError::Read)?;
    let mut current = registry
        .lock()
        .map_err(|_| InvalidationAttemptError::StatePoisoned)?;
    if *current != before {
        return Err(InvalidationAttemptError::StateChanged);
    }
    *current = after;
    Ok(events)
}

fn emit_invalidation_error(
    registry: &Mutex<TargetRegistry>,
    sink: &EventSink,
    paths: &[PathBuf],
    message: &str,
) {
    eprintln!("file watcher invalidation failed: {message}");
    let path = paths.first().map(PathBuf::as_path).unwrap_or(Path::new(""));
    let event = match registry.lock() {
        Ok(mut registry) => registry.error_event(path),
        Err(_) => {
            eprintln!("file watcher state is unavailable while emitting an error event");
            return;
        }
    };

    sink(event);
}

fn lock<T>(mutex: &Mutex<T>) -> Result<MutexGuard<'_, T>, FileWatchError> {
    mutex.lock().map_err(|_| FileWatchError::StatePoisoned)
}

fn update_target(
    target: &mut Target,
    reader: &FingerprintReader,
) -> io::Result<Option<(FileWatchEventKind, String, Option<String>)>> {
    let fingerprint = reader(&target.path)?;
    if fingerprint == target.fingerprint {
        return Ok(None);
    }

    target.fingerprint = fingerprint.clone();
    let kind = if fingerprint.is_some() {
        target.kind.event_kind()
    } else {
        FileWatchEventKind::Removed
    };

    Ok(Some((
        kind,
        target.path.to_string_lossy().into_owned(),
        fingerprint,
    )))
}

fn file_fingerprint(path: &Path) -> io::Result<Option<String>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    Ok(Some(content_fingerprint(&bytes)))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;
    use std::io;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        file_fingerprint, retry_invalidation, EventSink, FileWatchError, FileWatchEventKind,
        FileWatchService, FingerprintReader, InvalidationDispatcher, TargetRegistry, WatcherOps,
    };
    use crate::services::file_service::write_bytes_atomically;
    use notify_debouncer_full::notify;

    #[derive(Default)]
    struct FakeWatcherState {
        fail_next_unwatch: bool,
        installed: HashSet<PathBuf>,
        on_watch: Option<Box<dyn FnOnce() + Send>>,
    }

    struct FakeWatcherOps {
        state: Arc<Mutex<FakeWatcherState>>,
    }

    impl WatcherOps for FakeWatcherOps {
        fn watch_non_recursive(&mut self, path: &Path) -> notify::Result<()> {
            let on_watch = self
                .state
                .lock()
                .expect("fake watcher state should be available")
                .on_watch
                .take();
            if let Some(on_watch) = on_watch {
                on_watch();
            }
            self.state
                .lock()
                .expect("fake watcher state should be available")
                .installed
                .insert(path.to_path_buf());
            Ok(())
        }

        fn unwatch(&mut self, path: &Path) -> notify::Result<()> {
            let mut state = self
                .state
                .lock()
                .expect("fake watcher state should be available");
            if state.fail_next_unwatch {
                state.fail_next_unwatch = false;
                return Err(notify::Error::generic("synthetic unwatch failure"));
            }
            state.installed.remove(path);
            Ok(())
        }
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("lumamark-file-watch-{name}-{nanos}"));
        fs::create_dir_all(&directory).expect("test directory should be created");
        directory
    }

    fn write(path: &Path, content: &str) {
        fs::write(path, content).expect("test file should be written");
    }

    fn service_with_watcher<F>(
        sink: F,
        watcher: Result<Box<dyn WatcherOps>, FileWatchError>,
    ) -> FileWatchService
    where
        F: Fn(super::FileWatchEvent) + Send + Sync + 'static,
    {
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        let sink: Arc<EventSink> = Arc::new(sink);
        let dispatcher = InvalidationDispatcher::new(
            Arc::clone(&registry),
            Arc::clone(&sink),
            Arc::new(file_fingerprint),
        );
        FileWatchService::from_parts(registry, watcher, dispatcher)
    }

    #[test]
    fn registry_should_reuse_parent_watch_for_document_and_images() {
        let directory = unique_test_dir("parent-reuse");
        let document = directory.join("note.md");
        let image = directory.join("preview.png");
        write(&document, "before");
        write(&image, "image");
        let mut registry = TargetRegistry::default();

        registry
            .replace_document(&document)
            .expect("document target should be registered");
        registry
            .replace_images([image.as_path()])
            .expect("image target should be registered");

        assert_eq!(registry.parent_ref_count(&directory), 2);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn registry_should_ignore_events_for_unregistered_siblings() {
        let directory = unique_test_dir("exact-filter");
        let document = directory.join("note.md");
        let sibling = directory.join("other.md");
        write(&document, "before");
        write(&sibling, "unrelated");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document target should be registered");

        let events = registry
            .invalidate_paths([sibling.as_path()])
            .expect("unrelated path should be ignored");

        assert!(events.is_empty());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn registry_should_replace_local_image_targets() {
        let directory = unique_test_dir("replace-images");
        let document = directory.join("note.md");
        let previous_image = directory.join("previous.png");
        let current_image = directory.join("current.png");
        write(&document, "before");
        write(&previous_image, "previous");
        write(&current_image, "current");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document target should be registered");
        registry
            .replace_images([previous_image.as_path()])
            .expect("previous image should be registered");
        registry
            .replace_images([current_image.as_path()])
            .expect("current image should replace previous targets");
        write(&previous_image, "changed previous");
        write(&current_image, "changed current");

        let previous_events = registry
            .invalidate_paths([previous_image.as_path()])
            .expect("previous image path should be ignored");
        let current_event = registry
            .invalidate_paths([current_image.as_path()])
            .expect("current image should be fingerprinted")
            .pop()
            .expect("current image should emit an event");

        assert!(previous_events.is_empty());
        assert_eq!(current_event.kind, FileWatchEventKind::Image);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn registry_should_preserve_image_targets_when_the_document_is_replaced() {
        let old_directory = unique_test_dir("preserve-images-old-document");
        let new_directory = unique_test_dir("preserve-images-new-document");
        let old_document = old_directory.join("old.md");
        let new_document = new_directory.join("new.md");
        let image = new_directory.join("preview.png");
        write(&old_document, "old");
        write(&new_document, "new");
        write(&image, "before image");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&old_document)
            .expect("old document should be registered");
        registry
            .replace_images([image.as_path()])
            .expect("new image targets should be registered first");

        registry
            .replace_document(&new_document)
            .expect("new document should replace only the document target");
        write(&image, "changed image");
        let event = registry
            .invalidate_paths([image.as_path()])
            .expect("image should remain registered")
            .pop()
            .expect("image change should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Image);
        assert_eq!(registry.parent_ref_count(&old_directory), 0);
        assert_eq!(registry.parent_ref_count(&new_directory), 2);
        fs::remove_dir_all(old_directory).expect("old test directory should be removed");
        fs::remove_dir_all(new_directory).expect("new test directory should be removed");
    }

    #[test]
    fn registry_should_preserve_image_targets_when_the_document_is_unwatched() {
        let document_directory = unique_test_dir("unwatch-document-only");
        let image_directory = unique_test_dir("preserve-image-watch");
        let document = document_directory.join("note.md");
        let image = image_directory.join("preview.png");
        write(&document, "content");
        write(&image, "before image");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document should be registered");
        registry
            .replace_images([image.as_path()])
            .expect("image should be registered");

        registry
            .remove_document()
            .expect("only the document target should be removed");
        write(&image, "changed image");
        let event = registry
            .invalidate_paths([image.as_path()])
            .expect("image should remain registered")
            .pop()
            .expect("image change should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Image);
        assert_eq!(registry.parent_ref_count(&document_directory), 0);
        assert_eq!(registry.parent_ref_count(&image_directory), 1);
        fs::remove_dir_all(document_directory).expect("document test directory should be removed");
        fs::remove_dir_all(image_directory).expect("image test directory should be removed");
    }

    #[test]
    fn registry_should_not_lose_an_earlier_event_when_a_later_target_read_fails() {
        let directory = unique_test_dir("transactional-invalidation");
        let document = directory.join("note.md");
        let image = directory.join("preview.png");
        write(&document, "before");
        write(&image, "image");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document target should be registered");
        registry
            .replace_images([image.as_path()])
            .expect("image target should be registered");
        write(&document, "changed document");
        fs::remove_file(&image).expect("image should be removed");
        fs::create_dir(&image).expect("failing image path should become a directory");

        let failed = registry.invalidate_paths([document.as_path(), image.as_path()]);
        let retried = registry
            .invalidate_paths([document.as_path()])
            .expect("document invalidation should remain retryable");

        assert!(failed.is_err());
        assert_eq!(retried.len(), 1);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn registry_should_suppress_a_saved_document_fingerprint() {
        let directory = unique_test_dir("saved-fingerprint");
        let document = directory.join("note.md");
        write(&document, "before");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document target should be registered");
        write(&document, "saved by lumamark");
        registry
            .record_document_saved(&document, b"saved by lumamark")
            .expect("saved fingerprint should be recorded");

        let events = registry
            .invalidate_paths([document.as_path()])
            .expect("document should be readable");

        assert!(events.is_empty());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn registry_should_not_suppress_an_external_write_that_races_a_save() {
        let directory = unique_test_dir("save-race");
        let document = directory.join("note.md");
        write(&document, "before");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document target should be registered");
        write(&document, "external write after lumamark save");

        registry
            .record_document_saved(&document, b"saved by lumamark")
            .expect("saved bytes should be recorded");
        let event = registry
            .invalidate_paths([document.as_path()])
            .expect("external write should be fingerprinted")
            .pop()
            .expect("external write should not be suppressed");

        assert_eq!(event.kind, FileWatchEventKind::Document);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn registry_should_ignore_saved_fingerprint_for_an_unwatched_document() {
        let directory = unique_test_dir("unwatched-save");
        let document = directory.join("new-note.md");
        write(&document, "saved before watch registration");
        let mut registry = TargetRegistry::default();

        let result = registry.record_document_saved(&document, b"saved before watch registration");

        assert!(
            result.is_ok(),
            "unwatched save should be ignored: {result:?}"
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn registry_should_emit_removed_then_recreated_with_monotonic_revisions() {
        let directory = unique_test_dir("delete-recreate");
        let document = directory.join("note.md");
        write(&document, "before");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document target should be registered");
        fs::remove_file(&document).expect("document should be removed");

        let removed = registry
            .invalidate_paths([document.as_path()])
            .expect("removal should be detected")
            .pop()
            .expect("removal should emit one event");
        write(&document, "after");
        let recreated = registry
            .invalidate_paths([document.as_path()])
            .expect("recreation should be detected")
            .pop()
            .expect("recreation should emit one event");

        assert_eq!(removed.kind, FileWatchEventKind::Removed);
        assert_eq!(recreated.kind, FileWatchEventKind::Document);
        assert!(recreated.revision > removed.revision);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[cfg(windows)]
    #[test]
    fn registry_should_match_windows_paths_case_insensitively() {
        let directory = unique_test_dir("case-insensitive");
        let document = directory.join("Note.md");
        write(&document, "before");
        let mut registry = TargetRegistry::default();
        registry
            .replace_document(&document)
            .expect("document target should be registered");
        write(&document, "after");
        let differently_cased = PathBuf::from(document.to_string_lossy().to_uppercase());

        let event = registry
            .invalidate_paths([differently_cased.as_path()])
            .expect("case-insensitive path should match")
            .pop()
            .expect("changed document should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Document);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_emit_document_change_after_external_write() {
        let directory = unique_test_dir("external-write");
        let document = directory.join("note.md");
        write(&document, "before");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");

        write(&document, "changed outside lumamark");
        let event = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("external write should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Document);
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_emit_document_change_after_atomic_replacement() {
        let directory = unique_test_dir("atomic-replace");
        let document = directory.join("note.md");
        write(&document, "before");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");

        write_bytes_atomically(&document, b"atomically replaced")
            .expect("document should be atomically replaced");
        let event = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("atomic replacement should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Document);
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_emit_removed_then_recreated_document_events() {
        let directory = unique_test_dir("service-delete-recreate");
        let document = directory.join("note.md");
        write(&document, "before");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");

        fs::remove_file(&document).expect("document should be removed");
        let removed = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("removal should emit an event");
        write(&document, "recreated");
        let recreated = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("recreation should emit an event");

        assert_eq!(removed.kind, FileWatchEventKind::Removed);
        assert_eq!(recreated.kind, FileWatchEventKind::Document);
        assert!(recreated.revision > removed.revision);
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_emit_image_change_for_a_real_local_image_target() {
        let directory = unique_test_dir("real-image-change");
        let document = directory.join("note.md");
        let image = directory.join("preview.png");
        write(&document, "![preview](preview.png)");
        write(&image, "before image");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");
        service
            .replace_local_image_targets(std::slice::from_ref(&image))
            .expect("image should be watched");

        write(&image, "changed image");
        let event = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("local image change should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Image);
        assert_eq!(event.path, image.to_string_lossy());
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_preserve_images_registered_before_replacing_the_document_watch() {
        let old_directory = unique_test_dir("service-old-document");
        let new_directory = unique_test_dir("service-new-document-images");
        let old_document = old_directory.join("old.md");
        let new_document = new_directory.join("new.md");
        let image = new_directory.join("preview.png");
        write(&old_document, "old");
        write(&new_document, "![preview](preview.png)");
        write(&image, "before image");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&old_document)
            .expect("old document should be watched");
        service
            .replace_local_image_targets(std::slice::from_ref(&image))
            .expect("new image targets should be synchronized before the document watch");
        service
            .watch_document(&new_document)
            .expect("new document should replace only the document target");

        write(&image, "changed image");
        let event = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("preserved image target should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Image);
        drop(service);
        fs::remove_dir_all(old_directory).expect("old test directory should be removed");
        fs::remove_dir_all(new_directory).expect("new test directory should be removed");
    }

    #[test]
    fn service_should_preserve_image_watch_when_only_the_document_is_unwatched() {
        let document_directory = unique_test_dir("service-unwatch-document");
        let image_directory = unique_test_dir("service-preserve-image");
        let document = document_directory.join("note.md");
        let image = image_directory.join("preview.png");
        write(&document, "content");
        write(&image, "before image");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");
        service
            .replace_local_image_targets(std::slice::from_ref(&image))
            .expect("image should be watched");
        service
            .unwatch_document()
            .expect("only the document watch should be removed");

        write(&image, "changed image");
        let event = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("image watch should remain active");

        assert_eq!(event.kind, FileWatchEventKind::Image);
        drop(service);
        fs::remove_dir_all(document_directory).expect("document test directory should be removed");
        fs::remove_dir_all(image_directory).expect("image test directory should be removed");
    }

    #[test]
    fn service_should_emit_removed_then_document_when_a_file_is_renamed_away_and_back() {
        let directory = unique_test_dir("rename-away-back");
        let document = directory.join("note.md");
        let moved = directory.join("moved.md");
        write(&document, "content");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");

        fs::rename(&document, &moved).expect("document should be renamed away");
        let removed = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("rename away should emit removal");
        fs::rename(&moved, &document).expect("document should be renamed back");
        let restored = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("rename back should emit document change");

        assert_eq!(removed.kind, FileWatchEventKind::Removed);
        assert_eq!(restored.kind, FileWatchEventKind::Document);
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_coalesce_rapid_writes_to_the_latest_fingerprint() {
        let directory = unique_test_dir("rapid-writes");
        let document = directory.join("note.md");
        write(&document, "before");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");

        write(&document, "one");
        write(&document, "two");
        write(&document, "latest");
        let event = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("rapid writes should emit an event");
        let expected = file_fingerprint(&document).expect("document should be fingerprinted");

        assert_eq!(event.fingerprint, expected);
        assert!(receiver.recv_timeout(Duration::from_millis(500)).is_err());
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_ignore_the_previous_document_after_switching_targets() {
        let directory = unique_test_dir("document-switch");
        let previous = directory.join("previous.md");
        let current = directory.join("current.md");
        write(&previous, "previous");
        write(&current, "current");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&previous)
            .expect("previous document should be watched");
        service
            .watch_document(&current)
            .expect("current document should replace the target");

        write(&previous, "changed but no longer watched");
        assert!(receiver.recv_timeout(Duration::from_millis(500)).is_err());
        write(&current, "changed current document");
        let event = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("current document should emit an event");

        assert_eq!(event.path, current.to_string_lossy());
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_stop_emitting_after_unwatching_the_document() {
        let directory = unique_test_dir("unwatch-document");
        let document = directory.join("note.md");
        write(&document, "before");
        let (sender, receiver) = mpsc::channel();
        let service = FileWatchService::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        service
            .watch_document(&document)
            .expect("document should be watched");
        service
            .unwatch_document()
            .expect("document watch should be removed");

        write(&document, "changed after unwatch");

        assert!(receiver.recv_timeout(Duration::from_millis(500)).is_err());
        drop(service);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_emit_a_change_that_occurs_while_installing_the_parent_watch() {
        let directory = unique_test_dir("install-race");
        let document = directory.join("note.md");
        write(&document, "opened content");
        let state = Arc::new(Mutex::new(FakeWatcherState {
            on_watch: Some(Box::new({
                let document = document.clone();
                move || write(&document, "changed during watch installation")
            })),
            ..FakeWatcherState::default()
        }));
        let (sender, receiver) = mpsc::channel();
        let service = service_with_watcher(
            move |event| {
                sender
                    .send(event)
                    .expect("test event receiver should remain connected");
            },
            Ok(Box::new(FakeWatcherOps { state })),
        );

        let baseline = service
            .watch_document(&document)
            .expect("document watch should be installed");
        let event = receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("install race should emit the changed baseline");
        let current_fingerprint = file_fingerprint(&document).expect("document should be readable");

        assert_eq!(event.kind, FileWatchEventKind::Document);
        assert_eq!(baseline.fingerprint, current_fingerprint);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn service_should_reconcile_actual_watches_after_an_unwatch_failure() {
        let old_directory = unique_test_dir("reconcile-old");
        let new_directory = unique_test_dir("reconcile-new");
        let old_document = old_directory.join("old.md");
        let new_document = new_directory.join("new.md");
        write(&old_document, "old");
        write(&new_document, "new");
        let state = Arc::new(Mutex::new(FakeWatcherState::default()));
        let service = service_with_watcher(
            |_| {},
            Ok(Box::new(FakeWatcherOps {
                state: Arc::clone(&state),
            })),
        );
        service
            .watch_document(&old_document)
            .expect("old document should be watched");
        state
            .lock()
            .expect("fake watcher state should be available")
            .fail_next_unwatch = true;

        let failed_switch = service.watch_document(&new_document);
        service
            .watch_document(&new_document)
            .expect("retry should reconcile the actual watcher set");
        let installed = state
            .lock()
            .expect("fake watcher state should be available")
            .installed
            .clone();

        assert!(failed_switch.is_err());
        assert_eq!(installed, HashSet::from([new_directory.clone()]));
        fs::remove_dir_all(old_directory).expect("old test directory should be removed");
        fs::remove_dir_all(new_directory).expect("new test directory should be removed");
    }

    #[test]
    fn service_should_remain_constructible_when_the_watcher_backend_is_unavailable() {
        let directory = unique_test_dir("unavailable-backend");
        let document = directory.join("note.md");
        write(&document, "content");
        let service = service_with_watcher(
            |_| {},
            Err(FileWatchError::Notify(notify::Error::generic(
                "synthetic initialization failure",
            ))),
        );

        let result = service.watch_document(&document);

        assert!(matches!(result, Err(FileWatchError::Unavailable(_))));
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn debounced_callback_should_release_registry_lock_before_calling_the_sink() {
        let directory = unique_test_dir("sink-panic");
        let document = directory.join("note.md");
        write(&document, "before");
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        registry
            .lock()
            .expect("registry should be available")
            .replace_document(&document)
            .expect("document should be registered");
        write(&document, "after");
        let sink: Arc<EventSink> = Arc::new(|_| panic!("synthetic sink panic"));
        let reader: Arc<FingerprintReader> = Arc::new(file_fingerprint);

        let panicked = catch_unwind(AssertUnwindSafe(|| {
            retry_invalidation(
                Arc::clone(&registry),
                Arc::clone(&sink),
                vec![document.clone()],
                Arc::clone(&reader),
            );
        }));

        assert!(panicked.is_err());
        assert!(registry.lock().is_ok());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn invalidation_should_retry_temporary_read_failures_and_emit_latest_change_once() {
        let directory = unique_test_dir("retry-then-success");
        let document = directory.join("note.md");
        write(&document, "before");
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        registry
            .lock()
            .expect("registry should be available")
            .replace_document(&document)
            .expect("document should be registered");
        write(&document, "after retries");
        let attempts = Arc::new(AtomicUsize::new(0));
        let reader: Arc<FingerprintReader> = Arc::new({
            let attempts = Arc::clone(&attempts);
            move |path| {
                let attempt = attempts.fetch_add(1, Ordering::SeqCst);
                if attempt < 2 {
                    Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "synthetic sharing violation",
                    ))
                } else {
                    file_fingerprint(path)
                }
            }
        });
        let (sender, receiver) = mpsc::channel();
        let sink: Arc<EventSink> = Arc::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });

        let dispatcher = InvalidationDispatcher::new(Arc::clone(&registry), sink, reader);
        dispatcher.schedule_invalidation(vec![document.clone()]);
        let event = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("retry should eventually emit the change");

        assert_eq!(event.kind, FileWatchEventKind::Document);
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        assert!(receiver.recv_timeout(Duration::from_millis(250)).is_err());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn invalidation_should_emit_error_without_changing_fingerprint_after_retry_exhaustion() {
        let directory = unique_test_dir("retry-exhausted");
        let document = directory.join("note.md");
        write(&document, "before");
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        registry
            .lock()
            .expect("registry should be available")
            .replace_document(&document)
            .expect("document should be registered");
        let baseline = registry
            .lock()
            .expect("registry should be available")
            .document_fingerprint();
        write(&document, "unreadable change");
        let attempts = Arc::new(AtomicUsize::new(0));
        let reader: Arc<FingerprintReader> = Arc::new({
            let attempts = Arc::clone(&attempts);
            move |_| {
                attempts.fetch_add(1, Ordering::SeqCst);
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "synthetic persistent sharing violation",
                ))
            }
        });
        let (sender, receiver) = mpsc::channel();
        let sink: Arc<EventSink> = Arc::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });

        let dispatcher = InvalidationDispatcher::new(Arc::clone(&registry), sink, reader);
        dispatcher.schedule_invalidation(vec![document.clone()]);
        let event = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("retry exhaustion should emit an error event");
        let fingerprint = registry
            .lock()
            .expect("registry should remain available")
            .document_fingerprint();

        assert_eq!(event.kind, FileWatchEventKind::Error);
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        assert_eq!(fingerprint, baseline);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn dispatcher_should_use_one_worker_and_merge_many_pending_schedules_by_path() {
        let directory = unique_test_dir("bounded-dispatcher");
        let document = directory.join("note.md");
        write(&document, "before");
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        registry
            .lock()
            .expect("registry should be available")
            .replace_document(&document)
            .expect("document should be registered");
        write(&document, "after");
        let attempts = Arc::new(AtomicUsize::new(0));
        let worker_threads = Arc::new(Mutex::new(HashSet::new()));
        let (started_sender, started_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let release_receiver = Arc::new(Mutex::new(release_receiver));
        let reader: Arc<FingerprintReader> = Arc::new({
            let attempts = Arc::clone(&attempts);
            let worker_threads = Arc::clone(&worker_threads);
            let release_receiver = Arc::clone(&release_receiver);
            move |path| {
                worker_threads
                    .lock()
                    .expect("thread set should be available")
                    .insert(std::thread::current().id());
                let attempt = attempts.fetch_add(1, Ordering::SeqCst);
                if attempt == 0 {
                    started_sender
                        .send(())
                        .expect("test should wait for the first read");
                    release_receiver
                        .lock()
                        .expect("release receiver should be available")
                        .recv()
                        .expect("first read should be released");
                }
                file_fingerprint(path)
            }
        });
        let (sender, receiver) = mpsc::channel();
        let sink: Arc<EventSink> = Arc::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        let dispatcher = InvalidationDispatcher::new(Arc::clone(&registry), sink, reader);

        dispatcher.schedule_invalidation(vec![document.clone()]);
        started_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("first read should start");
        for _ in 0..100 {
            dispatcher.schedule_invalidation(vec![document.clone()]);
        }
        release_sender.send(()).expect("first read should resume");
        receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("document change should emit once");
        for _ in 0..100 {
            if attempts.load(Ordering::SeqCst) >= 2 {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(
            worker_threads
                .lock()
                .expect("thread set should be available")
                .len(),
            1
        );
        assert!(receiver.recv_timeout(Duration::from_millis(250)).is_err());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn dispatcher_should_emit_blocked_batches_in_monotonic_revision_order() {
        let directory = unique_test_dir("ordered-dispatcher");
        let document = directory.join("note.md");
        let image = directory.join("preview.png");
        write(&document, "document before");
        write(&image, "image before");
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        {
            let mut registry = registry.lock().expect("registry should be available");
            registry
                .replace_document(&document)
                .expect("document should be registered");
            registry
                .replace_images([image.as_path()])
                .expect("image should be registered");
        }
        write(&document, "document latest");
        let (started_sender, started_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let release_receiver = Arc::new(Mutex::new(release_receiver));
        let attempts = Arc::new(AtomicUsize::new(0));
        let reader: Arc<FingerprintReader> = Arc::new({
            let attempts = Arc::clone(&attempts);
            let release_receiver = Arc::clone(&release_receiver);
            move |path| {
                if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                    started_sender
                        .send(())
                        .expect("test should wait for the first batch");
                    release_receiver
                        .lock()
                        .expect("release receiver should be available")
                        .recv()
                        .expect("first batch should be released");
                }
                file_fingerprint(path)
            }
        });
        let (sender, receiver) = mpsc::channel();
        let sink: Arc<EventSink> = Arc::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        let dispatcher = InvalidationDispatcher::new(Arc::clone(&registry), sink, reader);

        dispatcher.schedule_invalidation(vec![document.clone()]);
        started_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("first batch should start");
        write(&image, "image latest");
        dispatcher.schedule_invalidation(vec![image.clone()]);
        release_sender.send(()).expect("first batch should resume");
        let document_event = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("document event should be emitted first");
        let image_event = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("image event should be emitted second");
        let registry = registry.lock().expect("registry should remain available");

        assert_eq!(document_event.kind, FileWatchEventKind::Document);
        assert_eq!(image_event.kind, FileWatchEventKind::Image);
        assert!(document_event.revision < image_event.revision);
        assert_eq!(
            registry.document_fingerprint(),
            file_fingerprint(&document).expect("document should be readable")
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn dispatcher_should_drop_a_stale_read_before_dispatching_a_newer_command_event() {
        let directory = unique_test_dir("command-worker-order");
        let document = directory.join("note.md");
        write(&document, "before");
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        registry
            .lock()
            .expect("registry should be available")
            .replace_document(&document)
            .expect("document should be registered");
        write(&document, "after");
        let (started_sender, started_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let release_receiver = Arc::new(Mutex::new(release_receiver));
        let reader: Arc<FingerprintReader> = Arc::new({
            let release_receiver = Arc::clone(&release_receiver);
            move |path| {
                started_sender
                    .send(())
                    .expect("test should wait for the worker read");
                release_receiver
                    .lock()
                    .expect("release receiver should be available")
                    .recv()
                    .expect("worker read should be released");
                file_fingerprint(path)
            }
        });
        let (sender, receiver) = mpsc::channel();
        let sink: Arc<EventSink> = Arc::new(move |event| {
            sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        let dispatcher = InvalidationDispatcher::new(Arc::clone(&registry), sink, reader);

        dispatcher.schedule_invalidation(vec![document.clone()]);
        started_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("worker read should start");
        let command_event = registry
            .lock()
            .expect("registry should be available")
            .error_event(Path::new(""));
        assert!(dispatcher.dispatch_events(vec![command_event]));
        release_sender.send(()).expect("worker should resume");
        let event = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("newer command event should be emitted");

        assert_eq!(event.kind, FileWatchEventKind::Error);
        assert!(receiver.recv_timeout(Duration::from_millis(250)).is_err());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn dispatcher_should_not_block_registry_updates_during_a_slow_read_or_emit_stale_events() {
        let old_directory = unique_test_dir("nonblocking-dispatch-old");
        let new_directory = unique_test_dir("nonblocking-dispatch-new");
        let old_document = old_directory.join("old.md");
        let new_document = new_directory.join("new.md");
        write(&old_document, "old before");
        write(&new_document, "new before");
        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        registry
            .lock()
            .expect("registry should be available")
            .replace_document(&old_document)
            .expect("old document should be registered");
        write(&old_document, "old after");

        let attempts = Arc::new(AtomicUsize::new(0));
        let (started_sender, started_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let release_receiver = Arc::new(Mutex::new(release_receiver));
        let reader: Arc<FingerprintReader> = Arc::new({
            let attempts = Arc::clone(&attempts);
            let release_receiver = Arc::clone(&release_receiver);
            move |path| {
                if attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                    started_sender
                        .send(())
                        .expect("test should wait for the first read");
                    release_receiver
                        .lock()
                        .expect("release receiver should be available")
                        .recv()
                        .expect("first read should be released");
                }
                file_fingerprint(path)
            }
        });
        let (event_sender, event_receiver) = mpsc::channel();
        let sink: Arc<EventSink> = Arc::new(move |event| {
            event_sender
                .send(event)
                .expect("test event receiver should remain connected");
        });
        let dispatcher =
            InvalidationDispatcher::new(Arc::clone(&registry), Arc::clone(&sink), reader);
        let service = Arc::new(FileWatchService::from_parts(
            Arc::clone(&registry),
            Ok(Box::new(FakeWatcherOps {
                state: Arc::new(Mutex::new(FakeWatcherState::default())),
            })),
            dispatcher.clone(),
        ));

        dispatcher.schedule_invalidation(vec![old_document.clone()]);
        started_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("slow read should start");
        let (updated_sender, updated_receiver) = mpsc::channel();
        let update_service = Arc::clone(&service);
        let update_document = new_document.clone();
        let update = std::thread::spawn(move || {
            let result = update_service.watch_document(&update_document);
            let _ = updated_sender.send(());
            result
        });
        let completed_while_read_was_blocked = updated_receiver
            .recv_timeout(Duration::from_millis(250))
            .is_ok();
        release_sender.send(()).expect("slow read should resume");
        update
            .join()
            .expect("watch update thread should finish")
            .expect("new document should be watched");

        assert!(
            completed_while_read_was_blocked,
            "a fingerprint read must not hold the registry-update dispatch lock"
        );
        write(&new_document, "new after");
        dispatcher.schedule_invalidation(vec![new_document.clone()]);
        let event = event_receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("new document change should emit an event");

        assert_eq!(event.kind, FileWatchEventKind::Document);
        assert_eq!(PathBuf::from(event.path), new_document);
        assert!(
            event_receiver
                .recv_timeout(Duration::from_millis(250))
                .is_err(),
            "the stale old-document batch must not emit after the registry changes"
        );
        drop(service);
        fs::remove_dir_all(old_directory).expect("old test directory should be removed");
        fs::remove_dir_all(new_directory).expect("new test directory should be removed");
    }

    #[test]
    fn dispatcher_should_stop_its_worker_after_the_last_sender_is_dropped() {
        struct DropNotifier(mpsc::Sender<()>);

        impl Drop for DropNotifier {
            fn drop(&mut self) {
                let _ = self.0.send(());
            }
        }

        let registry = Arc::new(Mutex::new(TargetRegistry::default()));
        let sink: Arc<EventSink> = Arc::new(|_| {});
        let (dropped_sender, dropped_receiver) = mpsc::channel();
        let notifier = DropNotifier(dropped_sender);
        let reader: Arc<FingerprintReader> = Arc::new(move |path| {
            let _keep_notifier_alive = &notifier;
            file_fingerprint(path)
        });

        let dispatcher = InvalidationDispatcher::new(registry, sink, reader);
        drop(dispatcher);

        dropped_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("worker should exit and drop its reader after the last sender");
    }
}
