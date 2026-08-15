#![allow(dead_code)]

use serde::Serialize;
use serde_json::{json, Value};
use std::cell::RefCell;

#[path = "../src/errors.rs"]
pub(crate) mod errors;

#[path = "../src/services/document_path_identity.rs"]
pub(crate) mod document_path_identity;

#[path = "../src/services/document_claim_service.rs"]
pub(crate) mod document_claim_service;

pub(crate) mod services {
    pub(crate) use crate::document_claim_service;
}

#[allow(dead_code)]
#[path = "../src/commands/document_claims.rs"]
mod document_claims;

use document_claim_service::DocumentClaimService;

const WINDOW_A: &str = "document-a";
const WINDOW_B: &str = "document-b";
const SESSION_A: &str = "session-a";
const SESSION_B: &str = "session-b";
const PATH_A: &str = r"C:\Notes\draft.md";
const PATH_B: &str = r"C:\Notes\other.md";

fn service() -> DocumentClaimService {
    DocumentClaimService::new().expect("test claim service should initialize")
}

fn serialized(value: &impl Serialize) -> Value {
    serde_json::to_value(value).expect("command DTO should serialize")
}

fn begin_generation(service: &DocumentClaimService, window: &str, session: &str) -> u64 {
    let response = document_claims::begin_session_for_window(service, window, session)
        .expect("session should begin");
    serialized(&response)["sessionGeneration"]
        .as_u64()
        .expect("begin response should carry a safe generation")
}

#[test]
fn begin_session_returns_a_generation_and_conflict_error_exposes_the_active_generation() {
    let service = service();

    let began = document_claims::begin_session_for_window(&service, WINDOW_A, SESSION_A)
        .expect("first session should begin");
    let repeated = document_claims::begin_session_for_window(&service, WINDOW_A, SESSION_A)
        .expect("same session should be idempotent");
    let conflict = document_claims::begin_session_for_window(&service, WINDOW_A, SESSION_B)
        .expect_err("different session must use explicit takeover");

    assert_eq!(
        serialized(&began),
        json!({"status": "began", "sessionGeneration": 1})
    );
    assert_eq!(
        serialized(&repeated),
        json!({"status": "alreadyActive", "sessionGeneration": 1})
    );
    assert_eq!(
        serialized(&conflict),
        json!({
            "code": "document_claim.session_already_active",
            "message": "Another document claim session is already active.",
            "recoverable": true,
            "details": {"activeGeneration": 1}
        })
    );
}

#[test]
fn takeover_uses_generation_cas_and_serializes_stale_generation_metadata() {
    let service = service();
    let first_generation = begin_generation(&service, WINDOW_A, SESSION_A);
    document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("old session should reserve");

    let takeover = document_claims::takeover_session_for_window(
        &service,
        WINDOW_A,
        SESSION_B,
        first_generation,
    )
    .expect("new session should take over the observed generation");
    let second_generation = serialized(&takeover)["sessionGeneration"]
        .as_u64()
        .expect("takeover response should carry the new generation");
    document_claims::reserve_for_window(&service, WINDOW_A, SESSION_B, 2, PATH_A)
        .expect("new session should reserve");
    let stale = document_claims::takeover_session_for_window(
        &service,
        WINDOW_A,
        SESSION_A,
        first_generation,
    )
    .expect_err("stale generation should fail closed");
    begin_generation(&service, WINDOW_B, SESSION_A);
    let still_pending =
        document_claims::reserve_for_window(&service, WINDOW_B, SESSION_A, 3, PATH_A)
            .expect("new session pending claim should remain");

    assert_eq!(
        serialized(&takeover),
        json!({
            "status": "takenOver",
            "sessionGeneration": second_generation,
            "releasedReservations": 1
        })
    );
    assert!(second_generation > first_generation);
    assert_eq!(
        serialized(&stale),
        json!({
            "code": "document_claim.session_generation_mismatch",
            "message": "Document claim session generation is stale.",
            "recoverable": true,
            "details": {"activeGeneration": second_generation}
        })
    );
    assert_eq!(
        serialized(&still_pending),
        json!({"status": "ownedBy", "windowLabel": WINDOW_A})
    );
}

