use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Barrier, Mutex,
    },
    thread,
};

use lumamark_lib::services::{
    desktop_window_service::{
        DesktopOpenAuthority, DesktopWindowRouteError, DesktopWindowRoutingService,
        DesktopWindowRuntime,
    },
    document_claim_service::DocumentClaimPathOwner,
    settings_service::OpenWindowMode,
};

#[derive(Default)]
struct FakeRuntime {
    live: Mutex<BTreeSet<String>>,
    trace: Mutex<Vec<String>>,
}

impl FakeRuntime {
    fn with_live(labels: &[&str]) -> Self {
        Self {
            live: Mutex::new(labels.iter().map(|label| (*label).to_owned()).collect()),
            trace: Mutex::new(Vec::new()),
        }
    }

    fn trace(&self) -> Vec<String> {
        self.trace.lock().expect("trace lock").clone()
    }
}

impl DesktopWindowRuntime for FakeRuntime {
    fn live_window_labels(&self) -> Result<Vec<String>, DesktopWindowRouteError> {
        Ok(self
            .live
            .lock()
            .expect("live lock")
            .iter()
            .cloned()
            .collect())
    }

    fn create_from_main_config(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        let mut live = self.live.lock().expect("live lock");
        if !live.insert(label.to_owned()) {
            return Err(DesktopWindowRouteError::new(
                "test.window_exists",
                "window already exists",
            ));
        }
        self.trace
            .lock()
            .expect("trace lock")
            .push(format!("create:{label}"));
        Ok(())
    }

    fn destroy_window(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        self.live.lock().expect("live lock").remove(label);
        self.trace
            .lock()
            .expect("trace lock")
            .push(format!("destroy:{label}"));
        Ok(())
    }

    fn notify_open_requests(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        self.trace
            .lock()
            .expect("trace lock")
            .push(format!("notify:{label}"));
        Ok(())
    }

    fn restore_and_focus(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        self.trace
            .lock()
            .expect("trace lock")
            .push(format!("focus:{label}"));
        Ok(())
    }
}

struct FakeAuthority {
    modes: Mutex<VecDeque<OpenWindowMode>>,
    mode_error: Mutex<Option<DesktopWindowRouteError>>,
    mode_loads: AtomicUsize,
    owners: Mutex<HashMap<String, DocumentClaimPathOwner>>,
    active_paths: Mutex<HashMap<String, String>>,
    expire_active_after_lookup: Mutex<BTreeSet<String>>,
    active_targets: Mutex<Vec<String>>,
    enqueue_calls: Mutex<Vec<(String, String)>>,
    durable_enqueues: Mutex<Vec<(String, String)>>,
    enqueue_result: Mutex<Result<bool, DesktopWindowRouteError>>,
}

impl FakeAuthority {
    fn new(mode: OpenWindowMode) -> Self {
        Self {
            modes: Mutex::new(VecDeque::from([mode])),
            mode_error: Mutex::new(None),
            mode_loads: AtomicUsize::new(0),
            owners: Mutex::new(HashMap::new()),
            active_paths: Mutex::new(HashMap::new()),
            expire_active_after_lookup: Mutex::new(BTreeSet::new()),
            active_targets: Mutex::new(Vec::new()),
            enqueue_calls: Mutex::new(Vec::new()),
            durable_enqueues: Mutex::new(Vec::new()),
            enqueue_result: Mutex::new(Ok(true)),
        }
    }

    fn enqueue_targets(&self) -> Vec<String> {
        self.enqueue_calls
            .lock()
            .expect("enqueue call lock")
            .iter()
            .map(|(_, target)| target.clone())
            .collect()
    }

    fn enqueue_paths(&self) -> Vec<String> {
        self.enqueue_calls
            .lock()
            .expect("enqueue call lock")
            .iter()
            .map(|(path, _)| path.clone())
            .collect()
    }

    fn durable_targets(&self) -> Vec<String> {
        self.durable_enqueues
            .lock()
            .expect("durable enqueue lock")
            .iter()
            .map(|(_, target)| target.clone())
            .collect()
    }
}

impl DesktopOpenAuthority for FakeAuthority {
    fn load_open_window_mode(&self) -> Result<OpenWindowMode, DesktopWindowRouteError> {
        self.mode_loads.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.mode_error.lock().expect("mode error lock").clone() {
            return Err(error);
        }
        let mut modes = self.modes.lock().expect("mode lock");
        let mode = *modes.front().expect("a mode should be configured");
        if modes.len() > 1 {
            modes.pop_front();
        }
        Ok(mode)
    }

