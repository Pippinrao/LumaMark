//! Exactly-once lifecycle bookkeeping for desktop open requests.
//!
//! Active requests remain registered until durable completion. Acknowledged
//! requests are compacted into exact sequence ranges plus a bounded recent fence,
//! so stale callbacks cannot replay work and persistence cost follows active work
//! instead of process lifetime. Applying a request is recorded separately from
//! acknowledging its persisted completion: persistence failures therefore remain
//! reconcilable without putting applied work back in the queue.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    error::Error,
    fmt,
    sync::Mutex,
};

use serde::{
    de::{self, Visitor},
    Deserialize, Deserializer, Serialize, Serializer,
};

const MAX_RECENT_COMPLETION_FENCES: usize = 128;

/// Stable caller-provided identity used to deduplicate an open request.
#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize)]
#[serde(transparent)]
pub struct OpenRequestId(String);

impl OpenRequestId {
    /// Creates a non-empty request identity.
    ///
    /// # Errors
    /// Returns [`LifecycleError::InvalidRequestId`] for empty or whitespace-only input.
    pub fn new(value: impl Into<String>) -> Result<Self, LifecycleError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(LifecycleError::InvalidRequestId);
        }
        Ok(Self(value))
    }

    /// Returns the identity exactly as supplied by the caller.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for OpenRequestId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// Window or session identity that owns an in-flight delivery lease.
#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize)]
#[serde(transparent)]
pub struct DeliveryOwner(String);

impl DeliveryOwner {
    /// Creates a non-empty delivery-owner identity.
    ///
    /// # Errors
    /// Returns [`LifecycleError::InvalidDeliveryOwner`] for empty or whitespace-only input.
    pub fn new(value: impl Into<String>) -> Result<Self, LifecycleError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(LifecycleError::InvalidDeliveryOwner);
        }
        Ok(Self(value))
    }

    /// Returns the owner identity exactly as supplied by the caller.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for DeliveryOwner {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::new(value).map_err(serde::de::Error::custom)
    }
}

/// Opaque fencing identity for one concrete delivery attempt.
///
/// Tokens intentionally expose no numeric or hash representation. Callers may
/// only retain, clone, serialize, and return them to lifecycle operations.
/// Durable JSON and IPC both use canonical unsigned-decimal strings so JavaScript
/// observers cannot lose u64 identity; legacy numeric snapshots still restore.
#[derive(Clone, Eq, PartialEq)]
pub struct DeliveryAttemptToken(u64);

impl Serialize for DeliveryAttemptToken {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_canonical_decimal())
    }
}

impl<'de> Deserialize<'de> for DeliveryAttemptToken {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct TokenVisitor;

        impl Visitor<'_> for TokenVisitor {
            type Value = DeliveryAttemptToken;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a canonical unsigned decimal attempt token")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                DeliveryAttemptToken::from_canonical_decimal(value).map_err(E::custom)
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                Ok(DeliveryAttemptToken(value))
            }
        }

        deserializer.deserialize_any(TokenVisitor)
    }
}

impl fmt::Debug for DeliveryAttemptToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DeliveryAttemptToken(<opaque>)")
    }
}

impl DeliveryAttemptToken {
    /// Parses the canonical unsigned-decimal IPC representation without exposing
    /// the token's numeric identity to callers.
    pub(crate) fn from_canonical_decimal(value: &str) -> Result<Self, LifecycleError> {
        let is_canonical = value == "0"
            || value
                .as_bytes()
                .first()
                .is_some_and(|first| (b'1'..=b'9').contains(first))
                && value.as_bytes()[1..]
                    .iter()
                    .all(|byte| byte.is_ascii_digit());
        if !is_canonical {
            return Err(LifecycleError::InvalidAttemptToken);
        }
        value
            .parse::<u64>()
            .map(Self)
            .map_err(|_| LifecycleError::InvalidAttemptToken)
    }

    /// Returns the canonical unsigned-decimal IPC representation.
    pub(crate) fn to_canonical_decimal(&self) -> String {
        self.0.to_string()
    }
}

/// Persistable state of one registered request.
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    deny_unknown_fields,
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RequestLifecycleState {
    /// Eligible for a future delivery claim.
    Queued {},
    /// Claimed by one owner until the logical lease expiry.
    Processing {
        /// Window or session that exclusively owns the lease.
        owner: DeliveryOwner,
        /// Caller-supplied monotonic logical time at which recovery may requeue the request.
        lease_expires_at: u64,
        /// Fencing identity that prevents stale callbacks from mutating later leases.
        attempt_token: DeliveryAttemptToken,
    },
    /// Applied by the owner, but its durable completion acknowledgement is pending.
    AppliedPendingAcknowledgement {
        /// Owner that applied the request and may acknowledge its persisted completion.
        owner: DeliveryOwner,
        /// Attempt that applied the request and may acknowledge completion.
        attempt_token: DeliveryAttemptToken,
    },
    /// Synthetic terminal state returned for a bounded exact retry fence.
    ///
    /// Completed records are never retained in the active record collection.
    /// Durable completion is compacted into acknowledged sequence ranges, with
    /// only a bounded recent owner/attempt fence exposed through this variant.
    Completed {
        /// Owner that completed the request.
        owner: DeliveryOwner,
        /// Only attempt for which terminal retries are idempotent.
        attempt_token: DeliveryAttemptToken,
    },
}

/// Result of registering a request identity.
#[derive(Debug, Clone, Eq, PartialEq)]
pub enum EnqueueOutcome {
    /// A new request was added to the queue.
    Queued,
    /// The identity was already registered and the original payload was preserved.
    Duplicate {
        /// Current state of the existing request.
        state: RequestLifecycleState,
    },
}

/// Result of explicitly abandoning a delivery lease.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum LeaseReleaseOutcome {
    /// The matching processing lease was returned to the queue.
    Released,
    /// The request was already queued, so no state change was required.
    AlreadyQueued,
}

/// Result of recording that the consumer applied a delivery.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ApplyOutcome {
    /// The processing request entered pending-completion acknowledgement.
    Recorded,
    /// Application had already been recorded or completed.
    AlreadyRecorded,
}

/// Result of acknowledging a completion that was persisted successfully.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum CompletionAcknowledgementOutcome {
    /// The pending completion became completed.
    Acknowledged,
    /// The request was already completed.
    AlreadyAcknowledged,
}

/// Operation attached to an invalid-transition error.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum LifecycleOperation {
    /// Explicitly return a processing lease to the queue.
    AbandonDelivery,
    /// Record successful consumer application.
    RecordApplied,
    /// Confirm that completion was persisted.
    AcknowledgePersistedCompletion,
}

/// Applied request whose completion persistence or acknowledgement can be retried.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct PendingCompletionAcknowledgement {
    /// Identity of the applied request.
    pub request_id: OpenRequestId,
    /// Owner allowed to acknowledge the persisted completion.
    pub owner: DeliveryOwner,
    /// Fencing identity required to acknowledge this completion.
    pub attempt_token: DeliveryAttemptToken,
}

/// Serializable complete registry image used by a persistence adapter.
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LifecycleSnapshot<T> {
    next_sequence: u64,
    next_attempt_sequence: u64,
    acknowledged_ranges: Vec<AcknowledgedSequenceRange>,
    recent_completion_fences: Vec<CompletionFence>,
    records: Vec<SnapshotRecord<T>>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AcknowledgedSequenceRange {
    start_sequence: u64,
    end_sequence_exclusive: u64,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CompletionFence {
    sequence: u64,
    request_id: OpenRequestId,
    owner: DeliveryOwner,
    attempt_token: DeliveryAttemptToken,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SnapshotRecord<T> {
    sequence: u64,
    request_id: OpenRequestId,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<T>,
    state: RequestLifecycleState,
}

/// Reason a persisted lifecycle image was rejected.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum SnapshotValidationError {
    /// More than one record used the same request identity.
    DuplicateRequestId,
    /// A deserialized request identity was empty.
    InvalidRequestId,
    /// A deserialized processing or applied owner was empty.
    InvalidDeliveryOwner,
    /// The first record did not use sequence zero.
    SequenceMustStartAtZero,
    /// Record ordering contained a gap or duplicate sequence.
    NonContiguousSequence,
    /// The next sequence could overwrite an existing record order.
    InvalidNextSequence,
    /// The persisted request sequence cannot allocate another record safely.
    SequenceExhausted,
    /// Acknowledged ranges were empty, overlapping, adjacent, out of order, or out of bounds.
    InvalidAcknowledgedRange,
    /// Active records and acknowledged ranges did not exactly cover the allocated sequence space.
    IncompleteSequenceCoverage,
    /// A completed tombstone remained in the active-record collection.
    CompletedRecordRetained,
    /// A recent completion fence was duplicated, out of range, or inconsistent.
    InvalidCompletionFence,
    /// Payload presence did not match the persisted lifecycle state.
    InvalidPayloadState,
    /// An active attempt token could be reused or duplicated.
    InvalidAttemptSequence,
    /// The persisted attempt sequence cannot allocate another token safely.
    AttemptSequenceExhausted,
}

/// One payload claimed for delivery by an owner.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Delivery<T> {
    /// Stable identity the consumer must use for application and acknowledgement.
    pub request_id: OpenRequestId,
    /// Original payload from the first enqueue call for this identity.
    pub payload: T,
    /// Opaque fencing identity required by operations that confirm this attempt.
    pub attempt_token: DeliveryAttemptToken,
}

/// Delivery batch plus the number of queued records mutated into processing.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ClaimOrReplayBatch<T> {
    /// New claims and same-owner replays in stable request order.
    pub deliveries: Vec<Delivery<T>>,
    /// Number of queued records that allocated a new attempt token.
    pub newly_claimed: usize,
}

/// Registered request that still retains a deliverable payload.
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct ActiveRequest<T> {
    /// Stable request identity.
    pub request_id: OpenRequestId,
    /// Payload retained while queued or processing.
    pub payload: T,
    /// Current queued or processing state.
    pub state: RequestLifecycleState,
}

/// Explicit failure returned by lifecycle operations.
#[derive(Debug, Clone, Eq, PartialEq)]
pub enum LifecycleError {
    /// A caller attempted to construct an empty request identity.
    InvalidRequestId,
    /// A caller attempted to construct an empty owner identity.
    InvalidDeliveryOwner,
    /// A positive lease duration is required for delivery.
    InvalidLeaseDuration,
    /// An IPC attempt token was not a canonical unsigned 64-bit decimal string.
    InvalidAttemptToken,
    /// Computing a lease expiry overflowed the caller's logical clock.
    LogicalTimeOverflow,
    /// No additional stable request sequence can be allocated.
    SequenceExhausted,
    /// No additional attempt token can be allocated without reuse.
    AttemptSequenceExhausted,
    /// The registry mutex was poisoned; all access fails closed.
    LockPoisoned,
    /// An internal index or state/payload invariant was violated.
    CorruptRegistry,
    /// The requested identity is not registered.
    UnknownRequest {
        /// Missing request identity.
        request_id: String,
    },
    /// A lease or applied record belongs to another owner.
    OwnerMismatch {
        /// Affected request identity.
        request_id: String,
        /// Current lease or application owner.
        expected: String,
        /// Owner supplied by the rejected operation.
        actual: String,
    },
    /// A stale callback presented a token from another delivery attempt.
    AttemptMismatch {
        /// Affected request identity. Token values are deliberately omitted.
        request_id: String,
    },
    /// The requested operation is not legal from the current state.
    InvalidTransition {
        /// Affected request identity.
        request_id: String,
        /// State that rejected the operation.
        state: RequestLifecycleState,
        /// Operation the caller attempted.
        operation: LifecycleOperation,
    },
    /// A persisted registry image violated a lifecycle invariant.
    InvalidSnapshot {
        /// Validation rule that rejected the image.
        reason: SnapshotValidationError,
    },
}