#[test]
fn same_target_takeover_retry_is_an_explicit_idempotent_outcome() {
    let service = service();
    let first_generation = begin_generation(&service, WINDOW_A, SESSION_A);
    let first = document_claims::takeover_session_for_window(
        &service,
        WINDOW_A,
        SESSION_B,
        first_generation,
    )
    .expect("first takeover should succeed");
    let session_generation = serialized(&first)["sessionGeneration"]
        .as_u64()
        .expect("takeover should return its generation");

    let retry = document_claims::takeover_session_for_window(
        &service,
        WINDOW_A,
        SESSION_B,
        first_generation,
    )
    .expect("same target session retry should be idempotent");

    assert_eq!(
        serialized(&retry),
        json!({
            "status": "alreadyActive",
            "sessionGeneration": session_generation
        })
    );
}

#[test]
fn reserve_outcomes_have_stable_tags_and_never_serialize_claim_tokens() {
    let service = service();
    begin_generation(&service, WINDOW_A, SESSION_A);
    begin_generation(&service, WINDOW_B, SESSION_B);

    let reserved = document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("first operation should reserve");
    let pending = document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 2, PATH_A)
        .expect("same-window concurrent operation should be explicit");
    let owned_by = document_claims::reserve_for_window(&service, WINDOW_B, SESSION_B, 3, PATH_A)
        .expect("cross-window conflict should be a normal outcome");
    document_claims::release_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("first operation should release");
    let released = document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("released operation retry should be explicit");
    document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 4, PATH_B)
        .expect("second path should reserve");
    document_claims::commit_for_window(&service, WINDOW_A, SESSION_A, 4, PATH_B)
        .expect("second path should commit");
    let already_owned =
        document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 5, PATH_B)
            .expect("same-window ownership should be explicit");

    assert_eq!(serialized(&reserved), json!({"status": "reserved"}));
    assert!(!serialized(&reserved).to_string().contains("token"));
    assert_eq!(serialized(&pending), json!({"status": "alreadyPending"}));
    assert_eq!(serialized(&released), json!({"status": "alreadyReleased"}));
    assert_eq!(
        serialized(&already_owned),
        json!({"status": "alreadyOwned"})
    );
    assert_eq!(
        serialized(&owned_by),
        json!({"status": "ownedBy", "windowLabel": WINDOW_A})
    );
}

#[test]
fn operation_mutations_always_return_tagged_dtos() {
    let service = service();
    begin_generation(&service, WINDOW_A, SESSION_A);
    document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("commit operation should reserve");

    let committed = document_claims::commit_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("commit should succeed");
    let committed_retry =
        document_claims::commit_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
            .expect("commit retry should be idempotent");
    let release_after_commit =
        document_claims::release_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
            .expect("release after commit should be explicit");
    document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 2, PATH_B)
        .expect("release operation should reserve");
    let released = document_claims::release_for_window(&service, WINDOW_A, SESSION_A, 2, PATH_B)
        .expect("release should succeed");
    let released_retry =
        document_claims::release_for_window(&service, WINDOW_A, SESSION_A, 2, PATH_B)
            .expect("release retry should be idempotent");

    assert_eq!(serialized(&committed), json!({"status": "committed"}));
    assert_eq!(
        serialized(&committed_retry),
        json!({"status": "alreadyCommitted"})
    );
    assert_eq!(
        serialized(&release_after_commit),
        json!({"status": "alreadyCommitted"})
    );
    assert_eq!(serialized(&released), json!({"status": "released"}));
    assert_eq!(
        serialized(&released_retry),
        json!({"status": "alreadyReleased"})
    );
}

struct FocusTarget {
    calls: RefCell<Vec<&'static str>>,
    fails_at: Option<&'static str>,
}

impl document_claims::WindowFocusTarget for FocusTarget {
    type Error = &'static str;

    fn unminimize(&self) -> Result<(), Self::Error> {
        self.calls.borrow_mut().push("unminimize");
        (self.fails_at != Some("unminimize"))
            .then_some(())
            .ok_or("unminimize failed")
    }