    fn owner_for_path(
        &self,
        path: &str,
    ) -> Result<Option<DocumentClaimPathOwner>, DesktopWindowRouteError> {
        Ok(self.owners.lock().expect("owner lock").get(path).cloned())
    }

    fn target_window_for_active_path(
        &self,
        path: &str,
    ) -> Result<Option<String>, DesktopWindowRouteError> {
        let mut active_paths = self.active_paths.lock().expect("active path lock");
        let target = active_paths.get(path).cloned();
        if self
            .expire_active_after_lookup
            .lock()
            .expect("active expiry lock")
            .contains(path)
        {
            active_paths.remove(path);
        }
        Ok(target)
    }

    fn active_target_windows(&self) -> Result<Vec<String>, DesktopWindowRouteError> {
        Ok(self
            .active_targets
            .lock()
            .expect("active target lock")
            .clone())
    }

    fn enqueue_for_window(
        &self,
        target_window: &str,
        requested_path: &str,
    ) -> Result<bool, DesktopWindowRouteError> {
        self.enqueue_calls
            .lock()
            .expect("enqueue call lock")
            .push((requested_path.to_owned(), target_window.to_owned()));
        let result = self
            .enqueue_result
            .lock()
            .expect("enqueue result lock")
            .clone();
        if matches!(result, Ok(true)) {
            let mut active_paths = self.active_paths.lock().expect("active path lock");
            if active_paths.get(requested_path).map(String::as_str) != Some(target_window) {
                active_paths.insert(requested_path.to_owned(), target_window.to_owned());
                self.durable_enqueues
                    .lock()
                    .expect("durable enqueue lock")
                    .push((requested_path.to_owned(), target_window.to_owned()));
            }
        }
        result
    }
}

#[test]
fn multi_window_mode_should_create_a_unique_document_window_for_a_new_path() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route(Some(r"C:\notes\first.md"), &authority, &runtime)
        .expect("new path should route");

    assert_eq!(
        (authority.enqueue_targets(), runtime.trace()),
        (
            vec!["document-1".to_owned()],
            vec![
                "create:document-1".to_owned(),
                "notify:document-1".to_owned(),
                "focus:document-1".to_owned(),
            ],
        )
    );
}

#[test]
fn aggregate_window_mode_should_reuse_main_for_a_new_path() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::AggregateWindow);
    let runtime = FakeRuntime::with_live(&["document-2", "main"]);

    service
        .route(Some(r"C:\notes\aggregate.md"), &authority, &runtime)
        .expect("aggregate path should route");

    assert_eq!(
        (authority.enqueue_targets(), runtime.trace()),
        (
            vec!["main".to_owned()],
            vec!["notify:main".to_owned(), "focus:main".to_owned()],
        )
    );
}

#[test]
fn owned_path_should_durably_handoff_to_its_existing_window_before_focus() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    authority.owners.lock().expect("owner lock").insert(
        "owned.md".to_owned(),
        DocumentClaimPathOwner::Owned {
            window_label: "document-2".to_owned(),
        },
    );
    let runtime = FakeRuntime::with_live(&["main", "document-2"]);

    service
        .route(Some("owned.md"), &authority, &runtime)
        .expect("owner should be focused");

    assert_eq!(
        (authority.enqueue_targets(), runtime.trace()),
        (
            vec!["document-2".to_owned()],
            vec![
                "notify:document-2".to_owned(),
                "focus:document-2".to_owned()
            ],
        )
    );
}

#[test]
fn pending_path_should_durably_coalesce_into_its_existing_window() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    authority.owners.lock().expect("owner lock").insert(
        "pending.md".to_owned(),
        DocumentClaimPathOwner::Pending {
            window_label: "document-4".to_owned(),
        },
    );
    let runtime = FakeRuntime::with_live(&["main", "document-4"]);

    service
        .route(Some("pending.md"), &authority, &runtime)
        .expect("pending owner should be focused");

    assert_eq!(
        (authority.enqueue_targets(), runtime.trace()),
        (
            vec!["document-4".to_owned()],
            vec![
                "notify:document-4".to_owned(),
                "focus:document-4".to_owned()
            ],
        )
    );
}

