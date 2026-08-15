use std::{
    collections::{BTreeSet, HashSet},
    ffi::{OsStr, OsString},
    fmt, fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    errors::AppError,
    services::{
        document_path_identity::{DocumentPathIdentity, PathIdentityError},
        file_service::write_bytes_atomically,
        open_request_lifecycle::{
            ApplyOutcome, CompletionAcknowledgementOutcome, DeliveryOwner, EnqueueOutcome,
            LeaseReleaseOutcome, LifecycleError, LifecycleSnapshot, OpenRequestId,
            OpenRequestLifecycle,
        },
    },
};

pub const OPEN_REQUESTS_AVAILABLE_EVENT: &str = "desktop-open-requests-available";
const OPEN_REQUEST_STATE_FILE_NAME: &str = "open-requests.json";
const OPEN_REQUEST_STATE_VERSION: u32 = 2;

#[derive(Debug, Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub path: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequestDelivery {
    pub request_id: String,
    pub path: String,
    pub attempt_token: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequestRecovery {
    pub request_id: String,
    pub attempt_token: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TargetedOpenRequest {
    target_window: String,
    path: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OpenRequestDocument {
    lifecycle: LifecycleSnapshot<TargetedOpenRequest>,
    next_request_id: u64,
    retained_requests: Vec<RetainedOpenRequest>,
    version: u32,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RetainedOpenRequest {
    identity: DocumentPathIdentity,
    request_id: OpenRequestId,
    payload: TargetedOpenRequest,
}

struct OpenRequestRuntime {
    lifecycle: OpenRequestLifecycle<TargetedOpenRequest>,
    next_request_id: u64,
    persistence_dirty: bool,
    retained_requests: Vec<RetainedOpenRequest>,
}

#[derive(Clone, Copy)]
enum PersistFailurePolicy {
    RollBack,
    RetainMutation,
}

pub struct OpenRequestService {
    config_dir: PathBuf,
    state: Mutex<OpenRequestRuntime>,
}

impl fmt::Debug for OpenRequestService {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OpenRequestService")
            .field("config_dir", &self.config_dir)
            .finish_non_exhaustive()
    }
}

impl OpenRequestService {
    pub fn new(config_dir: PathBuf) -> Result<Self, AppError> {
        let state = load_runtime(&config_dir)?;
        Ok(Self {
            config_dir,
            state: Mutex::new(state),
        })
    }

    pub fn enqueue_os_args(
        &self,
        target_window: &str,
        args: &[OsString],
        cwd: &Path,
    ) -> Result<bool, AppError> {
        validate_target_window(target_window)?;
        let request = parse_open_request(args, cwd)?;
        let Some(request) = request else {
            return Ok(false);
        };
        let requested_identity =
            DocumentPathIdentity::resolve(&request.path).map_err(map_query_identity_error)?;
        self.enqueue_path_for_identity(target_window, &request.path, &requested_identity)
    }

    pub(crate) fn enqueue_path_for_identity(
        &self,
        target_window: &str,
        document_path: &str,
        requested_identity: &DocumentPathIdentity,
    ) -> Result<bool, AppError> {
        validate_target_window(target_window)?;
        let lexical_identity =
            DocumentPathIdentity::lexical(document_path).map_err(map_query_identity_error)?;
        if &lexical_identity != requested_identity.lexical_alias() {
            return Err(invalid_open_request_path());
        }
        let requested_identity = requested_identity.clone();
        self.transaction(|state| {
            for retained in &state.retained_requests {
                validate_target_window(&retained.payload.target_window)?;
                if retained.payload.target_window == target_window
                    && retained.identity.overlaps(&requested_identity)
                {
                    return Ok((true, false));
                }
            }

            let request_number = state.next_request_id;
            let next_request_id = request_number
                .checked_add(1)
                .ok_or_else(request_id_exhausted)?;
            let request_id =
                OpenRequestId::new(request_number.to_string()).map_err(map_lifecycle_error)?;
            let payload = TargetedOpenRequest {
                target_window: target_window.to_owned(),
                path: document_path.to_owned(),
            };
            let outcome = state
                .lifecycle
                .enqueue(request_id.clone(), payload.clone())
                .map_err(map_lifecycle_error)?;
            if !matches!(outcome, EnqueueOutcome::Queued) {
                return Err(state_unavailable());
            }
            state.retained_requests.push(RetainedOpenRequest {
                identity: requested_identity,
                request_id,
                payload,
            });
            state.next_request_id = next_request_id;
            Ok((true, true))
        })
    }

    pub fn enqueue_utf8_args(
        &self,
        target_window: &str,
        args: &[String],
        cwd: &Path,
    ) -> Result<bool, AppError> {
        let os_args: Vec<OsString> = args.iter().map(OsString::from).collect();
        self.enqueue_os_args(target_window, &os_args, cwd)
    }

    pub fn recover_for_window(
        &self,
        window_label: &str,
    ) -> Result<Vec<OpenRequestRecovery>, AppError> {
        let owner = delivery_owner(window_label)?;
        let state = self.lock_state()?;
        Ok(state
            .lifecycle
            .pending_completion_acknowledgements()
            .map_err(map_lifecycle_error)?
            .into_iter()
            .filter(|pending| pending.owner == owner)
            .map(|pending| OpenRequestRecovery {
                request_id: pending.request_id.as_str().to_owned(),
                attempt_token: pending.attempt_token.to_canonical_decimal(),
            })
            .collect())
    }

    pub fn active_target_windows(&self) -> Result<Vec<String>, AppError> {
        let state = self.lock_state()?;
        let mut targets = BTreeSet::new();
        for retained in &state.retained_requests {
            validate_target_window(&retained.payload.target_window)
                .map_err(|_| state_unavailable())?;
            targets.insert(retained.payload.target_window.clone());
        }
        Ok(targets.into_iter().collect())
    }

    pub fn target_window_for_active_path(
        &self,
        document_path: &str,
    ) -> Result<Option<String>, AppError> {
        let query_identity =
            DocumentPathIdentity::resolve(document_path).map_err(map_query_identity_error)?;
        self.target_window_for_active_identity(&query_identity)
    }

    pub(crate) fn target_window_for_active_identity(
        &self,
        query_identity: &DocumentPathIdentity,
    ) -> Result<Option<String>, AppError> {
        let state = self.lock_state()?;
        let mut matched_target: Option<String> = None;
        for retained in &state.retained_requests {
            validate_target_window(&retained.payload.target_window)
                .map_err(|_| state_unavailable())?;
            if !query_identity.overlaps(&retained.identity) {
                continue;
            }
            match matched_target.as_deref() {
                Some(existing) if existing != retained.payload.target_window.as_str() => {
                    return Err(target_window_ambiguous());
                }
                Some(_) => {}
                None => matched_target = Some(retained.payload.target_window.clone()),
            }
        }
        Ok(matched_target)
    }

    pub fn claim_for_window(
        &self,
        window_label: &str,
    ) -> Result<Vec<OpenRequestDelivery>, AppError> {
        let owner = delivery_owner(window_label)?;
        let now = unix_time_millis()?;
        let process_lifetime_lease = u64::MAX
            .checked_sub(now)
            .filter(|duration| *duration > 0)
            .ok_or_else(state_unavailable)?;
        self.transaction(|state| {
            let recovered = state
                .lifecycle
                .recover_expired_leases(now)
                .map_err(map_lifecycle_error)?;
            let maximum = state.retained_requests.len();
            let batch = state
                .lifecycle
                .claim_or_replay_batch_matching_with_change(
                    owner,
                    maximum,
                    now,
                    process_lifetime_lease,
                    |payload| payload.target_window == window_label,
                )
                .map_err(map_lifecycle_error)?;
            let dirty = recovered > 0 || batch.newly_claimed > 0;
            let deliveries = batch
                .deliveries
                .into_iter()
                .map(|delivery| OpenRequestDelivery {
                    request_id: delivery.request_id.as_str().to_owned(),
                    path: delivery.payload.path,
                    attempt_token: delivery.attempt_token.to_canonical_decimal(),
                })
                .collect();
            Ok((deliveries, dirty))
        })
    }

    pub fn record_applied(
        &self,
        window_label: &str,
        request_id: &str,
        attempt_token: &str,
    ) -> Result<(), AppError> {
        let owner = delivery_owner(window_label)?;
        let request_sequence = parse_canonical_u64(request_id)?;
        let request_id = parse_request_id(request_id)?;
        let attempt_token = parse_attempt_token(attempt_token)?;
        self.transaction_retaining_mutation(|state| {
            let outcome = match state
                .lifecycle
                .record_applied(&request_id, &owner, &attempt_token)
            {
                Ok(outcome) => outcome,
                Err(LifecycleError::UnknownRequest { .. })
                    if state
                        .lifecycle
                        .is_acknowledged_sequence(request_sequence)
                        .map_err(map_lifecycle_error)? =>
                {
                    ApplyOutcome::AlreadyRecorded
                }
                Err(error) => return Err(map_lifecycle_error(error)),
            };
            Ok(((), matches!(outcome, ApplyOutcome::Recorded)))
        })
    }

    pub fn acknowledge(
        &self,
        window_label: &str,
        request_id: &str,
        attempt_token: &str,
    ) -> Result<(), AppError> {
        let owner = delivery_owner(window_label)?;
        let request_sequence = parse_canonical_u64(request_id)?;
        let request_id = parse_request_id(request_id)?;
        let attempt_token = parse_attempt_token(attempt_token)?;
        self.transaction(|state| {
            let outcome = match state.lifecycle.acknowledge_persisted_completion(
                &request_id,
                &owner,
                &attempt_token,
            ) {
                Ok(outcome) => outcome,
                Err(LifecycleError::UnknownRequest { .. })
                    if state
                        .lifecycle
                        .is_acknowledged_sequence(request_sequence)
                        .map_err(map_lifecycle_error)? =>
                {
                    CompletionAcknowledgementOutcome::AlreadyAcknowledged
                }
                Err(error) => return Err(map_lifecycle_error(error)),
            };
            if matches!(outcome, CompletionAcknowledgementOutcome::Acknowledged) {
                let before = state.retained_requests.len();
                state
                    .retained_requests
                    .retain(|retained| retained.request_id != request_id);
                if state.retained_requests.len().checked_add(1) != Some(before) {
                    return Err(state_unavailable());
                }
            }
            Ok((
                (),
                matches!(outcome, CompletionAcknowledgementOutcome::Acknowledged),
            ))
        })
    }

    pub fn abandon(
        &self,
        window_label: &str,
        request_id: &str,
        attempt_token: &str,
    ) -> Result<(), AppError> {
        let owner = delivery_owner(window_label)?;
        let request_id = parse_request_id(request_id)?;
        let attempt_token = parse_attempt_token(attempt_token)?;
        self.transaction(|state| {
            let outcome = state
                .lifecycle
                .abandon_delivery(&request_id, &owner, &attempt_token)
                .map_err(map_lifecycle_error)?;
            Ok(((), matches!(outcome, LeaseReleaseOutcome::Released)))
        })
    }

    pub fn release_window(&self, window_label: &str) -> Result<usize, AppError> {
        let owner = delivery_owner(window_label)?;
        self.transaction_retaining_mutation(|state| {
            let released = state
                .lifecycle
                .release_owner_leases(&owner)
                .map_err(map_lifecycle_error)?;
            Ok((released, released > 0))
        })
    }

    fn transaction<R>(
        &self,
        operation: impl FnOnce(&mut OpenRequestRuntime) -> Result<(R, bool), AppError>,
    ) -> Result<R, AppError> {
        self.transaction_with_policy(PersistFailurePolicy::RollBack, operation)
    }

    fn transaction_retaining_mutation<R>(
        &self,
        operation: impl FnOnce(&mut OpenRequestRuntime) -> Result<(R, bool), AppError>,
    ) -> Result<R, AppError> {
        self.transaction_with_policy(PersistFailurePolicy::RetainMutation, operation)
    }

    fn transaction_with_policy<R>(
        &self,
        persist_failure_policy: PersistFailurePolicy,
        operation: impl FnOnce(&mut OpenRequestRuntime) -> Result<(R, bool), AppError>,
    ) -> Result<R, AppError> {
        let mut state = self.lock_state()?;
        let before_snapshot = state.lifecycle.snapshot().map_err(map_lifecycle_error)?;
        let backup = OpenRequestLifecycle::restore_same_process(before_snapshot)
            .map_err(map_lifecycle_error)?;
        let before_next_request_id = state.next_request_id;
        let before_persistence_dirty = state.persistence_dirty;
        let before_retained_requests = state.retained_requests.clone();
        match operation(&mut state) {
            Ok((result, mutation_dirty)) => {
                if !mutation_dirty && !state.persistence_dirty {
                    return Ok(result);
                }
                if let Err(error) = persist_runtime(&self.config_dir, &state) {
                    match persist_failure_policy {
                        PersistFailurePolicy::RollBack => {
                            state.lifecycle = backup;
                            state.next_request_id = before_next_request_id;
                            state.persistence_dirty = before_persistence_dirty;
                            state.retained_requests = before_retained_requests;
                        }
                        PersistFailurePolicy::RetainMutation => {
                            state.persistence_dirty = true;
                        }
                    }
                    return Err(error);
                }
                state.persistence_dirty = false;
                Ok(result)
            }
            Err(error) => {
                state.lifecycle = backup;
                state.next_request_id = before_next_request_id;
                state.persistence_dirty = before_persistence_dirty;
                state.retained_requests = before_retained_requests;
                Err(error)
            }
        }
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, OpenRequestRuntime>, AppError> {
        self.state.lock().map_err(|_| state_unavailable())
    }
}

pub fn open_request_state_path(config_dir: &Path) -> PathBuf {
    config_dir.join(OPEN_REQUEST_STATE_FILE_NAME)
}

fn load_runtime(config_dir: &Path) -> Result<OpenRequestRuntime, AppError> {
    let path = open_request_state_path(config_dir);
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(OpenRequestRuntime {
                lifecycle: OpenRequestLifecycle::default(),
                next_request_id: 0,
                persistence_dirty: false,
                retained_requests: Vec::new(),
            });
        }
        Err(_) => return Err(state_unavailable()),
    };
    let document: OpenRequestDocument =
        serde_json::from_slice(&bytes).map_err(|_| state_unavailable())?;
    if document.version != OPEN_REQUEST_STATE_VERSION {
        return Err(state_unavailable());
    }
    let lifecycle =
        OpenRequestLifecycle::restore_cold(document.lifecycle).map_err(|_| state_unavailable())?;
    validate_loaded_runtime(
        &lifecycle,
        document.next_request_id,
        &document.retained_requests,
    )?;
    Ok(OpenRequestRuntime {
        lifecycle,
        next_request_id: document.next_request_id,
        persistence_dirty: false,
        retained_requests: document.retained_requests,
    })
}

fn validate_loaded_runtime(
    lifecycle: &OpenRequestLifecycle<TargetedOpenRequest>,
    next_request_id: u64,
    retained_requests: &[RetainedOpenRequest],
) -> Result<(), AppError> {
    let active_sequences = lifecycle
        .active_request_sequences()
        .map_err(map_lifecycle_error)?;
    let completion_sequences = lifecycle
        .recent_completion_sequences()
        .map_err(map_lifecycle_error)?;
    for (request_id, expected) in active_sequences.iter().chain(&completion_sequences) {
        let actual = parse_canonical_u64(request_id.as_str()).map_err(|_| state_unavailable())?;
        if actual != *expected {
            return Err(state_unavailable());
        }
    }
    let expected_next_request_id = lifecycle
        .sequence_high_water()
        .map_err(map_lifecycle_error)?;
    if next_request_id != expected_next_request_id {
        return Err(state_unavailable());
    }
    let mut retained_ids = HashSet::with_capacity(retained_requests.len());
    let mut retained_identities = HashSet::with_capacity(retained_requests.len().saturating_mul(2));
    for retained in retained_requests {
        if !retained_ids.insert(retained.request_id.clone()) {
            return Err(state_unavailable());
        }
        validate_target_window(&retained.payload.target_window).map_err(|_| state_unavailable())?;
        let lexical_identity = DocumentPathIdentity::lexical(&retained.payload.path)
            .map_err(|_| state_unavailable())?;
        if &lexical_identity != retained.identity.lexical_alias() {
            return Err(state_unavailable());
        }
        let target_window = retained.payload.target_window.clone();
        let mut keys = vec![retained.identity.lexical_alias().clone()];
        if retained.identity.resolved() != retained.identity.lexical_alias() {
            keys.push(retained.identity.resolved().clone());
        }
        if keys.iter().any(|identity| {
            retained_identities.contains(&(target_window.clone(), identity.clone()))
        }) {
            return Err(state_unavailable());
        }
        retained_identities.extend(
            keys.into_iter()
                .map(|identity| (target_window.clone(), identity)),
        );
    }
    let active = lifecycle.active_requests().map_err(map_lifecycle_error)?;
    for request in &active {
        let retained = retained_requests
            .iter()
            .find(|retained| retained.request_id == request.request_id)
            .ok_or_else(state_unavailable)?;
        if retained.payload != request.payload {
            return Err(state_unavailable());
        }
    }
    let pending = lifecycle
        .pending_completion_acknowledgements()
        .map_err(map_lifecycle_error)?;
    if pending.iter().any(|request| {
        !retained_requests.iter().any(|retained| {
            retained.request_id == request.request_id
                && retained.payload.target_window == request.owner.as_str()
        })
    }) || active.len().checked_add(pending.len()) != Some(retained_requests.len())
    {
        return Err(state_unavailable());
    }
    if retained_requests.iter().any(|retained| {
        !active
            .iter()
            .any(|request| request.request_id == retained.request_id)
            && !pending
                .iter()
                .any(|request| request.request_id == retained.request_id)
    }) {
        return Err(state_unavailable());
    }
    Ok(())
}

fn persist_runtime(config_dir: &Path, state: &OpenRequestRuntime) -> Result<(), AppError> {
    fs::create_dir_all(config_dir).map_err(|_| persist_failed())?;
    let document = OpenRequestDocument {
        lifecycle: state.lifecycle.snapshot().map_err(map_lifecycle_error)?,
        next_request_id: state.next_request_id,
        retained_requests: state.retained_requests.clone(),
        version: OPEN_REQUEST_STATE_VERSION,
    };
    let bytes = serde_json::to_vec_pretty(&document).map_err(|_| persist_failed())?;
    write_bytes_atomically(&open_request_state_path(config_dir), &bytes)
        .map_err(|_| persist_failed())
}

fn delivery_owner(window_label: &str) -> Result<DeliveryOwner, AppError> {
    validate_target_window(window_label)?;
    DeliveryOwner::new(window_label.to_owned()).map_err(map_lifecycle_error)
}

fn validate_target_window(window_label: &str) -> Result<(), AppError> {
    if window_label.trim().is_empty() || window_label.contains('\0') {
        Err(AppError::new(
            "desktop.open_request_invalid_window",
            "Desktop open request window is invalid.",
            false,
        ))
    } else {
        Ok(())
    }
}

fn parse_request_id(value: &str) -> Result<OpenRequestId, AppError> {
    parse_canonical_u64(value)?;
    OpenRequestId::new(value.to_owned()).map_err(map_lifecycle_error)
}

fn parse_attempt_token(
    value: &str,
) -> Result<crate::services::open_request_lifecycle::DeliveryAttemptToken, AppError> {
    crate::services::open_request_lifecycle::DeliveryAttemptToken::from_canonical_decimal(value)
        .map_err(map_lifecycle_error)
}

fn parse_canonical_u64(value: &str) -> Result<u64, AppError> {
    let is_canonical = value == "0"
        || value
            .as_bytes()
            .first()
            .is_some_and(|first| (b'1'..=b'9').contains(first))
            && value.as_bytes()[1..]
                .iter()
                .all(|byte| byte.is_ascii_digit());
    if !is_canonical {
        return Err(invalid_request_id());
    }
    value.parse::<u64>().map_err(|_| invalid_request_id())
}

fn unix_time_millis() -> Result<u64, AppError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| state_unavailable())?
        .as_millis();
    u64::try_from(millis).map_err(|_| state_unavailable())
}