    fn show(&self) -> Result<(), Self::Error> {
        self.calls.borrow_mut().push("show");
        (self.fails_at != Some("show"))
            .then_some(())
            .ok_or("show failed")
    }

    fn set_focus(&self) -> Result<(), Self::Error> {
        self.calls.borrow_mut().push("set_focus");
        (self.fails_at != Some("set_focus"))
            .then_some(())
            .ok_or("focus failed")
    }
}

#[test]
fn desktop_focus_window_returns_a_stable_dto_and_runs_all_window_actions() {
    let target = FocusTarget {
        calls: RefCell::new(Vec::new()),
        fails_at: None,
    };

    let response = document_claims::focus_existing_window(Some(&target))
        .expect("existing target should focus");

    assert_eq!(serialized(&response), json!({"status": "focused"}));
    assert_eq!(
        target.calls.into_inner(),
        vec!["show", "unminimize", "set_focus"]
    );
}

#[test]
fn desktop_focus_window_fails_closed_for_missing_or_failed_targets() {
    let missing = document_claims::focus_existing_window::<FocusTarget>(None)
        .expect_err("missing target should return a stable error");
    let target = FocusTarget {
        calls: RefCell::new(Vec::new()),
        fails_at: Some("show"),
    };
    let failed = document_claims::focus_existing_window(Some(&target))
        .expect_err("native window failure should return a stable error");

    assert_eq!(
        serialized(&missing),
        json!({
            "code": "desktop.window_not_found",
            "message": "Desktop window was not found.",
            "recoverable": true
        })
    );
    assert_eq!(
        serialized(&failed),
        json!({
            "code": "desktop.window_focus_failed",
            "message": "Desktop window could not be focused.",
            "recoverable": true
        })
    );
    assert_eq!(target.calls.into_inner(), vec!["show"]);
}

#[test]
fn desktop_focus_window_command_injects_the_real_caller_and_uses_camel_case_target() {
    let source = include_str!("../src/commands/document_claims.rs");

    assert!(source.contains("pub fn desktop_focus_window("));
    assert!(source.contains("window: WebviewWindow"));
    assert!(source.contains("target_window_label: String"));
    assert!(source.contains("#[tauri::command(rename_all = \"camelCase\")]"));
}

#[test]
fn owned_and_session_release_mutations_return_tagged_dtos() {
    let service = service();
    begin_generation(&service, WINDOW_A, SESSION_A);
    document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("owned operation should reserve");
    document_claims::commit_for_window(&service, WINDOW_A, SESSION_A, 1, PATH_A)
        .expect("owned operation should commit");

    let released_owned =
        document_claims::release_owned_for_window(&service, WINDOW_A, SESSION_A, PATH_A)
            .expect("owned document should release");
    let not_owned =
        document_claims::release_owned_for_window(&service, WINDOW_A, SESSION_A, PATH_A)
            .expect("owned release retry should be explicit");
    document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 2, PATH_B)
        .expect("pending operation should reserve");
    let released_session =
        document_claims::release_session_for_window(&service, WINDOW_A, SESSION_A)
            .expect("session should release");

    assert_eq!(serialized(&released_owned), json!({"status": "released"}));
    assert_eq!(serialized(&not_owned), json!({"status": "notOwned"}));
    assert_eq!(
        serialized(&released_session),
        json!({"status": "released", "releasedReservations": 1})
    );
}

#[test]
fn invalid_inputs_map_to_stable_non_metadata_errors() {
    let service = service();
    begin_generation(&service, WINDOW_A, SESSION_A);

    let invalid_path = document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 1, "")
        .expect_err("empty path should fail");
    let invalid_operation =
        document_claims::reserve_for_window(&service, WINDOW_A, SESSION_A, 0, PATH_A)
            .expect_err("zero operation id should fail");

    assert_eq!(
        serialized(&invalid_path),
        json!({
            "code": "document_claim.invalid_path",
            "message": "Document path is invalid.",
            "recoverable": false
        })
    );
    assert_eq!(
        serialized(&invalid_operation),
        json!({
            "code": "document_claim.invalid_operation_id",
            "message": "Document claim operation id must be a positive safe integer.",
            "recoverable": false
        })
    );
}
