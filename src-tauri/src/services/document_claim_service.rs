use std::{
    collections::HashMap,
    error::Error,
    ffi::OsString,
    fmt, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
};

use super::document_path_identity::{DocumentPathIdentity, PathIdentityError, PathIdentityKey};

static NEXT_SERVICE_ID: AtomicU64 = AtomicU64::new(1);
const MAX_SAFE_SESSION_GENERATION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, Eq, PartialEq)]
pub struct ClaimToken {
    key: ClaimTokenKey,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub struct ClaimOperation<'a> {
    session_id: &'a str,
    operation_id: u64,
}

impl<'a> ClaimOperation<'a> {
    pub const fn new(session_id: &'a str, operation_id: u64) -> Self {
        Self {
            session_id,
            operation_id,
        }
    }
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
struct ClaimTokenKey {
    service_id: u64,
    sequence: u64,
}

impl fmt::Debug for ClaimToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_tuple("ClaimToken")
            .field(&"[opaque]")
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReserveOutcome {
    Reserved { token: ClaimToken },
    AlreadyPending,
    AlreadyReleased,
    AlreadyOwned,
    OwnedBy { window_label: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitOutcome {
    Committed,
    AlreadyCommitted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReleaseOutcome {
    Released,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReleaseOperationOutcome {
    Released,
    AlreadyReleased,
    AlreadyCommitted,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OperationPathValidationOutcome {
    Validated,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BeginSessionOutcome {
    Began { session_generation: u64 },
    AlreadyActive { session_generation: u64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionTakeoverOutcome {
    TakenOver {
        session_generation: u64,
        released_reservations: usize,
    },
    AlreadyActive {
        session_generation: u64,
    },
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct SessionReleaseOutcome {
    pub released_reservations: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReleaseOwnedOutcome {
    Released,
    NotOwned,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DocumentClaimPathOwner {
    Pending { window_label: String },
    Owned { window_label: String },
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ReleasedWindowClaims {
    pub reservations: usize,
    pub owned_documents: usize,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaimError {
    InvalidPath,
    EmptyWindowLabel,
    EmptySessionId,
    InvalidOperationId,
    LockPoisoned,
    TokenSpaceExhausted,
    StaleToken,
    OperationPathMismatch,
    PathIdentityUnavailable,
    TokenOwnerMismatch { owned_by: String },
    TokenSessionMismatch,
    OwnedByOtherWindow { owned_by: String },
    InvalidSessionGeneration,
    SessionGenerationExhausted,
    SessionAlreadyActive { active_generation: u64 },
    SessionGenerationMismatch { active_generation: u64 },
    InactiveSession,
    AmbiguousPathIdentity,
    PathIdentityChanged,
}

impl fmt::Display for ClaimError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPath => formatter.write_str("document claim path is invalid"),
            Self::EmptyWindowLabel => formatter.write_str("document claim window label is empty"),
            Self::EmptySessionId => formatter.write_str("document claim session id is empty"),
            Self::InvalidOperationId => {
                formatter.write_str("document claim operation id must be nonzero")
            }
            Self::LockPoisoned => formatter.write_str("document claim registry lock is poisoned"),
            Self::TokenSpaceExhausted => {
                formatter.write_str("document claim token space is exhausted")
            }
            Self::StaleToken => formatter.write_str("document claim token is stale"),
            Self::OperationPathMismatch => {
                formatter.write_str("document claim operation is already reserved for another path")
            }
            Self::PathIdentityUnavailable => {
                formatter.write_str("document path identity is unavailable")
            }
            Self::TokenOwnerMismatch { owned_by } => {
                write!(
                    formatter,
                    "document claim token belongs to window `{owned_by}`"
                )
            }
            Self::TokenSessionMismatch => {
                formatter.write_str("document claim token belongs to another caller session")
            }
            Self::OwnedByOtherWindow { owned_by } => {
                write!(
                    formatter,
                    "document ownership belongs to window `{owned_by}`"
                )
            }
            Self::InvalidSessionGeneration => {
                formatter.write_str("document claim session generation is invalid")
            }
            Self::SessionGenerationExhausted => {
                formatter.write_str("document claim session generation space is exhausted")
            }
            Self::SessionAlreadyActive { .. } => {
                formatter.write_str("another document claim session is already active")
            }
            Self::SessionGenerationMismatch { .. } => {
                formatter.write_str("document claim session generation is stale")
            }
            Self::InactiveSession => formatter.write_str("document claim session is not active"),
            Self::AmbiguousPathIdentity => {
                formatter.write_str("document path identities resolve to different active claims")
            }
            Self::PathIdentityChanged => {
                formatter.write_str("document path identity changed after reservation")
            }
        }
    }
}

impl Error for ClaimError {}

impl From<PathIdentityError> for ClaimError {
    fn from(error: PathIdentityError) -> Self {
        match error {
            PathIdentityError::InvalidPath => Self::InvalidPath,
            PathIdentityError::Unavailable => Self::PathIdentityUnavailable,
        }
    }
}

pub struct DocumentClaimService {
    service_id: u64,
    state: Mutex<ClaimRegistry>,
}

#[derive(Default)]
struct ClaimRegistry {
    claims: HashMap<ClaimTokenKey, ClaimRecord>,
    identity_claims: HashMap<PathIdentityKey, ClaimTokenKey>,
    operation_states: HashMap<OperationKey, OperationState>,
    active_sessions: HashMap<String, ActiveSession>,
    next_sequence: u64,
    next_session_generation: u64,
}

struct ActiveSession {
    session_id: String,
    generation: u64,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct OperationKey {
    window_label: String,
    session_id: String,
    operation_id: u64,
}

struct ClaimRecord {
    identity: DocumentPathIdentity,
    state: ClaimState,
}

enum OperationState {
    Active { claim_id: ClaimTokenKey },
    Released { lexical_alias: PathIdentityKey },
}

enum ClaimState {
    Reserved {
        window_label: String,
        session_id: String,
        operation_id: u64,
    },
    Owned {
        window_label: String,
        session_id: String,
        operation_id: Option<u64>,
    },
}

impl DocumentClaimService {
    pub fn new() -> Result<Self, ClaimError> {
        let service_id = NEXT_SERVICE_ID
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| ClaimError::TokenSpaceExhausted)?;

        Ok(Self {
            service_id,
            state: Mutex::new(ClaimRegistry {
                next_sequence: 1,
                next_session_generation: 1,
                ..ClaimRegistry::default()
            }),
        })
    }

    pub fn begin_session(
        &self,
        window_label: &str,
        session_id: &str,
    ) -> Result<BeginSessionOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        let mut registry = self.lock_registry()?;
        match registry.active_sessions.get(window_label) {
            Some(active_session) if active_session.session_id == session_id => {
                Ok(BeginSessionOutcome::AlreadyActive {
                    session_generation: active_session.generation,
                })
            }
            Some(active_session) => Err(ClaimError::SessionAlreadyActive {
                active_generation: active_session.generation,
            }),
            None => {
                let session_generation = allocate_session_generation(&mut registry)?;
                remove_operations_for_other_sessions(&mut registry, window_label, session_id);
                rebind_owned_session(&mut registry, window_label, session_id);
                registry.active_sessions.insert(
                    window_label.to_owned(),
                    ActiveSession {
                        session_id: session_id.to_owned(),
                        generation: session_generation,
                    },
                );
                Ok(BeginSessionOutcome::Began { session_generation })
            }
        }
    }

    pub fn takeover_session(
        &self,
        window_label: &str,
        session_id: &str,
        expected_active_generation: u64,
    ) -> Result<SessionTakeoverOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        validate_session_generation(expected_active_generation)?;
        let mut registry = self.lock_registry()?;
        let active_session = registry
            .active_sessions
            .get(window_label)
            .ok_or(ClaimError::InactiveSession)?;
        if active_session.session_id == session_id {
            return Ok(SessionTakeoverOutcome::AlreadyActive {
                session_generation: active_session.generation,
            });
        }
        if active_session.generation != expected_active_generation {
            return Err(ClaimError::SessionGenerationMismatch {
                active_generation: active_session.generation,
            });
        }

        let session_generation = allocate_session_generation(&mut registry)?;
        let released_reservations = remove_pending_for_window(&mut registry, window_label);
        remove_operations_for_other_sessions(&mut registry, window_label, session_id);
        rebind_owned_session(&mut registry, window_label, session_id);
        registry.active_sessions.insert(
            window_label.to_owned(),
            ActiveSession {
                session_id: session_id.to_owned(),
                generation: session_generation,
            },
        );

        Ok(SessionTakeoverOutcome::TakenOver {
            session_generation,
            released_reservations,
        })
    }

    pub fn release_session(
        &self,
        window_label: &str,
        session_id: &str,
    ) -> Result<SessionReleaseOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        let mut registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;
        let released_reservations =
            remove_pending_for_session(&mut registry, window_label, session_id);
        remove_operations_for_session(&mut registry, window_label, session_id);
        registry.active_sessions.remove(window_label);

        Ok(SessionReleaseOutcome {
            released_reservations,
        })
    }

    pub fn reserve(
        &self,
        window_label: &str,
        operation: ClaimOperation<'_>,
        document_path: &str,
    ) -> Result<ReserveOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(operation.session_id)?;
        validate_operation_id(operation.operation_id)?;
        let lexical_alias = DocumentPathIdentity::lexical(document_path)?;
        let operation_key = OperationKey {
            window_label: window_label.to_owned(),
            session_id: operation.session_id.to_owned(),
            operation_id: operation.operation_id,
        };

        {
            let registry = self.lock_registry()?;
            if registry.active_sessions.contains_key(window_label) {
                require_active_session(&registry, window_label, operation.session_id)?;
                if let Some(outcome) =
                    reserve_outcome_for_operation(&registry, &operation_key, &lexical_alias)?
                {
                    return Ok(outcome);
                }
            }
        }

        let identity = DocumentPathIdentity::resolve(document_path)?;
        let mut registry = self.lock_registry()?;
        ensure_or_begin_session(&mut registry, window_label, operation.session_id)?;
        if let Some(outcome) =
            reserve_outcome_for_operation(&registry, &operation_key, &lexical_alias)?
        {
            return Ok(outcome);
        }

        if let Some(claim_id) = claim_id_for_identity(&registry, &identity)? {
            let claim = registry
                .claims
                .get(&claim_id)
                .ok_or(ClaimError::StaleToken)?;
            let outcome = match &claim.state {
                ClaimState::Reserved {
                    window_label: claimant,
                    ..
                } if claimant == window_label => return Ok(ReserveOutcome::AlreadyPending),
                ClaimState::Owned {
                    window_label: claimant,
                    session_id: claimant_session,
                    ..
                } if claimant == window_label && claimant_session == operation.session_id => {
                    ReserveOutcome::AlreadyOwned
                }
                ClaimState::Owned {
                    window_label: claimant,
                    ..
                } if claimant == window_label => return Err(ClaimError::TokenSessionMismatch),
                ClaimState::Reserved {
                    window_label: claimant,
                    ..
                }
                | ClaimState::Owned {
                    window_label: claimant,
                    ..
                } => {
                    return Ok(ReserveOutcome::OwnedBy {
                        window_label: claimant.clone(),
                    })
                }
            };
            bind_owned_operation(&mut registry, claim_id, operation_key)?;
            return Ok(outcome);
        }

        let token = self.next_token(&mut registry)?;
        index_claim_identity(&mut registry, token.key, &identity);
        registry.operation_states.insert(
            operation_key,
            OperationState::Active {
                claim_id: token.key,
            },
        );
        registry.claims.insert(
            token.key,
            ClaimRecord {
                identity,
                state: ClaimState::Reserved {
                    window_label: window_label.to_owned(),
                    session_id: operation.session_id.to_owned(),
                    operation_id: operation.operation_id,
                },
            },
        );

        Ok(ReserveOutcome::Reserved { token })
    }

    pub fn commit(
        &self,
        window_label: &str,
        session_id: &str,
        token: ClaimToken,
        document_path: &str,
    ) -> Result<CommitOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        let identity = DocumentPathIdentity::resolve(document_path)?;
        let mut registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;
        self.validate_token_namespace(token)?;
        let operation_id = {
            let claim = registry
                .claims
                .get(&token.key)
                .ok_or(ClaimError::StaleToken)?;
            match &claim.state {
                ClaimState::Reserved {
                    window_label: claimant,
                    ..
                } if claimant != window_label => {
                    return Err(ClaimError::TokenOwnerMismatch {
                        owned_by: claimant.clone(),
                    });
                }
                ClaimState::Reserved {
                    session_id: claimant_session,
                    ..
                } if claimant_session != session_id => {
                    return Err(ClaimError::TokenSessionMismatch);
                }
                ClaimState::Reserved { operation_id, .. } => *operation_id,
                ClaimState::Owned { .. } => return Err(ClaimError::StaleToken),
            }
        };
        validate_claim_identity(&registry, token.key, &identity)?;
        remove_owned_for_window_except(&mut registry, window_label, token.key);
        let claim = registry
            .claims
            .get_mut(&token.key)
            .ok_or(ClaimError::StaleToken)?;
        claim.state = ClaimState::Owned {
            window_label: window_label.to_owned(),
            session_id: session_id.to_owned(),
            operation_id: Some(operation_id),
        };

        Ok(CommitOutcome::Committed)
    }

    pub fn release(
        &self,
        window_label: &str,
        session_id: &str,
        token: ClaimToken,
    ) -> Result<ReleaseOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        let mut registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;
        self.validate_token_namespace(token)?;
        let claim = registry
            .claims
            .get(&token.key)
            .ok_or(ClaimError::StaleToken)?;
        match &claim.state {
            ClaimState::Reserved {
                window_label: claimant,
                ..
            } if claimant != window_label => {
                return Err(ClaimError::TokenOwnerMismatch {
                    owned_by: claimant.clone(),
                });
            }
            ClaimState::Reserved {
                session_id: claimant_session,
                ..
            } if claimant_session != session_id => {
                return Err(ClaimError::TokenSessionMismatch);
            }
            ClaimState::Reserved { .. } => {}
            ClaimState::Owned { .. } => return Err(ClaimError::StaleToken),
        }
        remove_claim(&mut registry, token.key, OperationDisposition::MarkReleased)
            .ok_or(ClaimError::StaleToken)?;

        Ok(ReleaseOutcome::Released)
    }

    pub fn validate_operation_path(
        &self,
        window_label: &str,
        session_id: &str,
        operation_id: u64,
        document_path: &str,
    ) -> Result<OperationPathValidationOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        validate_operation_id(operation_id)?;
        let identity = DocumentPathIdentity::resolve(document_path)?;
        let registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;
        let operation_key = operation_key(window_label, session_id, operation_id);
        let claim_id = active_claim_for_operation(&registry, &operation_key)?;
        validate_operation_owner(&registry, claim_id, &operation_key)?;
        validate_claim_identity(&registry, claim_id, &identity)?;

        Ok(OperationPathValidationOutcome::Validated)
    }

    /// Runs one filesystem operation against the canonical target protected by
    /// an active claim tuple. The registry guard remains held from tuple/path
    /// validation through the operation, and the caller never opens the mutable
    /// alias path after validation.
    pub fn with_validated_operation_io<R>(
        &self,
        window_label: &str,
        session_id: &str,
        operation_id: u64,
        document_path: &str,
        operation: impl FnOnce(&Path) -> R,
    ) -> Result<R, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        validate_operation_id(operation_id)?;
        let lexical_alias = DocumentPathIdentity::lexical(document_path)?;
        let operation_key = operation_key(window_label, session_id, operation_id);
        let registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;
        let claim_id = active_claim_for_operation(&registry, &operation_key)?;
        validate_operation_owner(&registry, claim_id, &operation_key)?;
        let claim = registry
            .claims
            .get(&claim_id)
            .ok_or(ClaimError::StaleToken)?;
        if claim.identity.lexical_alias() != &lexical_alias {
            return Err(ClaimError::OperationPathMismatch);
        }

        let io_target = canonical_io_target(document_path)?;
        let io_target_path = io_target
            .to_str()
            .ok_or(ClaimError::PathIdentityUnavailable)?;
        let io_identity = DocumentPathIdentity::resolve(io_target_path)?;
        let indexed_claim = claim_id_for_identity(&registry, &io_identity)?;
        if indexed_claim != Some(claim_id) || claim.identity.resolved() != io_identity.resolved() {
            return Err(ClaimError::PathIdentityChanged);
        }

        let result = operation(&io_target);
        drop(registry);
        Ok(result)
    }

    pub fn commit_operation(
        &self,
        window_label: &str,
        session_id: &str,
        operation_id: u64,
        document_path: &str,
    ) -> Result<CommitOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        validate_operation_id(operation_id)?;
        let lexical_alias = DocumentPathIdentity::lexical(document_path)?;
        let operation_key = operation_key(window_label, session_id, operation_id);
        {
            let registry = self.lock_registry()?;
            require_active_session(&registry, window_label, session_id)?;
            let claim_id = active_claim_for_operation(&registry, &operation_key)?;
            validate_operation_owner(&registry, claim_id, &operation_key)?;
            let claim = registry
                .claims
                .get(&claim_id)
                .ok_or(ClaimError::StaleToken)?;
            if claim.identity.lexical_alias() != &lexical_alias {
                return Err(ClaimError::OperationPathMismatch);
            }
            if matches!(claim.state, ClaimState::Owned { .. }) {
                return Ok(CommitOutcome::AlreadyCommitted);
            }
        }

        let identity = DocumentPathIdentity::resolve(document_path)?;
        let mut registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;
        let claim_id = active_claim_for_operation(&registry, &operation_key)?;
        validate_operation_owner(&registry, claim_id, &operation_key)?;
        let claim = registry
            .claims
            .get(&claim_id)
            .ok_or(ClaimError::StaleToken)?;
        if claim.identity.lexical_alias() != &lexical_alias {
            return Err(ClaimError::OperationPathMismatch);
        }
        if matches!(claim.state, ClaimState::Owned { .. }) {
            return Ok(CommitOutcome::AlreadyCommitted);
        }
        validate_claim_identity(&registry, claim_id, &identity)?;

        remove_owned_for_window_except(&mut registry, window_label, claim_id);
        let claim = registry
            .claims
            .get_mut(&claim_id)
            .ok_or(ClaimError::StaleToken)?;
        claim.state = ClaimState::Owned {
            window_label: window_label.to_owned(),
            session_id: session_id.to_owned(),
            operation_id: Some(operation_id),
        };

        Ok(CommitOutcome::Committed)
    }

    pub fn release_operation(
        &self,
        window_label: &str,
        session_id: &str,
        operation_id: u64,
        document_path: &str,
    ) -> Result<ReleaseOperationOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        validate_operation_id(operation_id)?;
        let lexical_alias = DocumentPathIdentity::lexical(document_path)?;
        let operation_key = operation_key(window_label, session_id, operation_id);
        let mut registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;
        let claim_id = match registry.operation_states.get(&operation_key) {
            Some(OperationState::Active { claim_id }) => *claim_id,
            Some(OperationState::Released {
                lexical_alias: released_alias,
            }) if released_alias == &lexical_alias => {
                return Ok(ReleaseOperationOutcome::AlreadyReleased);
            }
            Some(OperationState::Released { .. }) => {
                return Err(ClaimError::OperationPathMismatch);
            }
            None => return Err(ClaimError::StaleToken),
        };
        validate_operation_owner(&registry, claim_id, &operation_key)?;
        let claim = registry
            .claims
            .get(&claim_id)
            .ok_or(ClaimError::StaleToken)?;
        if claim.identity.lexical_alias() != &lexical_alias {
            return Err(ClaimError::OperationPathMismatch);
        }
        if matches!(claim.state, ClaimState::Owned { .. }) {
            return Ok(ReleaseOperationOutcome::AlreadyCommitted);
        }

        remove_claim(&mut registry, claim_id, OperationDisposition::MarkReleased)
            .ok_or(ClaimError::StaleToken)?;
        Ok(ReleaseOperationOutcome::Released)
    }

    pub fn release_owned(
        &self,
        window_label: &str,
        session_id: &str,
        document_path: &str,
    ) -> Result<ReleaseOwnedOutcome, ClaimError> {
        validate_window_label(window_label)?;
        validate_session_id(session_id)?;
        let identity = DocumentPathIdentity::resolve(document_path)?;
        let mut registry = self.lock_registry()?;
        require_active_session(&registry, window_label, session_id)?;

        let Some(claim_id) = claim_id_for_identity(&registry, &identity)? else {
            return Ok(ReleaseOwnedOutcome::NotOwned);
        };
        match registry.claims.get(&claim_id).map(|claim| &claim.state) {
            Some(ClaimState::Owned {
                window_label: claimant,
                session_id: claimant_session,
                ..
            }) if claimant == window_label && claimant_session == session_id => {
                remove_claim(&mut registry, claim_id, OperationDisposition::MarkReleased)
                    .ok_or(ClaimError::StaleToken)?;
                Ok(ReleaseOwnedOutcome::Released)
            }
            Some(ClaimState::Owned {
                window_label: claimant,
                session_id: claimant_session,
                ..
            }) if claimant == window_label && claimant_session != session_id => {
                Err(ClaimError::TokenSessionMismatch)
            }
            Some(ClaimState::Owned {
                window_label: claimant,
                ..
            }) => Err(ClaimError::OwnedByOtherWindow {
                owned_by: claimant.clone(),
            }),
            Some(ClaimState::Reserved { .. }) | None => Ok(ReleaseOwnedOutcome::NotOwned),
        }
    }

    pub fn owner_for_path(
        &self,
        document_path: &str,
    ) -> Result<Option<DocumentClaimPathOwner>, ClaimError> {
        let identity = DocumentPathIdentity::resolve(document_path)?;
        self.owner_for_identity(&identity)
    }

    pub(crate) fn owner_for_identity(
        &self,
        identity: &DocumentPathIdentity,
    ) -> Result<Option<DocumentClaimPathOwner>, ClaimError> {
        let registry = self.lock_registry()?;
        let Some(claim_id) = claim_id_for_identity(&registry, identity)? else {
            return Ok(None);
        };
        let claim = registry
            .claims
            .get(&claim_id)
            .ok_or(ClaimError::StaleToken)?;
        if !claim.identity.overlaps(identity) {
            return Err(ClaimError::PathIdentityChanged);
        }
        Ok(Some(match &claim.state {
            ClaimState::Reserved { window_label, .. } => DocumentClaimPathOwner::Pending {
                window_label: window_label.clone(),
            },
            ClaimState::Owned { window_label, .. } => DocumentClaimPathOwner::Owned {
                window_label: window_label.clone(),
            },
        }))
    }

    pub fn release_window(&self, window_label: &str) -> Result<ReleasedWindowClaims, ClaimError> {
        validate_window_label(window_label)?;
        let mut registry = self.lock_registry()?;
        let mut released = ReleasedWindowClaims::default();
        let claim_ids = registry
            .claims
            .iter()
            .filter_map(|(claim_id, claim)| match &claim.state {
                ClaimState::Reserved {
                    window_label: claimant,
                    ..
                }
                | ClaimState::Owned {
                    window_label: claimant,
                    ..
                } if claimant == window_label => Some(*claim_id),
                _ => None,
            })
            .collect::<Vec<_>>();

        for claim_id in claim_ids {
            let claim = remove_claim(&mut registry, claim_id, OperationDisposition::Remove)
                .ok_or(ClaimError::StaleToken)?;
            match claim.state {
                ClaimState::Reserved { .. } => released.reservations += 1,
                ClaimState::Owned { .. } => released.owned_documents += 1,
            }
        }
        registry
            .operation_states
            .retain(|operation, _| operation.window_label != window_label);
        registry.active_sessions.remove(window_label);

        Ok(released)
    }

    fn lock_registry(&self) -> Result<MutexGuard<'_, ClaimRegistry>, ClaimError> {
        self.state.lock().map_err(|_| ClaimError::LockPoisoned)
    }