fn map_lifecycle_error(error: LifecycleError) -> AppError {
    match error {
        LifecycleError::InvalidRequestId => invalid_request_id(),
        LifecycleError::InvalidAttemptToken => AppError::new(
            "desktop.open_request_invalid_attempt_token",
            "Desktop open request attempt token is invalid.",
            false,
        ),
        LifecycleError::InvalidDeliveryOwner => AppError::new(
            "desktop.open_request_invalid_window",
            "Desktop open request window is invalid.",
            false,
        ),
        LifecycleError::UnknownRequest { .. } => AppError::new(
            "desktop.open_request_unknown",
            "Desktop open request is unknown.",
            true,
        ),
        LifecycleError::OwnerMismatch { .. } => AppError::new(
            "desktop.open_request_owner_mismatch",
            "Desktop open request belongs to another window.",
            true,
        ),
        LifecycleError::AttemptMismatch { .. } => AppError::new(
            "desktop.open_request_attempt_stale",
            "Desktop open request attempt is stale.",
            true,
        ),
        LifecycleError::InvalidTransition { .. } => AppError::new(
            "desktop.open_request_invalid_transition",
            "Desktop open request transition is invalid.",
            true,
        ),
        LifecycleError::SequenceExhausted | LifecycleError::AttemptSequenceExhausted => {
            request_id_exhausted()
        }
        LifecycleError::InvalidLeaseDuration
        | LifecycleError::LogicalTimeOverflow
        | LifecycleError::LockPoisoned
        | LifecycleError::CorruptRegistry
        | LifecycleError::InvalidSnapshot { .. } => state_unavailable(),
    }
}

