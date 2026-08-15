use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::process::Command;

use lumamark_lib::services::open_request_service::{
    open_request_state_path, parse_open_request, OpenRequestService,
};

fn unique_test_dir(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be available")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("lumamark-open-request-{name}-{nanos}"));
    fs::create_dir_all(&path).expect("test directory should be created");
    path
}

fn launch_args(path: &str) -> Vec<OsString> {
    vec![OsString::from("LumaMark.exe"), OsString::from(path)]
}

fn assert_tampered_snapshot_fails_closed(name: &str, tamper: impl FnOnce(&mut serde_json::Value)) {
    let config_dir = unique_test_dir(name);
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    tamper(&mut document);
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("tampered persisted schema must fail closed");
    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

fn assert_tampered_completed_snapshot_fails_closed(
    name: &str,
    tamper: impl FnOnce(&mut serde_json::Value),
) {
    let config_dir = unique_test_dir(name);
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    let delivery = service
        .claim_for_window("window-a")
        .expect("request should be claimable")
        .remove(0);
    service
        .record_applied("window-a", &delivery.request_id, &delivery.attempt_token)
        .expect("application should persist");
    service
        .acknowledge("window-a", &delivery.request_id, &delivery.attempt_token)
        .expect("completion should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    tamper(&mut document);
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("tampered compacted schema must fail closed");
    assert_eq!(error.code, "desktop.open_request_state_unavailable");
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
fn parse_open_request_should_preserve_unicode_and_emoji_paths() {
    let args = vec![
        OsString::from("LumaMark.exe"),
        OsString::from("笔记/✨ 灵感.md"),
    ];

    let request = parse_open_request(&args, Path::new("E:/写作"))
        .expect("Unicode paths should be serializable")
        .expect("Markdown path should be selected");

    let expected: PathBuf = Path::new("E:/写作")
        .join("笔记/✨ 灵感.md")
        .components()
        .collect();
    assert_eq!(request.path, expected.to_str().expect("UTF-8 test path"));
}

#[test]
fn parse_open_request_should_ignore_flags_and_non_markdown_arguments() {
    let args = vec![
        OsString::from("LumaMark.exe"),
        OsString::from("--verbose"),
        OsString::from("notes.txt"),
        OsString::from("README.markdown"),
    ];

    let request = parse_open_request(&args, Path::new("E:/writing"))
        .expect("valid paths should parse")
        .expect("Markdown path should be selected");

    assert!(request.path.ends_with("README.markdown"));
}

#[test]
fn parse_open_request_should_accept_only_the_first_markdown_path_per_launch() {
    let args = vec![
        OsString::from("LumaMark.exe"),
        OsString::from("first.md"),
        OsString::from("second.mdown"),
    ];

    let request = parse_open_request(&args, Path::new("E:/writing"))
        .expect("valid paths should parse")
        .expect("Markdown path should be selected");

    assert!(request.path.ends_with("first.md"));
}

#[test]
fn open_request_service_should_deduplicate_lexically_equivalent_pending_paths() {
    let config_dir = unique_test_dir("lexical-dedupe");
    let service = OpenRequestService::new(config_dir).expect("service should initialize");
    service
        .enqueue_os_args(
            "main",
            &[
                OsString::from("LumaMark.exe"),
                OsString::from("notes/../readme.md"),
            ],
            Path::new("E:/writing"),
        )
        .expect("first request should be queued");
    service
        .enqueue_os_args(
            "main",
            &[OsString::from("LumaMark.exe"), OsString::from("readme.md")],
            Path::new("E:/writing"),
        )
        .expect("duplicate request should be handled");

    let claimed = service
        .claim_for_window("main")
        .expect("open requests should be claimed");

    assert_eq!(claimed.len(), 1);
    assert!(claimed[0].path.ends_with("readme.md"));
}

#[cfg(windows)]
#[test]
fn open_request_service_should_deduplicate_windows_paths_without_changing_display_path() {
    let config_dir = unique_test_dir("windows-dedupe");
    let service = OpenRequestService::new(config_dir).expect("service should initialize");
    service
        .enqueue_os_args(
            "main",
            &[
                OsString::from("LumaMark.exe"),
                OsString::from(r"E:\Notes\README.md"),
            ],
            Path::new(r"E:\"),
        )
        .expect("first request should be queued");
    service
        .enqueue_os_args(
            "main",
            &[
                OsString::from("LumaMark.exe"),
                OsString::from(r"e:\notes\readme.md"),
            ],
            Path::new(r"E:\"),
        )
        .expect("case-only duplicate should be handled");

    let claimed = service
        .claim_for_window("main")
        .expect("open requests should be claimed");

    assert_eq!(
        claimed
            .iter()
            .map(|request| request.path.as_str())
            .collect::<Vec<_>>(),
        vec![r"E:\Notes\README.md"]
    );
}

#[cfg(not(windows))]
#[test]
fn open_request_service_should_keep_case_distinct_paths_on_case_sensitive_platforms() {
    let config_dir = unique_test_dir("posix-case");
    let service = OpenRequestService::new(config_dir).expect("service should initialize");
    service
        .enqueue_os_args(
            "main",
            &[
                OsString::from("lumamark"),
                OsString::from("Notes/README.md"),
            ],
            Path::new("/writing"),
        )
        .expect("first request should be queued");
    service
        .enqueue_os_args(
            "main",
            &[
                OsString::from("lumamark"),
                OsString::from("notes/readme.md"),
            ],
            Path::new("/writing"),
        )
        .expect("case-distinct request should be queued");

    let claimed = service
        .claim_for_window("main")
        .expect("open requests should be claimed");

    assert_eq!(claimed.len(), 2);
}

#[cfg(unix)]
#[test]
fn parse_open_request_should_reject_a_non_utf8_path_without_lossy_conversion() {
    use std::os::unix::ffi::OsStringExt;

    let args = vec![
        OsString::from("lumamark"),
        OsString::from_vec(b"invalid-\xFF.md".to_vec()),
    ];

    let error = parse_open_request(&args, Path::new("/tmp"))
        .expect_err("non-UTF-8 paths cannot cross the JSON IPC boundary");

    assert_eq!(error.code, "desktop.open_request_path_not_utf8");

    let config_dir = unique_test_dir("non-utf8");
    let service = OpenRequestService::new(config_dir).expect("service should initialize");
    let enqueue_error = service
        .enqueue_os_args("main", &args, Path::new("/tmp"))
        .expect_err("the durable queue should reject the serialization failure");
    assert_eq!(enqueue_error.code, "desktop.open_request_path_not_utf8");
}

#[test]
fn durable_service_should_claim_only_requests_targeted_to_the_real_window() {
    let config_dir = unique_test_dir("targeted-claim");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");

    assert!(service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("first request should persist"));
    assert!(service
        .enqueue_os_args("window-b", &launch_args("second.md"), &config_dir)
        .expect("second request should persist"));
    assert!(open_request_state_path(&config_dir).is_file());

    let first_window = service
        .claim_for_window("window-a")
        .expect("window-a should claim its request");
    let repeated_first_window = service
        .claim_for_window("window-a")
        .expect("repeated claims must not redeliver processing work");
    let second_window = service
        .claim_for_window("window-b")
        .expect("window-b should claim only its request");

    assert_eq!(first_window.len(), 1);
    assert!(first_window[0].path.ends_with("first.md"));
    assert_eq!(first_window[0].request_id, "0");
    assert_eq!(first_window[0].attempt_token, "0");
    assert_eq!(repeated_first_window, first_window);
    assert_eq!(second_window.len(), 1);
    assert!(second_window[0].path.ends_with("second.md"));
    assert_eq!(second_window[0].request_id, "1");
    assert_eq!(second_window[0].attempt_token, "1");
}

#[test]
fn active_target_windows_are_unique_sorted_and_include_applied_pending() {
    let config_dir = unique_test_dir("active-target-windows");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    for (target, path) in [
        ("window-z", "z.md"),
        ("window-a", "a-first.md"),
        ("window-a", "a-second.md"),
    ] {
        service
            .enqueue_os_args(target, &launch_args(path), &config_dir)
            .expect("request should persist");
    }
    let z_delivery = service
        .claim_for_window("window-z")
        .expect("window-z request should claim")
        .remove(0);
    service
        .record_applied(
            "window-z",
            &z_delivery.request_id,
            &z_delivery.attempt_token,
        )
        .expect("window-z request should become applied-pending");

    assert_eq!(
        service
            .active_target_windows()
            .expect("active targets should be readable"),
        vec!["window-a".to_owned(), "window-z".to_owned()]
    );

    service
        .acknowledge(
            "window-z",
            &z_delivery.request_id,
            &z_delivery.attempt_token,
        )
        .expect("window-z completion should persist");
    assert_eq!(
        service
            .active_target_windows()
            .expect("completed targets should be excluded"),
        vec!["window-a".to_owned()]
    );
}

#[test]
fn active_path_target_query_uses_shared_filesystem_identity() {
    let config_dir = unique_test_dir("active-path-target");
    let real_directory = config_dir.join("real");
    let alias_directory = config_dir.join("alias");
    fs::create_dir_all(&real_directory).expect("real directory should exist");
    create_directory_alias(&real_directory, &alias_directory);
    let real_path = real_directory.join("draft.md");
    let alias_path = alias_directory.join("draft.md");
    fs::write(&real_path, "draft").expect("test document should exist");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args(
            "window-a",
            &launch_args(alias_path.to_str().expect("alias path should be Unicode")),
            &config_dir,
        )
        .expect("aliased request should persist");
    service
        .enqueue_os_args(
            "window-a",
            &launch_args(real_path.to_str().expect("real path should be Unicode")),
            &config_dir,
        )
        .expect("real-path duplicate should coalesce with the alias identity");
    assert_eq!(
        service
            .claim_for_window("window-a")
            .expect("coalesced request should be claimable")
            .len(),
        1
    );

    assert_eq!(
        service
            .target_window_for_active_path(real_path.to_str().expect("real path should be Unicode"))
            .expect("real path owner should be readable"),
        Some("window-a".to_owned())
    );
    assert_eq!(
        service
            .target_window_for_active_path(
                real_directory
                    .join("unclaimed.md")
                    .to_str()
                    .expect("unclaimed path should be Unicode"),
            )
            .expect("unclaimed path lookup should succeed"),
        None
    );
}

#[test]
fn active_path_target_query_fails_closed_for_different_target_windows() {
    let config_dir = unique_test_dir("ambiguous-active-path-target");
    let real_directory = config_dir.join("real");
    let alias_directory = config_dir.join("alias");
    fs::create_dir_all(&real_directory).expect("real directory should exist");
    create_directory_alias(&real_directory, &alias_directory);
    let real_path = real_directory.join("draft.md");
    let alias_path = alias_directory.join("draft.md");
    fs::write(&real_path, "draft").expect("test document should exist");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args(
            "window-a",
            &launch_args(alias_path.to_str().expect("alias path should be Unicode")),
            &config_dir,
        )
        .expect("alias request should persist");
    service
        .enqueue_os_args(
            "window-b",
            &launch_args(real_path.to_str().expect("real path should be Unicode")),
            &config_dir,
        )
        .expect("real-path request should persist for another target");

    let error = service
        .target_window_for_active_path(real_path.to_str().expect("real path should be Unicode"))
        .expect_err("different targets for one identity must fail closed");

    assert_eq!(error.code, "desktop.open_request_target_ambiguous");
}

#[test]
fn applied_pending_identity_survives_cold_restore_and_alias_removal_until_ack() {
    let config_dir = unique_test_dir("applied-identity-index");
    let real_directory = config_dir.join("real");
    let alias_directory = config_dir.join("alias");
    fs::create_dir_all(&real_directory).expect("real directory should exist");
    create_directory_alias(&real_directory, &alias_directory);
    let real_path = real_directory.join("draft.md");
    let alias_path = alias_directory.join("draft.md");
    fs::write(&real_path, "draft").expect("test document should exist");

    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args(
            "window-a",
            &launch_args(alias_path.to_str().expect("alias path should be Unicode")),
            &config_dir,
        )
        .expect("aliased request should persist");
    let attempt = service
        .claim_for_window("window-a")
        .expect("request should be claimable")
        .remove(0);
    service
        .record_applied("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("applied-pending state should persist");
    drop(service);

    #[cfg(windows)]
    fs::remove_dir(&alias_directory).expect("junction or symlink should be removable");
    #[cfg(unix)]
    fs::remove_file(&alias_directory).expect("symlink should be removable");

    let restored = OpenRequestService::new(config_dir.clone())
        .expect("persisted identity index should restore without touching the alias");
    assert_eq!(
        restored
            .target_window_for_active_path(real_path.to_str().expect("real path should be Unicode"))
            .expect("stored resolved identity should survive alias removal"),
        Some("window-a".to_owned())
    );

    restored
        .acknowledge("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("acknowledgement should delete retained identity atomically");
    assert_eq!(
        restored
            .target_window_for_active_path(real_path.to_str().expect("real path should be Unicode"))
            .expect("completed identity lookup should succeed"),
        None
    );
}

#[test]
fn failed_acknowledgement_persistence_rolls_back_the_completion_and_identity_index() {
    let config_dir = unique_test_dir("ack-identity-rollback");
    let document_path = config_dir.join("draft.md");
    fs::write(&document_path, "draft").expect("test document should exist");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args(
            "window-a",
            &launch_args(
                document_path
                    .to_str()
                    .expect("document path should be Unicode"),
            ),
            &config_dir,
        )
        .expect("request should persist");
    let attempt = service
        .claim_for_window("window-a")
        .expect("request should claim")
        .remove(0);
    service
        .record_applied("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("application should persist");

    let displaced_config_dir = config_dir.with_extension("displaced");
    fs::rename(&config_dir, &displaced_config_dir)
        .expect("state directory should move out of the persistence path");
    fs::write(&config_dir, b"not-a-directory").expect("blocking file should be created");
    let error = service
        .acknowledge("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect_err("failed persistence must reject the acknowledgement");
    assert_eq!(error.code, "desktop.open_request_persist_failed");

    fs::remove_file(&config_dir).expect("blocking file should be removable");
    fs::rename(&displaced_config_dir, &config_dir)
        .expect("state directory should return to the persistence path");
    assert_eq!(
        service
            .recover_for_window("window-a")
            .expect("completion should remain pending after rollback")
            .len(),
        1
    );
    assert_eq!(
        service
            .target_window_for_active_path(
                document_path
                    .to_str()
                    .expect("document path should be Unicode"),
            )
            .expect("identity index should remain after rollback"),
        Some("window-a".to_owned())
    );

    service
        .acknowledge("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("acknowledgement should succeed after storage recovers");
    assert_eq!(
        service
            .target_window_for_active_path(
                document_path
                    .to_str()
                    .expect("document path should be Unicode"),
            )
            .expect("completed identity lookup should succeed"),
        None
    );
}

#[test]
fn failed_record_applied_persistence_keeps_the_irreversible_application_pending() {
    let config_dir = unique_test_dir("record-applied-persist-debt");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    let attempt = service
        .claim_for_window("window-a")
        .expect("request should claim")
        .remove(0);

    let displaced_config_dir = config_dir.with_extension("displaced");
    fs::rename(&config_dir, &displaced_config_dir)
        .expect("state directory should move out of the persistence path");
    fs::write(&config_dir, b"not-a-directory").expect("blocking file should be created");
    let error = service
        .record_applied("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect_err("failed persistence must report the unapplied durability debt");
    assert_eq!(error.code, "desktop.open_request_persist_failed");

    fs::remove_file(&config_dir).expect("blocking file should be removable");
    fs::rename(&displaced_config_dir, &config_dir)
        .expect("state directory should return to the persistence path");
    let pending = service
        .recover_for_window("window-a")
        .expect("the irreversible application must remain pending in memory");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].request_id, attempt.request_id);
    assert_eq!(pending[0].attempt_token, attempt.attempt_token);
    assert!(service
        .claim_for_window("window-a")
        .expect("applied work must never redeliver")
        .is_empty());

    service
        .record_applied("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("a terminal retry must flush the pending durability debt");
    drop(service);
    let restored = OpenRequestService::new(config_dir)
        .expect("the retried applied marker should survive restart");
    assert_eq!(
        restored
            .recover_for_window("window-a")
            .expect("the persisted applied marker should remain reconcilable")
            .len(),
        1
    );
}

#[test]
fn failed_destroy_release_persistence_rotates_the_dead_windows_attempt_in_memory() {
    let config_dir = unique_test_dir("release-window-persist-debt");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    let stale_attempt = service
        .claim_for_window("window-a")
        .expect("request should claim")
        .remove(0);

    let displaced_config_dir = config_dir.with_extension("displaced");
    fs::rename(&config_dir, &displaced_config_dir)
        .expect("state directory should move out of the persistence path");
    fs::write(&config_dir, b"not-a-directory").expect("blocking file should be created");
    let error = service
        .release_window("window-a")
        .expect_err("destroy cleanup must report failed persistence");
    assert_eq!(error.code, "desktop.open_request_persist_failed");

    fs::remove_file(&config_dir).expect("blocking file should be removable");
    fs::rename(&displaced_config_dir, &config_dir)
        .expect("state directory should return to the persistence path");
    let fresh_attempt = service
        .claim_for_window("window-a")
        .expect("the replacement window should claim the in-memory queue")
        .remove(0);
    assert_eq!(fresh_attempt.request_id, stale_attempt.request_id);
    assert_ne!(fresh_attempt.attempt_token, stale_attempt.attempt_token);
    let stale_error = service
        .record_applied(
            "window-a",
            &stale_attempt.request_id,
            &stale_attempt.attempt_token,
        )
        .expect_err("the destroyed WebView attempt must stay fenced");
    assert_eq!(stale_error.code, "desktop.open_request_attempt_stale");
}

#[test]
fn one_claim_should_drain_every_targeted_request_without_hidden_pagination() {
    let config_dir = unique_test_dir("claim-all");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    for index in 0..65 {
        service
            .enqueue_os_args(
                "window-a",
                &launch_args(&format!("request-{index}.md")),
                &config_dir,
            )
            .expect("request should persist");
    }

    let deliveries = service
        .claim_for_window("window-a")
        .expect("one synchronization must claim every targeted request");

    assert_eq!(deliveries.len(), 65);
    assert_eq!(
        deliveries.first().map(|item| item.request_id.as_str()),
        Some("0")
    );
    assert_eq!(
        deliveries.last().map(|item| item.request_id.as_str()),
        Some("64")
    );
}

#[test]
fn cold_restore_should_requeue_processing_without_cross_window_delivery() {
    let config_dir = unique_test_dir("cold-restore");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    let first_attempt = service
        .claim_for_window("window-a")
        .expect("first process should claim")
        .remove(0);
    drop(service);

    let restored = OpenRequestService::new(config_dir)
        .expect("persisted lifecycle should restore after restart");
    assert!(restored
        .claim_for_window("window-b")
        .expect("other window claim should be safe")
        .is_empty());
    let replay = restored
        .claim_for_window("window-a")
        .expect("original target should reclaim cold processing")
        .remove(0);

    assert_eq!(replay.request_id, first_attempt.request_id);
    assert_ne!(replay.attempt_token, first_attempt.attempt_token);
}

#[test]
fn applied_request_should_recover_and_acknowledge_without_redelivery() {
    let config_dir = unique_test_dir("applied-recovery");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    let attempt = service
        .claim_for_window("window-a")
        .expect("request should be claimable")
        .remove(0);
    service
        .record_applied("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("application should persist before returning");
    drop(service);

    let restored =
        OpenRequestService::new(config_dir.clone()).expect("applied lifecycle should restore");
    assert!(restored
        .claim_for_window("window-a")
        .expect("applied request must not redeliver")
        .is_empty());
    assert!(restored
        .recover_for_window("window-b")
        .expect("other owner recovery should be safe")
        .is_empty());
    let pending = restored
        .recover_for_window("window-a")
        .expect("applying owner should recover the pending acknowledgement");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].request_id, attempt.request_id);
    assert_eq!(pending[0].attempt_token, attempt.attempt_token);
    restored
        .acknowledge(
            "window-a",
            &pending[0].request_id,
            &pending[0].attempt_token,
        )
        .expect("completion acknowledgement should persist");
    drop(restored);

    let completed =
        OpenRequestService::new(config_dir).expect("completed tombstone should restore");
    assert!(completed
        .recover_for_window("window-a")
        .expect("completed request should not require reconciliation")
        .is_empty());
    assert!(completed
        .claim_for_window("window-a")
        .expect("completed request should not redeliver")
        .is_empty());
}

#[test]
fn duplicate_enqueue_should_reuse_applied_pending_identity_until_acknowledgement() {
    let config_dir = unique_test_dir("pending-dedupe");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    let attempt = service
        .claim_for_window("window-a")
        .expect("request should be claimable")
        .remove(0);
    service
        .record_applied("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("application should persist");
    drop(service);
    let service = OpenRequestService::new(config_dir.clone())
        .expect("applied-pending dedupe identity should survive restart");

    assert!(service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("duplicate applied notification should reuse durable identity"));
    assert!(service
        .claim_for_window("window-a")
        .expect("duplicate notification must not create a second delivery")
        .is_empty());
    let pending = service
        .recover_for_window("window-a")
        .expect("original pending acknowledgement should remain");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].request_id, attempt.request_id);
    service
        .acknowledge("window-a", &attempt.request_id, &attempt.attempt_token)
        .expect("original request should complete");

    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("a later explicit launch may create a new request");
    let later = service
        .claim_for_window("window-a")
        .expect("later launch should be deliverable")
        .remove(0);
    assert_eq!(later.request_id, "1");
}

#[test]
fn reload_recovery_and_destroy_cleanup_should_release_only_processing_for_that_owner() {
    let config_dir = unique_test_dir("owner-cleanup");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("first request should persist");
    service
        .enqueue_os_args("window-a", &launch_args("second.md"), &config_dir)
        .expect("second request should persist");
    let attempts = service
        .claim_for_window("window-a")
        .expect("both requests should be claimed");
    service
        .record_applied(
            "window-a",
            &attempts[0].request_id,
            &attempts[0].attempt_token,
        )
        .expect("first request should enter applied-pending");

    let recovered = service
        .recover_for_window("window-a")
        .expect("reload recovery should expose only applied acknowledgements");
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].request_id, attempts[0].request_id);
    let replay = service
        .claim_for_window("window-a")
        .expect("reload should replay the same owned processing attempt")
        .into_iter()
        .find(|delivery| delivery.request_id == attempts[1].request_id)
        .expect("second request should remain owned by this window");
    assert_eq!(replay.request_id, attempts[1].request_id);
    assert_eq!(replay.attempt_token, attempts[1].attempt_token);

    assert_eq!(
        service
            .release_window("window-a")
            .expect("destroy cleanup should persist"),
        1
    );
    let reclaimed = service
        .claim_for_window("window-a")
        .expect("destroyed-window processing should requeue")
        .into_iter()
        .find(|delivery| delivery.request_id == attempts[1].request_id)
        .expect("released request should be reclaimed");
    assert_ne!(reclaimed.attempt_token, attempts[1].attempt_token);
    assert_eq!(
        service
            .recover_for_window("window-a")
            .expect("applied-pending must survive destroyed-window cleanup")
            .len(),
        1
    );
}

#[test]
fn persistence_failure_should_roll_back_request_id_and_queue_state() {
    let config_dir = unique_test_dir("rollback");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    fs::remove_dir(&config_dir).expect("empty test directory should be removable");
    fs::write(&config_dir, b"not-a-directory").expect("blocking file should be created");

    let error = service
        .enqueue_os_args(
            "window-a",
            &launch_args("first.md"),
            Path::new("E:/writing"),
        )
        .expect_err("failed durable write must reject enqueue");
    assert_eq!(error.code, "desktop.open_request_persist_failed");

    fs::remove_file(&config_dir).expect("blocking file should be removable");
    fs::create_dir_all(&config_dir).expect("test directory should be restored");
    service
        .enqueue_os_args(
            "window-a",
            &launch_args("first.md"),
            Path::new("E:/writing"),
        )
        .expect("retry should persist after storage recovers");
    let delivery = service
        .claim_for_window("window-a")
        .expect("rolled-back request should be claimable once")
        .remove(0);
    assert_eq!(delivery.request_id, "0");
}

#[test]
fn an_empty_claim_should_not_attempt_a_durable_write() {
    let config_dir = unique_test_dir("empty-claim-no-write");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    fs::remove_dir(&config_dir).expect("empty test directory should be removable");
    fs::write(&config_dir, b"not-a-directory").expect("blocking file should be created");

    let deliveries = service
        .claim_for_window("window-a")
        .expect("an empty claim must not depend on persistence");

    assert!(deliveries.is_empty());
}

#[test]
fn acknowledged_requests_should_persist_only_active_records_and_a_compact_high_water() {
    let config_dir = unique_test_dir("completion-compaction");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    for file_name in ["first.md", "second.md", "third.md"] {
        service
            .enqueue_os_args("window-a", &launch_args(file_name), &config_dir)
            .expect("request should persist");
    }
    let attempts = service
        .claim_for_window("window-a")
        .expect("requests should be claimable");
    assert_eq!(attempts.len(), 3);
    for attempt in &attempts {
        service
            .record_applied("window-a", &attempt.request_id, &attempt.attempt_token)
            .expect("application should persist");
        service
            .acknowledge("window-a", &attempt.request_id, &attempt.attempt_token)
            .expect("completion should persist");
    }
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("state should be readable"))
            .expect("state should be valid JSON");
    assert_eq!(document["nextRequestId"], serde_json::json!(3));
    assert_eq!(document["retainedRequests"], serde_json::json!([]));
    assert_eq!(document["lifecycle"]["records"], serde_json::json!([]));
    assert_eq!(
        document["lifecycle"]["acknowledgedRanges"],
        serde_json::json!([{ "startSequence": 0, "endSequenceExclusive": 3 }])
    );

    let restored = OpenRequestService::new(config_dir.clone())
        .expect("a sparse compacted lifecycle should restore");
    restored
        .record_applied(
            "window-a",
            &attempts[0].request_id,
            &attempts[0].attempt_token,
        )
        .expect("an exact stale application callback should be harmless");
    restored
        .acknowledge(
            "window-a",
            &attempts[0].request_id,
            &attempts[0].attempt_token,
        )
        .expect("an exact stale acknowledgement should be harmless");
    let stale_error = restored
        .acknowledge("window-a", &attempts[0].request_id, "999")
        .expect_err("a recent stale callback must retain attempt fencing");
    assert_eq!(stale_error.code, "desktop.open_request_attempt_stale");
    assert!(restored
        .claim_for_window("window-a")
        .expect("compacted completions must never replay")
        .is_empty());
    drop(restored);

    document["lifecycle"]["recentCompletionFences"]
        .as_array_mut()
        .expect("recent completion fences should be an array")
        .retain(|fence| fence["requestId"] != serde_json::json!("0"));
    fs::write(
        &state_path,
        serde_json::to_vec_pretty(&document).expect("compacted fixture should serialize"),
    )
    .expect("compacted fixture should be written");
    let compacted =
        OpenRequestService::new(config_dir).expect("an older compacted completion should restore");
    compacted
        .record_applied("unrelated-window", "0", "999")
        .expect("an older application callback should be a no-op");
    compacted
        .acknowledge("unrelated-window", "0", "999")
        .expect("an older acknowledgement should be a no-op");
    assert!(compacted
        .claim_for_window("window-a")
        .expect("an older compacted completion must never replay")
        .is_empty());
}

#[test]
fn corrupt_persisted_state_should_fail_closed() {
    let config_dir = unique_test_dir("corrupt");
    fs::write(open_request_state_path(&config_dir), b"{not-json")
        .expect("corrupt fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("corrupt durable state must not silently reset");

    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

#[test]
fn persisted_root_unknown_fields_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("unknown-root-field", |document| {
        document["unexpectedRoot"] = serde_json::json!(true);
    });
}

#[test]
fn persisted_retained_request_unknown_fields_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("unknown-retained-field", |document| {
        document["retainedRequests"][0]["unexpectedRetained"] = serde_json::json!(true);
    });
}

#[test]
fn persisted_payload_unknown_fields_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("unknown-payload-field", |document| {
        document["retainedRequests"][0]["payload"]["unexpectedPayload"] = serde_json::json!(true);
    });
}

#[test]
fn persisted_lifecycle_unknown_fields_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("unknown-lifecycle-field", |document| {
        document["lifecycle"]["unexpectedLifecycle"] = serde_json::json!(true);
    });
}

#[test]
fn persisted_lifecycle_record_unknown_fields_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("unknown-record-field", |document| {
        document["lifecycle"]["records"][0]["unexpectedRecord"] = serde_json::json!(true);
    });
}

#[test]
fn persisted_lifecycle_state_unknown_fields_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("unknown-state-field", |document| {
        document["lifecycle"]["records"][0]["state"]["unexpectedState"] = serde_json::json!(true);
    });
}

#[test]
fn persisted_acknowledged_range_unknown_fields_should_fail_closed() {
    assert_tampered_completed_snapshot_fails_closed("unknown-ack-range-field", |document| {
        document["lifecycle"]["acknowledgedRanges"][0]["unexpectedRange"] = serde_json::json!(true);
    });
}

#[test]
fn persisted_completion_fence_unknown_fields_should_fail_closed() {
    assert_tampered_completed_snapshot_fails_closed("unknown-completion-fence-field", |document| {
        document["lifecycle"]["recentCompletionFences"][0]["unexpectedFence"] =
            serde_json::json!(true);
    });
}

#[test]
fn persisted_acknowledged_ranges_must_exactly_cover_compacted_sequences() {
    assert_tampered_completed_snapshot_fails_closed("invalid-ack-range-coverage", |document| {
        document["lifecycle"]["acknowledgedRanges"][0]["startSequence"] = serde_json::json!(1);
    });
}

#[test]
fn persisted_nested_identity_unknown_fields_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("unknown-identity-field", |document| {
        document["retainedRequests"][0]["identity"]["unexpectedIdentity"] = serde_json::json!(true);
    });
}

