use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::{
    errors::AppError,
    services::document_claim_service::{
        BeginSessionOutcome, ClaimError, ClaimOperation, CommitOutcome, DocumentClaimService,
        ReleaseOperationOutcome, ReleaseOwnedOutcome, ReserveOutcome, SessionTakeoverOutcome,
    },
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentClaimCommandError {
    code: String,
    message: String,
    recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<DocumentClaimCommandErrorDetails>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentClaimCommandErrorDetails {
    active_generation: u64,
}

impl DocumentClaimCommandError {
    fn new(code: &str, message: &str, recoverable: bool) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
            recoverable,
            details: None,
        }
    }

    fn with_active_generation(code: &str, message: &str, active_generation: u64) -> Self {
        Self {
            code: code.to_owned(),
            message: message.to_owned(),
            recoverable: true,
            details: Some(DocumentClaimCommandErrorDetails { active_generation }),
        }
    }

    fn service_unavailable() -> Self {
        Self::new(
            "document_claim.service_unavailable",
            "Document claim service is unavailable.",
            true,
        )
    }

    fn task_failed() -> Self {
        Self::new(
            "document_claim.task_failed",
            "Document claim operation failed.",
            true,
        )
    }
}

impl From<ClaimError> for DocumentClaimCommandError {
    fn from(error: ClaimError) -> Self {
        match error {
            ClaimError::InvalidPath => Self::new(
                "document_claim.invalid_path",
                "Document path is invalid.",
                false,
            ),
            ClaimError::EmptyWindowLabel => Self::new(
                "document_claim.invalid_window",
                "Document claim window is invalid.",
                false,
            ),
            ClaimError::EmptySessionId => Self::new(
                "document_claim.invalid_session_id",
                "Document claim session id is required.",
                false,
            ),
            ClaimError::InvalidOperationId => Self::new(
                "document_claim.invalid_operation_id",
                "Document claim operation id must be a positive safe integer.",
                false,
            ),
            ClaimError::LockPoisoned => Self::new(
                "document_claim.registry_unavailable",
                "Document claim registry is unavailable.",
                true,
            ),
            ClaimError::TokenSpaceExhausted => Self::new(
                "document_claim.token_space_exhausted",
                "Document claim token space is exhausted.",
                false,
            ),
            ClaimError::StaleToken => Self::new(
                "document_claim.stale_operation",
                "Document claim operation is stale.",
                true,
            ),
            ClaimError::OperationPathMismatch => Self::new(
                "document_claim.operation_path_mismatch",
                "Document claim operation is bound to another path.",
                false,
            ),
            ClaimError::PathIdentityUnavailable => Self::new(
                "document_claim.path_identity_unavailable",
                "Document path identity is unavailable.",
                true,
            ),
            ClaimError::TokenOwnerMismatch { .. } => Self::new(
                "document_claim.owner_mismatch",
                "Document claim belongs to another window.",
                true,
            ),
            ClaimError::TokenSessionMismatch => Self::new(
                "document_claim.session_mismatch",
                "Document claim belongs to another session.",
                true,
            ),
            ClaimError::OwnedByOtherWindow { .. } => Self::new(
                "document_claim.owned_by_other_window",
                "Document is owned by another window.",
                true,
            ),
            ClaimError::InvalidSessionGeneration => Self::new(
                "document_claim.invalid_session_generation",
                "Document claim session generation must be a positive safe integer.",
                false,
            ),
            ClaimError::SessionGenerationExhausted => Self::new(
                "document_claim.session_generation_exhausted",
                "Document claim session generation space is exhausted.",
                false,
            ),
            ClaimError::SessionAlreadyActive { active_generation } => Self::with_active_generation(
                "document_claim.session_already_active",
                "Another document claim session is already active.",
                active_generation,
            ),
            ClaimError::SessionGenerationMismatch { active_generation } => {
                Self::with_active_generation(
                    "document_claim.session_generation_mismatch",
                    "Document claim session generation is stale.",
                    active_generation,
                )
            }
            ClaimError::InactiveSession => Self::new(
                "document_claim.inactive_session",
                "Document claim session is not active.",
                true,
            ),
            ClaimError::AmbiguousPathIdentity => Self::new(
                "document_claim.ambiguous_path_identity",
                "Document path identity conflicts with multiple active claims.",
                true,
            ),
            ClaimError::PathIdentityChanged => Self::new(
                "document_claim.path_identity_changed",
                "Document path identity changed during the operation.",
                true,
            ),
        }
    }
}

