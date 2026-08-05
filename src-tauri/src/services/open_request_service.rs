use std::{
    collections::VecDeque,
    ffi::{OsStr, OsString},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use serde::Serialize;

use crate::errors::AppError;

pub const OPEN_REQUESTS_AVAILABLE_EVENT: &str = "desktop-open-requests-available";

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub path: String,
}

#[derive(Default)]
pub struct OpenRequestQueue {
    state: Mutex<OpenRequestQueueState>,
}

#[derive(Default)]
struct OpenRequestQueueState {
    pending_error: Option<AppError>,
    requests: VecDeque<QueuedOpenRequest>,
}

struct QueuedOpenRequest {
    identity: OpenRequestIdentity,
    request: OpenRequest,
}

#[derive(Eq, PartialEq)]
struct OpenRequestIdentity(String);

impl OpenRequestIdentity {
    fn from_path(path: &str) -> Self {
        #[cfg(windows)]
        let value = path.to_lowercase();

        #[cfg(not(windows))]
        let value = path.to_owned();

        Self(value)
    }
}

impl OpenRequestQueue {
    pub fn enqueue_os_args(&self, args: &[OsString], cwd: &Path) -> Result<bool, AppError> {
        let request = match parse_open_request(args, cwd) {
            Ok(request) => request,
            Err(error) => {
                self.state
                    .lock()
                    .map_err(|_| AppError::open_request_queue_unavailable())?
                    .pending_error = Some(error.clone());
                return Err(error);
            }
        };
        let Some(request) = request else {
            return Ok(false);
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::open_request_queue_unavailable())?;
        let identity = OpenRequestIdentity::from_path(&request.path);
        if state
            .requests
            .iter()
            .any(|queued| queued.identity == identity)
        {
            return Ok(false);
        }
        state
            .requests
            .push_back(QueuedOpenRequest { identity, request });
        Ok(true)
    }

    pub fn enqueue_utf8_args(&self, args: &[String], cwd: &Path) -> Result<bool, AppError> {
        let os_args: Vec<OsString> = args.iter().map(OsString::from).collect();
        self.enqueue_os_args(&os_args, cwd)
    }

    pub fn drain(&self) -> Result<Vec<OpenRequest>, AppError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| AppError::open_request_queue_unavailable())?;
        if let Some(error) = state.pending_error.take() {
            return Err(error);
        }
        Ok(state
            .requests
            .drain(..)
            .map(|queued| queued.request)
            .collect())
    }
}

pub fn parse_open_request(args: &[OsString], cwd: &Path) -> Result<Option<OpenRequest>, AppError> {
    let Some(path) = args
        .iter()
        .skip(1)
        .map(OsString::as_os_str)
        .map(os_path)
        .find(|path| !is_flag(path) && is_markdown_path(path))
    else {
        return Ok(None);
    };

    let resolved = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    let normalized = normalize_lexically(&resolved);
    let serialized = normalized
        .to_str()
        .ok_or_else(AppError::open_request_path_not_utf8)?;

    Ok(Some(OpenRequest {
        path: serialized.to_owned(),
    }))
}

fn os_path(path: &OsStr) -> &Path {
    Path::new(path)
}

fn is_flag(path: &Path) -> bool {
    path.as_os_str()
        .to_str()
        .is_some_and(|argument| argument.starts_with('-'))
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown"
            )
        })
}

fn normalize_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}