#[test]
fn active_request_should_recreate_its_missing_target_before_notification() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    authority
        .active_paths
        .lock()
        .expect("active path lock")
        .insert("retained.md".to_owned(), "document-7".to_owned());
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route(Some("retained.md"), &authority, &runtime)
        .expect("retained target should recover");

    assert_eq!(
        (authority.enqueue_targets(), runtime.trace()),
        (
            vec!["document-7".to_owned()],
            vec![
                "create:document-7".to_owned(),
                "notify:document-7".to_owned(),
                "focus:document-7".to_owned(),
            ],
        )
    );
}

#[test]
fn active_lookup_ack_barrier_should_still_create_a_fresh_durable_handoff() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    authority
        .active_paths
        .lock()
        .expect("active path lock")
        .insert("barrier.md".to_owned(), "document-3".to_owned());
    authority
        .expire_active_after_lookup
        .lock()
        .expect("active expiry lock")
        .insert("barrier.md".to_owned());
    let runtime = FakeRuntime::with_live(&["main", "document-3"]);

    service
        .route(Some("barrier.md"), &authority, &runtime)
        .expect("an acknowledgement racing the lookup must not consume the launch");

    assert_eq!(authority.durable_targets(), ["document-3"]);
    assert_eq!(runtime.trace(), ["notify:document-3", "focus:document-3"]);
}

#[test]
fn no_file_activation_should_focus_main_without_enqueueing() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["document-2", "main"]);

    service
        .route(None, &authority, &runtime)
        .expect("activation should focus main");

    assert_eq!(runtime.trace(), ["focus:main"]);
}

#[test]
fn no_file_activation_should_not_depend_on_settings_availability() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority.mode_error.lock().expect("mode error lock") = Some(DesktopWindowRouteError::new(
        "test.settings_unavailable",
        "settings unavailable",
    ));
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route(None, &authority, &runtime)
        .expect("activation focus should not read settings");

    assert_eq!(authority.mode_loads.load(Ordering::SeqCst), 0);
    assert_eq!(runtime.trace(), ["focus:main"]);
}

#[test]
fn authoritative_owner_should_route_when_settings_are_unavailable() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority.mode_error.lock().expect("mode error lock") = Some(DesktopWindowRouteError::new(
        "test.settings_unavailable",
        "settings unavailable",
    ));
    authority.owners.lock().expect("owner lock").insert(
        "owned-without-settings.md".to_owned(),
        DocumentClaimPathOwner::Owned {
            window_label: "document-6".to_owned(),
        },
    );
    let runtime = FakeRuntime::with_live(&["main", "document-6"]);

    service
        .route(Some("owned-without-settings.md"), &authority, &runtime)
        .expect("owner routing should not read settings");

    assert_eq!(authority.mode_loads.load(Ordering::SeqCst), 0);
    assert_eq!(authority.enqueue_targets(), ["document-6"]);
    assert_eq!(runtime.trace(), ["notify:document-6", "focus:document-6"]);
}

#[test]
fn active_target_should_route_when_settings_are_unavailable() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority.mode_error.lock().expect("mode error lock") = Some(DesktopWindowRouteError::new(
        "test.settings_unavailable",
        "settings unavailable",
    ));
    authority
        .active_paths
        .lock()
        .expect("active path lock")
        .insert(
            "retained-without-settings.md".to_owned(),
            "document-9".to_owned(),
        );
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route(Some("retained-without-settings.md"), &authority, &runtime)
        .expect("retained routing should not read settings");

    assert_eq!(authority.mode_loads.load(Ordering::SeqCst), 0);
    assert_eq!(authority.enqueue_targets(), ["document-9"]);
    assert_eq!(
        runtime.trace(),
        ["create:document-9", "notify:document-9", "focus:document-9"]
    );
}

#[test]
fn authoritative_owner_should_recreate_its_missing_window() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    authority.owners.lock().expect("owner lock").insert(
        "owned-after-crash.md".to_owned(),
        DocumentClaimPathOwner::Owned {
            window_label: "document-5".to_owned(),
        },
    );
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route(Some("owned-after-crash.md"), &authority, &runtime)
        .expect("missing authoritative owner should be reconstructed");

    assert_eq!(authority.mode_loads.load(Ordering::SeqCst), 0);
    assert_eq!(authority.enqueue_targets(), ["document-5"]);
    assert_eq!(
        runtime.trace(),
        ["create:document-5", "notify:document-5", "focus:document-5"]
    );
}

#[test]
fn no_file_activation_should_focus_the_first_live_document_when_main_is_absent() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["document-8", "document-3"]);

    service
        .route(None, &authority, &runtime)
        .expect("activation should focus a deterministic live window");

    assert_eq!(runtime.trace(), ["focus:document-3"]);
}

