use std::{
    collections::BTreeSet,
    error::Error,
    ffi::OsString,
    fmt,
    path::Path,
    sync::{Mutex, MutexGuard},
};

use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindowBuilder};

use crate::services::{
    document_claim_service::{DocumentClaimPathOwner, DocumentClaimService},
    document_path_identity::{DocumentPathIdentity, PathIdentityError},
    open_request_service::{
        parse_open_request, OpenRequest, OpenRequestService, OPEN_REQUESTS_AVAILABLE_EVENT,
    },
    settings_service::{load_open_window_mode, OpenWindowMode},
};

const MAIN_WINDOW_LABEL: &str = "main";
const DOCUMENT_WINDOW_PREFIX: &str = "document-";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopWindowRouteError {
    code: String,
    message: String,
}

impl DesktopWindowRouteError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }
}

impl fmt::Display for DesktopWindowRouteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{} ({})", self.message, self.code)
    }
}

impl Error for DesktopWindowRouteError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopWindowRouteAction {
    Enqueued,
    Focused,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopWindowRouteOutcome {
    pub action: DesktopWindowRouteAction,
    pub created_window: bool,
    pub window_label: String,
}

pub trait DesktopOpenAuthority: Send + Sync {
    fn load_open_window_mode(&self) -> Result<OpenWindowMode, DesktopWindowRouteError>;

    fn owner_for_path(
        &self,
        path: &str,
    ) -> Result<Option<DocumentClaimPathOwner>, DesktopWindowRouteError>;

    fn target_window_for_active_path(
        &self,
        path: &str,
    ) -> Result<Option<String>, DesktopWindowRouteError>;

    fn active_target_windows(&self) -> Result<Vec<String>, DesktopWindowRouteError>;

    fn enqueue_for_window(
        &self,
        target_window: &str,
        requested_path: &str,
    ) -> Result<bool, DesktopWindowRouteError>;
}

pub trait DesktopWindowRuntime: Send + Sync {
    fn live_window_labels(&self) -> Result<Vec<String>, DesktopWindowRouteError>;

    fn create_from_main_config(&self, label: &str) -> Result<(), DesktopWindowRouteError>;

    fn destroy_window(&self, label: &str) -> Result<(), DesktopWindowRouteError>;

    fn notify_open_requests(&self, label: &str) -> Result<(), DesktopWindowRouteError>;

    fn restore_and_focus(&self, label: &str) -> Result<(), DesktopWindowRouteError>;
}

#[derive(Default)]
pub struct DesktopWindowRoutingService {
    route_serial: Mutex<()>,
}

impl DesktopWindowRoutingService {
    pub fn route<A, R>(
        &self,
        requested_path: Option<&str>,
        authority: &A,
        runtime: &R,
    ) -> Result<DesktopWindowRouteOutcome, DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        let _serial = self.lock_route_serial()?;
        self.route_locked(requested_path, authority, runtime, false)
    }

    pub fn route_paths<A, R>(
        &self,
        requested_paths: &[&str],
        authority: &A,
        runtime: &R,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        let _serial = self.lock_route_serial()?;
        if requested_paths.is_empty() {
            return self
                .route_locked(None, authority, runtime, false)
                .map(|outcome| vec![outcome]);
        }

        requested_paths
            .iter()
            .map(|path| self.route_locked(Some(path), authority, runtime, false))
            .collect()
    }

    pub fn route_startup_paths<A, R>(
        &self,
        requested_paths: &[&str],
        authority: &A,
        runtime: &R,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        let _serial = self.lock_route_serial()?;
        self.route_startup_paths_locked(requested_paths, authority, runtime)
    }