impl fmt::Display for LifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::InvalidRequestId => "open request id must not be empty",
            Self::InvalidDeliveryOwner => "delivery owner must not be empty",
            Self::InvalidLeaseDuration => "delivery lease duration must be greater than zero",
            Self::InvalidAttemptToken => "delivery attempt token is invalid",
            Self::LogicalTimeOverflow => "delivery lease expiration overflowed logical time",
            Self::SequenceExhausted => "open request sequence is exhausted",
            Self::AttemptSequenceExhausted => "open request attempt sequence is exhausted",
            Self::LockPoisoned => "open request lifecycle registry is unavailable",
            Self::CorruptRegistry => "open request lifecycle registry is inconsistent",
            Self::UnknownRequest { .. } => "open request is not registered",
            Self::OwnerMismatch { .. } => "delivery lease belongs to a different owner",
            Self::AttemptMismatch { .. } => "delivery attempt is stale",
            Self::InvalidTransition { .. } => "open request lifecycle transition is invalid",
            Self::InvalidSnapshot { .. } => "persisted open request lifecycle is invalid",
        };
        formatter.write_str(message)
    }
}

impl Error for LifecycleError {}

/// Thread-safe registry that owns request deduplication and delivery leases.
pub struct OpenRequestLifecycle<T> {
    state: Mutex<LifecycleRegistryState<T>>,
}

struct LifecycleRegistryState<T> {
    next_sequence: u64,
    next_attempt_sequence: u64,
    acknowledged_ranges: Vec<AcknowledgedSequenceRange>,
    recent_completion_fences: Vec<CompletionFence>,
    records: BTreeMap<u64, LifecycleRecord<T>>,
    request_index: HashMap<OpenRequestId, u64>,
}

struct LifecycleRecord<T> {
    sequence: u64,
    request_id: OpenRequestId,
    payload: Option<T>,
    state: RequestLifecycleState,
}

impl<T> Default for OpenRequestLifecycle<T> {
    fn default() -> Self {
        Self {
            state: Mutex::new(LifecycleRegistryState {
                next_sequence: 0,
                next_attempt_sequence: 0,
                acknowledged_ranges: Vec::new(),
                recent_completion_fences: Vec::new(),
                records: BTreeMap::new(),
                request_index: HashMap::new(),
            }),
        }
    }
}

impl<T> OpenRequestLifecycle<T> {
    /// Registers the first payload for an identity and rejects known duplicates.
    ///
    /// Arbitrary identities older than the bounded recent-completion fence are
    /// not globally replay-proof at this generic layer. The production service
    /// uses canonical monotonic numeric IDs plus acknowledged sequence ranges to
    /// reject every older replay without retaining unbounded tombstones.
    ///
    /// # Errors
    /// Returns a fail-closed registry or sequence-allocation error.
    pub fn enqueue(
        &self,
        request_id: OpenRequestId,
        payload: T,
    ) -> Result<EnqueueOutcome, LifecycleError> {
        let mut state = self.lock_state()?;
        if let Some(existing_sequence) = state.request_index.get(&request_id).copied() {
            let existing = state
                .records
                .get(&existing_sequence)
                .filter(|record| record.request_id == request_id)
                .ok_or(LifecycleError::CorruptRegistry)?;
            return Ok(EnqueueOutcome::Duplicate {
                state: existing.state.clone(),
            });
        }
        if let Some(completion) = state
            .recent_completion_fences
            .iter()
            .find(|completion| completion.request_id == request_id)
        {
            return Ok(EnqueueOutcome::Duplicate {
                state: RequestLifecycleState::Completed {
                    owner: completion.owner.clone(),
                    attempt_token: completion.attempt_token.clone(),
                },
            });
        }
        let next_sequence = state
            .next_sequence
            .checked_add(1)
            .filter(|next| *next != u64::MAX)
            .ok_or(LifecycleError::SequenceExhausted)?;
        let sequence = state.next_sequence;
        if state.records.contains_key(&sequence) {
            return Err(LifecycleError::CorruptRegistry);
        }
        state.records.insert(
            sequence,
            LifecycleRecord {
                sequence,
                request_id: request_id.clone(),
                payload: Some(payload),
                state: RequestLifecycleState::Queued {},
            },
        );
        state.request_index.insert(request_id, sequence);
        state.next_sequence = next_sequence;
        Ok(EnqueueOutcome::Queued)
    }

    /// Restores a validated registry image inside the same process clock domain.
    ///
    /// Processing leases are preserved. Callers must use this only when `now`
    /// has the same meaning and epoch as the values used before snapshotting.
    ///
    /// # Errors
    /// Returns [`LifecycleError::InvalidSnapshot`] if identities, owners, or
    /// stable ordering violate registry invariants.
    pub fn restore_same_process(snapshot: LifecycleSnapshot<T>) -> Result<Self, LifecycleError> {
        Self::restore_validated(snapshot, false)
    }

    /// Restores a validated registry image after a process restart.
    ///
    /// Every unapplied processing lease is requeued because its logical clock
    /// epoch no longer exists. Applied-pending requests remain active but
    /// non-deliverable; durably completed sequences remain compacted into exact
    /// acknowledged ranges and bounded recent fences across restarts.
    ///
    /// # Errors
    /// Returns [`LifecycleError::InvalidSnapshot`] if identities, owners, or
    /// stable ordering violate registry invariants.
    pub fn restore_cold(snapshot: LifecycleSnapshot<T>) -> Result<Self, LifecycleError> {
        Self::restore_validated(snapshot, true)
    }

    fn restore_validated(
        snapshot: LifecycleSnapshot<T>,
        requeue_processing: bool,
    ) -> Result<Self, LifecycleError> {
        validate_snapshot(&snapshot)?;
        let records: BTreeMap<_, _> = snapshot
            .records
            .into_iter()
            .map(|record| {
                let state = match record.state {
                    RequestLifecycleState::Processing { .. } if requeue_processing => {
                        RequestLifecycleState::Queued {}
                    }
                    state => state,
                };
                (
                    record.sequence,
                    LifecycleRecord {
                        sequence: record.sequence,
                        request_id: record.request_id,
                        payload: record.payload,
                        state,
                    },
                )
            })
            .collect();
        let request_index = records
            .values()
            .map(|record| (record.request_id.clone(), record.sequence))
            .collect();
        Ok(Self {
            state: Mutex::new(LifecycleRegistryState {
                next_sequence: snapshot.next_sequence,
                next_attempt_sequence: snapshot.next_attempt_sequence,
                acknowledged_ranges: snapshot.acknowledged_ranges,
                recent_completion_fences: snapshot.recent_completion_fences,
                records,
                request_index,
            }),
        })
    }

    /// Requeues processing records whose leases have expired at `now`.
    ///
    /// Applied-pending and completed records are never recovered.
    ///
    /// # Errors
    /// Returns [`LifecycleError::LockPoisoned`] if the registry is unavailable.
    pub fn recover_expired_leases(&self, now: u64) -> Result<usize, LifecycleError> {
        let mut state = self.lock_state()?;
        let mut recovered = 0;
        for record in state.records.values_mut() {
            if matches!(
                record.state,
                RequestLifecycleState::Processing {
                    lease_expires_at,
                    ..
                } if lease_expires_at <= now
            ) {
                record.state = RequestLifecycleState::Queued {};
                recovered += 1;
            }
        }
        Ok(recovered)
    }

    /// Releases only unapplied processing leases owned by a destroyed window or session.
    ///
    /// # Errors
    /// Returns [`LifecycleError::LockPoisoned`] if the registry is unavailable.
    pub fn release_owner_leases(&self, owner: &DeliveryOwner) -> Result<usize, LifecycleError> {
        let mut state = self.lock_state()?;
        let mut released = 0;
        for record in state.records.values_mut() {
            if matches!(
                &record.state,
                RequestLifecycleState::Processing {
                    owner: lease_owner,
                    ..
                } if lease_owner == owner
            ) {
                record.state = RequestLifecycleState::Queued {};
                released += 1;
            }
        }
        Ok(released)
    }

    /// Explicitly abandons one matching processing lease.
    ///
    /// # Errors
    /// Returns an owner, transition, unknown-request, or registry error without
    /// mutating the protected record.
    pub fn abandon_delivery(
        &self,
        request_id: &OpenRequestId,
        owner: &DeliveryOwner,
        attempt_token: &DeliveryAttemptToken,
    ) -> Result<LeaseReleaseOutcome, LifecycleError> {
        let mut state = self.lock_state()?;
        let record_sequence = indexed_record_sequence(&state, request_id)?;
        let record = state
            .records
            .get_mut(&record_sequence)
            .ok_or(LifecycleError::CorruptRegistry)?;
        match record.state.clone() {
            RequestLifecycleState::Queued {} => Ok(LeaseReleaseOutcome::AlreadyQueued),
            RequestLifecycleState::Processing {
                owner: lease_owner, ..
            } if &lease_owner != owner => Err(LifecycleError::OwnerMismatch {
                request_id: request_id.as_str().to_owned(),
                expected: lease_owner.as_str().to_owned(),
                actual: owner.as_str().to_owned(),
            }),
            RequestLifecycleState::Processing {
                attempt_token: current_attempt,
                ..
            } if &current_attempt != attempt_token => Err(LifecycleError::AttemptMismatch {
                request_id: request_id.as_str().to_owned(),
            }),
            RequestLifecycleState::Processing { .. } => {
                record.state = RequestLifecycleState::Queued {};
                Ok(LeaseReleaseOutcome::Released)
            }
            state => Err(LifecycleError::InvalidTransition {
                request_id: request_id.as_str().to_owned(),
                state,
                operation: LifecycleOperation::AbandonDelivery,
            }),
        }
    }