#[test]
fn enqueue_failure_should_destroy_the_just_created_empty_window() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority
        .enqueue_result
        .lock()
        .expect("enqueue result lock") = Err(DesktopWindowRouteError::new(
        "test.enqueue_failed",
        "durable enqueue failed",
    ));
    let runtime = FakeRuntime::with_live(&["main"]);

    let error = service
        .route(Some("rollback.md"), &authority, &runtime)
        .expect_err("enqueue failure should fail closed");

    assert_eq!(
        (error.code(), authority.enqueue_targets(), runtime.trace()),
        (
            "test.enqueue_failed",
            vec!["document-1".to_owned()],
            vec![
                "create:document-1".to_owned(),
                "destroy:document-1".to_owned(),
            ],
        )
    );
}

#[test]
fn concurrent_routes_should_allocate_distinct_document_labels() {
    let service = Arc::new(DesktopWindowRoutingService::default());
    let authority = Arc::new(FakeAuthority::new(OpenWindowMode::MultiWindow));
    let runtime = Arc::new(FakeRuntime::with_live(&["main"]));
    let barrier = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();

    for path in ["one.md", "two.md"] {
        let service = Arc::clone(&service);
        let authority = Arc::clone(&authority);
        let runtime = Arc::clone(&runtime);
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            barrier.wait();
            service
                .route(Some(path), authority.as_ref(), runtime.as_ref())
                .expect("concurrent route should succeed");
        }));
    }
    barrier.wait();
    for worker in workers {
        worker.join().expect("route worker should finish");
    }

    assert_eq!(
        authority
            .enqueue_targets()
            .into_iter()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["document-1".to_owned(), "document-2".to_owned()])
    );
}

#[test]
fn concurrent_routes_for_the_same_path_should_create_and_enqueue_only_once() {
    let service = Arc::new(DesktopWindowRoutingService::default());
    let authority = Arc::new(FakeAuthority::new(OpenWindowMode::MultiWindow));
    let runtime = Arc::new(FakeRuntime::with_live(&["main"]));
    let barrier = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();

    for _ in 0..2 {
        let service = Arc::clone(&service);
        let authority = Arc::clone(&authority);
        let runtime = Arc::clone(&runtime);
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            barrier.wait();
            service
                .route(Some("same.md"), authority.as_ref(), runtime.as_ref())
                .expect("same-path route should coalesce");
        }));
    }
    barrier.wait();
    for worker in workers {
        worker.join().expect("route worker should finish");
    }

    assert_eq!(authority.durable_targets(), ["document-1"]);
}

#[test]
fn startup_recovery_should_rebuild_missing_active_targets_in_sorted_order() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority.active_targets.lock().expect("active target lock") = vec![
        "document-7".to_owned(),
        "main".to_owned(),
        "document-2".to_owned(),
    ];
    let runtime = FakeRuntime::with_live(&["main", "document-2"]);

    service
        .recover_active_targets(&authority, &runtime)
        .expect("startup targets should recover");

    assert_eq!(
        runtime.trace(),
        [
            "notify:document-2",
            "create:document-7",
            "notify:document-7",
            "notify:main",
        ]
    );
}

#[test]
fn startup_recovery_and_initial_paths_should_share_one_ordered_routing_barrier() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority.active_targets.lock().expect("active target lock") = vec!["main".to_owned()];
    let runtime = FakeRuntime::with_live(&[]);

    service
        .recover_and_route_startup_paths(&["fresh.md"], &authority, &runtime)
        .expect("startup recovery must finish before initial argv routing");

    assert_eq!(authority.enqueue_targets(), ["document-1"]);
    assert_eq!(authority.enqueue_paths(), ["fresh.md"]);
    assert_eq!(
        runtime.trace(),
        [
            "create:main",
            "notify:main",
            "create:document-1",
            "notify:document-1",
            "focus:document-1",
        ]
    );
}

#[test]
fn each_route_should_reload_the_canonical_window_mode() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority.modes.lock().expect("mode lock") =
        VecDeque::from([OpenWindowMode::MultiWindow, OpenWindowMode::AggregateWindow]);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route(Some("first.md"), &authority, &runtime)
        .expect("first route should succeed");
    service
        .route(Some("second.md"), &authority, &runtime)
        .expect("second route should succeed");

    assert_eq!(authority.mode_loads.load(Ordering::SeqCst), 2);
}