    pub fn recover_and_route_startup_paths<A, R>(
        &self,
        requested_paths: &[&str],
        authority: &A,
        runtime: &R,
    ) -> Result<(usize, Vec<DesktopWindowRouteOutcome>), DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        let _serial = self.lock_route_serial()?;
        let recovered_windows = self.recover_active_targets_locked(authority, runtime)?;
        let routes = self.route_startup_paths_locked(requested_paths, authority, runtime)?;
        Ok((recovered_windows, routes))
    }

    fn route_startup_paths_locked<A, R>(
        &self,
        requested_paths: &[&str],
        authority: &A,
        runtime: &R,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        if requested_paths.is_empty() {
            return self
                .route_locked(None, authority, runtime, false)
                .map(|outcome| vec![outcome]);
        }

        let mut blank_main_available = true;
        let mut outcomes = Vec::with_capacity(requested_paths.len());
        for path in requested_paths {
            let outcome =
                self.route_locked(Some(path), authority, runtime, blank_main_available)?;
            if outcome.window_label == MAIN_WINDOW_LABEL {
                blank_main_available = false;
            }
            outcomes.push(outcome);
        }
        Ok(outcomes)
    }

    fn route_locked<A, R>(
        &self,
        requested_path: Option<&str>,
        authority: &A,
        runtime: &R,
        reuse_blank_main_for_new_path: bool,
    ) -> Result<DesktopWindowRouteOutcome, DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        let live_windows = managed_live_windows(runtime)?;

        let Some(requested_path) = requested_path else {
            let (window_label, created_window) =
                focus_target_or_create_main(runtime, &live_windows)?;
            runtime.restore_and_focus(&window_label)?;
            return Ok(DesktopWindowRouteOutcome {
                action: DesktopWindowRouteAction::Focused,
                created_window,
                window_label,
            });
        };

        if let Some(owner) = authority.owner_for_path(requested_path)? {
            let window_label = match owner {
                DocumentClaimPathOwner::Pending { window_label }
                | DocumentClaimPathOwner::Owned { window_label } => window_label,
            };
            validate_managed_window_label(&window_label)?;
            let created_window = ensure_window(runtime, &live_windows, &window_label)?;
            return enqueue_notify_and_focus(
                authority,
                runtime,
                &window_label,
                requested_path,
                created_window,
            );
        }

        if let Some(window_label) = authority.target_window_for_active_path(requested_path)? {
            validate_managed_window_label(&window_label)?;
            let created_window = ensure_window(runtime, &live_windows, &window_label)?;
            return enqueue_notify_and_focus(
                authority,
                runtime,
                &window_label,
                requested_path,
                created_window,
            );
        }

        let mode = authority.load_open_window_mode()?;
        match mode {
            OpenWindowMode::AggregateWindow => {
                let (window_label, created_window) =
                    focus_target_or_create_main(runtime, &live_windows)?;
                enqueue_notify_and_focus(
                    authority,
                    runtime,
                    &window_label,
                    requested_path,
                    created_window,
                )
            }
            OpenWindowMode::MultiWindow => {
                let mut used_labels = live_windows;
                let active_targets = authority.active_target_windows()?;
                if reuse_blank_main_for_new_path
                    && used_labels.contains(MAIN_WINDOW_LABEL)
                    && !active_targets
                        .iter()
                        .any(|target| target == MAIN_WINDOW_LABEL)
                {
                    return enqueue_notify_and_focus(
                        authority,
                        runtime,
                        MAIN_WINDOW_LABEL,
                        requested_path,
                        false,
                    );
                }
                for target in active_targets {
                    validate_managed_window_label(&target)?;
                    used_labels.insert(target);
                }
                let window_label = allocate_document_window_label(&used_labels)?;
                runtime.create_from_main_config(&window_label)?;
                enqueue_notify_and_focus(authority, runtime, &window_label, requested_path, true)
            }
        }
    }

    pub fn recover_active_targets<A, R>(
        &self,
        authority: &A,
        runtime: &R,
    ) -> Result<usize, DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        let _serial = self.lock_route_serial()?;
        self.recover_active_targets_locked(authority, runtime)
    }

    fn recover_active_targets_locked<A, R>(
        &self,
        authority: &A,
        runtime: &R,
    ) -> Result<usize, DesktopWindowRouteError>
    where
        A: DesktopOpenAuthority,
        R: DesktopWindowRuntime,
    {
        let live_windows = managed_live_windows(runtime)?;
        let targets: BTreeSet<String> = authority.active_target_windows()?.into_iter().collect();
        let mut created_windows = 0;

        for target in targets {
            validate_managed_window_label(&target)?;
            if !live_windows.contains(&target) {
                runtime.create_from_main_config(&target)?;
                created_windows += 1;
            }
            runtime.notify_open_requests(&target)?;
        }

        Ok(created_windows)
    }

    pub fn route_utf8_args<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config_dir: &Path,
        args: &[String],
        cwd: &Path,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError> {
        let os_args: Vec<OsString> = args.iter().map(OsString::from).collect();
        self.route_tauri_os_args(app, config_dir, &os_args, cwd, false)
    }

    pub fn route_os_args<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config_dir: &Path,
        args: &[OsString],
        cwd: &Path,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError> {
        self.route_tauri_os_args(app, config_dir, args, cwd, true)
    }

    fn route_tauri_os_args<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config_dir: &Path,
        args: &[OsString],
        cwd: &Path,
        blank_main_available: bool,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError> {
        let _serial = self.lock_route_serial()?;
        self.route_tauri_os_args_locked(app, config_dir, args, cwd, blank_main_available)
    }

    fn route_tauri_os_args_locked<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config_dir: &Path,
        args: &[OsString],
        cwd: &Path,
        mut blank_main_available: bool,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError> {
        let requests = parse_open_requests(args, cwd)?;
        let runtime = TauriDesktopWindowRuntime { app };

        if requests.is_empty() {
            let authority = TauriDesktopOpenAuthority {
                app,
                config_dir,
                identity: None,
            };
            return self
                .route_locked(None, &authority, &runtime, false)
                .map(|outcome| vec![outcome]);
        }

        let mut outcomes = Vec::with_capacity(requests.len());
        for request in requests {
            let identity =
                DocumentPathIdentity::resolve(&request.path).map_err(route_path_identity_error)?;
            let authority = TauriDesktopOpenAuthority {
                app,
                config_dir,
                identity: Some(&identity),
            };
            let outcome = self.route_locked(
                Some(request.path.as_str()),
                &authority,
                &runtime,
                blank_main_available,
            )?;
            if outcome.window_label == MAIN_WINDOW_LABEL {
                blank_main_available = false;
            }
            outcomes.push(outcome);
        }
        Ok(outcomes)
    }

    pub fn recover_and_route_os_args<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config_dir: &Path,
        args: &[OsString],
        cwd: &Path,
    ) -> Result<Vec<DesktopWindowRouteOutcome>, DesktopWindowRouteError> {
        let _serial = self.lock_route_serial()?;
        let authority = TauriDesktopOpenAuthority {
            app,
            config_dir,
            identity: None,
        };
        let runtime = TauriDesktopWindowRuntime { app };
        self.recover_active_targets_locked(&authority, &runtime)?;
        self.route_tauri_os_args_locked(app, config_dir, args, cwd, true)
    }

    pub fn recover_active_targets_for_app<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        config_dir: &Path,
    ) -> Result<usize, DesktopWindowRouteError> {
        let authority = TauriDesktopOpenAuthority {
            app,
            config_dir,
            identity: None,
        };
        let runtime = TauriDesktopWindowRuntime { app };
        self.recover_active_targets(&authority, &runtime)
    }

    fn lock_route_serial(&self) -> Result<MutexGuard<'_, ()>, DesktopWindowRouteError> {
        self.route_serial.lock().map_err(|_| {
            DesktopWindowRouteError::new(
                "desktop.window_route_state_unavailable",
                "Desktop window routing state is unavailable.",
            )
        })
    }
}