    fn next_token(&self, registry: &mut ClaimRegistry) -> Result<ClaimToken, ClaimError> {
        let sequence = registry.next_sequence;
        registry.next_sequence = sequence
            .checked_add(1)
            .ok_or(ClaimError::TokenSpaceExhausted)?;

        Ok(ClaimToken {
            key: ClaimTokenKey {
                service_id: self.service_id,
                sequence,
            },
        })
    }

    fn validate_token_namespace(&self, token: ClaimToken) -> Result<(), ClaimError> {
        if token.key.service_id == self.service_id {
            Ok(())
        } else {
            Err(ClaimError::StaleToken)
        }
    }
}

fn claim_id_for_identity(
    registry: &ClaimRegistry,
    identity: &DocumentPathIdentity,
) -> Result<Option<ClaimTokenKey>, ClaimError> {
    let lexical_claim = registry
        .identity_claims
        .get(identity.lexical_alias())
        .copied();
    let resolved_claim = registry.identity_claims.get(identity.resolved()).copied();

    match (lexical_claim, resolved_claim) {
        (Some(lexical), Some(resolved)) if lexical != resolved => {
            Err(ClaimError::AmbiguousPathIdentity)
        }
        (Some(claim_id), _) | (_, Some(claim_id)) => Ok(Some(claim_id)),
        (None, None) => Ok(None),
    }
}