fn invalid_request_id() -> AppError {
    AppError::new(
        "desktop.open_request_invalid_request_id",
        "Desktop open request id is invalid.",
        false,
    )
}

fn invalid_open_request_path() -> AppError {
    AppError::new(
        "desktop.open_request_invalid_path",
        "Desktop open request path is invalid.",
        false,
    )
}

fn map_query_identity_error(error: PathIdentityError) -> AppError {
    match error {
        PathIdentityError::InvalidPath => invalid_open_request_path(),
        PathIdentityError::Unavailable => path_identity_unavailable(),
    }
}

fn path_identity_unavailable() -> AppError {
    AppError::new(
        "desktop.open_request_path_identity_unavailable",
        "Desktop open request path identity is unavailable.",
        true,
    )
}

fn target_window_ambiguous() -> AppError {
    AppError::new(
        "desktop.open_request_target_ambiguous",
        "Desktop open request path belongs to multiple target windows.",
        false,
    )
}

fn request_id_exhausted() -> AppError {
    AppError::new(
        "desktop.open_request_id_exhausted",
        "Desktop open request id space is exhausted.",
        false,
    )
}

fn state_unavailable() -> AppError {
    AppError::new(
        "desktop.open_request_state_unavailable",
        "Desktop open request state is unavailable.",
        false,
    )
}