    /// Records application before the caller persists and acknowledges completion.
    ///
    /// Once recorded, recovery and owner shutdown cannot make the request deliverable.
    ///
    /// # Errors
    /// Returns an owner, transition, unknown-request, or registry error without
    /// mutating the protected record.
    pub fn record_applied(
        &self,
        request_id: &OpenRequestId,
        owner: &DeliveryOwner,
        attempt_token: &DeliveryAttemptToken,
    ) -> Result<ApplyOutcome, LifecycleError> {
        let mut state = self.lock_state()?;
        let record_sequence = match indexed_record_sequence(&state, request_id) {
            Ok(record_sequence) => record_sequence,
            Err(LifecycleError::UnknownRequest { .. })
                if validate_recent_completion_retry(&state, request_id, owner, attempt_token)? =>
            {
                return Ok(ApplyOutcome::AlreadyRecorded);
            }
            Err(error) => return Err(error),
        };
        let record = state
            .records
            .get_mut(&record_sequence)
            .ok_or(LifecycleError::CorruptRegistry)?;
        match record.state.clone() {
            RequestLifecycleState::Processing {
                owner: lease_owner, ..
            } if &lease_owner != owner => Err(LifecycleError::OwnerMismatch {
                request_id: request_id.as_str().to_owned(),
                expected: lease_owner.as_str().to_owned(),
                actual: owner.as_str().to_owned(),
            }),
            RequestLifecycleState::Processing {
                attempt_token: current_attempt,
                ..
            } if &current_attempt != attempt_token => Err(LifecycleError::AttemptMismatch {
                request_id: request_id.as_str().to_owned(),
            }),
            RequestLifecycleState::Processing { .. } => {
                record.payload = None;
                record.state = RequestLifecycleState::AppliedPendingAcknowledgement {
                    owner: owner.clone(),
                    attempt_token: attempt_token.clone(),
                };
                Ok(ApplyOutcome::Recorded)
            }
            RequestLifecycleState::AppliedPendingAcknowledgement {
                owner: applied_owner,
                ..
            } if &applied_owner != owner => Err(LifecycleError::OwnerMismatch {
                request_id: request_id.as_str().to_owned(),
                expected: applied_owner.as_str().to_owned(),
                actual: owner.as_str().to_owned(),
            }),
            RequestLifecycleState::AppliedPendingAcknowledgement {
                attempt_token: applied_attempt,
                ..
            } if &applied_attempt != attempt_token => Err(LifecycleError::AttemptMismatch {
                request_id: request_id.as_str().to_owned(),
            }),
            RequestLifecycleState::Completed {
                owner: completed_owner,
                ..
            } if &completed_owner != owner => Err(LifecycleError::OwnerMismatch {
                request_id: request_id.as_str().to_owned(),
                expected: completed_owner.as_str().to_owned(),
                actual: owner.as_str().to_owned(),
            }),
            RequestLifecycleState::Completed {
                attempt_token: completed_attempt,
                ..
            } if &completed_attempt != attempt_token => Err(LifecycleError::AttemptMismatch {
                request_id: request_id.as_str().to_owned(),
            }),
            RequestLifecycleState::AppliedPendingAcknowledgement { .. }
            | RequestLifecycleState::Completed { .. } => Ok(ApplyOutcome::AlreadyRecorded),
            state => Err(LifecycleError::InvalidTransition {
                request_id: request_id.as_str().to_owned(),
                state,
                operation: LifecycleOperation::RecordApplied,
            }),
        }
    }

    /// Marks an applied request completed after durable persistence succeeds.
    ///
    /// Repeating a successful acknowledgement is idempotent.
    ///
    /// # Errors
    /// Returns an owner, transition, unknown-request, or registry error without
    /// mutating the protected record.
    pub fn acknowledge_persisted_completion(
        &self,
        request_id: &OpenRequestId,
        owner: &DeliveryOwner,
        attempt_token: &DeliveryAttemptToken,
    ) -> Result<CompletionAcknowledgementOutcome, LifecycleError> {
        let mut state = self.lock_state()?;
        let record_sequence = match indexed_record_sequence(&state, request_id) {
            Ok(record_sequence) => record_sequence,
            Err(LifecycleError::UnknownRequest { .. })
                if validate_recent_completion_retry(&state, request_id, owner, attempt_token)? =>
            {
                return Ok(CompletionAcknowledgementOutcome::AlreadyAcknowledged);
            }
            Err(error) => return Err(error),
        };
        let record = state
            .records
            .get(&record_sequence)
            .ok_or(LifecycleError::CorruptRegistry)?;
        match record.state.clone() {
            RequestLifecycleState::AppliedPendingAcknowledgement {
                owner: applied_owner,
                ..
            } if &applied_owner != owner => Err(LifecycleError::OwnerMismatch {
                request_id: request_id.as_str().to_owned(),
                expected: applied_owner.as_str().to_owned(),
                actual: owner.as_str().to_owned(),
            }),
            RequestLifecycleState::AppliedPendingAcknowledgement {
                attempt_token: applied_attempt,
                ..
            } if &applied_attempt != attempt_token => Err(LifecycleError::AttemptMismatch {
                request_id: request_id.as_str().to_owned(),
            }),
            RequestLifecycleState::AppliedPendingAcknowledgement { .. } => {
                let completion = CompletionFence {
                    sequence: record.sequence,
                    request_id: record.request_id.clone(),
                    owner: owner.clone(),
                    attempt_token: attempt_token.clone(),
                };
                let removed = state
                    .records
                    .remove(&record_sequence)
                    .ok_or(LifecycleError::CorruptRegistry)?;
                if state.request_index.remove(&removed.request_id) != Some(record_sequence) {
                    return Err(LifecycleError::CorruptRegistry);
                }
                insert_acknowledged_sequence(&mut state.acknowledged_ranges, completion.sequence)?;
                state.recent_completion_fences.push(completion);
                if state.recent_completion_fences.len() > MAX_RECENT_COMPLETION_FENCES {
                    state.recent_completion_fences.remove(0);
                }
                Ok(CompletionAcknowledgementOutcome::Acknowledged)
            }
            RequestLifecycleState::Completed {
                owner: completed_owner,
                ..
            } if &completed_owner != owner => Err(LifecycleError::OwnerMismatch {
                request_id: request_id.as_str().to_owned(),
                expected: completed_owner.as_str().to_owned(),
                actual: owner.as_str().to_owned(),
            }),
            RequestLifecycleState::Completed {
                attempt_token: completed_attempt,
                ..
            } if &completed_attempt != attempt_token => Err(LifecycleError::AttemptMismatch {
                request_id: request_id.as_str().to_owned(),
            }),
            RequestLifecycleState::Completed { .. } => {
                Ok(CompletionAcknowledgementOutcome::AlreadyAcknowledged)
            }
            state => Err(LifecycleError::InvalidTransition {
                request_id: request_id.as_str().to_owned(),
                state,
                operation: LifecycleOperation::AcknowledgePersistedCompletion,
            }),
        }
    }

    /// Returns applied completions still awaiting persistence acknowledgement.
    ///
    /// Results retain original enqueue order for deterministic reconciliation.
    ///
    /// # Errors
    /// Returns [`LifecycleError::LockPoisoned`] if the registry is unavailable.
    pub fn pending_completion_acknowledgements(
        &self,
    ) -> Result<Vec<PendingCompletionAcknowledgement>, LifecycleError> {
        let state = self.lock_state()?;
        Ok(state
            .records
            .values()
            .filter_map(|record| match &record.state {
                RequestLifecycleState::AppliedPendingAcknowledgement {
                    owner,
                    attempt_token,
                } => Some(PendingCompletionAcknowledgement {
                    request_id: record.request_id.clone(),
                    owner: owner.clone(),
                    attempt_token: attempt_token.clone(),
                }),
                _ => None,
            })
            .collect())
    }

    /// Returns the exclusive high-water mark for stable request sequences.
    pub fn sequence_high_water(&self) -> Result<u64, LifecycleError> {
        Ok(self.lock_state()?.next_sequence)
    }

    /// Returns active request identities paired with their stable sequences.
    pub fn active_request_sequences(&self) -> Result<Vec<(OpenRequestId, u64)>, LifecycleError> {
        let state = self.lock_state()?;
        Ok(state
            .records
            .values()
            .map(|record| (record.request_id.clone(), record.sequence))
            .collect())
    }

    /// Returns bounded recent completion identities paired with stable sequences.
    pub fn recent_completion_sequences(&self) -> Result<Vec<(OpenRequestId, u64)>, LifecycleError> {
        let state = self.lock_state()?;
        Ok(state
            .recent_completion_fences
            .iter()
            .map(|completion| (completion.request_id.clone(), completion.sequence))
            .collect())
    }

    /// Reports whether a stable sequence is covered by an acknowledged range.
    pub fn is_acknowledged_sequence(&self, sequence: u64) -> Result<bool, LifecycleError> {
        let state = self.lock_state()?;
        let index = state
            .acknowledged_ranges
            .partition_point(|range| range.end_sequence_exclusive <= sequence);
        Ok(state.acknowledged_ranges.get(index).is_some_and(|range| {
            range.start_sequence <= sequence && sequence < range.end_sequence_exclusive
        }))
    }

    fn lock_state(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, LifecycleRegistryState<T>>, LifecycleError> {
        self.state.lock().map_err(|_| LifecycleError::LockPoisoned)
    }
}

impl<T: Clone> OpenRequestLifecycle<T> {
    /// Clones a complete serializable registry image.
    ///
    /// # Errors
    /// Returns [`LifecycleError::LockPoisoned`] if the registry is unavailable.
    pub fn snapshot(&self) -> Result<LifecycleSnapshot<T>, LifecycleError> {
        let state = self.lock_state()?;
        Ok(LifecycleSnapshot {
            next_sequence: state.next_sequence,
            next_attempt_sequence: state.next_attempt_sequence,
            acknowledged_ranges: state.acknowledged_ranges.clone(),
            recent_completion_fences: state.recent_completion_fences.clone(),
            records: state
                .records
                .values()
                .map(|record| SnapshotRecord {
                    sequence: record.sequence,
                    request_id: record.request_id.clone(),
                    payload: record.payload.clone(),
                    state: record.state.clone(),
                })
                .collect(),
        })
    }

    /// Returns queued and processing records in stable enqueue order.
    ///
    /// # Errors
    /// Fails closed if an active record has lost its payload.
    pub fn active_requests(&self) -> Result<Vec<ActiveRequest<T>>, LifecycleError> {
        let state = self.lock_state()?;
        state
            .records
            .values()
            .filter(|record| {
                matches!(
                    record.state,
                    RequestLifecycleState::Queued {} | RequestLifecycleState::Processing { .. }
                )
            })
            .map(|record| {
                Ok(ActiveRequest {
                    request_id: record.request_id.clone(),
                    payload: record
                        .payload
                        .as_ref()
                        .ok_or(LifecycleError::CorruptRegistry)?
                        .clone(),
                    state: record.state.clone(),
                })
            })
            .collect()
    }

    /// Returns active request identities in stable enqueue order.
    ///
    /// Completed identities are compacted out of active records. Canonical
    /// numeric request replay is fenced by acknowledged sequence ranges in the
    /// service layer; arbitrary generic identities only retain the bounded
    /// recent-completion fence needed for exact owner/attempt retry semantics.
    ///
    /// # Errors
    /// Returns [`LifecycleError::LockPoisoned`] if the registry is unavailable.
    pub fn request_ids(&self) -> Result<Vec<OpenRequestId>, LifecycleError> {
        let state = self.lock_state()?;
        Ok(state
            .records
            .values()
            .map(|record| record.request_id.clone())
            .collect())
    }

    /// Claims up to `maximum` queued requests in stable enqueue order.
    ///
    /// A claimed request remains unavailable to repeated notifications and drains
    /// until explicitly abandoned or recovered after lease expiry.
    ///
    /// # Errors
    /// Returns a lease-validation, logical-time, or fail-closed registry error.
    pub fn claim_batch(
        &self,
        owner: DeliveryOwner,
        maximum: usize,
        now: u64,
        lease_duration: u64,
    ) -> Result<Vec<Delivery<T>>, LifecycleError> {
        self.claim_batch_matching(owner, maximum, now, lease_duration, |_| true)
    }