#[test]
fn future_persisted_schema_version_should_fail_closed() {
    assert_tampered_snapshot_fails_closed("future-schema-version", |document| {
        document["version"] = serde_json::json!(3);
    });
}

#[test]
fn legacy_snapshot_without_persisted_path_identity_should_fail_closed() {
    let config_dir = unique_test_dir("legacy-identity-schema");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    document["version"] = serde_json::json!(1);
    if let Some(retained) = document["retainedRequests"].as_array_mut() {
        for request in retained {
            request
                .as_object_mut()
                .expect("retained request should be an object")
                .remove("identity");
        }
    }
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("legacy fixture should serialize"),
    )
    .expect("legacy fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("identity-less legacy snapshots must not be silently re-resolved");
    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

#[test]
fn malformed_persisted_path_identity_should_fail_closed() {
    let config_dir = unique_test_dir("malformed-identity-snapshot");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    document["retainedRequests"][0]["identity"] = serde_json::json!({
        "lexicalAlias": "windows-drive:C:/noncanonical",
        "resolved": "windows-drive:c:/noncanonical"
    });
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("malformed persisted path identities must fail closed");
    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

#[test]
fn persisted_path_identity_must_match_the_retained_payload_path() {
    let config_dir = unique_test_dir("identity-payload-mismatch");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("first request should persist");
    service
        .enqueue_os_args("window-a", &launch_args("second.md"), &config_dir)
        .expect("second request should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    document["retainedRequests"][0]["identity"] =
        document["retainedRequests"][1]["identity"].clone();
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("a canonical identity for another payload must fail closed");
    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

#[test]
fn noncanonical_persisted_request_id_should_fail_with_state_error() {
    let config_dir = unique_test_dir("noncanonical-request-id");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    document["lifecycle"]["records"][0]["requestId"] = serde_json::json!("00");
    document["retainedRequests"][0]["requestId"] = serde_json::json!("00");
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("noncanonical persisted identity must fail closed");

    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

#[test]
fn noncontiguous_persisted_request_ids_should_fail_closed() {
    let config_dir = unique_test_dir("noncontiguous-request-ids");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    document["lifecycle"]["records"][0]["requestId"] = serde_json::json!("1");
    document["retainedRequests"][0]["requestId"] = serde_json::json!("1");
    document["nextRequestId"] = serde_json::json!(2);
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("persisted request identities must remain contiguous from zero");

    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

#[test]
fn persisted_applied_owner_must_match_the_retained_target_window() {
    let config_dir = unique_test_dir("pending-owner-mismatch");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("request should persist");
    let delivery = service
        .claim_for_window("window-a")
        .expect("request should be claimable")
        .remove(0);
    service
        .record_applied("window-a", &delivery.request_id, &delivery.attempt_token)
        .expect("application should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    document["retainedRequests"][0]["payload"]["targetWindow"] = serde_json::json!("window-b");
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("pending owner and retained target mismatch must fail closed");

    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}

#[test]
fn persisted_targeted_path_identities_must_be_unique() {
    let config_dir = unique_test_dir("duplicate-path-identity");
    let service = OpenRequestService::new(config_dir.clone())
        .expect("empty durable service should initialize");
    service
        .enqueue_os_args("window-a", &launch_args("first.md"), &config_dir)
        .expect("first request should persist");
    service
        .enqueue_os_args("window-a", &launch_args("second.md"), &config_dir)
        .expect("second request should persist");
    drop(service);

    let state_path = open_request_state_path(&config_dir);
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(&state_path).expect("persisted state should be readable"))
            .expect("persisted state should be valid JSON");
    let first_path = document["retainedRequests"][0]["payload"]["path"].clone();
    let first_identity = document["retainedRequests"][0]["identity"].clone();
    document["retainedRequests"][1]["payload"]["path"] = first_path.clone();
    document["retainedRequests"][1]["identity"] = first_identity;
    document["lifecycle"]["records"][1]["payload"]["path"] = first_path;
    fs::write(
        state_path,
        serde_json::to_vec_pretty(&document).expect("tampered fixture should serialize"),
    )
    .expect("tampered fixture should be written");

    let error = OpenRequestService::new(config_dir)
        .expect_err("duplicate targeted path identity must fail closed");

    assert_eq!(error.code, "desktop.open_request_state_unavailable");
}
