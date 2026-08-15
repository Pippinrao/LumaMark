#![allow(dead_code)]

use std::{
    ffi::OsString,
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};

#[path = "../src/errors.rs"]
pub(crate) mod errors;

#[path = "../src/services/document_path_identity.rs"]
pub(crate) mod document_path_identity;

#[path = "../src/services/file_service.rs"]
pub(crate) mod file_service;

#[path = "../src/services/open_request_lifecycle.rs"]
pub(crate) mod open_request_lifecycle;

#[path = "../src/services/open_request_service.rs"]
pub(crate) mod open_request_service;

pub(crate) mod services {
    pub(crate) use crate::{
        document_path_identity, file_service, open_request_lifecycle, open_request_service,
    };
}

#[allow(dead_code)]
#[path = "../src/commands/open_requests.rs"]
mod open_requests;

use open_request_service::OpenRequestService;

fn unique_test_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be available")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("lumamark-open-command-{name}-{nanos}"));
    fs::create_dir_all(&path).expect("test directory should be created");
    path
}

fn service_with_request(target_window: &str) -> OpenRequestService {
    let config_dir = unique_test_dir("service");
    let service = OpenRequestService::new(config_dir.clone()).expect("service should initialize");
    service
        .enqueue_os_args(
            target_window,
            &[OsString::from("LumaMark.exe"), OsString::from("first.md")],
            &config_dir,
        )
        .expect("request should persist");
    service
}

fn serialized(value: &impl Serialize) -> Value {
    serde_json::to_value(value).expect("command result should serialize")
}

#[test]
fn recover_and_claim_dtos_use_canonical_decimal_strings_and_camel_case() {
    let service = service_with_request("window-a");

    let claimed = open_requests::claim_for_window(&service, "window-a")
        .expect("target window should claim the request");
    assert_eq!(
        serialized(&claimed),
        json!([{
            "requestId": "0",
            "path": claimed[0].path,
            "attemptToken": "0"
        }])
    );
    open_requests::record_applied_for_window(
        &service,
        "window-a",
        &claimed[0].request_id,
        &claimed[0].attempt_token,
    )
    .expect("record command should succeed");
    let recovered = open_requests::recover_for_window(&service, "window-a")
        .expect("owner should recover the pending acknowledgement");

    assert_eq!(
        serialized(&recovered),
        json!([{"requestId": "0", "attemptToken": "0"}])
    );
}

#[test]
fn mutation_helpers_return_real_unit_and_keep_owner_fencing() {
    let service = service_with_request("window-a");
    let claimed = open_requests::claim_for_window(&service, "window-a")
        .expect("target window should claim the request");
    let attempt = &claimed[0];

    let wrong_owner = open_requests::record_applied_for_window(
        &service,
        "window-b",
        &attempt.request_id,
        &attempt.attempt_token,
    )
    .expect_err("another window must not mutate the attempt");
    assert_eq!(wrong_owner.code, "desktop.open_request_owner_mismatch");

    open_requests::record_applied_for_window(
        &service,
        "window-a",
        &attempt.request_id,
        &attempt.attempt_token,
    )
    .expect("owning window should record application");
    open_requests::acknowledge_for_window(
        &service,
        "window-a",
        &attempt.request_id,
        &attempt.attempt_token,
    )
    .expect("owning window should acknowledge completion");

    assert_eq!(serialized(&()), Value::Null);
}

#[test]
fn abandon_is_idempotent_but_rejects_noncanonical_boundary_values() {
    let service = service_with_request("window-a");
    let attempt = open_requests::claim_for_window(&service, "window-a")
        .expect("target window should claim the request")
        .remove(0);

    let invalid_request =
        open_requests::abandon_for_window(&service, "window-a", "00", &attempt.attempt_token)
            .expect_err("request id must be canonical u64 decimal");
    let invalid_attempt =
        open_requests::abandon_for_window(&service, "window-a", &attempt.request_id, "+0")
            .expect_err("attempt token must be canonical u64 decimal");
    open_requests::abandon_for_window(
        &service,
        "window-a",
        &attempt.request_id,
        &attempt.attempt_token,
    )
    .expect("matching attempt should abandon");
    open_requests::abandon_for_window(
        &service,
        "window-a",
        &attempt.request_id,
        &attempt.attempt_token,
    )
    .expect("same abandonment should be idempotent");

    assert_eq!(
        invalid_request.code,
        "desktop.open_request_invalid_request_id"
    );
    assert_eq!(
        invalid_attempt.code,
        "desktop.open_request_invalid_attempt_token"
    );
    assert_eq!(serialized(&()), Value::Null);
}

#[test]
fn tauri_entrypoints_inject_webview_window_and_expose_only_the_frozen_commands() {
    let source = include_str!("../src/commands/open_requests.rs");

    for command in [
        "open_requests_recover",
        "open_requests_claim",
        "open_requests_record_applied",
        "open_requests_acknowledge",
        "open_requests_abandon",
    ] {
        assert!(
            source.contains(&format!("pub async fn {command}(")),
            "{command} must remain registered as a real Tauri entrypoint"
        );
    }
    assert!(source.contains("window: WebviewWindow"));
    assert!(!source.contains("open_requests_drain"));
    assert!(!source.contains("owner: String"));
    assert!(!source.contains("window_label: String"));
}