pub(crate) fn claim_error_to_app_error(error: ClaimError) -> AppError {
    let error = DocumentClaimCommandError::from(error);
    AppError::new(error.code, error.message, error.recoverable)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DocumentClaimSessionStartResponse {
    #[serde(rename = "began")]
    Began {
        #[serde(rename = "sessionGeneration")]
        session_generation: u64,
    },
    #[serde(rename = "alreadyActive")]
    AlreadyActive {
        #[serde(rename = "sessionGeneration")]
        session_generation: u64,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DocumentClaimSessionTakeoverResponse {
    #[serde(rename = "takenOver")]
    TakenOver {
        #[serde(rename = "sessionGeneration")]
        session_generation: u64,
        #[serde(rename = "releasedReservations")]
        released_reservations: usize,
    },
    #[serde(rename = "alreadyActive")]
    AlreadyActive {
        #[serde(rename = "sessionGeneration")]
        session_generation: u64,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DocumentClaimSessionReleaseResponse {
    #[serde(rename = "released")]
    Released {
        #[serde(rename = "releasedReservations")]
        released_reservations: usize,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DocumentClaimReserveResponse {
    #[serde(rename = "reserved")]
    Reserved,
    #[serde(rename = "alreadyPending")]
    AlreadyPending,
    #[serde(rename = "alreadyReleased")]
    AlreadyReleased,
    #[serde(rename = "alreadyOwned")]
    AlreadyOwned,
    #[serde(rename = "ownedBy")]
    OwnedBy {
        #[serde(rename = "windowLabel")]
        window_label: String,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DocumentClaimCommitResponse {
    #[serde(rename = "committed")]
    Committed,
    #[serde(rename = "alreadyCommitted")]
    AlreadyCommitted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DocumentClaimReleaseResponse {
    #[serde(rename = "released")]
    Released,
    #[serde(rename = "alreadyReleased")]
    AlreadyReleased,
    #[serde(rename = "alreadyCommitted")]
    AlreadyCommitted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DocumentClaimOwnedReleaseResponse {
    #[serde(rename = "released")]
    Released,
    #[serde(rename = "notOwned")]
    NotOwned,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status")]
pub enum DesktopFocusWindowResponse {
    #[serde(rename = "focused")]
    Focused,
}

pub(crate) trait WindowFocusTarget {
    type Error;

    fn unminimize(&self) -> Result<(), Self::Error>;
    fn show(&self) -> Result<(), Self::Error>;
    fn set_focus(&self) -> Result<(), Self::Error>;
}

impl<R: tauri::Runtime> WindowFocusTarget for WebviewWindow<R> {
    type Error = tauri::Error;

    fn unminimize(&self) -> Result<(), Self::Error> {
        WebviewWindow::unminimize(self)
    }

    fn show(&self) -> Result<(), Self::Error> {
        WebviewWindow::show(self)
    }

    fn set_focus(&self) -> Result<(), Self::Error> {
        WebviewWindow::set_focus(self)
    }
}

pub(crate) fn focus_existing_window<T: WindowFocusTarget>(
    target: Option<&T>,
) -> Result<DesktopFocusWindowResponse, AppError> {
    let target = target.ok_or_else(|| {
        AppError::new(
            "desktop.window_not_found",
            "Desktop window was not found.",
            true,
        )
    })?;
    target.show().map_err(|_| focus_window_failed())?;
    target.unminimize().map_err(|_| focus_window_failed())?;
    target.set_focus().map_err(|_| focus_window_failed())?;
    Ok(DesktopFocusWindowResponse::Focused)
}

fn focus_window_failed() -> AppError {
    AppError::new(
        "desktop.window_focus_failed",
        "Desktop window could not be focused.",
        true,
    )
}

pub(crate) fn begin_session_for_window(
    service: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
) -> Result<DocumentClaimSessionStartResponse, DocumentClaimCommandError> {
    service
        .begin_session(window_label, session_id)
        .map(|outcome| match outcome {
            BeginSessionOutcome::Began { session_generation } => {
                DocumentClaimSessionStartResponse::Began { session_generation }
            }
            BeginSessionOutcome::AlreadyActive { session_generation } => {
                DocumentClaimSessionStartResponse::AlreadyActive { session_generation }
            }
        })
        .map_err(DocumentClaimCommandError::from)
}

pub(crate) fn takeover_session_for_window(
    service: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
    expected_active_generation: u64,
) -> Result<DocumentClaimSessionTakeoverResponse, DocumentClaimCommandError> {
    service
        .takeover_session(window_label, session_id, expected_active_generation)
        .map(|outcome| match outcome {
            SessionTakeoverOutcome::TakenOver {
                session_generation,
                released_reservations,
            } => DocumentClaimSessionTakeoverResponse::TakenOver {
                session_generation,
                released_reservations,
            },
            SessionTakeoverOutcome::AlreadyActive { session_generation } => {
                DocumentClaimSessionTakeoverResponse::AlreadyActive { session_generation }
            }
        })
        .map_err(DocumentClaimCommandError::from)
}

pub(crate) fn release_session_for_window(
    service: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
) -> Result<DocumentClaimSessionReleaseResponse, DocumentClaimCommandError> {
    service
        .release_session(window_label, session_id)
        .map(|outcome| DocumentClaimSessionReleaseResponse::Released {
            released_reservations: outcome.released_reservations,
        })
        .map_err(DocumentClaimCommandError::from)
}

pub(crate) fn reserve_for_window(
    service: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
    operation_id: u64,
    path: &str,
) -> Result<DocumentClaimReserveResponse, DocumentClaimCommandError> {
    service
        .reserve(
            window_label,
            ClaimOperation::new(session_id, operation_id),
            path,
        )
        .map(|outcome| match outcome {
            ReserveOutcome::Reserved { .. } => DocumentClaimReserveResponse::Reserved,
            ReserveOutcome::AlreadyPending => DocumentClaimReserveResponse::AlreadyPending,
            ReserveOutcome::AlreadyReleased => DocumentClaimReserveResponse::AlreadyReleased,
            ReserveOutcome::AlreadyOwned => DocumentClaimReserveResponse::AlreadyOwned,
            ReserveOutcome::OwnedBy { window_label } => {
                DocumentClaimReserveResponse::OwnedBy { window_label }
            }
        })
        .map_err(DocumentClaimCommandError::from)
}

pub(crate) fn commit_for_window(
    service: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
    operation_id: u64,
    path: &str,
) -> Result<DocumentClaimCommitResponse, DocumentClaimCommandError> {
    service
        .commit_operation(window_label, session_id, operation_id, path)
        .map(|outcome| match outcome {
            CommitOutcome::Committed => DocumentClaimCommitResponse::Committed,
            CommitOutcome::AlreadyCommitted => DocumentClaimCommitResponse::AlreadyCommitted,
        })
        .map_err(DocumentClaimCommandError::from)
}

pub(crate) fn release_for_window(
    service: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
    operation_id: u64,
    path: &str,
) -> Result<DocumentClaimReleaseResponse, DocumentClaimCommandError> {
    service
        .release_operation(window_label, session_id, operation_id, path)
        .map(|outcome| match outcome {
            ReleaseOperationOutcome::Released => DocumentClaimReleaseResponse::Released,
            ReleaseOperationOutcome::AlreadyReleased => {
                DocumentClaimReleaseResponse::AlreadyReleased
            }
            ReleaseOperationOutcome::AlreadyCommitted => {
                DocumentClaimReleaseResponse::AlreadyCommitted
            }
        })
        .map_err(DocumentClaimCommandError::from)
}

pub(crate) fn release_owned_for_window(
    service: &DocumentClaimService,
    window_label: &str,
    session_id: &str,
    path: &str,
) -> Result<DocumentClaimOwnedReleaseResponse, DocumentClaimCommandError> {
    service
        .release_owned(window_label, session_id, path)
        .map(|outcome| match outcome {
            ReleaseOwnedOutcome::Released => DocumentClaimOwnedReleaseResponse::Released,
            ReleaseOwnedOutcome::NotOwned => DocumentClaimOwnedReleaseResponse::NotOwned,
        })
        .map_err(DocumentClaimCommandError::from)
}

async fn run_claim_command<T, F>(app: AppHandle, command: F) -> Result<T, DocumentClaimCommandError>
where
    T: Send + 'static,
    F: FnOnce(&DocumentClaimService) -> Result<T, DocumentClaimCommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let service = app
            .try_state::<DocumentClaimService>()
            .ok_or_else(DocumentClaimCommandError::service_unavailable)?;
        command(service.inner())
    })
    .await
    .map_err(|_| DocumentClaimCommandError::task_failed())?
}

#[tauri::command(rename_all = "camelCase")]
pub fn desktop_focus_window(
    app: AppHandle,
    window: WebviewWindow,
    target_window_label: String,
) -> Result<DesktopFocusWindowResponse, AppError> {
    let _caller_window_label = window.label();
    if target_window_label.trim().is_empty() || target_window_label.contains('\0') {
        return Err(AppError::new(
            "desktop.window_invalid_target",
            "Desktop window target is invalid.",
            false,
        ));
    }
    let target = app.get_webview_window(&target_window_label);
    focus_existing_window(target.as_ref())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn document_claim_begin_session(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
) -> Result<DocumentClaimSessionStartResponse, DocumentClaimCommandError> {
    let window_label = window.label().to_owned();
    run_claim_command(app, move |service| {
        begin_session_for_window(service, &window_label, &session_id)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn document_claim_takeover_session(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    expected_active_generation: u64,
) -> Result<DocumentClaimSessionTakeoverResponse, DocumentClaimCommandError> {
    let window_label = window.label().to_owned();
    run_claim_command(app, move |service| {
        takeover_session_for_window(
            service,
            &window_label,
            &session_id,
            expected_active_generation,
        )
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn document_claim_release_session(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
) -> Result<DocumentClaimSessionReleaseResponse, DocumentClaimCommandError> {
    let window_label = window.label().to_owned();
    run_claim_command(app, move |service| {
        release_session_for_window(service, &window_label, &session_id)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn document_claim_reserve(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    operation_id: u64,
    path: String,
) -> Result<DocumentClaimReserveResponse, DocumentClaimCommandError> {
    let window_label = window.label().to_owned();
    run_claim_command(app, move |service| {
        reserve_for_window(service, &window_label, &session_id, operation_id, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn document_claim_commit(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    operation_id: u64,
    path: String,
) -> Result<DocumentClaimCommitResponse, DocumentClaimCommandError> {
    let window_label = window.label().to_owned();
    run_claim_command(app, move |service| {
        commit_for_window(service, &window_label, &session_id, operation_id, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn document_claim_release(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    operation_id: u64,
    path: String,
) -> Result<DocumentClaimReleaseResponse, DocumentClaimCommandError> {
    let window_label = window.label().to_owned();
    run_claim_command(app, move |service| {
        release_for_window(service, &window_label, &session_id, operation_id, &path)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn document_claim_release_owned(
    app: AppHandle,
    window: WebviewWindow,
    session_id: String,
    path: String,
) -> Result<DocumentClaimOwnedReleaseResponse, DocumentClaimCommandError> {
    let window_label = window.label().to_owned();
    run_claim_command(app, move |service| {
        release_owned_for_window(service, &window_label, &session_id, &path)
    })
    .await
}