fn index_claim_identity(
    registry: &mut ClaimRegistry,
    claim_id: ClaimTokenKey,
    identity: &DocumentPathIdentity,
) {
    registry
        .identity_claims
        .insert(identity.lexical_alias().clone(), claim_id);
    registry
        .identity_claims
        .insert(identity.resolved().clone(), claim_id);
}

#[derive(Clone, Copy)]
enum OperationDisposition {
    Remove,
    MarkReleased,
}

fn canonical_io_target(document_path: &str) -> Result<PathBuf, ClaimError> {
    let mut ancestor = PathBuf::from(document_path);
    let mut missing_components = Vec::<OsString>::new();
    loop {
        match fs::canonicalize(&ancestor) {
            Ok(mut canonical) => {
                for component in missing_components.iter().rev() {
                    canonical.push(component);
                }
                return Ok(canonical);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let component = ancestor.file_name().ok_or(ClaimError::InvalidPath)?;
                missing_components.push(component.to_owned());
                if !ancestor.pop() {
                    return Err(ClaimError::InvalidPath);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => {
                return Err(ClaimError::InvalidPath);
            }
            Err(_) => return Err(ClaimError::PathIdentityUnavailable),
        }
    }
}

fn remove_claim(
    registry: &mut ClaimRegistry,
    claim_id: ClaimTokenKey,
    disposition: OperationDisposition,
) -> Option<ClaimRecord> {
    let claim = registry.claims.remove(&claim_id)?;
    remove_identity_index(registry, claim.identity.lexical_alias(), claim_id);
    remove_identity_index(registry, claim.identity.resolved(), claim_id);

    let operation = match &claim.state {
        ClaimState::Reserved {
            window_label,
            session_id,
            operation_id,
        } => Some(OperationKey {
            window_label: window_label.clone(),
            session_id: session_id.clone(),
            operation_id: *operation_id,
        }),
        ClaimState::Owned {
            window_label,
            session_id,
            operation_id: Some(operation_id),
        } => Some(OperationKey {
            window_label: window_label.clone(),
            session_id: session_id.clone(),
            operation_id: *operation_id,
        }),
        ClaimState::Owned {
            operation_id: None, ..
        } => None,
    };

    if let Some(operation) = operation {
        match disposition {
            OperationDisposition::Remove => {
                registry.operation_states.remove(&operation);
            }
            OperationDisposition::MarkReleased => {
                registry.operation_states.insert(
                    operation,
                    OperationState::Released {
                        lexical_alias: claim.identity.lexical_alias().clone(),
                    },
                );
            }
        }
    }

    Some(claim)
}

fn operation_key(window_label: &str, session_id: &str, operation_id: u64) -> OperationKey {
    OperationKey {
        window_label: window_label.to_owned(),
        session_id: session_id.to_owned(),
        operation_id,
    }
}

fn reserve_outcome_for_operation(
    registry: &ClaimRegistry,
    operation: &OperationKey,
    lexical_alias: &PathIdentityKey,
) -> Result<Option<ReserveOutcome>, ClaimError> {
    let Some(operation_state) = registry.operation_states.get(operation) else {
        return Ok(None);
    };
    match operation_state {
        OperationState::Active { claim_id } => {
            let claim = registry
                .claims
                .get(claim_id)
                .ok_or(ClaimError::StaleToken)?;
            if claim.identity.lexical_alias() != lexical_alias {
                return Err(ClaimError::OperationPathMismatch);
            }
            Ok(Some(match &claim.state {
                ClaimState::Reserved { .. } => ReserveOutcome::Reserved {
                    token: ClaimToken { key: *claim_id },
                },
                ClaimState::Owned { .. } => ReserveOutcome::AlreadyOwned,
            }))
        }
        OperationState::Released {
            lexical_alias: released_alias,
        } if released_alias == lexical_alias => Ok(Some(ReserveOutcome::AlreadyReleased)),
        OperationState::Released { .. } => Err(ClaimError::OperationPathMismatch),
    }
}

fn active_claim_for_operation(
    registry: &ClaimRegistry,
    operation: &OperationKey,
) -> Result<ClaimTokenKey, ClaimError> {
    match registry.operation_states.get(operation) {
        Some(OperationState::Active { claim_id }) => Ok(*claim_id),
        Some(OperationState::Released { .. }) | None => Err(ClaimError::StaleToken),
    }
}

fn validate_operation_owner(
    registry: &ClaimRegistry,
    claim_id: ClaimTokenKey,
    operation: &OperationKey,
) -> Result<(), ClaimError> {
    let claim = registry
        .claims
        .get(&claim_id)
        .ok_or(ClaimError::StaleToken)?;

    let (window_label, session_id, operation_id) = match &claim.state {
        ClaimState::Reserved {
            window_label,
            session_id,
            operation_id,
        } => (window_label, session_id, Some(*operation_id)),
        ClaimState::Owned {
            window_label,
            session_id,
            operation_id,
        } => (window_label, session_id, *operation_id),
    };

    if window_label != &operation.window_label {
        return Err(ClaimError::TokenOwnerMismatch {
            owned_by: window_label.clone(),
        });
    }
    if session_id != &operation.session_id {
        return Err(ClaimError::TokenSessionMismatch);
    }
    if operation_id != Some(operation.operation_id) {
        return Err(ClaimError::StaleToken);
    }

    Ok(())
}

fn validate_claim_identity(
    registry: &ClaimRegistry,
    claim_id: ClaimTokenKey,
    current_identity: &DocumentPathIdentity,
) -> Result<(), ClaimError> {
    let indexed_claim = claim_id_for_identity(registry, current_identity)?;
    if indexed_claim != Some(claim_id) {
        return Err(ClaimError::PathIdentityChanged);
    }

    let claim = registry
        .claims
        .get(&claim_id)
        .ok_or(ClaimError::StaleToken)?;
    if &claim.identity != current_identity {
        return Err(ClaimError::PathIdentityChanged);
    }

    Ok(())
}

fn ensure_or_begin_session(
    registry: &mut ClaimRegistry,
    window_label: &str,
    session_id: &str,
) -> Result<(), ClaimError> {
    match registry.active_sessions.get(window_label) {
        Some(active_session) if active_session.session_id == session_id => Ok(()),
        Some(_) => Err(ClaimError::InactiveSession),
        None => {
            let session_generation = allocate_session_generation(registry)?;
            remove_operations_for_other_sessions(registry, window_label, session_id);
            rebind_owned_session(registry, window_label, session_id);
            registry.active_sessions.insert(
                window_label.to_owned(),
                ActiveSession {
                    session_id: session_id.to_owned(),
                    generation: session_generation,
                },
            );
            Ok(())
        }
    }
}

fn require_active_session(
    registry: &ClaimRegistry,
    window_label: &str,
    session_id: &str,
) -> Result<(), ClaimError> {
    if registry
        .active_sessions
        .get(window_label)
        .is_some_and(|active_session| active_session.session_id == session_id)
    {
        Ok(())
    } else {
        Err(ClaimError::InactiveSession)
    }
}

fn allocate_session_generation(registry: &mut ClaimRegistry) -> Result<u64, ClaimError> {
    let generation = registry.next_session_generation;
    if generation == 0 || generation > MAX_SAFE_SESSION_GENERATION {
        return Err(ClaimError::SessionGenerationExhausted);
    }
    registry.next_session_generation = generation
        .checked_add(1)
        .ok_or(ClaimError::SessionGenerationExhausted)?;
    Ok(generation)
}

fn validate_session_generation(generation: u64) -> Result<(), ClaimError> {
    if generation == 0 || generation > MAX_SAFE_SESSION_GENERATION {
        Err(ClaimError::InvalidSessionGeneration)
    } else {
        Ok(())
    }
}

fn rebind_owned_session(registry: &mut ClaimRegistry, window_label: &str, session_id: &str) {
    for claim in registry.claims.values_mut() {
        if let ClaimState::Owned {
            window_label: claimant,
            session_id: claimant_session,
            operation_id,
        } = &mut claim.state
        {
            if claimant == window_label {
                *claimant_session = session_id.to_owned();
                *operation_id = None;
            }
        }
    }
}

fn bind_owned_operation(
    registry: &mut ClaimRegistry,
    claim_id: ClaimTokenKey,
    operation: OperationKey,
) -> Result<(), ClaimError> {
    let previous_operation = {
        let claim = registry
            .claims
            .get(&claim_id)
            .ok_or(ClaimError::StaleToken)?;
        match &claim.state {
            ClaimState::Owned {
                window_label,
                session_id,
                operation_id,
            } if window_label == &operation.window_label && session_id == &operation.session_id => {
                operation_id.map(|operation_id| OperationKey {
                    window_label: window_label.clone(),
                    session_id: session_id.clone(),
                    operation_id,
                })
            }
            _ => return Err(ClaimError::StaleToken),
        }
    };
    if registry.operation_states.contains_key(&operation) {
        return Err(ClaimError::StaleToken);
    }
    if let Some(previous_operation) = previous_operation {
        match registry.operation_states.get(&previous_operation) {
            Some(OperationState::Active {
                claim_id: active_claim,
            }) if *active_claim == claim_id => {}
            _ => return Err(ClaimError::StaleToken),
        }
        registry.operation_states.remove(&previous_operation);
    }
    registry
        .operation_states
        .insert(operation.clone(), OperationState::Active { claim_id });
    let claim = registry
        .claims
        .get_mut(&claim_id)
        .ok_or(ClaimError::StaleToken)?;
    match &mut claim.state {
        ClaimState::Owned { operation_id, .. } => {
            *operation_id = Some(operation.operation_id);
            Ok(())
        }
        ClaimState::Reserved { .. } => Err(ClaimError::StaleToken),
    }
}

fn remove_owned_for_window_except(
    registry: &mut ClaimRegistry,
    window_label: &str,
    retained_claim: ClaimTokenKey,
) -> usize {
    let owned_claims = registry
        .claims
        .iter()
        .filter_map(|(claim_id, claim)| match &claim.state {
            ClaimState::Owned {
                window_label: claimant,
                ..
            } if claimant == window_label && *claim_id != retained_claim => Some(*claim_id),
            _ => None,
        })
        .collect::<Vec<_>>();
    let removed = owned_claims.len();
    for claim_id in owned_claims {
        let _ = remove_claim(registry, claim_id, OperationDisposition::MarkReleased);
    }
    removed
}

fn remove_pending_for_window(registry: &mut ClaimRegistry, window_label: &str) -> usize {
    let pending_claims = registry
        .claims
        .iter()
        .filter_map(|(claim_id, claim)| match &claim.state {
            ClaimState::Reserved {
                window_label: claimant,
                ..
            } if claimant == window_label => Some(*claim_id),
            _ => None,
        })
        .collect::<Vec<_>>();
    let removed = pending_claims.len();
    for claim_id in pending_claims {
        let _ = remove_claim(registry, claim_id, OperationDisposition::Remove);
    }
    removed
}

fn remove_pending_for_session(
    registry: &mut ClaimRegistry,
    window_label: &str,
    session_id: &str,
) -> usize {
    let pending_claims = registry
        .claims
        .iter()
        .filter_map(|(claim_id, claim)| match &claim.state {
            ClaimState::Reserved {
                window_label: claimant,
                session_id: claimant_session,
                ..
            } if claimant == window_label && claimant_session == session_id => Some(*claim_id),
            _ => None,
        })
        .collect::<Vec<_>>();
    let removed = pending_claims.len();
    for claim_id in pending_claims {
        let _ = remove_claim(registry, claim_id, OperationDisposition::Remove);
    }
    removed
}

fn remove_operations_for_session(
    registry: &mut ClaimRegistry,
    window_label: &str,
    session_id: &str,
) {
    registry.operation_states.retain(|operation, _| {
        operation.window_label != window_label || operation.session_id != session_id
    });
}

fn remove_operations_for_other_sessions(
    registry: &mut ClaimRegistry,
    window_label: &str,
    session_id: &str,
) {
    registry.operation_states.retain(|operation, _| {
        operation.window_label != window_label || operation.session_id == session_id
    });
}

fn remove_identity_index(
    registry: &mut ClaimRegistry,
    identity: &PathIdentityKey,
    claim_id: ClaimTokenKey,
) {
    if registry.identity_claims.get(identity) == Some(&claim_id) {
        registry.identity_claims.remove(identity);
    }
}

fn validate_session_id(session_id: &str) -> Result<(), ClaimError> {
    if session_id.trim().is_empty() {
        Err(ClaimError::EmptySessionId)
    } else {
        Ok(())
    }
}

fn validate_operation_id(operation_id: u64) -> Result<(), ClaimError> {
    if operation_id == 0 || operation_id > MAX_SAFE_SESSION_GENERATION {
        Err(ClaimError::InvalidOperationId)
    } else {
        Ok(())
    }
}

fn validate_window_label(window_label: &str) -> Result<(), ClaimError> {
    if window_label.trim().is_empty() {
        Err(ClaimError::EmptyWindowLabel)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{Arc, Barrier},
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[cfg(windows)]
    use std::process::Command;

    use super::*;

    const SESSION_A: &str = "session-a";
    const SESSION_B: &str = "session-b";
    const OPERATION_A: ClaimOperation<'static> = ClaimOperation::new(SESSION_A, 101);
    const OPERATION_B: ClaimOperation<'static> = ClaimOperation::new(SESSION_A, 102);
    const OPERATION_C: ClaimOperation<'static> = ClaimOperation::new(SESSION_A, 103);

    fn service() -> DocumentClaimService {
        DocumentClaimService::new().expect("a test service should have a token namespace")
    }

    fn reserved_token(outcome: ReserveOutcome) -> ClaimToken {
        match outcome {
            ReserveOutcome::Reserved { token } => token,
            unexpected => panic!("expected a reservation, got {unexpected:?}"),
        }
    }

    fn begun_generation(outcome: BeginSessionOutcome) -> u64 {
        match outcome {
            BeginSessionOutcome::Began { session_generation }
            | BeginSessionOutcome::AlreadyActive { session_generation } => session_generation,
        }
    }

    fn takeover_generation(outcome: SessionTakeoverOutcome) -> u64 {
        match outcome {
            SessionTakeoverOutcome::TakenOver {
                session_generation, ..
            }
            | SessionTakeoverOutcome::AlreadyActive { session_generation } => session_generation,
        }
    }

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should follow the Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "lumamark-document-claim-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).expect("test directory should be removable");
        }
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
    fn reserve_returns_the_same_token_for_the_same_operation_retry() {
        let service = service();
        let first = service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("first reservation should succeed");
        let second = service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("the same operation retry should be idempotent");

        assert_eq!(first, second);
    }

    #[test]
    fn pending_reserve_retry_does_not_resolve_an_offline_original_path() {
        let temp = TestDirectory::new("pending-reserve-terminal-offline");
        let document_directory = temp.path().join("documents");
        let document_path = document_directory.join("draft.md");
        fs::create_dir(&document_directory).expect("document directory should be created");
        fs::write(&document_path, "draft").expect("document should be created");
        let document_path = document_path
            .to_str()
            .expect("test document path should be Unicode");
        let service = service();
        let first = service
            .reserve("window-a", OPERATION_A, document_path)
            .expect("operation should reserve");
        fs::remove_file(document_path).expect("document should be removable");
        fs::remove_dir(&document_directory).expect("document directory should be removable");
        fs::write(&document_directory, "not a directory")
            .expect("the former directory should become an unresolvable parent");
        DocumentPathIdentity::reset_resolution_attempts();

        let retry = service
            .reserve("window-a", OPERATION_A, document_path)
            .expect("operation retry should use the stored lexical identity");

        assert_eq!(retry, first);
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);
    }

    #[test]
    fn pending_release_can_clean_up_an_offline_original_path_without_resolution() {
        let temp = TestDirectory::new("pending-release-terminal-offline");
        let document_directory = temp.path().join("documents");
        let document_path = document_directory.join("draft.md");
        fs::create_dir(&document_directory).expect("document directory should be created");
        fs::write(&document_path, "draft").expect("document should be created");
        let document_path = document_path
            .to_str()
            .expect("test document path should be Unicode");
        let service = service();
        service
            .reserve("window-a", OPERATION_A, document_path)
            .expect("operation should reserve");
        fs::remove_file(document_path).expect("document should be removable");
        fs::remove_dir(&document_directory).expect("document directory should be removable");
        fs::write(&document_directory, "not a directory")
            .expect("the former directory should become an unresolvable parent");
        DocumentPathIdentity::reset_resolution_attempts();

        let released = service
            .release_operation("window-a", SESSION_A, 101, document_path)
            .expect("operation cleanup should use the stored lexical identity");

        assert_eq!(released, ReleaseOperationOutcome::Released);
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);
    }

    #[test]
    fn a_new_session_reusing_an_operation_id_cannot_receive_the_old_token() {
        let service = service();
        let first = service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("first session should reserve");

        let reloaded = service
            .reserve(
                "window-a",
                ClaimOperation::new(SESSION_B, 101),
                r"C:\Notes\draft.md",
            )
            .expect_err("new session reuse requires an explicit takeover");

        assert_eq!(reloaded, ClaimError::InactiveSession);
        assert!(matches!(first, ReserveOutcome::Reserved { .. }));
    }

    #[test]
    fn a_new_session_cannot_commit_a_token_from_the_previous_session() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("first session should reserve"),
        );

        let rejected = service
            .commit("window-a", SESSION_B, token, r"C:\Notes\draft.md")
            .expect_err("a new session must not commit the old session token");
        let committed = service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("the original session should retain its reservation");

        assert_eq!(
            (rejected, committed),
            (ClaimError::InactiveSession, CommitOutcome::Committed)
        );
    }

    #[test]
    fn a_new_session_cannot_release_a_token_from_the_previous_session() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("first session should reserve"),
        );

        let rejected = service
            .release("window-a", SESSION_B, token)
            .expect_err("a new session must not cancel the old session token");
        let released = service
            .release("window-a", SESSION_A, token)
            .expect("the original session should retain its reservation");

        assert_eq!(
            (rejected, released),
            (ClaimError::InactiveSession, ReleaseOutcome::Released)
        );
    }

    #[test]
    fn session_takeover_replaces_old_pending_with_a_new_token() {
        let service = service();
        let active_generation = begun_generation(
            service
                .begin_session("window-a", SESSION_A)
                .expect("old session should begin"),
        );
        let old_token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("old session should reserve"),
        );

        let takeover = service
            .takeover_session("window-a", SESSION_B, active_generation)
            .expect("new WebView session should atomically take over");
        let new_token = reserved_token(
            service
                .reserve(
                    "window-a",
                    ClaimOperation::new(SESSION_B, 101),
                    r"C:\Notes\draft.md",
                )
                .expect("new session should receive a fresh reservation"),
        );
        let stale = service
            .commit("window-a", SESSION_B, old_token, r"C:\Notes\draft.md")
            .expect_err("the replaced session token must be stale");

        assert!(matches!(
            takeover,
            SessionTakeoverOutcome::TakenOver {
                released_reservations: 1,
                ..
            }
        ));
        assert!(old_token != new_token);
        assert_eq!(stale, ClaimError::StaleToken);
    }

    #[test]
    fn begin_session_requires_explicit_takeover_of_an_active_session() {
        let service = service();
        let began = service
            .begin_session("window-a", SESSION_A)
            .expect("first session should begin");
        let repeated = service
            .begin_session("window-a", SESSION_A)
            .expect("same session begin should be idempotent");
        let error = service
            .begin_session("window-a", SESSION_B)
            .expect_err("a new session must request takeover explicitly");

        assert_eq!(
            (began, repeated, error),
            (
                BeginSessionOutcome::Began {
                    session_generation: 1,
                },
                BeginSessionOutcome::AlreadyActive {
                    session_generation: 1,
                },
                ClaimError::SessionAlreadyActive {
                    active_generation: 1,
                },
            )
        );
    }

    #[test]
    fn stale_takeover_cannot_reclaim_a_newer_session_or_clear_its_pending_claim() {
        let service = service();
        let first_generation = begun_generation(
            service
                .begin_session("window-a", SESSION_A)
                .expect("first session should begin"),
        );
        let second_generation = takeover_generation(
            service
                .takeover_session("window-a", SESSION_B, first_generation)
                .expect("second session should take over the observed generation"),
        );
        service
            .reserve(
                "window-a",
                ClaimOperation::new(SESSION_B, 201),
                r"C:\Notes\new-session-pending.md",
            )
            .expect("new session should reserve");

        let stale = service
            .takeover_session("window-a", SESSION_A, first_generation)
            .expect_err("stale session generation must fail closed");
        let conflict = service
            .reserve(
                "window-b",
                ClaimOperation::new(SESSION_A, 301),
                r"C:\Notes\new-session-pending.md",
            )
            .expect("new session reservation should remain intact");

        assert_eq!(
            stale,
            ClaimError::SessionGenerationMismatch {
                active_generation: second_generation,
            }
        );
        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn takeover_preserves_committed_ownership_and_fences_the_old_session() {
        let service = service();
        let active_generation = begun_generation(
            service
                .begin_session("window-a", SESSION_A)
                .expect("old session should begin"),
        );
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("old session should reserve"),
        );
        service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("old session should commit");
        service
            .takeover_session("window-a", SESSION_B, active_generation)
            .expect("new session should take over ownership");

        let stale_release = service
            .release_owned("window-a", SESSION_A, r"C:\Notes\draft.md")
            .expect_err("old session must not release rebound ownership");
        let still_owned = service
            .reserve(
                "window-b",
                ClaimOperation::new(SESSION_A, 201),
                r"C:\Notes\draft.md",
            )
            .expect("old session late release must leave ownership intact");
        let released = service
            .release_owned("window-a", SESSION_B, r"C:\Notes\draft.md")
            .expect("new session should release rebound ownership");

        assert_eq!(stale_release, ClaimError::InactiveSession);
        assert_eq!(
            (still_owned, released),
            (
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
                ReleaseOwnedOutcome::Released,
            )
        );
    }

    #[test]
    fn release_session_removes_only_that_sessions_pending_claims() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("session should reserve");

        let released = service
            .release_session("window-a", SESSION_A)
            .expect("active session should release");
        let next = service
            .reserve(
                "window-b",
                ClaimOperation::new(SESSION_A, 201),
                r"C:\Notes\draft.md",
            )
            .expect("another window should reserve the released path");

        assert_eq!(released.released_reservations, 1);
        assert!(matches!(next, ReserveOutcome::Reserved { .. }));
    }

    #[test]
    fn release_session_preserves_committed_ownership_for_the_next_session() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("old session should reserve");
        service
            .commit_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("old session should commit");
        service
            .release_session("window-a", SESSION_A)
            .expect("old session should release its pending state");
        service
            .begin_session("window-a", SESSION_B)
            .expect("new session should inherit committed ownership");

        let conflict = service
            .reserve(
                "window-b",
                ClaimOperation::new(SESSION_A, 201),
                r"C:\Notes\draft.md",
            )
            .expect("the committed path should remain owned");
        let released = service
            .release_owned("window-a", SESSION_B, r"C:\Notes\draft.md")
            .expect("the new session should own the release fence");

        assert_eq!(
            (conflict, released),
            (
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
                ReleaseOwnedOutcome::Released,
            )
        );
    }

    #[test]
    fn a_different_same_window_operation_does_not_receive_a_releasable_token() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("first operation should reserve");

        let second = service
            .reserve("window-a", OPERATION_B, r"C:\Notes\draft.md")
            .expect("a concurrent operation is an explicit normal outcome");

        assert_eq!(second, ReserveOutcome::AlreadyPending);
    }

    #[test]
    fn cancelling_a_distinct_same_window_operation_cannot_release_the_active_reservation() {
        let service = Arc::new(service());
        let barrier = Arc::new(Barrier::new(3));
        let first_service = Arc::clone(&service);
        let first_barrier = Arc::clone(&barrier);
        let first = thread::spawn(move || {
            first_barrier.wait();
            first_service.reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
        });
        let second_service = Arc::clone(&service);
        let second_barrier = Arc::clone(&barrier);
        let second = thread::spawn(move || {
            second_barrier.wait();
            second_service.reserve("window-a", OPERATION_B, r"C:\Notes\draft.md")
        });
        barrier.wait();
        let outcomes = [
            first.join().expect("first worker should not panic"),
            second.join().expect("second worker should not panic"),
        ];
        let active_token = outcomes
            .iter()
            .find_map(|outcome| match outcome {
                Ok(ReserveOutcome::Reserved { token }) => Some(*token),
                _ => None,
            })
            .expect("exactly one operation should receive the release token");
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| matches!(outcome, Ok(ReserveOutcome::Reserved { .. })))
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| matches!(outcome, Ok(ReserveOutcome::AlreadyPending)))
                .count(),
            1
        );

        let conflict = service
            .reserve("window-b", OPERATION_C, r"C:\Notes\draft.md")
            .expect("the original reservation should still block another window");
        let release = service
            .release("window-a", SESSION_A, active_token)
            .expect("only the token-holding operation can cancel");

        assert_eq!(
            (conflict, release),
            (
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
                ReleaseOutcome::Released,
            )
        );
    }

    #[test]
    fn reusing_an_operation_for_a_different_path_fails_closed() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\first.md")
            .expect("first path should reserve");

        let error = service
            .reserve("window-a", OPERATION_A, r"C:\Notes\second.md")
            .expect_err("one in-flight operation must not identify two paths");

        assert_eq!(error, ClaimError::OperationPathMismatch);
    }

    #[test]
    fn commit_operation_is_idempotent_for_the_same_session_tuple() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("operation should reserve");

        let first = service
            .commit_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("first commit should succeed");
        let second = service
            .commit_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("commit retry should be idempotent");

        assert_eq!(
            (first, second),
            (CommitOutcome::Committed, CommitOutcome::AlreadyCommitted)
        );
    }

    #[test]
    fn committed_operation_retry_does_not_resolve_an_offline_original_path() {
        let temp = TestDirectory::new("committed-terminal-offline");
        let document_directory = temp.path().join("documents");
        let document_path = document_directory.join("draft.md");
        fs::create_dir(&document_directory).expect("document directory should be created");
        fs::write(&document_path, "draft").expect("document should be created");
        let document_path = document_path
            .to_str()
            .expect("test document path should be Unicode");
        let service = service();
        service
            .reserve("window-a", OPERATION_A, document_path)
            .expect("operation should reserve");
        service
            .commit_operation("window-a", SESSION_A, 101, document_path)
            .expect("operation should commit");
        fs::remove_file(document_path).expect("document should be removable");
        fs::remove_dir(&document_directory).expect("document directory should be removable");
        fs::write(&document_directory, "not a directory")
            .expect("the former directory should become an unresolvable parent");
        DocumentPathIdentity::reset_resolution_attempts();

        let retry = service
            .commit_operation("window-a", SESSION_A, 101, document_path)
            .expect("terminal commit retry should use the stored lexical identity");

        assert_eq!(retry, CommitOutcome::AlreadyCommitted);
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);
    }

    #[test]
    fn committed_operation_retry_rejects_a_different_lexical_path() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("operation should reserve");
        service
            .commit_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("operation should commit");

        let error = service
            .commit_operation("window-a", SESSION_A, 101, r"C:\Notes\other.md")
            .expect_err("terminal commit retry must remain bound to its lexical path");

        assert_eq!(error, ClaimError::OperationPathMismatch);
    }

    #[test]
    fn release_operation_is_idempotent_for_the_same_session_tuple() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("operation should reserve");

        let first = service
            .release_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("first release should succeed");
        let second = service
            .release_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("release retry should be idempotent");

        assert_eq!(
            (first, second),
            (
                ReleaseOperationOutcome::Released,
                ReleaseOperationOutcome::AlreadyReleased,
            )
        );
    }

    #[test]
    fn released_operation_retry_does_not_resolve_an_offline_original_path() {
        let temp = TestDirectory::new("released-terminal-offline");
        let document_directory = temp.path().join("documents");
        let document_path = document_directory.join("draft.md");
        fs::create_dir(&document_directory).expect("document directory should be created");
        fs::write(&document_path, "draft").expect("document should be created");
        let document_path = document_path
            .to_str()
            .expect("test document path should be Unicode");
        let service = service();
        service
            .reserve("window-a", OPERATION_A, document_path)
            .expect("operation should reserve");
        service
            .release_operation("window-a", SESSION_A, 101, document_path)
            .expect("operation should release");
        fs::remove_file(document_path).expect("document should be removable");
        fs::remove_dir(&document_directory).expect("document directory should be removable");
        fs::write(&document_directory, "not a directory")
            .expect("the former directory should become an unresolvable parent");
        DocumentPathIdentity::reset_resolution_attempts();

        let retry = service
            .release_operation("window-a", SESSION_A, 101, document_path)
            .expect("terminal release retry should use its lexical tombstone");

        assert_eq!(retry, ReleaseOperationOutcome::AlreadyReleased);
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);
    }

    #[test]
    fn released_operation_retry_rejects_a_different_lexical_path() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("operation should reserve");
        service
            .release_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("operation should release");

        let error = service
            .release_operation("window-a", SESSION_A, 101, r"C:\Notes\other.md")
            .expect_err("terminal release retry must remain bound to its lexical path");

        assert_eq!(error, ClaimError::OperationPathMismatch);
    }

    #[test]
    fn reserve_retry_after_operation_release_reports_already_released() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("operation should reserve");
        service
            .release_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("operation should release");

        let retry = service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("released operation retry is an explicit outcome");

        assert_eq!(retry, ReserveOutcome::AlreadyReleased);
    }

    #[test]
    fn release_operation_after_commit_reports_already_committed() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("operation should reserve");
        service
            .commit_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("operation should commit");

        let release = service
            .release_operation("window-a", SESSION_A, 101, r"C:\Notes\draft.md")
            .expect("release after commit is an explicit outcome");

        assert_eq!(release, ReleaseOperationOutcome::AlreadyCommitted);
    }

    #[test]
    fn reserve_reports_the_existing_window_while_a_claim_is_pending() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("first reservation should succeed");

        let conflict = service
            .reserve("window-b", OPERATION_B, r"c:\notes\DRAFT.md")
            .expect("ownership conflicts are a normal outcome");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn commit_solidifies_the_reservation_for_the_original_window() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );

        let committed = service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("the reservation owner should commit");

        assert_eq!(committed, CommitOutcome::Committed);
    }

    #[test]
    fn reserve_is_idempotent_after_the_same_window_commits() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("commit should succeed");

        let repeated = service
            .reserve("window-a", OPERATION_B, r"c:\notes\DRAFT.md")
            .expect("repeated ownership should be idempotent");

        assert_eq!(repeated, ReserveOutcome::AlreadyOwned);
        assert_eq!(
            service
                .validate_operation_path(
                    "window-a",
                    SESSION_A,
                    OPERATION_B.operation_id,
                    r"c:\notes\DRAFT.md",
                )
                .expect("the latest operation should bind to existing ownership"),
            OperationPathValidationOutcome::Validated
        );
        assert_eq!(
            service.validate_operation_path(
                "window-a",
                SESSION_A,
                OPERATION_A.operation_id,
                r"C:\Notes\draft.md",
            ),
            Err(ClaimError::StaleToken)
        );
    }

    #[test]
    fn already_owned_reservation_rebinds_claimed_io_to_the_current_session_operation() {
        let directory = TestDirectory::new("owned-io-rebind");
        let document = directory.path().join("note.md");
        fs::write(&document, "owned-content").expect("test document should be written");
        let display_path = document.to_str().expect("test path should be Unicode");
        let service = service();
        service
            .begin_session("window-a", SESSION_A)
            .expect("first session should begin");
        let token = reserved_token(
            service
                .reserve(
                    "window-a",
                    ClaimOperation::new(SESSION_A, 201),
                    display_path,
                )
                .expect("first session should reserve"),
        );
        service
            .commit("window-a", SESSION_A, token, display_path)
            .expect("first session should own the document");
        service
            .release_session("window-a", SESSION_A)
            .expect("first session should release");
        service
            .begin_session("window-a", SESSION_B)
            .expect("replacement session should begin");

        let reserve = service
            .reserve(
                "window-a",
                ClaimOperation::new(SESSION_B, 202),
                display_path,
            )
            .expect("current owner should remain idempotent");
        let content = service
            .with_validated_operation_io("window-a", SESSION_B, 202, display_path, |target| {
                fs::read_to_string(target)
            })
            .expect("the current session operation should own the I/O tuple")
            .expect("the claimed document should remain readable");

        assert_eq!(reserve, ReserveOutcome::AlreadyOwned);
        assert_eq!(content, "owned-content");
        assert_eq!(
            service.with_validated_operation_io("window-a", SESSION_A, 201, display_path, |_| (),),
            Err(ClaimError::InactiveSession)
        );
    }

    #[test]
    fn reserve_reports_the_existing_window_after_commit() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("commit should succeed");

        let conflict = service
            .reserve("window-b", OPERATION_B, r"C:\Notes\draft.md")
            .expect("ownership conflicts are a normal outcome");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn commit_rejects_a_stale_token_after_cancellation() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .release("window-a", SESSION_A, token)
            .expect("cancellation should release the reservation");

        let error = service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect_err("a released token must not commit");

        assert_eq!(error, ClaimError::StaleToken);
    }

    #[test]
    fn commit_rejects_a_different_window_without_changing_the_claim() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .begin_session("window-b", SESSION_A)
            .expect("the other window session should begin");

        let error = service
            .commit("window-b", SESSION_A, token, r"C:\Notes\draft.md")
            .expect_err("a different window must not commit the claim");
        let original_commit = service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("a rejected commit must leave the claim intact");

        assert_eq!(
            (error, original_commit),
            (
                ClaimError::TokenOwnerMismatch {
                    owned_by: "window-a".to_owned(),
                },
                CommitOutcome::Committed,
            )
        );
    }

    #[test]
    fn release_rejects_a_different_window_without_changing_the_claim() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .begin_session("window-b", SESSION_A)
            .expect("the other window session should begin");

        let error = service
            .release("window-b", SESSION_A, token)
            .expect_err("a different window must not release the claim");
        let original_release = service
            .release("window-a", SESSION_A, token)
            .expect("a rejected release must leave the claim intact");

        assert_eq!(
            (error, original_release),
            (
                ClaimError::TokenOwnerMismatch {
                    owned_by: "window-a".to_owned(),
                },
                ReleaseOutcome::Released,
            )
        );
    }

    #[test]
    fn release_after_failure_allows_another_window_to_reserve() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .release("window-a", SESSION_A, token)
            .expect("failed work should release the reservation");

        let next = service
            .reserve("window-b", OPERATION_B, r"C:\Notes\draft.md")
            .expect("another window should reserve after release");

        assert!(matches!(next, ReserveOutcome::Reserved { .. }));
    }

    #[test]
    fn release_rejects_a_token_that_was_consumed_by_commit() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("commit should succeed");

        let error = service
            .release("window-a", SESSION_A, token)
            .expect_err("a committed token is stale");

        assert_eq!(error, ClaimError::StaleToken);
    }

    #[test]
    fn release_window_removes_its_pending_reservations() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("reservation should succeed");

        let released = service
            .release_window("window-a")
            .expect("window cleanup should succeed");

        assert_eq!(
            released,
            ReleasedWindowClaims {
                reservations: 1,
                owned_documents: 0,
            }
        );
    }

    #[test]
    fn release_window_removes_its_committed_ownership() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("reservation should succeed"),
        );
        service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("commit should succeed");
        service
            .release_window("window-a")
            .expect("window cleanup should succeed");

        let next = service
            .reserve("window-b", OPERATION_B, r"C:\Notes\draft.md")
            .expect("another window should reserve the released document");

        assert!(matches!(next, ReserveOutcome::Reserved { .. }));
    }

    #[test]
    fn commit_precisely_releases_a_previous_document_during_switch() {
        let service = service();
        let first_path = r"C:\Notes\first.md";
        let current_path = r"C:\Notes\current.md";
        let pending_path = r"C:\Notes\pending.md";
        let first_token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, first_path)
                .expect("first document should reserve"),
        );
        service
            .commit("window-a", SESSION_A, first_token, first_path)
            .expect("first document should commit");
        let current_token = reserved_token(
            service
                .reserve("window-a", OPERATION_B, current_path)
                .expect("current document should reserve"),
        );
        service
            .commit("window-a", SESSION_A, current_token, current_path)
            .expect("current document should commit");
        service
            .reserve("window-a", OPERATION_C, pending_path)
            .expect("unrelated operation should remain pending");

        let released = service
            .release_owned("window-a", SESSION_A, first_path)
            .expect("the replaced ownership should already be absent");
        let first_available = service
            .reserve("window-b", ClaimOperation::new(SESSION_A, 201), first_path)
            .expect("the previous document should become available");
        let current_still_owned = service
            .reserve(
                "window-b",
                ClaimOperation::new(SESSION_A, 202),
                current_path,
            )
            .expect("the current document should remain owned");
        let pending_still_reserved = service
            .reserve(
                "window-b",
                ClaimOperation::new(SESSION_A, 203),
                pending_path,
            )
            .expect("the unrelated pending operation should remain intact");

        assert_eq!(released, ReleaseOwnedOutcome::NotOwned);
        assert!(matches!(first_available, ReserveOutcome::Reserved { .. }));
        assert_eq!(
            (current_still_owned, pending_still_reserved),
            (
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
            )
        );
    }

    #[test]
    fn commit_operation_atomically_replaces_the_same_windows_previous_owned_document() {
        let service = service();
        let first_path = r"C:\Notes\first.md";
        let current_path = r"C:\Notes\current.md";
        service
            .reserve("window-a", OPERATION_A, first_path)
            .expect("first document should reserve");
        service
            .commit_operation("window-a", SESSION_A, 101, first_path)
            .expect("first document should commit");
        service
            .reserve("window-a", OPERATION_B, current_path)
            .expect("current document should reserve");

        let committed = service
            .commit_operation("window-a", SESSION_A, 102, current_path)
            .expect("current document should atomically replace the previous owner");
        let previous_available = service
            .reserve("window-b", ClaimOperation::new(SESSION_A, 201), first_path)
            .expect("previous document should become available at commit");
        let current_owned = service
            .reserve(
                "window-b",
                ClaimOperation::new(SESSION_A, 202),
                current_path,
            )
            .expect("current document should remain owned by the first window");

        assert_eq!(committed, CommitOutcome::Committed);
        assert!(matches!(
            previous_available,
            ReserveOutcome::Reserved { .. }
        ));
        assert_eq!(
            current_owned,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn release_owned_is_idempotent_when_no_committed_owner_exists() {
        let service = service();
        service
            .begin_session("window-a", SESSION_A)
            .expect("the caller session should begin");

        let first = service
            .release_owned("window-a", SESSION_A, r"C:\Notes\missing.md")
            .expect("missing ownership is an idempotent outcome");
        let second = service
            .release_owned("window-a", SESSION_A, r"C:\Notes\missing.md")
            .expect("repeated missing ownership remains idempotent");

        assert_eq!(
            (first, second),
            (ReleaseOwnedOutcome::NotOwned, ReleaseOwnedOutcome::NotOwned,)
        );
    }

    #[test]
    fn release_owned_fails_closed_for_another_window() {
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
                .expect("document should reserve"),
        );
        service
            .commit("window-a", SESSION_A, token, r"C:\Notes\draft.md")
            .expect("document should commit");
        service
            .begin_session("window-b", SESSION_A)
            .expect("the non-owner caller session should begin");

        let error = service
            .release_owned("window-b", SESSION_A, r"C:\Notes\draft.md")
            .expect_err("a non-owner must not release committed ownership");
        let conflict = service
            .reserve("window-c", OPERATION_C, r"C:\Notes\draft.md")
            .expect("the rejected release must leave ownership intact");

        assert_eq!(
            (error, conflict),
            (
                ClaimError::OwnedByOtherWindow {
                    owned_by: "window-a".to_owned(),
                },
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
            )
        );
    }

    #[test]
    fn release_owned_does_not_remove_a_pending_reservation() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect("document should reserve");

        let release = service
            .release_owned("window-a", SESSION_A, r"C:\Notes\draft.md")
            .expect("pending state is not committed ownership");
        let conflict = service
            .reserve("window-b", OPERATION_B, r"C:\Notes\draft.md")
            .expect("the pending reservation should remain intact");

        assert_eq!(release, ReleaseOwnedOutcome::NotOwned);
        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn generated_tokens_are_monotonically_unique_within_a_service() {
        let service = service();
        let first = reserved_token(
            service
                .reserve("window-a", OPERATION_A, r"C:\Notes\first.md")
                .expect("first reservation should succeed"),
        );
        let second = reserved_token(
            service
                .reserve("window-a", OPERATION_B, r"C:\Notes\second.md")
                .expect("second reservation should succeed"),
        );

        assert!(first.key.sequence < second.key.sequence);
    }

    #[test]
    fn a_token_from_another_service_cannot_commit_a_local_reservation() {
        let first_service = service();
        let foreign_token = reserved_token(
            first_service
                .reserve("window-a", OPERATION_A, r"C:\Notes\first.md")
                .expect("foreign reservation should succeed"),
        );
        let second_service = service();
        second_service
            .reserve("window-a", OPERATION_B, r"C:\Notes\second.md")
            .expect("local reservation should succeed");

        let error = second_service
            .commit("window-a", SESSION_A, foreign_token, r"C:\Notes\first.md")
            .expect_err("opaque tokens must be scoped to their service");

        assert_eq!(error, ClaimError::StaleToken);
    }

    #[test]
    fn drive_and_extended_drive_paths_share_a_case_insensitive_identity() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\Draft.md")
            .expect("reservation should succeed");

        let conflict = service
            .reserve("window-b", OPERATION_B, r"\\?\c:\notes\DRAFT.md")
            .expect("aliases should resolve to one identity");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn normal_drive_paths_trim_win32_trailing_dots_and_spaces() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"C:\Notes\Draft.md")
            .expect("first reservation should succeed");

        let conflict = service
            .reserve("window-b", OPERATION_B, "c:\\notes\\DRAFT.md. ")
            .expect("normal Win32 aliases should share one identity");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn normal_unc_paths_trim_win32_trailing_dots_and_spaces() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"\\Server\Share\Notes\Draft.md")
            .expect("first reservation should succeed");

        let conflict = service
            .reserve(
                "window-b",
                OPERATION_B,
                "\\\\server\\share\\notes\\DRAFT.md. ",
            )
            .expect("normal UNC aliases should share one identity");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn verbatim_drive_paths_preserve_trailing_dots_and_spaces() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"\\?\C:\Notes\Draft.md")
            .expect("first verbatim reservation should succeed");

        let distinct = service
            .reserve("window-b", OPERATION_B, r"\\?\C:\Notes\Draft.md.")
            .expect("verbatim trailing dots identify a distinct path");

        assert!(matches!(distinct, ReserveOutcome::Reserved { .. }));
    }

    #[test]
    fn verbatim_unc_paths_preserve_trailing_dots_and_spaces() {
        let service = service();
        service
            .reserve(
                "window-a",
                OPERATION_A,
                r"\\?\UNC\Server\Share\Notes\Draft.md",
            )
            .expect("first verbatim reservation should succeed");

        let distinct = service
            .reserve(
                "window-b",
                OPERATION_B,
                r"\\?\UNC\Server\Share\Notes\Draft.md ",
            )
            .expect("verbatim trailing spaces identify a distinct path");

        assert!(matches!(distinct, ReserveOutcome::Reserved { .. }));
    }

    #[test]
    fn an_existing_directory_alias_resolves_to_the_same_document_identity() {
        let temp = TestDirectory::new("alias");
        let real_directory = temp.path().join("real");
        let alias_directory = temp.path().join("alias");
        fs::create_dir(&real_directory).expect("real directory should be created");
        fs::write(real_directory.join("draft.md"), "draft").expect("document should be created");
        create_directory_alias(&real_directory, &alias_directory);
        let real_path = real_directory.join("draft.md");
        let alias_path = alias_directory.join("draft.md");
        let service = service();
        service
            .reserve(
                "window-a",
                OPERATION_A,
                real_path.to_str().expect("test path should be Unicode"),
            )
            .expect("real path should reserve");

        let conflict = service
            .reserve(
                "window-b",
                OPERATION_B,
                alias_path.to_str().expect("test path should be Unicode"),
            )
            .expect("filesystem aliases should share one identity");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn a_missing_document_under_an_existing_directory_alias_fails_closed_to_one_identity() {
        let temp = TestDirectory::new("missing-alias");
        let real_directory = temp.path().join("real");
        let alias_directory = temp.path().join("alias");
        fs::create_dir(&real_directory).expect("real directory should be created");
        create_directory_alias(&real_directory, &alias_directory);
        let real_path = real_directory.join("future.md");
        let alias_path = alias_directory.join("future.md");
        let service = service();
        service
            .reserve(
                "window-a",
                OPERATION_A,
                real_path.to_str().expect("test path should be Unicode"),
            )
            .expect("real missing path should reserve");

        let conflict = service
            .reserve(
                "window-b",
                OPERATION_B,
                alias_path.to_str().expect("test path should be Unicode"),
            )
            .expect("missing paths under an existing alias should fail closed");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn deleting_a_claimed_directory_alias_cannot_orphan_its_lexical_claim() {
        let temp = TestDirectory::new("deleted-alias");
        let real_directory = temp.path().join("real");
        let alias_directory = temp.path().join("alias");
        fs::create_dir(&real_directory).expect("real directory should be created");
        fs::write(real_directory.join("draft.md"), "draft").expect("document should be created");
        create_directory_alias(&real_directory, &alias_directory);
        let alias_path = alias_directory.join("draft.md");
        let alias_path = alias_path.to_str().expect("test path should be Unicode");
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, alias_path)
                .expect("alias should reserve"),
        );
        service
            .commit("window-a", SESSION_A, token, alias_path)
            .expect("alias ownership should commit");
        fs::remove_dir(&alias_directory).expect("directory alias should be removable");

        let conflict = service
            .reserve("window-b", OPERATION_B, alias_path)
            .expect("the visible alias must remain claimed after deletion");
        let released = service
            .release_owned("window-a", SESSION_A, alias_path)
            .expect("the original lexical alias must release its ownership");

        assert_eq!(
            (conflict, released),
            (
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
                ReleaseOwnedOutcome::Released,
            )
        );
    }

    #[test]
    fn repointing_a_claimed_directory_alias_cannot_change_its_claim_identity() {
        let temp = TestDirectory::new("repointed-alias");
        let first_directory = temp.path().join("first");
        let second_directory = temp.path().join("second");
        let alias_directory = temp.path().join("alias");
        fs::create_dir(&first_directory).expect("first directory should be created");
        fs::create_dir(&second_directory).expect("second directory should be created");
        fs::write(first_directory.join("draft.md"), "first")
            .expect("first document should be created");
        fs::write(second_directory.join("draft.md"), "second")
            .expect("second document should be created");
        create_directory_alias(&first_directory, &alias_directory);
        let alias_path = alias_directory.join("draft.md");
        let alias_path = alias_path.to_str().expect("test path should be Unicode");
        let service = service();
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, alias_path)
                .expect("first alias target should reserve"),
        );
        service
            .commit("window-a", SESSION_A, token, alias_path)
            .expect("first alias target should commit");
        fs::remove_dir(&alias_directory).expect("old directory alias should be removable");
        create_directory_alias(&second_directory, &alias_directory);

        let conflict = service
            .reserve("window-b", OPERATION_B, alias_path)
            .expect("the lexical alias should still identify the original claim");
        let released = service
            .release_owned("window-a", SESSION_A, alias_path)
            .expect("the original lexical alias should release after repointing");

        assert_eq!(
            (conflict, released),
            (
                ReserveOutcome::OwnedBy {
                    window_label: "window-a".to_owned(),
                },
                ReleaseOwnedOutcome::Released,
            )
        );
    }

    #[test]
    fn lexical_and_resolved_keys_pointing_to_different_claims_fail_closed() {
        let temp = TestDirectory::new("dual-key-conflict");
        let first_directory = temp.path().join("first");
        let second_directory = temp.path().join("second");
        let alias_directory = temp.path().join("alias");
        fs::create_dir(&first_directory).expect("first directory should be created");
        fs::create_dir(&second_directory).expect("second directory should be created");
        fs::write(first_directory.join("draft.md"), "first")
            .expect("first document should be created");
        fs::write(second_directory.join("draft.md"), "second")
            .expect("second document should be created");
        create_directory_alias(&first_directory, &alias_directory);
        let alias_path = alias_directory.join("draft.md");
        let alias_path = alias_path.to_str().expect("test path should be Unicode");
        let second_path = second_directory.join("draft.md");
        let second_path = second_path.to_str().expect("test path should be Unicode");
        let service = service();
        let first_token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, alias_path)
                .expect("lexical alias should reserve"),
        );
        service
            .commit("window-a", SESSION_A, first_token, alias_path)
            .expect("lexical alias should commit");
        let second_token = reserved_token(
            service
                .reserve("window-b", ClaimOperation::new(SESSION_A, 201), second_path)
                .expect("second target should reserve independently"),
        );
        service
            .commit("window-b", SESSION_A, second_token, second_path)
            .expect("second target should commit");
        fs::remove_dir(&alias_directory).expect("old alias should be removable");
        create_directory_alias(&second_directory, &alias_directory);

        let error = service
            .reserve("window-c", ClaimOperation::new(SESSION_A, 301), alias_path)
            .expect_err("dual-key claims must be an explicit ambiguity");

        assert_eq!(error, ClaimError::AmbiguousPathIdentity);
    }

    #[test]
    fn alias_retarget_is_rejected_at_read_and_commit_boundaries() {
        let temp = TestDirectory::new("retarget-boundary");
        let first_directory = temp.path().join("first");
        let second_directory = temp.path().join("second");
        let alias_directory = temp.path().join("alias");
        fs::create_dir(&first_directory).expect("first directory should be created");
        fs::create_dir(&second_directory).expect("second directory should be created");
        fs::write(first_directory.join("draft.md"), "first")
            .expect("first document should be created");
        fs::write(second_directory.join("draft.md"), "second")
            .expect("second document should be created");
        create_directory_alias(&first_directory, &alias_directory);
        let alias_path = alias_directory.join("draft.md");
        let alias_path = alias_path.to_str().expect("test path should be Unicode");
        let service = service();
        service
            .reserve("window-a", OPERATION_A, alias_path)
            .expect("first alias target should reserve");
        fs::remove_dir(&alias_directory).expect("old alias should be removable");
        create_directory_alias(&second_directory, &alias_directory);

        let read_error = service
            .validate_operation_path("window-a", SESSION_A, 101, alias_path)
            .expect_err("read must not follow a retargeted alias");
        let commit_error = service
            .commit_operation("window-a", SESSION_A, 101, alias_path)
            .expect_err("commit must not follow a retargeted alias");

        assert_eq!(
            (read_error, commit_error),
            (
                ClaimError::PathIdentityChanged,
                ClaimError::PathIdentityChanged,
            )
        );
    }

    #[test]
    fn unc_and_extended_unc_paths_share_a_case_insensitive_identity() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"\\Server\Share\Notes\Draft.md")
            .expect("reservation should succeed");

        let conflict = service
            .reserve(
                "window-b",
                OPERATION_B,
                r"\\?\UNC\server\share\notes\DRAFT.md",
            )
            .expect("aliases should resolve to one identity");

        assert_eq!(
            conflict,
            ReserveOutcome::OwnedBy {
                window_label: "window-a".to_owned(),
            }
        );
    }

    #[test]
    fn different_unc_shares_do_not_collide() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"\\Server\Share-A\Notes\Draft.md")
            .expect("first reservation should succeed");

        let other_share = service
            .reserve("window-b", OPERATION_B, r"\\server\share-b\notes\draft.md")
            .expect("a different share should remain distinct");

        assert!(matches!(other_share, ReserveOutcome::Reserved { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn posix_paths_remain_case_sensitive() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, "/notes/Draft.md")
            .expect("first reservation should succeed");

        let case_distinct = service
            .reserve("window-b", OPERATION_B, "/notes/draft.md")
            .expect("case-distinct POSIX paths should not collide");

        assert!(matches!(case_distinct, ReserveOutcome::Reserved { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn posix_backslashes_are_literal_characters() {
        let service = service();
        service
            .reserve("window-a", OPERATION_A, r"/notes/a\b.md")
            .expect("first reservation should succeed");

        let distinct = service
            .reserve("window-b", OPERATION_B, "/notes/a/b.md")
            .expect("a POSIX backslash must not become a separator");

        assert!(matches!(distinct, ReserveOutcome::Reserved { .. }));
    }

    #[test]
    fn drive_paths_cannot_escape_above_their_root() {
        let error = service()
            .reserve("window-a", OPERATION_A, r"C:\..\draft.md")
            .expect_err("root traversal must be rejected");

        assert_eq!(error, ClaimError::InvalidPath);
    }

    #[test]
    fn unc_paths_cannot_escape_above_their_share() {
        let error = service()
            .reserve("window-a", OPERATION_A, r"\\Server\Share\..\draft.md")
            .expect_err("share traversal must be rejected");

        assert_eq!(error, ClaimError::InvalidPath);
    }

    #[test]
    fn extended_unc_paths_cannot_escape_above_their_share() {
        let error = service()
            .reserve("window-a", OPERATION_A, r"\\?\UNC\Server\Share\..\draft.md")
            .expect_err("extended share traversal must be rejected");

        assert_eq!(error, ClaimError::InvalidPath);
    }

    #[cfg(unix)]
    #[test]
    fn posix_paths_cannot_escape_above_their_root() {
        let error = service()
            .reserve("window-a", OPERATION_A, "/../draft.md")
            .expect_err("root traversal must be rejected");

        assert_eq!(error, ClaimError::InvalidPath);
    }

    #[test]
    fn relative_paths_are_rejected() {
        let error = service()
            .reserve("window-a", OPERATION_A, "notes/draft.md")
            .expect_err("document claims require an absolute identity");

        assert_eq!(error, ClaimError::InvalidPath);
    }

    #[test]
    fn reserved_device_namespaces_are_rejected() {
        let error = service()
            .reserve(
                "window-a",
                OPERATION_A,
                r"\\.\GLOBALROOT\Device\HarddiskVolume1\draft.md",
            )
            .expect_err("device namespaces are not document identities");

        assert_eq!(error, ClaimError::InvalidPath);
    }

    #[test]
    fn empty_window_labels_are_rejected() {
        let error = service()
            .reserve("", OPERATION_A, r"C:\Notes\draft.md")
            .expect_err("claims require a stable window label");

        assert_eq!(error, ClaimError::EmptyWindowLabel);
    }

    #[test]
    fn empty_session_ids_are_rejected() {
        let error = service()
            .reserve(
                "window-a",
                ClaimOperation::new("", 101),
                r"C:\Notes\draft.md",
            )
            .expect_err("claims require a caller session epoch");

        assert_eq!(error, ClaimError::EmptySessionId);
    }

    #[test]
    fn zero_operation_ids_are_rejected_at_every_operation_boundary() {
        let service = service();
        let reserve_error = service
            .reserve(
                "window-a",
                ClaimOperation::new(SESSION_A, 0),
                r"C:\Notes\draft.md",
            )
            .expect_err("reserve requires a nonzero operation id");
        service
            .begin_session("window-a", SESSION_A)
            .expect("the caller session should begin");
        let validate_error = service
            .validate_operation_path("window-a", SESSION_A, 0, r"C:\Notes\draft.md")
            .expect_err("validation requires a nonzero operation id");
        let io_error = service
            .with_validated_operation_io("window-a", SESSION_A, 0, r"C:\Notes\draft.md", |_| ())
            .expect_err("claimed I/O requires a nonzero operation id");
        let commit_error = service
            .commit_operation("window-a", SESSION_A, 0, r"C:\Notes\draft.md")
            .expect_err("commit requires a nonzero operation id");
        let release_error = service
            .release_operation("window-a", SESSION_A, 0, r"C:\Notes\draft.md")
            .expect_err("release requires a nonzero operation id");

        assert_eq!(
            (
                reserve_error,
                validate_error,
                io_error,
                commit_error,
                release_error,
            ),
            (
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
            )
        );
    }

    #[test]
    fn operation_ids_above_the_javascript_safe_integer_are_rejected_everywhere() {
        let service = service();
        let unsafe_operation_id = MAX_SAFE_SESSION_GENERATION + 1;
        let reserve_error = service
            .reserve(
                "window-a",
                ClaimOperation::new(SESSION_A, unsafe_operation_id),
                r"C:\Notes\draft.md",
            )
            .expect_err("reserve requires a JavaScript-safe operation id");
        service
            .begin_session("window-a", SESSION_A)
            .expect("the caller session should begin");
        let validate_error = service
            .validate_operation_path(
                "window-a",
                SESSION_A,
                unsafe_operation_id,
                r"C:\Notes\draft.md",
            )
            .expect_err("validation requires a JavaScript-safe operation id");
        let io_error = service
            .with_validated_operation_io(
                "window-a",
                SESSION_A,
                unsafe_operation_id,
                r"C:\Notes\draft.md",
                |_| (),
            )
            .expect_err("claimed I/O requires a JavaScript-safe operation id");
        let commit_error = service
            .commit_operation(
                "window-a",
                SESSION_A,
                unsafe_operation_id,
                r"C:\Notes\draft.md",
            )
            .expect_err("commit requires a JavaScript-safe operation id");
        let release_error = service
            .release_operation(
                "window-a",
                SESSION_A,
                unsafe_operation_id,
                r"C:\Notes\draft.md",
            )
            .expect_err("release requires a JavaScript-safe operation id");

        assert_eq!(
            (
                reserve_error,
                validate_error,
                io_error,
                commit_error,
                release_error,
            ),
            (
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
                ClaimError::InvalidOperationId,
            )
        );
    }

    #[test]
    fn poisoned_state_is_returned_as_a_module_error() {
        let service = Arc::new(service());
        let poisoner = Arc::clone(&service);
        let joined = thread::spawn(move || {
            let _guard = poisoner
                .state
                .lock()
                .expect("test should acquire the state");
            panic!("poison the claim registry for the test");
        })
        .join();
        assert!(joined.is_err(), "the poison thread must panic");

        let error = service
            .reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
            .expect_err("poisoned state must fail closed");

        assert_eq!(error, ClaimError::LockPoisoned);
    }

    #[test]
    fn owner_query_reports_pending_and_committed_claims_without_exposing_tokens() {
        let service = service();
        let document_path = r"C:\Notes\draft.md";
        assert_eq!(
            service.owner_for_path(document_path),
            Ok(None),
            "an unclaimed path should not have a routing owner"
        );
        let token = reserved_token(
            service
                .reserve("window-a", OPERATION_A, document_path)
                .expect("path should reserve"),
        );

        assert_eq!(
            service.owner_for_path(document_path),
            Ok(Some(DocumentClaimPathOwner::Pending {
                window_label: "window-a".to_owned(),
            }))
        );

        service
            .commit("window-a", SESSION_A, token, document_path)
            .expect("reservation should commit");
        assert_eq!(
            service.owner_for_path(document_path),
            Ok(Some(DocumentClaimPathOwner::Owned {
                window_label: "window-a".to_owned(),
            }))
        );
    }

    #[test]
    fn owner_identity_query_scans_the_registry_without_resolving_again() {
        let service = service();
        let document_path = r"C:\Notes\identity-route.md";
        service
            .reserve("window-a", OPERATION_A, document_path)
            .expect("path should reserve");
        let identity =
            DocumentPathIdentity::resolve(document_path).expect("query identity should resolve");

        DocumentPathIdentity::reset_resolution_attempts();
        assert_eq!(
            service.owner_for_identity(&identity),
            Ok(Some(DocumentClaimPathOwner::Pending {
                window_label: "window-a".to_owned(),
            }))
        );
        assert_eq!(DocumentPathIdentity::resolution_attempts(), 0);
    }

    #[test]
    fn owner_query_uses_the_shared_resolved_identity_for_filesystem_aliases() {
        let temp = TestDirectory::new("owner-query-alias");
        let real_directory = temp.path().join("real");
        let alias_directory = temp.path().join("alias");
        fs::create_dir_all(&real_directory).expect("real directory should exist");
        create_directory_alias(&real_directory, &alias_directory);
        let real_path = real_directory.join("draft.md");
        let alias_path = alias_directory.join("draft.md");
        fs::write(&real_path, "draft").expect("test document should exist");
        let service = {
            let service = service();
            service
                .reserve(
                    "window-a",
                    OPERATION_A,
                    alias_path.to_str().expect("alias path should be Unicode"),
                )
                .expect("alias should reserve");
            service
        };

        assert_eq!(
            service.owner_for_path(real_path.to_str().expect("real path should be Unicode")),
            Ok(Some(DocumentClaimPathOwner::Pending {
                window_label: "window-a".to_owned(),
            }))
        );
    }

    #[test]
    fn owner_query_fails_closed_when_lexical_and_resolved_keys_disagree() {
        let temp = TestDirectory::new("owner-query-ambiguous");
        let first_directory = temp.path().join("first");
        let second_directory = temp.path().join("second");
        let alias_directory = temp.path().join("alias");
        fs::create_dir_all(&first_directory).expect("first directory should exist");
        fs::create_dir_all(&second_directory).expect("second directory should exist");
        create_directory_alias(&first_directory, &alias_directory);
        let alias_path = alias_directory.join("draft.md");
        let second_path = second_directory.join("draft.md");
        fs::write(first_directory.join("draft.md"), "first").expect("first document should exist");
        fs::write(&second_path, "second").expect("second document should exist");
        let service = service();
        let first_token = reserved_token(
            service
                .reserve(
                    "window-a",
                    OPERATION_A,
                    alias_path.to_str().expect("alias path should be Unicode"),
                )
                .expect("alias should reserve"),
        );
        let second_token = reserved_token(
            service
                .reserve(
                    "window-b",
                    OPERATION_B,
                    second_path.to_str().expect("second path should be Unicode"),
                )
                .expect("second document should reserve"),
        );
        let query_identity = DocumentPathIdentity::resolve(
            alias_path.to_str().expect("alias path should be Unicode"),
        )
        .expect("query identity should resolve");
        let mut registry = service
            .state
            .lock()
            .expect("test should acquire the registry");
        assert!(
            registry.identity_claims.get(query_identity.lexical_alias()) == Some(&first_token.key)
        );
        registry
            .identity_claims
            .insert(query_identity.resolved().clone(), second_token.key);
        drop(registry);

        assert_eq!(
            service.owner_for_path(alias_path.to_str().expect("alias path should be Unicode")),
            Err(ClaimError::AmbiguousPathIdentity)
        );
    }

    #[test]
    fn concurrent_alias_reservations_have_exactly_one_claimant() {
        let service = Arc::new(service());
        let barrier = Arc::new(Barrier::new(3));
        let first_service = Arc::clone(&service);
        let first_barrier = Arc::clone(&barrier);
        let first = thread::spawn(move || {
            first_barrier.wait();
            first_service.reserve("window-a", OPERATION_A, r"C:\Notes\draft.md")
        });
        let second_service = Arc::clone(&service);
        let second_barrier = Arc::clone(&barrier);
        let second = thread::spawn(move || {
            second_barrier.wait();
            second_service.reserve("window-b", OPERATION_B, r"\\?\c:\notes\DRAFT.md")
        });
        barrier.wait();

        let outcomes = [
            first.join().expect("first worker should not panic"),
            second.join().expect("second worker should not panic"),
        ];
        let reservations = outcomes
            .iter()
            .filter(|outcome| matches!(outcome, Ok(ReserveOutcome::Reserved { .. })))
            .count();
        let conflicts = outcomes
            .iter()
            .filter(|outcome| matches!(outcome, Ok(ReserveOutcome::OwnedBy { .. })))
            .count();

        assert_eq!((reservations, conflicts), (1, 1));
    }
}