fn persist_failed() -> AppError {
    AppError::new(
        "desktop.open_request_persist_failed",
        "Desktop open request state could not be persisted.",
        true,
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    use std::process::Command;

    fn unique_test_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be available")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("lumamark-open-request-unit-{name}-{nanos}"));
        fs::create_dir_all(&path).expect("test directory should be created");
        path
    }

    fn launch_args(path: &Path) -> Vec<OsString> {
        vec![OsString::from("LumaMark.exe"), path.as_os_str().to_owned()]
    }

    #[cfg(windows)]
    fn create_directory_alias(target: &Path, alias: &Path) {
        if std::os::windows::fs::symlink_dir(target, alias).is_ok() {
            return;
        }
        let output = Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(alias)
            .arg(target)
            .output()
            .expect("junction creation should launch");
        assert!(
            output.status.success(),
            "junction creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[cfg(unix)]
    fn create_directory_alias(target: &Path, alias: &Path) {
        std::os::unix::fs::symlink(target, alias).expect("directory symlink should be created");
    }

    #[test]
    fn active_path_query_resolves_only_the_target_when_unrelated_alias_is_offline() {
        let config_dir = unique_test_dir("single-resolution");
        let offline_real_directory = config_dir.join("offline-real");
        let offline_alias_directory = config_dir.join("offline-alias");
        fs::create_dir_all(&offline_real_directory).expect("real directory should exist");
        create_directory_alias(&offline_real_directory, &offline_alias_directory);
        let offline_real_path = offline_real_directory.join("offline.md");
        let offline_alias_path = offline_alias_directory.join("offline.md");
        fs::write(&offline_real_path, "offline").expect("offline document should exist");

        let stable_path = config_dir.join("stable.md");
        let unmatched_path = config_dir.join("unmatched.md");
        fs::write(&stable_path, "stable").expect("stable document should exist");
        let service = OpenRequestService::new(config_dir.clone())
            .expect("empty durable service should initialize");
        service
            .enqueue_os_args(
                "window-offline",
                &launch_args(&offline_alias_path),
                &config_dir,
            )
            .expect("offline request should persist");
        service
            .enqueue_os_args("window-stable", &launch_args(&stable_path), &config_dir)
            .expect("stable request should persist");

        #[cfg(windows)]
        fs::remove_dir(&offline_alias_directory).expect("junction should be removable");
        #[cfg(unix)]
        fs::remove_file(&offline_alias_directory).expect("symlink should be removable");

        DocumentPathIdentity::reset_resolution_attempts();
        assert_eq!(
            service
                .target_window_for_active_path(
                    stable_path.to_str().expect("stable path should be Unicode")
                )
                .expect("offline unrelated identity must not block a match"),
            Some("window-stable".to_owned())
        );
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 1);

        let stable_identity = DocumentPathIdentity::resolve(
            stable_path.to_str().expect("stable path should be Unicode"),
        )
        .expect("stable identity should resolve");
        DocumentPathIdentity::reset_resolution_attempts();
        assert_eq!(
            service
                .target_window_for_active_identity(&stable_identity)
                .expect("identity lookup should scan only the stored index"),
            Some("window-stable".to_owned())
        );
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);

        DocumentPathIdentity::reset_resolution_attempts();
        assert!(service
            .enqueue_path_for_identity(
                "window-stable",
                stable_path.to_str().expect("stable path should be Unicode"),
                &stable_identity,
            )
            .expect("identity-aware duplicate enqueue should be idempotent"));
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);
        let mismatch = service
            .enqueue_path_for_identity(
                "window-stable",
                unmatched_path
                    .to_str()
                    .expect("unmatched path should be Unicode"),
                &stable_identity,
            )
            .expect_err("identity-aware enqueue must reject a mismatched path");
        assert_eq!(mismatch.code, "desktop.open_request_invalid_path");
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);

        DocumentPathIdentity::reset_resolution_attempts();
        assert_eq!(
            service
                .target_window_for_active_path(
                    unmatched_path
                        .to_str()
                        .expect("unmatched path should be Unicode")
                )
                .expect("offline unrelated identity must not block a miss"),
            None
        );
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 1);
    }
}