    /// Atomically claims only queued requests whose payload matches `predicate`.
    ///
    /// Non-matching requests remain queued and keep their enqueue order. The
    /// predicate runs while the registry lock is held and therefore must not
    /// call back into this lifecycle.
    ///
    /// # Errors
    /// Returns a lease-validation, logical-time, or fail-closed registry error.
    pub fn claim_batch_matching(
        &self,
        owner: DeliveryOwner,
        maximum: usize,
        now: u64,
        lease_duration: u64,
        predicate: impl Fn(&T) -> bool,
    ) -> Result<Vec<Delivery<T>>, LifecycleError> {
        let mut state = self.lock_state()?;
        if maximum == 0 {
            return Ok(Vec::new());
        }
        if lease_duration == 0 {
            return Err(LifecycleError::InvalidLeaseDuration);
        }
        let lease_expires_at = now
            .checked_add(lease_duration)
            .ok_or(LifecycleError::LogicalTimeOverflow)?;
        if state.records.values().any(|record| {
            matches!(record.state, RequestLifecycleState::Queued {}) && record.payload.is_none()
        }) {
            return Err(LifecycleError::CorruptRegistry);
        }
        let claim_sequences = state
            .records
            .iter()
            .filter_map(|(sequence, record)| {
                (matches!(record.state, RequestLifecycleState::Queued {})
                    && record.payload.as_ref().is_some_and(&predicate))
                .then_some(*sequence)
            })
            .take(maximum)
            .collect::<Vec<_>>();
        let claim_count = u64::try_from(claim_sequences.len())
            .map_err(|_| LifecycleError::AttemptSequenceExhausted)?;
        let next_attempt_sequence = state
            .next_attempt_sequence
            .checked_add(claim_count)
            .filter(|next| *next != u64::MAX)
            .ok_or(LifecycleError::AttemptSequenceExhausted)?;
        let mut attempt_sequence = state.next_attempt_sequence;
        let mut deliveries = Vec::with_capacity(claim_sequences.len());
        for record_sequence in claim_sequences {
            let record = state
                .records
                .get_mut(&record_sequence)
                .ok_or(LifecycleError::CorruptRegistry)?;
            let payload = record
                .payload
                .as_ref()
                .ok_or(LifecycleError::CorruptRegistry)?
                .clone();
            record.state = RequestLifecycleState::Processing {
                owner: owner.clone(),
                lease_expires_at,
                attempt_token: DeliveryAttemptToken(attempt_sequence),
            };
            deliveries.push(Delivery {
                request_id: record.request_id.clone(),
                payload,
                attempt_token: DeliveryAttemptToken(attempt_sequence),
            });
            attempt_sequence = attempt_sequence
                .checked_add(1)
                .ok_or(LifecycleError::AttemptSequenceExhausted)?;
        }
        state.next_attempt_sequence = next_attempt_sequence;
        Ok(deliveries)
    }

    /// Replays this owner's still-processing attempts and claims matching queued
    /// requests in one stable-order pass.
    ///
    /// This supports a reloaded consumer without rotating its fencing token, and
    /// makes repeated availability notifications idempotent for the same owner.
    ///
    /// # Errors
    /// Returns a lease-validation, logical-time, or fail-closed registry error.
    pub fn claim_or_replay_batch_matching(
        &self,
        owner: DeliveryOwner,
        maximum: usize,
        now: u64,
        lease_duration: u64,
        predicate: impl Fn(&T) -> bool,
    ) -> Result<Vec<Delivery<T>>, LifecycleError> {
        Ok(self
            .claim_or_replay_batch_matching_with_change(
                owner,
                maximum,
                now,
                lease_duration,
                predicate,
            )?
            .deliveries)
    }

    /// Replays/claims like [`Self::claim_or_replay_batch_matching`] and reports
    /// whether durable lifecycle state actually changed.
    pub fn claim_or_replay_batch_matching_with_change(
        &self,
        owner: DeliveryOwner,
        maximum: usize,
        now: u64,
        lease_duration: u64,
        predicate: impl Fn(&T) -> bool,
    ) -> Result<ClaimOrReplayBatch<T>, LifecycleError> {
        let mut state = self.lock_state()?;
        if maximum == 0 {
            return Ok(ClaimOrReplayBatch {
                deliveries: Vec::new(),
                newly_claimed: 0,
            });
        }
        if lease_duration == 0 {
            return Err(LifecycleError::InvalidLeaseDuration);
        }
        let lease_expires_at = now
            .checked_add(lease_duration)
            .ok_or(LifecycleError::LogicalTimeOverflow)?;
        if state.records.values().any(|record| {
            matches!(
                record.state,
                RequestLifecycleState::Queued {} | RequestLifecycleState::Processing { .. }
            ) && record.payload.is_none()
        }) {
            return Err(LifecycleError::CorruptRegistry);
        }
        let eligible_sequences = state
            .records
            .iter()
            .filter_map(|(sequence, record)| {
                let is_owned_processing = matches!(
                    &record.state,
                    RequestLifecycleState::Processing {
                        owner: current_owner,
                        ..
                    } if current_owner == &owner
                );
                ((matches!(record.state, RequestLifecycleState::Queued {}) || is_owned_processing)
                    && record.payload.as_ref().is_some_and(&predicate))
                .then_some(*sequence)
            })
            .take(maximum)
            .collect::<Vec<_>>();
        let newly_claimed = eligible_sequences
            .iter()
            .filter(|sequence| {
                state
                    .records
                    .get(*sequence)
                    .is_some_and(|record| matches!(record.state, RequestLifecycleState::Queued {}))
            })
            .count();
        let new_claim_count =
            u64::try_from(newly_claimed).map_err(|_| LifecycleError::AttemptSequenceExhausted)?;
        let next_attempt_sequence = state
            .next_attempt_sequence
            .checked_add(new_claim_count)
            .filter(|next| *next != u64::MAX)
            .ok_or(LifecycleError::AttemptSequenceExhausted)?;
        let mut attempt_sequence = state.next_attempt_sequence;
        let mut deliveries = Vec::with_capacity(eligible_sequences.len());
        for record_sequence in eligible_sequences {
            let record = state
                .records
                .get_mut(&record_sequence)
                .ok_or(LifecycleError::CorruptRegistry)?;
            let payload = record
                .payload
                .as_ref()
                .ok_or(LifecycleError::CorruptRegistry)?
                .clone();
            let attempt_token = match &record.state {
                RequestLifecycleState::Processing { attempt_token, .. } => attempt_token.clone(),
                RequestLifecycleState::Queued {} => {
                    let attempt_token = DeliveryAttemptToken(attempt_sequence);
                    record.state = RequestLifecycleState::Processing {
                        owner: owner.clone(),
                        lease_expires_at,
                        attempt_token: attempt_token.clone(),
                    };
                    attempt_sequence = attempt_sequence
                        .checked_add(1)
                        .ok_or(LifecycleError::AttemptSequenceExhausted)?;
                    attempt_token
                }
                _ => return Err(LifecycleError::CorruptRegistry),
            };
            deliveries.push(Delivery {
                request_id: record.request_id.clone(),
                payload,
                attempt_token,
            });
        }
        state.next_attempt_sequence = next_attempt_sequence;
        Ok(ClaimOrReplayBatch {
            deliveries,
            newly_claimed,
        })
    }
}

fn indexed_record_sequence<T>(
    state: &LifecycleRegistryState<T>,
    request_id: &OpenRequestId,
) -> Result<u64, LifecycleError> {
    let sequence = state
        .request_index
        .get(request_id)
        .copied()
        .ok_or_else(|| LifecycleError::UnknownRequest {
            request_id: request_id.as_str().to_owned(),
        })?;
    if state
        .records
        .get(&sequence)
        .is_some_and(|record| &record.request_id == request_id)
    {
        Ok(sequence)
    } else {
        Err(LifecycleError::CorruptRegistry)
    }
}

fn validate_recent_completion_retry<T>(
    state: &LifecycleRegistryState<T>,
    request_id: &OpenRequestId,
    owner: &DeliveryOwner,
    attempt_token: &DeliveryAttemptToken,
) -> Result<bool, LifecycleError> {
    let Some(completion) = state
        .recent_completion_fences
        .iter()
        .find(|completion| &completion.request_id == request_id)
    else {
        return Ok(false);
    };
    if &completion.owner != owner {
        return Err(LifecycleError::OwnerMismatch {
            request_id: request_id.as_str().to_owned(),
            expected: completion.owner.as_str().to_owned(),
            actual: owner.as_str().to_owned(),
        });
    }
    if &completion.attempt_token != attempt_token {
        return Err(LifecycleError::AttemptMismatch {
            request_id: request_id.as_str().to_owned(),
        });
    }
    Ok(true)
}

fn insert_acknowledged_sequence(
    ranges: &mut Vec<AcknowledgedSequenceRange>,
    sequence: u64,
) -> Result<(), LifecycleError> {
    let end_sequence_exclusive = sequence
        .checked_add(1)
        .ok_or(LifecycleError::SequenceExhausted)?;
    let insertion_index = ranges.partition_point(|range| range.start_sequence < sequence);
    let merge_left =
        insertion_index > 0 && ranges[insertion_index - 1].end_sequence_exclusive == sequence;
    let merge_right = insertion_index < ranges.len()
        && ranges[insertion_index].start_sequence == end_sequence_exclusive;
    match (merge_left, merge_right) {
        (true, true) => {
            let right_end = ranges[insertion_index].end_sequence_exclusive;
            ranges[insertion_index - 1].end_sequence_exclusive = right_end;
            ranges.remove(insertion_index);
        }
        (true, false) => {
            ranges[insertion_index - 1].end_sequence_exclusive = end_sequence_exclusive;
        }
        (false, true) => {
            ranges[insertion_index].start_sequence = sequence;
        }
        (false, false) => ranges.insert(
            insertion_index,
            AcknowledgedSequenceRange {
                start_sequence: sequence,
                end_sequence_exclusive,
            },
        ),
    }
    Ok(())
}

fn validate_snapshot<T>(snapshot: &LifecycleSnapshot<T>) -> Result<(), LifecycleError> {
    if snapshot.next_sequence == u64::MAX {
        return Err(LifecycleError::InvalidSnapshot {
            reason: SnapshotValidationError::SequenceExhausted,
        });
    }
    if snapshot.next_attempt_sequence == u64::MAX {
        return Err(LifecycleError::InvalidSnapshot {
            reason: SnapshotValidationError::AttemptSequenceExhausted,
        });
    }
    let mut previous_range_end = None;
    for range in &snapshot.acknowledged_ranges {
        if range.start_sequence >= range.end_sequence_exclusive
            || range.end_sequence_exclusive > snapshot.next_sequence
            || previous_range_end.is_some_and(|end| end >= range.start_sequence)
        {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidAcknowledgedRange,
            });
        }
        previous_range_end = Some(range.end_sequence_exclusive);
    }
    let mut seen = HashSet::with_capacity(
        snapshot
            .records
            .len()
            .saturating_add(snapshot.recent_completion_fences.len()),
    );
    let mut seen_attempts = HashSet::new();
    let mut previous_record_sequence = None;
    for record in &snapshot.records {
        if !seen.insert(record.request_id.clone()) {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::DuplicateRequestId,
            });
        }
        if record.request_id.as_str().trim().is_empty() {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidRequestId,
            });
        }
        if record.sequence >= snapshot.next_sequence {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidNextSequence,
            });
        }
        if previous_record_sequence.is_some_and(|previous| previous >= record.sequence) {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::NonContiguousSequence,
            });
        }
        previous_record_sequence = Some(record.sequence);
        if sequence_is_acknowledged(&snapshot.acknowledged_ranges, record.sequence) {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::IncompleteSequenceCoverage,
            });
        }
        if let Some(owner) = state_owner(&record.state) {
            if owner.as_str().trim().is_empty() {
                return Err(LifecycleError::InvalidSnapshot {
                    reason: SnapshotValidationError::InvalidDeliveryOwner,
                });
            }
        }
        if matches!(record.state, RequestLifecycleState::Completed { .. }) {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::CompletedRecordRetained,
            });
        }
        let payload_is_valid = match record.state {
            RequestLifecycleState::Queued {} | RequestLifecycleState::Processing { .. } => {
                record.payload.is_some()
            }
            RequestLifecycleState::AppliedPendingAcknowledgement { .. } => record.payload.is_none(),
            RequestLifecycleState::Completed { .. } => false,
        };
        if !payload_is_valid {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidPayloadState,
            });
        }
        if let Some(attempt_token) = state_attempt(&record.state) {
            if attempt_token.0 >= snapshot.next_attempt_sequence
                || !seen_attempts.insert(attempt_token.0)
            {
                return Err(LifecycleError::InvalidSnapshot {
                    reason: SnapshotValidationError::InvalidAttemptSequence,
                });
            }
        }
    }

    if snapshot.recent_completion_fences.len() > MAX_RECENT_COMPLETION_FENCES {
        return Err(LifecycleError::InvalidSnapshot {
            reason: SnapshotValidationError::InvalidCompletionFence,
        });
    }
    let mut seen_completion_sequences = HashSet::new();
    for completion in &snapshot.recent_completion_fences {
        if completion.request_id.as_str().trim().is_empty()
            || completion.owner.as_str().trim().is_empty()
            || !sequence_is_acknowledged(&snapshot.acknowledged_ranges, completion.sequence)
            || !seen.insert(completion.request_id.clone())
            || !seen_completion_sequences.insert(completion.sequence)
        {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidCompletionFence,
            });
        }
        if completion.attempt_token.0 >= snapshot.next_attempt_sequence
            || !seen_attempts.insert(completion.attempt_token.0)
        {
            return Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidAttemptSequence,
            });
        }
    }

    let mut record_index = 0;
    let mut range_index = 0;
    let mut expected_sequence = 0_u64;
    while expected_sequence < snapshot.next_sequence {
        let record_sequence = snapshot
            .records
            .get(record_index)
            .map(|record| record.sequence);
        let range = snapshot.acknowledged_ranges.get(range_index);
        match (
            record_sequence == Some(expected_sequence),
            range.is_some_and(|range| range.start_sequence == expected_sequence),
        ) {
            (true, false) => {
                expected_sequence =
                    expected_sequence
                        .checked_add(1)
                        .ok_or(LifecycleError::InvalidSnapshot {
                            reason: SnapshotValidationError::SequenceExhausted,
                        })?;
                record_index += 1;
            }
            (false, true) => {
                expected_sequence = range
                    .ok_or(LifecycleError::CorruptRegistry)?
                    .end_sequence_exclusive;
                range_index += 1;
            }
            (true, true) => {
                return Err(LifecycleError::InvalidSnapshot {
                    reason: SnapshotValidationError::IncompleteSequenceCoverage,
                });
            }
            (false, false) => {
                let reason =
                    if expected_sequence == 0 && (record_sequence.is_some() || range.is_some()) {
                        SnapshotValidationError::SequenceMustStartAtZero
                    } else if record_sequence.is_none() && range.is_none() {
                        SnapshotValidationError::InvalidNextSequence
                    } else {
                        SnapshotValidationError::NonContiguousSequence
                    };
                return Err(LifecycleError::InvalidSnapshot { reason });
            }
        }
    }
    if record_index != snapshot.records.len() || range_index != snapshot.acknowledged_ranges.len() {
        return Err(LifecycleError::InvalidSnapshot {
            reason: SnapshotValidationError::IncompleteSequenceCoverage,
        });
    }
    Ok(())
}