#[test]
fn empty_launch_batch_should_only_focus_the_existing_main_window() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_paths(&[], &authority, &runtime)
        .expect("empty launch should route as a no-file activation");

    assert!(authority.enqueue_targets().is_empty());
    assert_eq!(runtime.trace(), ["focus:main"]);
}

#[test]
fn multi_window_launch_batch_should_route_each_distinct_path() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_paths(&["first.md", "second.md"], &authority, &runtime)
        .expect("multi-window launch should route every path");

    assert_eq!(authority.enqueue_targets(), ["document-1", "document-2"]);
    assert_eq!(authority.enqueue_paths(), ["first.md", "second.md"]);
    assert_eq!(
        runtime.trace(),
        [
            "create:document-1",
            "notify:document-1",
            "focus:document-1",
            "create:document-2",
            "notify:document-2",
            "focus:document-2",
        ]
    );
}

#[test]
fn aggregate_launch_batch_should_route_each_path_to_main() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::AggregateWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_paths(&["first.md", "second.md"], &authority, &runtime)
        .expect("aggregate launch should route every path");

    assert_eq!(authority.enqueue_targets(), ["main", "main"]);
    assert_eq!(authority.enqueue_paths(), ["first.md", "second.md"]);
    assert_eq!(
        runtime.trace(),
        ["notify:main", "focus:main", "notify:main", "focus:main"]
    );
}

#[test]
fn startup_without_paths_should_only_focus_main() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_startup_paths(&[], &authority, &runtime)
        .expect("empty startup should focus the configured main window");

    assert!(authority.enqueue_paths().is_empty());
    assert_eq!(runtime.trace(), ["focus:main"]);
}

#[test]
fn multi_window_startup_should_use_blank_main_for_the_first_path() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_startup_paths(&["first.md"], &authority, &runtime)
        .expect("first cold-start path should reuse blank main");

    assert_eq!(authority.enqueue_targets(), ["main"]);
    assert_eq!(authority.enqueue_paths(), ["first.md"]);
    assert_eq!(runtime.trace(), ["notify:main", "focus:main"]);
}

#[test]
fn multi_window_startup_should_use_main_then_a_document_window() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_startup_paths(&["first.md", "second.md"], &authority, &runtime)
        .expect("cold-start batch should route every path exactly once");

    assert_eq!(authority.enqueue_targets(), ["main", "document-1"]);
    assert_eq!(authority.enqueue_paths(), ["first.md", "second.md"]);
    assert_eq!(
        runtime.trace(),
        [
            "notify:main",
            "focus:main",
            "create:document-1",
            "notify:document-1",
            "focus:document-1",
        ]
    );
}

#[test]
fn multi_window_startup_should_not_overwrite_a_retained_main_target() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    *authority.active_targets.lock().expect("active target lock") = vec!["main".to_owned()];
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_startup_paths(&["new.md"], &authority, &runtime)
        .expect("retained main must remain reserved for recovery");

    assert_eq!(authority.enqueue_targets(), ["document-1"]);
    assert_eq!(authority.enqueue_paths(), ["new.md"]);
    assert_eq!(
        runtime.trace(),
        ["create:document-1", "notify:document-1", "focus:document-1"]
    );
}

#[test]
fn multi_window_startup_should_reuse_blank_main_for_the_first_new_identity() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::MultiWindow);
    authority
        .active_paths
        .lock()
        .expect("active path lock")
        .insert("retained.md".to_owned(), "document-4".to_owned());
    let runtime = FakeRuntime::with_live(&["main", "document-4"]);

    service
        .route_startup_paths(&["retained.md", "fresh.md"], &authority, &runtime)
        .expect("the first new identity should still use the blank main window");

    assert_eq!(authority.enqueue_targets(), ["document-4", "main"]);
    assert_eq!(authority.enqueue_paths(), ["retained.md", "fresh.md"]);
    assert_eq!(
        runtime.trace(),
        [
            "notify:document-4",
            "focus:document-4",
            "notify:main",
            "focus:main",
        ]
    );
}

#[test]
fn aggregate_startup_should_reuse_main_for_every_path() {
    let service = DesktopWindowRoutingService::default();
    let authority = FakeAuthority::new(OpenWindowMode::AggregateWindow);
    let runtime = FakeRuntime::with_live(&["main"]);

    service
        .route_startup_paths(&["first.md", "second.md"], &authority, &runtime)
        .expect("aggregate startup should keep a single managed window");

    assert_eq!(authority.enqueue_targets(), ["main", "main"]);
    assert_eq!(authority.enqueue_paths(), ["first.md", "second.md"]);
}