fn managed_live_windows(
    runtime: &impl DesktopWindowRuntime,
) -> Result<BTreeSet<String>, DesktopWindowRouteError> {
    Ok(runtime
        .live_window_labels()?
        .into_iter()
        .filter(|label| is_managed_window_label(label))
        .collect())
}

fn focus_target_or_create_main(
    runtime: &impl DesktopWindowRuntime,
    live_windows: &BTreeSet<String>,
) -> Result<(String, bool), DesktopWindowRouteError> {
    if live_windows.contains(MAIN_WINDOW_LABEL) {
        return Ok((MAIN_WINDOW_LABEL.to_owned(), false));
    }
    if let Some(label) = live_windows.iter().next() {
        return Ok((label.clone(), false));
    }
    runtime.create_from_main_config(MAIN_WINDOW_LABEL)?;
    Ok((MAIN_WINDOW_LABEL.to_owned(), true))
}

fn ensure_window(
    runtime: &impl DesktopWindowRuntime,
    live_windows: &BTreeSet<String>,
    window_label: &str,
) -> Result<bool, DesktopWindowRouteError> {
    if live_windows.contains(window_label) {
        Ok(false)
    } else {
        runtime.create_from_main_config(window_label)?;
        Ok(true)
    }
}

fn enqueue_notify_and_focus(
    authority: &impl DesktopOpenAuthority,
    runtime: &impl DesktopWindowRuntime,
    window_label: &str,
    requested_path: &str,
    created_window: bool,
) -> Result<DesktopWindowRouteOutcome, DesktopWindowRouteError> {
    let enqueue_result = authority.enqueue_for_window(window_label, requested_path);
    let enqueue_result = match enqueue_result {
        Ok(true) => Ok(()),
        Ok(false) => Err(DesktopWindowRouteError::new(
            "desktop.window_enqueue_rejected",
            "Desktop open request enqueue unexpectedly rejected the parsed path.",
        )),
        Err(error) => Err(error),
    };
    if let Err(enqueue_error) = enqueue_result {
        return if created_window {
            match runtime.destroy_window(window_label) {
                Ok(()) => Err(enqueue_error),
                Err(rollback_error) => Err(DesktopWindowRouteError::new(
                    "desktop.window_enqueue_rollback_failed",
                    format!(
                        "Open request enqueue failed ({enqueue_error}); the empty window rollback also failed ({rollback_error})."
                    ),
                )),
            }
        } else {
            Err(enqueue_error)
        };
    }

    runtime.notify_open_requests(window_label)?;
    runtime.restore_and_focus(window_label)?;
    Ok(DesktopWindowRouteOutcome {
        action: DesktopWindowRouteAction::Enqueued,
        created_window,
        window_label: window_label.to_owned(),
    })
}

