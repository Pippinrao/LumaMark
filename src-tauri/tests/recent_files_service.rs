use std::{
    fs,
    sync::{Arc, Barrier},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use lumamark_lib::services::recent_files_service::{
    recent_files_path, RecentFileInput, RecentFilesService,
};

fn unique_test_dir(name: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("lumamark-recent-files-{name}-{nanos}"));
    fs::create_dir_all(&dir).expect("test directory should be created");
    dir
}

fn file(name: &str, path: &str, opened_at: u64) -> RecentFileInput {
    RecentFileInput {
        name: name.to_owned(),
        opened_at,
        path: path.to_owned(),
    }
}

#[test]
fn starts_empty_without_creating_a_file() {
    let dir = unique_test_dir("empty");
    let service = RecentFilesService::new(dir.clone());

    let snapshot = service.get().expect("missing state should load");

    assert!(snapshot.files.is_empty());
    assert_eq!(snapshot.revision, 0);
    assert!(!recent_files_path(&dir).exists());
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn add_persists_and_a_new_service_restores_the_snapshot() {
    let dir = unique_test_dir("restore");
    let service = RecentFilesService::new(dir.clone());

    let added = service
        .add(file("draft.md", r"C:\Notes\draft.md", 42))
        .expect("add should persist");
    let restarted = RecentFilesService::new(dir.clone())
        .get()
        .expect("persisted state should load");

    assert_eq!(added, restarted);
    assert_eq!(restarted.revision, 1);
    assert_eq!(
        restarted.files,
        [file("draft.md", r"C:\Notes\draft.md", 42)]
    );
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn repeated_exact_path_moves_the_newest_entry_to_the_front() {
    let dir = unique_test_dir("dedupe");
    let service = RecentFilesService::new(dir.clone());
    service
        .add(file("old.md", r"C:\Notes\same.md", 1))
        .expect("first add should persist");

    let snapshot = service
        .add(file("new.md", r"C:\Notes\same.md", 2))
        .expect("second add should persist");

    assert_eq!(snapshot.revision, 2);
    assert_eq!(snapshot.files, [file("new.md", r"C:\Notes\same.md", 2)]);
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn windows_aliases_deduplicate() {
    let dir = unique_test_dir("path-identity");
    let service = RecentFilesService::new(dir.clone());
    service
        .add(file("drive-old.md", r"C:\Notes\draft.md", 1))
        .expect("drive path should persist");
    service
        .add(file("drive-extended.md", r"\\?\c:\notes\DRAFT.md", 2))
        .expect("extended drive alias should persist");
    service
        .add(file("drive-new.md", r"c:\notes\DRAFT.md. ", 3))
        .expect("normal drive trailing dot and space alias should persist");
    service
        .add(file("unc-old.md", r"\\Server\Share\note.md", 4))
        .expect("UNC path should persist");

    let snapshot = service
        .add(file("unc-new.md", r"\\?\UNC\server\share\NOTE.md", 5))
        .expect("extended UNC alias should persist");

    assert_eq!(snapshot.files.len(), 2);
    assert!(snapshot
        .files
        .iter()
        .any(|entry| entry.name == "drive-new.md"));
    assert!(snapshot
        .files
        .iter()
        .any(|entry| entry.name == "unc-new.md"));
    fs::remove_dir_all(dir).expect("cleanup");
}

#[cfg(windows)]
#[test]
fn posix_rooted_paths_fail_closed_on_windows() {
    let dir = unique_test_dir("posix-rooted-windows");
    let service = RecentFilesService::new(dir.clone());

    let error = service
        .add(file("upper.md", "/notes/Draft.md", 6))
        .expect_err("Windows recent files must reject POSIX-rooted paths");

    assert_eq!(error.code, "recent_files.invalid_entry");
    fs::remove_dir_all(dir).expect("cleanup");
}

#[cfg(unix)]
#[test]
fn posix_case_remains_distinct() {
    let dir = unique_test_dir("posix-case");
    let service = RecentFilesService::new(dir.clone());
    service
        .add(file("upper.md", "/notes/Draft.md", 6))
        .expect("POSIX upper-case path should persist");

    let snapshot = service
        .add(file("lower.md", "/notes/draft.md", 7))
        .expect("POSIX lower-case path should persist");

    assert_eq!(snapshot.files.len(), 2);
    assert!(snapshot.files.iter().any(|entry| entry.name == "upper.md"));
    assert!(snapshot.files.iter().any(|entry| entry.name == "lower.md"));
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn legacy_import_reuses_windows_identity_without_duplicating_aliases() {
    let dir = unique_test_dir("legacy-path-identity");
    let service = RecentFilesService::new(dir.clone());
    service
        .add(file("native.md", r"C:\Notes\draft.md", 3))
        .expect("native entry should persist");

    let snapshot = service
        .import_legacy(vec![
            file("alias.md", r"\\?\c:\notes\DRAFT.md", 2),
            file("other.md", r"C:\Notes\other.md", 1),
        ])
        .expect("legacy aliases should import atomically");

    assert_eq!(snapshot.files.len(), 2);
    assert!(snapshot.files.iter().any(|entry| entry.name == "native.md"));
    assert!(snapshot.files.iter().any(|entry| entry.name == "other.md"));
    assert!(!snapshot.files.iter().any(|entry| entry.name == "alias.md"));
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn an_unparseable_legacy_entry_does_not_block_a_new_recent_file() {
    let dir = unique_test_dir("offline-entry");
    fs::write(
        recent_files_path(&dir),
        br#"{
  "files": [{"name":"offline.md","openedAt":1,"path":"relative-offline.md"}],
  "legacyImported":false,
  "revision":1,
  "version":1
}"#,
    )
    .expect("legacy document should be written");
    let service = RecentFilesService::new(dir.clone());

    let snapshot = service
        .add(file("local.md", r"C:\Notes\local.md", 2))
        .expect("an unavailable old identity must not block a new entry");

    assert_eq!(snapshot.files.len(), 2);
    assert!(snapshot
        .files
        .iter()
        .any(|entry| entry.path == "relative-offline.md"));
    assert!(snapshot.files.iter().any(|entry| entry.name == "local.md"));
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn concurrent_adds_are_serialized_without_lost_updates() {
    let dir = unique_test_dir("concurrent");
    let service = Arc::new(RecentFilesService::new(dir.clone()));
    let barrier = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();
    for (name, path, opened_at) in [
        ("one.md", r"C:\Notes\one.md", 1),
        ("two.md", r"C:\Notes\two.md", 2),
    ] {
        let worker_service = Arc::clone(&service);
        let worker_barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            worker_barrier.wait();
            worker_service.add(file(name, path, opened_at))
        }));
    }
    barrier.wait();
    for worker in workers {
        worker
            .join()
            .expect("worker should not panic")
            .expect("concurrent add should persist");
    }

    let snapshot = service.get().expect("final state should load");

    assert_eq!(snapshot.revision, 2);
    assert_eq!(snapshot.files.len(), 2);
    assert!(snapshot
        .files
        .iter()
        .any(|entry| entry.path.ends_with("one.md")));
    assert!(snapshot
        .files
        .iter()
        .any(|entry| entry.path.ends_with("two.md")));
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn clear_is_atomic_and_increments_the_revision() {
    let dir = unique_test_dir("clear");
    let service = RecentFilesService::new(dir.clone());
    service
        .add(file("draft.md", r"C:\Notes\draft.md", 1))
        .expect("add should persist");

    let cleared = service.clear().expect("clear should persist");
    let restarted = RecentFilesService::new(dir.clone())
        .get()
        .expect("cleared state should load");

    assert!(cleared.files.is_empty());
    assert_eq!(cleared.revision, 2);
    assert_eq!(restarted, cleared);
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn corrupt_state_fails_closed_without_rewriting_the_file() {
    let dir = unique_test_dir("corrupt");
    let path = recent_files_path(&dir);
    let raw = b"{not-json";
    fs::write(&path, raw).expect("write corrupt fixture");
    let service = RecentFilesService::new(dir.clone());

    let error = service
        .get()
        .expect_err("corruption must not become empty state");

    assert_eq!(error.code, "recent_files.read_failed");
    assert_eq!(fs::read(path).expect("read original"), raw);
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn invalid_inputs_fail_without_mutating_persisted_state() {
    let dir = unique_test_dir("invalid-input");
    let service = RecentFilesService::new(dir.clone());
    let baseline = service
        .add(file("draft.md", r"C:\Notes\draft.md", 1))
        .expect("baseline should persist");

    let error = service
        .add(file("", "", 2))
        .expect_err("empty input must fail closed");
    let after = service.get().expect("baseline should remain readable");

    assert_eq!(error.code, "recent_files.invalid_entry");
    assert_eq!(after, baseline);
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn legacy_import_is_atomic_and_idempotent_across_a_cold_restart() {
    let dir = unique_test_dir("legacy-import");
    let service = RecentFilesService::new(dir.clone());
    service
        .add(file("native.md", r"C:\Notes\native.md", 30))
        .expect("native entry should persist");
    let legacy = vec![
        file("new-legacy.md", r"C:\Notes\new-legacy.md", 20),
        file("old-legacy.md", r"C:\Notes\old-legacy.md", 10),
    ];

    let imported = service
        .import_legacy(legacy.clone())
        .expect("legacy list should import in one write");
    let restarted = RecentFilesService::new(dir.clone());
    let retried = restarted
        .import_legacy(legacy)
        .expect("a cold retry after frontend cleanup loss should be idempotent");

    assert_eq!(imported.revision, 2);
    assert_eq!(
        imported.files,
        [
            file("native.md", r"C:\Notes\native.md", 30),
            file("new-legacy.md", r"C:\Notes\new-legacy.md", 20),
            file("old-legacy.md", r"C:\Notes\old-legacy.md", 10),
        ]
    );
    assert_eq!(retried, imported);
    fs::remove_dir_all(dir).expect("cleanup");
}

#[test]
fn failed_legacy_import_does_not_mark_the_migration_complete() {
    let parent = unique_test_dir("legacy-import-failure");
    let blocked_config_dir = parent.join("config");
    fs::write(&blocked_config_dir, b"not a directory").expect("blocking file should exist");
    let service = RecentFilesService::new(blocked_config_dir.clone());
    let legacy = vec![file("legacy.md", r"C:\Notes\legacy.md", 1)];

    let error = service
        .import_legacy(legacy.clone())
        .expect_err("failed atomic persistence must fail closed");
    assert_eq!(error.code, "recent_files.write_failed");

    fs::remove_file(&blocked_config_dir).expect("blocking file should be removed");
    fs::create_dir_all(&blocked_config_dir).expect("config directory should become writable");
    let imported = service
        .import_legacy(legacy)
        .expect("the complete import must remain retryable");
    assert_eq!(imported.files.len(), 1);
    assert_eq!(imported.revision, 1);
    fs::remove_dir_all(parent).expect("cleanup");
}