fn sequence_is_acknowledged(ranges: &[AcknowledgedSequenceRange], sequence: u64) -> bool {
    let index = ranges.partition_point(|range| range.end_sequence_exclusive <= sequence);
    ranges.get(index).is_some_and(|range| {
        range.start_sequence <= sequence && sequence < range.end_sequence_exclusive
    })
}

fn state_attempt(state: &RequestLifecycleState) -> Option<&DeliveryAttemptToken> {
    match state {
        RequestLifecycleState::Processing { attempt_token, .. }
        | RequestLifecycleState::AppliedPendingAcknowledgement { attempt_token, .. }
        | RequestLifecycleState::Completed { attempt_token, .. } => Some(attempt_token),
        RequestLifecycleState::Queued {} => None,
    }
}

fn state_owner(state: &RequestLifecycleState) -> Option<&DeliveryOwner> {
    match state {
        RequestLifecycleState::Processing { owner, .. }
        | RequestLifecycleState::AppliedPendingAcknowledgement { owner, .. }
        | RequestLifecycleState::Completed { owner, .. } => Some(owner),
        RequestLifecycleState::Queued {} => None,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        sync::{Arc, Barrier},
        thread,
        time::Instant,
    };

    use super::{
        ApplyOutcome, CompletionAcknowledgementOutcome, DeliveryAttemptToken, DeliveryOwner,
        EnqueueOutcome, LeaseReleaseOutcome, LifecycleError, LifecycleOperation, OpenRequestId,
        OpenRequestLifecycle, RequestLifecycleState, SnapshotValidationError,
    };

    fn request_id(value: &str) -> OpenRequestId {
        OpenRequestId::new(value).expect("test request id should be valid")
    }

    fn owner(value: &str) -> DeliveryOwner {
        DeliveryOwner::new(value).expect("test owner should be valid")
    }

    fn claim_attempt<T: Clone>(
        lifecycle: &OpenRequestLifecycle<T>,
        delivery_owner: DeliveryOwner,
        now: u64,
        lease_duration: u64,
    ) -> DeliveryAttemptToken {
        lifecycle
            .claim_batch(delivery_owner, 1, now, lease_duration)
            .expect("request should be claimed")
            .remove(0)
            .attempt_token
    }

    #[test]
    fn identity_deserialization_should_reject_empty_request_ids() {
        let empty = serde_json::from_str::<OpenRequestId>("\"\"");
        let whitespace = serde_json::from_str::<OpenRequestId>("\"   \"");

        assert!(empty.is_err());
        assert!(whitespace.is_err());
    }

    #[test]
    fn identity_deserialization_should_reject_empty_delivery_owners() {
        let empty = serde_json::from_str::<DeliveryOwner>("\"\"");
        let whitespace = serde_json::from_str::<DeliveryOwner>("\"   \"");

        assert!(empty.is_err());
        assert!(whitespace.is_err());
    }

    #[test]
    fn untrusted_snapshot_deserialization_should_reject_an_empty_request_id() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        let mut serialized =
            serde_json::to_value(snapshot).expect("valid snapshot should serialize");
        serialized["records"][0]["requestId"] = serde_json::json!("   ");

        let restored = serde_json::from_value::<super::LifecycleSnapshot<String>>(serialized);

        assert!(restored.is_err());
    }

    #[test]
    fn untrusted_snapshot_deserialization_should_reject_an_empty_delivery_owner() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        lifecycle
            .claim_batch(owner("window-1"), 1, 10, 50)
            .expect("request should be claimed");
        let snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        let mut serialized =
            serde_json::to_value(snapshot).expect("valid snapshot should serialize");
        serialized["records"][0]["state"]["owner"] = serde_json::json!("");

        let restored = serde_json::from_value::<super::LifecycleSnapshot<String>>(serialized);

        assert!(restored.is_err());
    }

    #[test]
    fn duplicate_enqueue_should_preserve_the_first_payload_and_deliver_once() {
        let lifecycle = OpenRequestLifecycle::default();

        let first = lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("first request should enqueue");
        let duplicate = lifecycle
            .enqueue(request_id("request-1"), "replacement.md".to_owned())
            .expect("duplicate request should be handled");
        let claimed = lifecycle
            .claim_batch(owner("window-1"), 8, 10, 50)
            .expect("queued request should be claimable");
        let repeated_drain = lifecycle
            .claim_batch(owner("window-1"), 8, 11, 50)
            .expect("repeated notification drain should be safe");

        assert_eq!(first, EnqueueOutcome::Queued);
        assert!(matches!(duplicate, EnqueueOutcome::Duplicate { .. }));
        assert_eq!(
            claimed
                .iter()
                .map(|delivery| (delivery.request_id.as_str(), delivery.payload.as_str()))
                .collect::<Vec<_>>(),
            vec![("request-1", "first.md")]
        );
        assert!(repeated_drain.is_empty());
    }

    #[test]
    fn enqueue_should_fail_before_allocating_an_unsnapshotable_max_sequence() {
        let lifecycle = OpenRequestLifecycle::default();
        {
            let mut state = lifecycle
                .state
                .lock()
                .expect("fresh registry lock should be available");
            state.next_sequence = u64::MAX - 1;
        }

        let result = lifecycle.enqueue(request_id("request-1"), "first.md".to_owned());
        let state = lifecycle
            .state
            .lock()
            .expect("failed allocation should leave the registry available");

        assert_eq!(result, Err(LifecycleError::SequenceExhausted));
        assert!(state.records.is_empty());
        assert_eq!(state.next_sequence, u64::MAX - 1);
    }

    #[test]
    fn claim_batch_should_preserve_enqueue_order_across_batch_boundaries() {
        let lifecycle = OpenRequestLifecycle::default();
        for value in ["request-1", "request-2", "request-3"] {
            lifecycle
                .enqueue(request_id(value), value.to_owned())
                .expect("request should enqueue");
        }

        let first = lifecycle
            .claim_batch(owner("window-1"), 2, 10, 50)
            .expect("first batch should be claimable");
        let second = lifecycle
            .claim_batch(owner("window-1"), 2, 11, 50)
            .expect("second batch should be claimable");

        assert_eq!(
            first
                .iter()
                .chain(&second)
                .map(|delivery| delivery.request_id.as_str())
                .collect::<Vec<_>>(),
            vec!["request-1", "request-2", "request-3"]
        );
    }

    #[test]
    fn recovery_should_not_replay_a_processing_request_with_a_valid_lease() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        lifecycle
            .claim_batch(owner("window-1"), 1, 10, 50)
            .expect("request should be claimed");

        let recovered = lifecycle
            .recover_expired_leases(59)
            .expect("recovery should inspect leases");
        let replay = lifecycle
            .claim_batch(owner("window-2"), 1, 59, 50)
            .expect("second drain should be safe");

        assert_eq!(recovered, 0);
        assert!(replay.is_empty());
    }

    #[test]
    fn recovery_should_requeue_only_expired_unapplied_leases_in_original_order() {
        let lifecycle = OpenRequestLifecycle::default();
        for value in ["request-1", "request-2", "request-3"] {
            lifecycle
                .enqueue(request_id(value), value.to_owned())
                .expect("request should enqueue");
        }
        lifecycle
            .claim_batch(owner("window-1"), 2, 10, 10)
            .expect("first two requests should be claimed");

        let recovered = lifecycle
            .recover_expired_leases(20)
            .expect("expired leases should be recovered");
        let replay = lifecycle
            .claim_batch(owner("window-2"), 3, 20, 50)
            .expect("recovered requests should be claimable");

        assert_eq!(recovered, 2);
        assert_eq!(
            replay
                .iter()
                .map(|delivery| delivery.request_id.as_str())
                .collect::<Vec<_>>(),
            vec!["request-1", "request-2", "request-3"]
        );
    }

    #[test]
    fn explicit_abandon_should_requeue_the_matching_unapplied_lease() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, owner("window-1"), 10, 50);

        let released = lifecycle
            .abandon_delivery(&request_id, &owner("window-1"), &attempt)
            .expect("matching lease should be releasable");
        let replay = lifecycle
            .claim_batch(owner("window-2"), 1, 11, 50)
            .expect("abandoned request should be claimable");

        assert_eq!(released, LeaseReleaseOutcome::Released);
        assert_eq!(replay[0].request_id, request_id);
    }

    #[test]
    fn explicit_abandon_should_fail_closed_for_a_different_owner() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, owner("window-1"), 10, 50);

        let error = lifecycle
            .abandon_delivery(&request_id, &owner("window-2"), &attempt)
            .expect_err("a different owner must not release the lease");
        let replay = lifecycle
            .claim_batch(owner("window-2"), 1, 11, 50)
            .expect("failed release should leave the request protected");

        assert!(matches!(error, LifecycleError::OwnerMismatch { .. }));
        assert!(replay.is_empty());
    }

    #[test]
    fn applied_request_should_remain_non_deliverable_while_completion_ack_is_pending() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, lease_owner.clone(), 10, 10);

        let applied = lifecycle
            .record_applied(&request_id, &lease_owner, &attempt)
            .expect("application should be recorded before persistence acknowledgement");
        let recovered = lifecycle
            .recover_expired_leases(100)
            .expect("recovery should skip applied requests");
        let replay = lifecycle
            .claim_batch(owner("window-2"), 1, 100, 10)
            .expect("recovery drain should be safe");
        let pending = lifecycle
            .pending_completion_acknowledgements()
            .expect("pending completion should remain reconcilable");

        assert_eq!(applied, ApplyOutcome::Recorded);
        assert_eq!(recovered, 0);
        assert!(replay.is_empty());
        assert_eq!(
            pending
                .iter()
                .map(|completion| { (completion.request_id.as_str(), completion.owner.as_str()) })
                .collect::<Vec<_>>(),
            vec![("request-1", "window-1")]
        );
    }

    #[test]
    fn applied_and_completion_acknowledgements_should_be_idempotent() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, owner.clone(), 10, 50);

        let first_apply = lifecycle
            .record_applied(&request_id, &owner, &attempt)
            .expect("first application record should succeed");
        let repeated_apply = lifecycle
            .record_applied(&request_id, &owner, &attempt)
            .expect("repeated application record should be idempotent");
        let first_ack = lifecycle
            .acknowledge_persisted_completion(&request_id, &owner, &attempt)
            .expect("persisted completion should be acknowledged");
        let repeated_ack = lifecycle
            .acknowledge_persisted_completion(&request_id, &owner, &attempt)
            .expect("repeated completion acknowledgement should be idempotent");

        assert_eq!(first_apply, ApplyOutcome::Recorded);
        assert_eq!(repeated_apply, ApplyOutcome::AlreadyRecorded);
        assert_eq!(first_ack, CompletionAcknowledgementOutcome::Acknowledged);
        assert_eq!(
            repeated_ack,
            CompletionAcknowledgementOutcome::AlreadyAcknowledged
        );
    }

    #[test]
    fn completion_acknowledgement_should_fail_closed_before_application() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");

        let error = lifecycle
            .acknowledge_persisted_completion(&request_id, &owner, &DeliveryAttemptToken(0))
            .expect_err("queued request cannot be acknowledged as complete");

        assert!(matches!(
            error,
            LifecycleError::InvalidTransition {
                state: RequestLifecycleState::Queued {},
                operation: LifecycleOperation::AcknowledgePersistedCompletion,
                ..
            }
        ));
    }

    #[test]
    fn record_applied_should_fail_closed_for_a_different_owner() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, owner("window-1"), 10, 50);

        let error = lifecycle
            .record_applied(&request_id, &owner("window-2"), &attempt)
            .expect_err("a different owner cannot mark the request applied");

        assert!(matches!(error, LifecycleError::OwnerMismatch { .. }));
    }

    #[test]
    fn restored_pending_completion_should_remain_reconcilable_without_redelivery() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, lease_owner.clone(), 10, 10);
        lifecycle
            .record_applied(&request_id, &lease_owner, &attempt)
            .expect("applied state should be recorded");
        let snapshot = lifecycle
            .snapshot()
            .expect("pending state should be snapshotable for persistence retry");
        let persisted =
            serde_json::to_string(&snapshot).expect("lifecycle snapshot should be serializable");
        let restored_snapshot: super::LifecycleSnapshot<String> =
            serde_json::from_str(&persisted).expect("persisted lifecycle should deserialize");
        let restored = OpenRequestLifecycle::restore_cold(restored_snapshot)
            .expect("valid persisted lifecycle should restore");

        let recovered = restored
            .recover_expired_leases(100)
            .expect("recovery should inspect the restored lifecycle");
        let replay = restored
            .claim_batch(owner("window-2"), 1, 100, 10)
            .expect("restored registry should remain usable");
        let pending = restored
            .pending_completion_acknowledgements()
            .expect("pending acknowledgement should remain available for retry");

        assert_eq!(recovered, 0);
        assert!(replay.is_empty());
        assert_eq!(pending[0].request_id, request_id);
    }

    #[test]
    fn restored_completed_request_should_reject_duplicate_delivery() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, lease_owner.clone(), 10, 50);
        lifecycle
            .record_applied(&request_id, &lease_owner, &attempt)
            .expect("applied state should be recorded");
        lifecycle
            .acknowledge_persisted_completion(&request_id, &lease_owner, &attempt)
            .expect("persisted completion should be acknowledged");
        let snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        let restored =
            OpenRequestLifecycle::restore_cold(snapshot).expect("valid snapshot should restore");

        let duplicate = restored
            .enqueue(request_id, "replacement.md".to_owned())
            .expect("completed duplicate should be recognized");
        let replay = restored
            .claim_batch(owner("window-2"), 1, 100, 10)
            .expect("completed duplicate drain should be safe");

        assert!(matches!(
            duplicate,
            EnqueueOutcome::Duplicate {
                state: RequestLifecycleState::Completed { .. }
            }
        ));
        assert!(replay.is_empty());
    }

    #[test]
    fn restore_should_fail_closed_for_duplicate_request_ids() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.records.push(snapshot.records[0].clone());

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::DuplicateRequestId,
            })
        ));
    }

    #[test]
    fn restore_should_reject_a_programmatically_corrupted_request_id() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.records[0].request_id.0.clear();

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidRequestId,
            })
        ));
    }

    #[test]
    fn restore_should_reject_a_programmatically_corrupted_delivery_owner() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        lifecycle
            .claim_batch(owner("window-1"), 1, 10, 50)
            .expect("request should be claimed");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        match &mut snapshot.records[0].state {
            RequestLifecycleState::Processing { owner, .. } => owner.0.clear(),
            state => panic!("expected processing state, got {state:?}"),
        }

        let restored = OpenRequestLifecycle::restore_same_process(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidDeliveryOwner,
            })
        ));
    }

    #[test]
    fn restore_should_reject_a_payload_that_does_not_match_queued_state() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.records[0].payload = None;

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidPayloadState,
            })
        ));
    }

    #[test]
    fn restore_should_reject_an_attempt_token_outside_the_allocated_sequence() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        lifecycle
            .claim_batch(owner("window-1"), 1, 10, 50)
            .expect("request should be claimed");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.next_attempt_sequence = 0;

        let restored = OpenRequestLifecycle::restore_same_process(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidAttemptSequence,
            })
        ));
    }

    #[test]
    fn restore_should_reject_an_exhausted_attempt_sequence() {
        let lifecycle = OpenRequestLifecycle::<String>::default();
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.next_attempt_sequence = u64::MAX;

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::AttemptSequenceExhausted,
            })
        ));
    }

    #[test]
    fn owner_shutdown_should_release_only_that_owners_processing_lease() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("first request should enqueue");
        lifecycle
            .claim_batch(owner("window-1"), 1, 10, 50)
            .expect("first owner should claim the first request");
        lifecycle
            .enqueue(request_id("request-2"), "second.md".to_owned())
            .expect("second request should enqueue");
        lifecycle
            .claim_batch(owner("window-2"), 1, 10, 50)
            .expect("second owner should claim the second request");

        let released = lifecycle
            .release_owner_leases(&owner("window-1"))
            .expect("owner shutdown should release its processing leases");
        let replay = lifecycle
            .claim_batch(owner("window-3"), 2, 11, 50)
            .expect("released work should be claimable");

        assert_eq!(released, 1);
        assert_eq!(
            replay
                .iter()
                .map(|delivery| delivery.request_id.as_str())
                .collect::<Vec<_>>(),
            vec!["request-1"]
        );
    }

    #[test]
    fn owner_shutdown_should_not_release_an_applied_request() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, lease_owner.clone(), 10, 50);
        lifecycle
            .record_applied(&request_id, &lease_owner, &attempt)
            .expect("application should be recorded");

        let released = lifecycle
            .release_owner_leases(&lease_owner)
            .expect("owner shutdown should inspect leases");
        let replay = lifecycle
            .claim_batch(owner("window-2"), 1, 11, 50)
            .expect("shutdown drain should remain safe");

        assert_eq!(released, 0);
        assert!(replay.is_empty());
    }

    #[test]
    fn omitted_persistence_acknowledgement_should_leave_applied_request_reconcilable() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "sensitive-first-payload".to_owned())
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, lease_owner.clone(), 10, 10);
        lifecycle
            .record_applied(&request_id, &lease_owner, &attempt)
            .expect("application should be recorded before persistence");
        let snapshot = lifecycle
            .snapshot()
            .expect("pending state should remain snapshotable");
        let persisted =
            serde_json::to_string(&snapshot).expect("pending state should remain serializable");
        let replay = lifecycle
            .claim_batch(owner("window-2"), 1, 100, 10)
            .expect("omitted acknowledgement must not reopen delivery");
        let pending = lifecycle
            .pending_completion_acknowledgements()
            .expect("omitted acknowledgement should remain reconcilable");

        assert!(persisted.contains("appliedPendingAcknowledgement"));
        assert!(!persisted.contains("sensitive-first-payload"));
        assert!(replay.is_empty());
        assert_eq!(pending[0].request_id, request_id);
    }

    #[test]
    fn poisoned_registry_should_fail_closed() {
        let lifecycle = OpenRequestLifecycle::<String>::default();
        let poison_result = catch_unwind(AssertUnwindSafe(|| {
            let _guard = lifecycle
                .state
                .lock()
                .expect("fresh registry lock should be available");
            panic!("poison lifecycle registry for the test");
        }));
        assert!(poison_result.is_err());

        let error = lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect_err("poisoned registry must reject mutations");

        assert_eq!(error, LifecycleError::LockPoisoned);
    }

    #[test]
    fn zero_size_claim_should_still_fail_closed_when_registry_is_poisoned() {
        let lifecycle = OpenRequestLifecycle::<String>::default();
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let _guard = lifecycle
                .state
                .lock()
                .expect("fresh registry lock should be available");
            panic!("poison lifecycle registry for the test");
        }));

        let error = lifecycle
            .claim_batch(owner("window-1"), 0, 10, 50)
            .expect_err("even an empty claim must observe a poisoned registry");

        assert_eq!(error, LifecycleError::LockPoisoned);
    }

    #[test]
    fn restored_processing_request_should_wait_for_lease_expiry_before_recovery() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        lifecycle
            .claim_batch(owner("window-1"), 1, 10, 50)
            .expect("request should be claimed");
        let snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        let restored = OpenRequestLifecycle::restore_same_process(snapshot)
            .expect("same-process snapshot should restore in the original clock domain");

        let early_recovery = restored
            .recover_expired_leases(59)
            .expect("early recovery should inspect the lease");
        let early_replay = restored
            .claim_batch(owner("window-2"), 1, 59, 50)
            .expect("early drain should be safe");
        let expired_recovery = restored
            .recover_expired_leases(60)
            .expect("expired lease should recover");
        let expired_replay = restored
            .claim_batch(owner("window-2"), 1, 60, 50)
            .expect("expired request should be claimable");

        assert_eq!(early_recovery, 0);
        assert!(early_replay.is_empty());
        assert_eq!(expired_recovery, 1);
        assert_eq!(expired_replay[0].request_id.as_str(), "request-1");
    }

    #[test]
    fn cold_restore_should_requeue_processing_without_replaying_applied_or_completed() {
        let lifecycle = OpenRequestLifecycle::default();
        let processing_id = request_id("processing");
        let applied_id = request_id("applied");
        let completed_id = request_id("completed");
        for (request_id, payload) in [
            (processing_id.clone(), "processing.md"),
            (applied_id.clone(), "applied.md"),
            (completed_id.clone(), "completed.md"),
        ] {
            lifecycle
                .enqueue(request_id, payload.to_owned())
                .expect("request should enqueue");
        }

        lifecycle
            .claim_batch(owner("processing-owner"), 1, 100, 1_000)
            .expect("processing request should be claimed");
        let applied_attempt = claim_attempt(&lifecycle, owner("applied-owner"), 100, 1_000);
        lifecycle
            .record_applied(&applied_id, &owner("applied-owner"), &applied_attempt)
            .expect("applied request should enter reconciliation");
        let completed_attempt = claim_attempt(&lifecycle, owner("completed-owner"), 100, 1_000);
        lifecycle
            .record_applied(&completed_id, &owner("completed-owner"), &completed_attempt)
            .expect("completed request should first be recorded as applied");
        lifecycle
            .acknowledge_persisted_completion(
                &completed_id,
                &owner("completed-owner"),
                &completed_attempt,
            )
            .expect("completed request should be acknowledged");

        let snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        let restored = OpenRequestLifecycle::restore_cold(snapshot)
            .expect("cold restore should validate the persisted lifecycle");
        let deliveries = restored
            .claim_batch(owner("new-process-owner"), 3, 0, 10)
            .expect("only unapplied processing work should be claimable after restart");
        let pending = restored
            .pending_completion_acknowledgements()
            .expect("applied request should remain reconcilable");
        let completed_duplicate = restored
            .enqueue(completed_id, "replacement.md".to_owned())
            .expect("completed tombstone should still deduplicate");

        assert_eq!(deliveries.len(), 1);
        assert_eq!(deliveries[0].request_id, processing_id);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].request_id, applied_id);
        assert!(matches!(
            completed_duplicate,
            EnqueueOutcome::Duplicate {
                state: RequestLifecycleState::Completed { .. },
            }
        ));
    }

    #[test]
    fn concurrent_drains_should_claim_each_request_once_per_lease() {
        let lifecycle = Arc::new(OpenRequestLifecycle::default());
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let barrier = Arc::new(Barrier::new(3));
        let handles = ["window-1", "window-2"].map(|owner_name| {
            let lifecycle = Arc::clone(&lifecycle);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                lifecycle
                    .claim_batch(owner(owner_name), 1, 10, 50)
                    .expect("concurrent drain should remain available")
                    .len()
            })
        });
        barrier.wait();

        let claimed_count: usize = handles
            .into_iter()
            .map(|handle| handle.join().expect("drain thread should finish"))
            .sum();

        assert_eq!(claimed_count, 1);
    }

    #[test]
    fn expired_then_reclaimed_by_same_owner_should_reject_stale_attempt_application() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let stale_attempt = lifecycle
            .claim_batch(lease_owner.clone(), 1, 10, 10)
            .expect("first attempt should claim")[0]
            .attempt_token
            .clone();
        lifecycle
            .recover_expired_leases(20)
            .expect("expired attempt should recover");
        let fresh_attempt = lifecycle
            .claim_batch(lease_owner.clone(), 1, 20, 10)
            .expect("same owner should reclaim with a new attempt")[0]
            .attempt_token
            .clone();

        let stale_error = lifecycle
            .record_applied(&request_id, &lease_owner, &stale_attempt)
            .expect_err("stale attempt must not apply the new lease");
        let fresh_result = lifecycle
            .record_applied(&request_id, &lease_owner, &fresh_attempt)
            .expect("fresh attempt should remain valid");

        assert!(matches!(
            stale_error,
            LifecycleError::AttemptMismatch { .. }
        ));
        assert_eq!(fresh_result, ApplyOutcome::Recorded);
    }

    #[test]
    fn expired_then_reclaimed_by_same_owner_should_reject_stale_attempt_abandonment() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let stale_attempt = lifecycle
            .claim_batch(lease_owner.clone(), 1, 10, 10)
            .expect("first attempt should claim")[0]
            .attempt_token
            .clone();
        lifecycle
            .recover_expired_leases(20)
            .expect("expired attempt should recover");
        let fresh_attempt = lifecycle
            .claim_batch(lease_owner.clone(), 1, 20, 10)
            .expect("same owner should reclaim with a new attempt")[0]
            .attempt_token
            .clone();

        let stale_error = lifecycle
            .abandon_delivery(&request_id, &lease_owner, &stale_attempt)
            .expect_err("stale attempt must not abandon the new lease");
        let fresh_result = lifecycle
            .abandon_delivery(&request_id, &lease_owner, &fresh_attempt)
            .expect("fresh attempt should remain valid");

        assert!(matches!(
            stale_error,
            LifecycleError::AttemptMismatch { .. }
        ));
        assert_eq!(fresh_result, LeaseReleaseOutcome::Released);
    }

    #[test]
    fn completion_acknowledgement_should_reject_a_stale_attempt_token() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let stale_attempt = claim_attempt(&lifecycle, lease_owner.clone(), 10, 10);
        lifecycle
            .recover_expired_leases(20)
            .expect("expired attempt should recover");
        let fresh_attempt = claim_attempt(&lifecycle, lease_owner.clone(), 20, 10);
        lifecycle
            .record_applied(&request_id, &lease_owner, &fresh_attempt)
            .expect("fresh attempt should apply the request");

        let stale_error = lifecycle
            .acknowledge_persisted_completion(&request_id, &lease_owner, &stale_attempt)
            .expect_err("stale attempt must not acknowledge the fresh application");
        let fresh_result = lifecycle
            .acknowledge_persisted_completion(&request_id, &lease_owner, &fresh_attempt)
            .expect("fresh attempt should acknowledge completion");

        assert!(matches!(
            stale_error,
            LifecycleError::AttemptMismatch { .. }
        ));
        assert_eq!(fresh_result, CompletionAcknowledgementOutcome::Acknowledged);
    }

    #[test]
    fn completed_request_should_keep_owner_and_attempt_fencing() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let first_owner = owner("window-1");
        let other_owner = owner("window-2");
        lifecycle
            .enqueue(request_id.clone(), "first.md".to_owned())
            .expect("request should enqueue");
        let stale_attempt = claim_attempt(&lifecycle, first_owner.clone(), 10, 10);
        lifecycle
            .recover_expired_leases(20)
            .expect("expired attempt should recover");
        let committed_attempt = claim_attempt(&lifecycle, first_owner.clone(), 20, 10);
        lifecycle
            .record_applied(&request_id, &first_owner, &committed_attempt)
            .expect("fresh attempt should apply the request");
        lifecycle
            .acknowledge_persisted_completion(&request_id, &first_owner, &committed_attempt)
            .expect("fresh attempt should complete the request");

        let stale_record = lifecycle
            .record_applied(&request_id, &first_owner, &stale_attempt)
            .expect_err("completed request must reject a stale attempt");
        let stale_acknowledgement = lifecycle
            .acknowledge_persisted_completion(&request_id, &first_owner, &stale_attempt)
            .expect_err("completed request must reject a stale acknowledgement");
        let wrong_owner = lifecycle
            .acknowledge_persisted_completion(&request_id, &other_owner, &committed_attempt)
            .expect_err("completed request must retain its owner fence");

        assert!(matches!(
            stale_record,
            LifecycleError::AttemptMismatch { .. }
        ));
        assert!(matches!(
            stale_acknowledgement,
            LifecycleError::AttemptMismatch { .. }
        ));
        assert!(matches!(wrong_owner, LifecycleError::OwnerMismatch { .. }));
    }

    #[test]
    fn attempt_token_json_should_persist_canonical_decimal_strings() {
        let token = DeliveryAttemptToken(0);

        assert_eq!(
            serde_json::to_value(&token).expect("token should serialize"),
            serde_json::json!("0")
        );
        let from_string: DeliveryAttemptToken = serde_json::from_value(serde_json::json!("0"))
            .expect("canonical string should restore");
        assert_eq!(from_string, token);
        let from_number: DeliveryAttemptToken = serde_json::from_value(serde_json::json!(0))
            .expect("legacy numeric tokens should restore");
        assert_eq!(from_number, token);
        assert!(
            serde_json::from_value::<DeliveryAttemptToken>(serde_json::json!("00")).is_err(),
            "non-canonical decimal strings must not restore"
        );
    }

    #[test]
    fn attempt_token_should_round_trip_only_canonical_u64_decimal_strings() {
        let token = DeliveryAttemptToken::from_canonical_decimal("18446744073709551615")
            .expect("maximum u64 should be accepted");

        assert_eq!(token.to_canonical_decimal(), "18446744073709551615");
        for invalid in [
            "",
            "00",
            "01",
            "+1",
            "-1",
            " 1",
            "1 ",
            "18446744073709551616",
        ] {
            assert!(
                DeliveryAttemptToken::from_canonical_decimal(invalid).is_err(),
                "{invalid:?} must not cross the IPC boundary"
            );
        }
    }

    #[test]
    fn claim_batch_matching_should_atomically_preserve_other_targets() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(
                request_id("request-1"),
                ("window-1".to_owned(), "first.md".to_owned()),
            )
            .expect("first request should enqueue");
        lifecycle
            .enqueue(
                request_id("request-2"),
                ("window-2".to_owned(), "second.md".to_owned()),
            )
            .expect("second request should enqueue");

        let first_window = lifecycle
            .claim_batch_matching(owner("window-1"), 8, 10, 50, |payload| {
                payload.0 == "window-1"
            })
            .expect("first window should claim only its request");
        let second_window = lifecycle
            .claim_batch_matching(owner("window-2"), 8, 10, 50, |payload| {
                payload.0 == "window-2"
            })
            .expect("second window request should remain queued");

        assert_eq!(first_window.len(), 1);
        assert_eq!(first_window[0].request_id.as_str(), "request-1");
        assert_eq!(second_window.len(), 1);
        assert_eq!(second_window[0].request_id.as_str(), "request-2");
    }

    #[test]
    fn record_applied_should_release_the_retained_payload() {
        let lifecycle = OpenRequestLifecycle::default();
        let request_id = request_id("request-1");
        let lease_owner = owner("window-1");
        let payload = Arc::new("large-payload".to_owned());
        lifecycle
            .enqueue(request_id.clone(), Arc::clone(&payload))
            .expect("request should enqueue");
        let attempt = claim_attempt(&lifecycle, lease_owner.clone(), 10, 50);
        assert_eq!(Arc::strong_count(&payload), 2);

        lifecycle
            .record_applied(&request_id, &lease_owner, &attempt)
            .expect("application should release the retained payload");

        assert_eq!(Arc::strong_count(&payload), 1);
    }

    #[test]
    fn acknowledged_completion_should_compact_records_into_merged_ranges() {
        let lifecycle = OpenRequestLifecycle::default();
        let lease_owner = owner("window-1");
        let mut attempts = Vec::new();
        for sequence in 0..3 {
            let request_id = request_id(&sequence.to_string());
            lifecycle
                .enqueue(request_id, format!("payload-{sequence}"))
                .expect("request should enqueue");
            attempts.push(claim_attempt(&lifecycle, lease_owner.clone(), 10, 50));
        }

        for (completion_index, sequence) in [1_u64, 0, 2].into_iter().enumerate() {
            let request_id = request_id(&sequence.to_string());
            lifecycle
                .record_applied(&request_id, &lease_owner, &attempts[sequence as usize])
                .expect("application should be recorded");
            lifecycle
                .acknowledge_persisted_completion(
                    &request_id,
                    &lease_owner,
                    &attempts[sequence as usize],
                )
                .expect("completion should be recorded");

            let serialized = serde_json::to_value(
                lifecycle
                    .snapshot()
                    .expect("compacted completion should be snapshotable"),
            )
            .expect("snapshot should serialize");
            let expected_range_end = match sequence {
                1 => 2,
                0 => 2,
                2 => 3,
                _ => unreachable!(),
            };
            assert_eq!(
                serialized["acknowledgedRanges"],
                match sequence {
                    1 => serde_json::json!([
                        { "startSequence": 1, "endSequenceExclusive": 2 }
                    ]),
                    _ => serde_json::json!([
                        { "startSequence": 0, "endSequenceExclusive": expected_range_end }
                    ]),
                }
            );
            assert_eq!(
                serialized["records"].as_array().unwrap().len(),
                2 - completion_index
            );
        }

        let serialized = serde_json::to_string(
            &lifecycle
                .snapshot()
                .expect("compacted completion should be snapshotable"),
        )
        .expect("compacted completion should serialize");
        assert!(!serialized.contains("payload-"));
        assert!(!serialized.contains("\"kind\":\"completed\""));
    }

    #[test]
    fn completion_fences_should_be_strict_and_bounded() {
        let lifecycle = OpenRequestLifecycle::default();
        let lease_owner = owner("window-1");
        for sequence in 0..200_u64 {
            let request_id = request_id(&sequence.to_string());
            lifecycle
                .enqueue(request_id.clone(), format!("payload-{sequence}"))
                .expect("request should enqueue");
            let attempt = claim_attempt(&lifecycle, lease_owner.clone(), sequence, 1);
            lifecycle
                .record_applied(&request_id, &lease_owner, &attempt)
                .expect("application should be recorded");
            lifecycle
                .acknowledge_persisted_completion(&request_id, &lease_owner, &attempt)
                .expect("completion should be acknowledged");
        }

        let snapshot = serde_json::to_value(
            lifecycle
                .snapshot()
                .expect("bounded completion fences should snapshot"),
        )
        .expect("snapshot should serialize");
        assert_eq!(snapshot["records"], serde_json::json!([]));
        assert_eq!(
            snapshot["acknowledgedRanges"],
            serde_json::json!([{ "startSequence": 0, "endSequenceExclusive": 200 }])
        );
        assert!(
            snapshot["recentCompletionFences"]
                .as_array()
                .expect("recent completion fences should be an array")
                .len()
                <= 128
        );
    }

    #[test]
    #[ignore = "serial 10k authority capacity/performance gate"]
    fn ten_thousand_acknowledgements_remain_compact_and_linear() {
        const REQUEST_COUNT: u64 = 10_000;
        let started = Instant::now();
        let lifecycle = OpenRequestLifecycle::default();
        let lease_owner = owner("window-1");
        for sequence in 0..REQUEST_COUNT {
            let request_id = request_id(&sequence.to_string());
            lifecycle
                .enqueue(request_id.clone(), format!("payload-{sequence}"))
                .expect("request should enqueue");
        }
        let deliveries = lifecycle
            .claim_batch(
                lease_owner.clone(),
                usize::try_from(REQUEST_COUNT).expect("10k should fit usize"),
                0,
                1,
            )
            .expect("all production backlog requests should claim once");
        assert_eq!(deliveries.len(), REQUEST_COUNT as usize);
        for delivery in deliveries {
            lifecycle
                .record_applied(&delivery.request_id, &lease_owner, &delivery.attempt_token)
                .expect("application should be recorded");
            lifecycle
                .acknowledge_persisted_completion(
                    &delivery.request_id,
                    &lease_owner,
                    &delivery.attempt_token,
                )
                .expect("completion should be acknowledged");
        }
        let snapshot = lifecycle.snapshot().expect("10k state should snapshot");
        let serialized = serde_json::to_vec(&snapshot).expect("10k state should serialize");
        let elapsed = started.elapsed();

        println!(
            "OPEN_REQUEST_10K wall_ms={} json_bytes={} records={} ranges={} fences={}",
            elapsed.as_millis(),
            serialized.len(),
            snapshot.records.len(),
            snapshot.acknowledged_ranges.len(),
            snapshot.recent_completion_fences.len()
        );
        assert_eq!(snapshot.next_sequence, REQUEST_COUNT);
        assert!(snapshot.records.is_empty());
        assert_eq!(
            snapshot.acknowledged_ranges,
            vec![super::AcknowledgedSequenceRange {
                start_sequence: 0,
                end_sequence_exclusive: REQUEST_COUNT,
            }]
        );
        assert_eq!(
            snapshot.recent_completion_fences.len(),
            super::MAX_RECENT_COMPLETION_FENCES
        );
        assert!(serialized.len() < 64 * 1024, "10k state must stay bounded");
        assert!(
            elapsed.as_secs_f64() < 5.0,
            "10k lifecycle gate exceeded five seconds: {elapsed:?}"
        );
    }

    #[test]
    fn restore_should_reject_acknowledged_ranges_that_do_not_exactly_cover_record_gaps() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("0"), "first.md".to_owned())
            .expect("request should enqueue");
        lifecycle
            .enqueue(request_id("1"), "second.md".to_owned())
            .expect("request should enqueue");
        let snapshot = lifecycle.snapshot().expect("state should snapshot");
        let mut serialized = serde_json::to_value(snapshot).expect("snapshot should serialize");
        serialized["records"]
            .as_array_mut()
            .expect("records should be an array")
            .remove(0);
        let tampered: super::LifecycleSnapshot<String> = serde_json::from_value(serialized)
            .expect("the sparse snapshot schema should deserialize before validation");

        let restored = OpenRequestLifecycle::restore_cold(tampered);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::SequenceMustStartAtZero,
            })
        ));
    }

    #[test]
    fn restore_should_reject_adjacent_unmerged_acknowledged_ranges() {
        let lifecycle = OpenRequestLifecycle::<String>::default();
        let snapshot = lifecycle.snapshot().expect("state should snapshot");
        let mut serialized = serde_json::to_value(snapshot).expect("snapshot should serialize");
        serialized["nextSequence"] = serde_json::json!(2);
        serialized["acknowledgedRanges"] = serde_json::json!([
            { "startSequence": 0, "endSequenceExclusive": 1 },
            { "startSequence": 1, "endSequenceExclusive": 2 }
        ]);
        let tampered: super::LifecycleSnapshot<String> = serde_json::from_value(serialized)
            .expect("range schema should deserialize before validation");

        let restored = OpenRequestLifecycle::restore_cold(tampered);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidAcknowledgedRange,
            })
        ));
    }

    #[test]
    fn lifecycle_state_json_uses_the_exact_camel_case_schema() {
        let owner = owner("window-1");
        let attempt_token = DeliveryAttemptToken(7);

        assert_eq!(
            serde_json::to_value(RequestLifecycleState::Queued {})
                .expect("queued state should serialize"),
            serde_json::json!({ "kind": "queued" })
        );
        assert_eq!(
            serde_json::to_value(RequestLifecycleState::Processing {
                owner: owner.clone(),
                lease_expires_at: 99,
                attempt_token: attempt_token.clone(),
            })
            .expect("processing state should serialize"),
            serde_json::json!({
                "kind": "processing",
                "owner": "window-1",
                "leaseExpiresAt": 99,
                "attemptToken": "7",
            })
        );
        assert_eq!(
            serde_json::to_value(RequestLifecycleState::AppliedPendingAcknowledgement {
                owner: owner.clone(),
                attempt_token: attempt_token.clone(),
            })
            .expect("applied-pending state should serialize"),
            serde_json::json!({
                "kind": "appliedPendingAcknowledgement",
                "owner": "window-1",
                "attemptToken": "7",
            })
        );
        assert_eq!(
            serde_json::to_value(RequestLifecycleState::Completed {
                owner,
                attempt_token,
            })
            .expect("completed state should serialize"),
            serde_json::json!({
                "kind": "completed",
                "owner": "window-1",
                "attemptToken": "7",
            })
        );
    }

    #[test]
    fn restore_should_reject_a_request_sequence_that_does_not_start_at_zero() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.records[0].sequence = 1;
        snapshot.next_sequence = 2;

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::SequenceMustStartAtZero,
            })
        ));
    }

    #[test]
    fn restore_should_reject_a_gap_in_request_sequences() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("first request should enqueue");
        lifecycle
            .enqueue(request_id("request-2"), "second.md".to_owned())
            .expect("second request should enqueue");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.records[1].sequence = 2;
        snapshot.next_sequence = 3;

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::NonContiguousSequence,
            })
        ));
    }

    #[test]
    fn restore_should_require_next_sequence_to_equal_last_plus_one() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.next_sequence = 2;

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidNextSequence,
            })
        ));
    }

    #[test]
    fn restore_should_reject_an_exhausted_request_sequence() {
        let lifecycle = OpenRequestLifecycle::default();
        lifecycle
            .enqueue(request_id("request-1"), "first.md".to_owned())
            .expect("request should enqueue");
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.next_sequence = u64::MAX;

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::SequenceExhausted,
            })
        ));
    }

    #[test]
    fn restore_should_require_zero_next_sequence_for_an_empty_registry() {
        let lifecycle = OpenRequestLifecycle::<String>::default();
        let mut snapshot = lifecycle.snapshot().expect("state should be snapshotable");
        snapshot.next_sequence = 1;

        let restored = OpenRequestLifecycle::restore_cold(snapshot);

        assert!(matches!(
            restored,
            Err(LifecycleError::InvalidSnapshot {
                reason: SnapshotValidationError::InvalidNextSequence,
            })
        ));
    }
}