fn allocate_document_window_label(
    used_labels: &BTreeSet<String>,
) -> Result<String, DesktopWindowRouteError> {
    let mut sequence = 1_u64;
    loop {
        let label = format!("{DOCUMENT_WINDOW_PREFIX}{sequence}");
        if !used_labels.contains(&label) {
            return Ok(label);
        }
        sequence = sequence.checked_add(1).ok_or_else(|| {
            DesktopWindowRouteError::new(
                "desktop.window_label_exhausted",
                "Desktop document window label space is exhausted.",
            )
        })?;
    }
}

fn validate_managed_window_label(label: &str) -> Result<(), DesktopWindowRouteError> {
    if is_managed_window_label(label) {
        Ok(())
    } else {
        Err(DesktopWindowRouteError::new(
            "desktop.window_invalid_target",
            format!("Desktop open request target `{label}` is not a managed document window."),
        ))
    }
}

fn is_managed_window_label(label: &str) -> bool {
    if label == MAIN_WINDOW_LABEL {
        return true;
    }
    let Some(sequence) = label.strip_prefix(DOCUMENT_WINDOW_PREFIX) else {
        return false;
    };
    !sequence.is_empty()
        && !sequence.starts_with('0')
        && sequence.bytes().all(|byte| byte.is_ascii_digit())
        && sequence.parse::<u64>().is_ok()
}

fn route_app_error(error: crate::errors::AppError) -> DesktopWindowRouteError {
    DesktopWindowRouteError::new(error.code, error.message)
}

fn route_path_identity_error(error: PathIdentityError) -> DesktopWindowRouteError {
    let code = match error {
        PathIdentityError::InvalidPath => "desktop.window_path_invalid",
        PathIdentityError::Unavailable => "desktop.window_path_identity_unavailable",
    };
    DesktopWindowRouteError::new(code, format!("Desktop document identity failed: {error}"))
}

fn parse_open_requests(
    args: &[OsString],
    cwd: &Path,
) -> Result<Vec<OpenRequest>, DesktopWindowRouteError> {
    let Some(program) = args.first() else {
        return Ok(Vec::new());
    };
    let mut requests = Vec::new();
    for argument in args.iter().skip(1) {
        let launch = [program.clone(), argument.clone()];
        if let Some(request) = parse_open_request(&launch, cwd).map_err(route_app_error)? {
            requests.push(request);
        }
    }
    Ok(requests)
}

struct TauriDesktopOpenAuthority<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    config_dir: &'a Path,
    identity: Option<&'a DocumentPathIdentity>,
}

impl<R: Runtime> DesktopOpenAuthority for TauriDesktopOpenAuthority<'_, R> {
    fn load_open_window_mode(&self) -> Result<OpenWindowMode, DesktopWindowRouteError> {
        load_open_window_mode(self.config_dir).map_err(route_app_error)
    }

    fn owner_for_path(
        &self,
        _path: &str,
    ) -> Result<Option<DocumentClaimPathOwner>, DesktopWindowRouteError> {
        let service = self
            .app
            .try_state::<DocumentClaimService>()
            .ok_or_else(|| {
                DesktopWindowRouteError::new(
                    "desktop.window_claim_state_unavailable",
                    "Document claim state is unavailable while routing a desktop open request.",
                )
            })?;
        service
            .owner_for_identity(self.identity()?)
            .map_err(|error| {
                DesktopWindowRouteError::new(
                    "desktop.window_claim_lookup_failed",
                    format!("Document claim lookup failed: {error}"),
                )
            })
    }

    fn target_window_for_active_path(
        &self,
        _path: &str,
    ) -> Result<Option<String>, DesktopWindowRouteError> {
        self.open_request_service()?
            .target_window_for_active_identity(self.identity()?)
            .map_err(route_app_error)
    }

    fn active_target_windows(&self) -> Result<Vec<String>, DesktopWindowRouteError> {
        self.open_request_service()?
            .active_target_windows()
            .map_err(route_app_error)
    }

    fn enqueue_for_window(
        &self,
        target_window: &str,
        requested_path: &str,
    ) -> Result<bool, DesktopWindowRouteError> {
        self.open_request_service()?
            .enqueue_path_for_identity(target_window, requested_path, self.identity()?)
            .map_err(route_app_error)
    }
}

impl<'a, R: Runtime> TauriDesktopOpenAuthority<'a, R> {
    fn identity(&self) -> Result<&DocumentPathIdentity, DesktopWindowRouteError> {
        self.identity.ok_or_else(|| {
            DesktopWindowRouteError::new(
                "desktop.window_identity_unavailable",
                "Desktop document identity is unavailable while routing a file request.",
            )
        })
    }

    fn open_request_service(
        &self,
    ) -> Result<tauri::State<'a, OpenRequestService>, DesktopWindowRouteError> {
        self.app.try_state::<OpenRequestService>().ok_or_else(|| {
            DesktopWindowRouteError::new(
                "desktop.open_request_state_unavailable",
                "Desktop open request state is unavailable while routing a window.",
            )
        })
    }
}

struct TauriDesktopWindowRuntime<'a, R: Runtime> {
    app: &'a AppHandle<R>,
}

impl<R: Runtime> DesktopWindowRuntime for TauriDesktopWindowRuntime<'_, R> {
    fn live_window_labels(&self) -> Result<Vec<String>, DesktopWindowRouteError> {
        Ok(self.app.webview_windows().into_keys().collect())
    }

    fn create_from_main_config(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        validate_managed_window_label(label)?;
        let mut config = self
            .app
            .config()
            .app
            .windows
            .iter()
            .find(|config| config.label == MAIN_WINDOW_LABEL)
            .cloned()
            .ok_or_else(|| {
                DesktopWindowRouteError::new(
                    "desktop.window_main_config_unavailable",
                    "The main desktop window configuration is unavailable.",
                )
            })?;
        config.label = label.to_owned();
        WebviewWindowBuilder::from_config(self.app, &config)
            .map_err(|error| {
                DesktopWindowRouteError::new(
                    "desktop.window_create_failed",
                    format!("Failed to configure desktop window `{label}`: {error}"),
                )
            })?
            .build()
            .map_err(|error| {
                DesktopWindowRouteError::new(
                    "desktop.window_create_failed",
                    format!("Failed to create desktop window `{label}`: {error}"),
                )
            })?;
        Ok(())
    }

    fn destroy_window(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        let window = self.app.get_webview_window(label).ok_or_else(|| {
            DesktopWindowRouteError::new(
                "desktop.window_rollback_target_missing",
                format!("The empty desktop window `{label}` is already unavailable."),
            )
        })?;
        window.destroy().map_err(|error| {
            DesktopWindowRouteError::new(
                "desktop.window_rollback_failed",
                format!("Failed to destroy empty desktop window `{label}`: {error}"),
            )
        })
    }

    fn notify_open_requests(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        let window = self.app.get_webview_window(label).ok_or_else(|| {
            DesktopWindowRouteError::new(
                "desktop.window_notification_target_missing",
                format!("Desktop open request target `{label}` is unavailable."),
            )
        })?;
        window
            .emit(OPEN_REQUESTS_AVAILABLE_EVENT, ())
            .map_err(|error| {
                DesktopWindowRouteError::new(
                    "desktop.window_notification_failed",
                    format!("Failed to notify desktop window `{label}`: {error}"),
                )
            })
    }

    fn restore_and_focus(&self, label: &str) -> Result<(), DesktopWindowRouteError> {
        let window = self.app.get_webview_window(label).ok_or_else(|| {
            DesktopWindowRouteError::new(
                "desktop.window_focus_target_missing",
                format!("Desktop focus target `{label}` is unavailable."),
            )
        })?;
        window.show().map_err(|error| {
            DesktopWindowRouteError::new(
                "desktop.window_show_failed",
                format!("Failed to show desktop window `{label}`: {error}"),
            )
        })?;
        window.unminimize().map_err(|error| {
            DesktopWindowRouteError::new(
                "desktop.window_restore_failed",
                format!("Failed to restore desktop window `{label}`: {error}"),
            )
        })?;
        window.set_focus().map_err(|error| {
            DesktopWindowRouteError::new(
                "desktop.window_focus_failed",
                format!("Failed to focus desktop window `{label}`: {error}"),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_parser_preserves_each_markdown_argument_in_order() {
        let cwd = Path::new(r"E:\writing");
        let requests = parse_open_requests(
            &[
                OsString::from("LumaMark.exe"),
                OsString::from("--verbose"),
                OsString::from("first.md"),
                OsString::from("notes.txt"),
                OsString::from("second.mdown"),
            ],
            cwd,
        )
        .expect("launch paths should parse");

        assert_eq!(
            requests
                .iter()
                .map(|request| request.path.as_str())
                .collect::<Vec<_>>(),
            [r"E:\writing\first.md", r"E:\writing\second.mdown"]
        );
    }

    #[test]
    fn launch_parser_returns_an_empty_batch_without_markdown_arguments() {
        let requests = parse_open_requests(
            &[
                OsString::from("LumaMark.exe"),
                OsString::from("--verbose"),
                OsString::from("notes.txt"),
            ],
            Path::new(r"E:\writing"),
        )
        .expect("non-Markdown arguments should be ignored");

        assert!(requests.is_empty());
    }
}
