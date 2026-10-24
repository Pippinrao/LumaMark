//! Hidden renderer lifecycle and the job queue shared with the renderer page.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::automation::messages::Messages;
use crate::automation::report::{
    Report, ToolError, DIAGRAM_TIMEOUT_MS, MAX_DIAGRAMS, MAX_SOURCE_BYTES,
    RENDERER_READY_TIMEOUT_MS, RENDERER_STALL_TIMEOUT_MS,
};

pub const RENDERER_WINDOW_LABEL: &str = "automation";
pub const RENDERER_PAGE: &str = "automation-render.html";

/// Whether a job only proves renderability or also returns the SVG.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderMode {
    Check,
    Render,
}

impl RenderMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Check => "check",
            Self::Render => "render",
        }
    }
}

/// Per-request limits and sentences handed to the renderer page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererLimits {
    pub source_bytes: usize,
    pub diagrams: u32,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererMessages {
    pub too_large: String,
    pub too_many: String,
    pub empty: String,
    pub timeout: String,
    pub no_svg: String,
    pub load_failed: String,
}

/// One rendering request pulled by the hidden page.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
    pub job_id: u64,
    pub mode: String,
    pub source: String,
    pub format: String,
    pub limits: RendererLimits,
    pub messages: RendererMessages,
}

struct HostInner {
    next_job_id: u64,
    /// Identifies the current renderer window. Idle release and restart never
    /// apply a stop to a newer generation.
    generation: u64,
    ready: bool,
    stop_requested: bool,
    queue: VecDeque<RenderJob>,
    /// Jobs accepted by `enqueue` and not yet finished or abandoned.
    outstanding: u32,
    /// `next_job` calls currently inside the pull. Idle release waits for this
    /// to hit zero so the page observes `None` before the window is destroyed.
    pullers: u32,
    finished: Option<(u64, Report)>,
    last_progress: Instant,
    last_activity: Instant,
    ready_timeout: Duration,
    failed: Option<ToolError>,
    shutting_down: bool,
}

/// Shared state between the CLI/MCP worker and the hidden renderer page.
///
/// The page pulls jobs, reports progress and delivers one report per job. A
/// renderer that stops making progress is marked failed instead of hanging the
/// caller forever, and it never silently reports success.
pub struct RenderHost {
    messages: Messages,
    inner: Mutex<HostInner>,
    changed: Condvar,
}

impl RenderHost {
    pub fn new(messages: Messages) -> Self {
        Self {
            messages,
            inner: Mutex::new(HostInner {
                next_job_id: 1,
                generation: 0,
                ready: false,
                stop_requested: false,
                queue: VecDeque::new(),
                outstanding: 0,
                pullers: 0,
                finished: None,
                last_progress: Instant::now(),
                last_activity: Instant::now(),
                ready_timeout: Duration::from_millis(RENDERER_READY_TIMEOUT_MS),
                failed: None,
                shutting_down: false,
            }),
            changed: Condvar::new(),
        }
    }

    pub fn shared(self) -> Arc<Self> {
        Arc::new(self)
    }

    pub fn messages(&self) -> Messages {
        self.messages
    }

    /// Recovers from a poisoned mutex: the queue is plain data and a panic in
    /// one command must not make the renderer unusable for the whole session.
    fn lock(&self) -> MutexGuard<'_, HostInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Validates a diagram (`Check`) or renders it (`Render`).
    pub fn render(
        &self,
        source: &str,
        format: &str,
        mode: RenderMode,
    ) -> Result<Report, ToolError> {
        if source.len() > MAX_SOURCE_BYTES {
            return Err(ToolError::new(
                "input.too_large",
                self.messages.too_large(MAX_SOURCE_BYTES),
            ));
        }
        let timeout_ms = self.lock().ready_timeout.as_millis() as u64;
        self.wait_until_ready(timeout_ms)?;
        let job_id = self.enqueue(source, format, mode)?;
        let report = self.wait_for(job_id)?;
        if !report.is_trustworthy() {
            return Err(ToolError::new(
                "automation.failed",
                self.messages.text().invalid_result,
            ));
        }
        Ok(report)
    }

    pub fn mark_ready(&self) {
        let mut inner = self.lock();
        // A page that is being released must not resurrect this generation.
        if inner.shutting_down || inner.stop_requested {
            return;
        }
        inner.ready = true;
        inner.last_progress = Instant::now();
        inner.last_activity = Instant::now();
        self.changed.notify_all();
    }

    /// Blocks until a job is queued. `None` means this generation was stopped
    /// or the process is shutting down. The page loop treats both as exit.
    pub fn next_job(&self) -> Option<RenderJob> {
        {
            let mut inner = self.lock();
            inner.pullers += 1;
        }
        let _puller = PullerGuard { host: self };
        let mut inner = self.lock();
        loop {
            if inner.shutting_down || inner.stop_requested {
                return None;
            }
            if let Some(job) = inner.queue.pop_front() {
                inner.last_progress = Instant::now();
                inner.last_activity = Instant::now();
                return Some(job);
            }
            inner = self
                .changed
                .wait(inner)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    pub fn report_progress(&self, job_id: u64, _completed: u32) {
        let mut inner = self.lock();
        if inner.finished.as_ref().is_some_and(|(id, _)| *id == job_id) {
            return;
        }
        inner.last_progress = Instant::now();
        self.changed.notify_all();
    }

    pub fn deliver(&self, job_id: u64, report: Report) {
        let mut inner = self.lock();
        if inner.shutting_down {
            return;
        }
        inner.finished = Some((job_id, report));
        inner.last_progress = Instant::now();
        self.changed.notify_all();
    }

    pub fn shutdown(&self) {
        let mut inner = self.lock();
        inner.shutting_down = true;
        self.changed.notify_all();
    }

    /// Waits for the renderer page to report readiness.
    ///
    /// Shared by `render` and the startup watchdog, so a renderer that never
    /// comes up fails loudly instead of hanging the caller forever.
    pub fn wait_until_ready(&self, timeout_ms: u64) -> Result<(), ToolError> {
        let deadline = Duration::from_millis(timeout_ms);
        let mut inner = self.lock();
        let started = Instant::now();
        loop {
            if let Some(error) = inner.failed.clone() {
                return Err(error);
            }
            if inner.stop_requested {
                return Err(ToolError::new(
                    "renderer.unavailable",
                    self.messages.unavailable("The renderer is restarting."),
                ));
            }
            if inner.ready {
                return Ok(());
            }
            let elapsed = started.elapsed();
            if elapsed >= deadline {
                let error =
                    ToolError::new("renderer.unavailable", self.messages.text().ready_timeout);
                inner.failed = Some(error.clone());
                return Err(error);
            }
            let remaining = deadline.saturating_sub(elapsed);
            let (guard, _) = self
                .changed
                .wait_timeout(inner, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner = guard;
        }
    }

    fn enqueue(&self, source: &str, format: &str, mode: RenderMode) -> Result<u64, ToolError> {
        let mut inner = self.lock();
        if let Some(error) = inner.failed.clone() {
            return Err(error);
        }
        if inner.stop_requested || inner.shutting_down {
            return Err(ToolError::new(
                "renderer.unavailable",
                self.messages.unavailable("The renderer is restarting."),
            ));
        }
        let job_id = inner.next_job_id;
        inner.next_job_id += 1;
        inner.outstanding += 1;
        inner.queue.push_back(RenderJob {
            job_id,
            mode: mode.as_str().to_owned(),
            source: source.to_owned(),
            format: format.to_owned(),
            limits: RendererLimits {
                source_bytes: MAX_SOURCE_BYTES,
                diagrams: MAX_DIAGRAMS,
                timeout_ms: DIAGRAM_TIMEOUT_MS,
            },
            messages: RendererMessages {
                too_large: self.messages.too_large(MAX_SOURCE_BYTES),
                too_many: self.messages.too_many(MAX_DIAGRAMS),
                empty: self.messages.text().empty.to_owned(),
                timeout: self.messages.timeout(DIAGRAM_TIMEOUT_MS),
                no_svg: self.messages.text().browser_no_svg.to_owned(),
                load_failed: self.messages.text().browser_load_failed.to_owned(),
            },
        });
        inner.last_progress = Instant::now();
        self.changed.notify_all();
        Ok(job_id)
    }

    fn wait_for(&self, job_id: u64) -> Result<Report, ToolError> {
        let result = self.wait_for_inner(job_id);
        self.release_outstanding();
        result
    }

    fn wait_for_inner(&self, job_id: u64) -> Result<Report, ToolError> {
        let stall = Duration::from_millis(RENDERER_STALL_TIMEOUT_MS);
        let mut inner = self.lock();
        let mut last_seen = inner.last_progress;
        loop {
            if let Some((id, report)) = inner.finished.take() {
                if id == job_id {
                    return Ok(report);
                }
                inner.finished = Some((id, report));
            }
            if let Some(error) = inner.failed.clone() {
                return Err(error);
            }
            if inner.stop_requested {
                return Err(ToolError::new(
                    "renderer.unavailable",
                    self.messages.unavailable("The renderer is restarting."),
                ));
            }
            if inner.last_progress != last_seen {
                last_seen = inner.last_progress;
            }
            let elapsed = last_seen.elapsed();
            if elapsed >= stall {
                let error = ToolError::new(
                    "renderer.timeout",
                    self.messages.timeout(RENDERER_STALL_TIMEOUT_MS),
                );
                inner.failed = Some(error.clone());
                inner.queue.retain(|job| job.job_id != job_id);
                self.changed.notify_all();
                return Err(error);
            }
            let remaining = stall.saturating_sub(elapsed);
            let (guard, _) = self
                .changed
                .wait_timeout(inner, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner = guard;
        }
    }

    fn release_outstanding(&self) {
        let mut inner = self.lock();
        inner.outstanding = inner.outstanding.saturating_sub(1);
        inner.last_activity = Instant::now();
        self.changed.notify_all();
    }

    /// Starts a renderer generation. The previous page must already have exited.
    pub(crate) fn begin_generation(&self) -> u64 {
        let mut inner = self.lock();
        inner.generation = inner.generation.wrapping_add(1);
        inner.ready = false;
        inner.stop_requested = false;
        inner.failed = None;
        inner.queue.clear();
        inner.finished = None;
        inner.outstanding = 0;
        inner.last_activity = Instant::now();
        inner.last_progress = Instant::now();
        inner.generation
    }

    pub(crate) fn generation(&self) -> u64 {
        self.lock().generation
    }

    pub(crate) fn is_ready(&self) -> bool {
        let inner = self.lock();
        inner.ready && !inner.stop_requested && inner.failed.is_none()
    }

    pub(crate) fn has_failure(&self) -> bool {
        self.lock().failed.is_some()
    }

    /// Clears a failed generation so the next start can succeed.
    pub(crate) fn clear_failure(&self) {
        let mut inner = self.lock();
        inner.failed = None;
        inner.ready = false;
        inner.stop_requested = false;
        inner.queue.clear();
        inner.finished = None;
        inner.outstanding = 0;
        self.changed.notify_all();
    }

    /// Unblocks a page that is waiting for a job. Does not by itself destroy
    /// the window; the lifecycle does that after the puller count drops.
    pub(crate) fn force_stop(&self) {
        let mut inner = self.lock();
        inner.stop_requested = true;
        inner.ready = false;
        self.changed.notify_all();
    }

    /// Refreshes the idle clock unless a stop already won the race.
    pub(crate) fn note_activity_unless_stopping(&self) -> bool {
        let mut inner = self.lock();
        if inner.stop_requested || inner.shutting_down || !inner.ready || inner.failed.is_some() {
            return false;
        }
        inner.last_activity = Instant::now();
        true
    }

    /// Marks this generation stopped when it is idle. Returns false when a job
    /// is still queued or running, so the caller must not destroy the window.
    pub(crate) fn try_begin_idle_stop(&self, idle: Duration) -> bool {
        let mut inner = self.lock();
        let idle_long_enough = inner.last_activity.elapsed() >= idle;
        if !inner.ready
            || inner.stop_requested
            || inner.failed.is_some()
            || inner.outstanding > 0
            || inner.shutting_down
            || !idle_long_enough
        {
            return false;
        }
        inner.stop_requested = true;
        self.changed.notify_all();
        true
    }

    pub(crate) fn finish_stop(&self, generation: u64) {
        let mut inner = self.lock();
        if inner.generation != generation {
            return;
        }
        inner.ready = false;
        inner.stop_requested = false;
        inner.last_activity = Instant::now();
        self.changed.notify_all();
    }

    pub(crate) fn wait_until_pullers_drained(&self, timeout: Duration) -> bool {
        let mut inner = self.lock();
        let started = Instant::now();
        loop {
            if inner.pullers == 0 {
                return true;
            }
            let elapsed = started.elapsed();
            if elapsed >= timeout {
                return false;
            }
            let (guard, _) = self
                .changed
                .wait_timeout(inner, timeout.saturating_sub(elapsed))
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner = guard;
        }
    }

    #[cfg(test)]
    pub(crate) fn set_ready_timeout(&self, timeout: Duration) {
        self.lock().ready_timeout = timeout;
    }

    #[cfg(test)]
    pub(crate) fn puller_count(&self) -> u32 {
        self.lock().pullers
    }
}

/// Decrements the puller count when `next_job` returns, including on panic.
struct PullerGuard<'a> {
    host: &'a RenderHost,
}

impl Drop for PullerGuard<'_> {
    fn drop(&mut self) {
        let mut inner = self.host.lock();
        inner.pullers = inner.pullers.saturating_sub(1);
        self.host.changed.notify_all();
    }
}

const AUTOMATION_DATA_DIR_PREFIX: &str = "lumamark-automation-webview-";

/// Per-process WebView data directory for the hidden renderer.
///
/// WebView2 blocks when several processes create an environment for the same
/// user data folder at once, which would hang a second `LumaMark.exe check`
/// while another one (or the editor) is starting. Each automation process
/// therefore gets its own folder, removed again on exit.
pub fn automation_data_directory() -> std::path::PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    std::env::temp_dir().join(format!(
        "{AUTOMATION_DATA_DIR_PREFIX}{}-{unique}",
        std::process::id()
    ))
}

/// Removes automation WebView data left behind when a client killed the process.
///
/// Only directories whose owning process is gone are deleted. A live process
/// may still hold its directory, and a delete failure is ignored.
pub fn sweep_stale_automation_data_directories() {
    sweep_stale_automation_data_directories_in(&std::env::temp_dir(), process_is_alive);
}

pub(crate) fn sweep_stale_automation_data_directories_in(
    root: &std::path::Path,
    process_alive: impl Fn(u32) -> bool,
) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(pid) = parse_automation_data_pid(&name) else {
            continue;
        };
        if process_alive(pid) {
            continue;
        }
        let _ = std::fs::remove_dir_all(entry.path());
    }
}

fn parse_automation_data_pid(name: &str) -> Option<u32> {
    let rest = name.strip_prefix(AUTOMATION_DATA_DIR_PREFIX)?;
    let (pid, unique) = rest.split_once('-')?;
    if unique.is_empty() || !unique.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    pid.parse().ok()
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    if pid == 0 {
        return true;
    }
    // SAFETY: OpenProcess/CloseHandle only query whether this pid exists.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            CloseHandle(handle);
            return true;
        }
        // Access denied means the process exists but this token cannot inspect it.
        GetLastError() == ERROR_ACCESS_DENIED
    }
}

#[cfg(not(windows))]
fn process_is_alive(pid: u32) -> bool {
    // Without a proven-dead process, keep the directory.
    let _ = pid;
    true
}

/// Best-effort removal: a browser that is still shutting down may hold files.
pub fn remove_data_directory(path: &std::path::Path) {
    for _ in 0..5 {
        if std::fs::remove_dir_all(path).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(60));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::messages::Locale;
    use std::sync::mpsc;
    use std::thread;

    fn host() -> Arc<RenderHost> {
        RenderHost::new(Messages::new(Locale::En)).shared()
    }

    #[test]
    fn a_rendered_job_is_delivered_to_the_caller() {
        let host = host();
        host.mark_ready();

        let worker_host = Arc::clone(&host);
        let worker =
            thread::spawn(move || worker_host.render("graph TD", "mermaid", RenderMode::Check));

        let job = host.next_job().expect("a job should be queued");
        assert_eq!(job.source, "graph TD");
        assert_eq!(job.format, "mermaid");
        assert_eq!(job.limits.diagrams, MAX_DIAGRAMS);
        host.report_progress(job.job_id, 1);
        host.deliver(job.job_id, Report::new(true, 1, Vec::new()));

        let report = worker
            .join()
            .expect("worker should finish")
            .expect("report");
        assert!(report.ok);
        assert_eq!(report.checked, 1);
    }

    #[test]
    fn a_renderer_that_never_becomes_ready_fails_closed() {
        // The readiness deadline is 60s, so drive the failure through shutdown
        // free logic: a failed host must report unavailable instead of hanging.
        let host = host();
        {
            let mut inner = host.lock();
            inner.failed = Some(ToolError::new("renderer.unavailable", "gone"));
        }
        host.mark_ready();

        let error = host
            .render("graph TD", "mermaid", RenderMode::Check)
            .expect_err("must fail");
        assert_eq!(error.code, "renderer.unavailable");
    }

    #[test]
    fn oversized_sources_are_rejected_before_queueing() {
        let host = host();
        host.mark_ready();
        let source = "x".repeat(MAX_SOURCE_BYTES + 1);

        let error = host
            .render(&source, "mermaid", RenderMode::Check)
            .expect_err("must fail");

        assert_eq!(error.code, "input.too_large");
        assert!(error.message.contains(&MAX_SOURCE_BYTES.to_string()));
    }

    #[test]
    fn an_untrustworthy_report_is_rejected() {
        let host = host();
        host.mark_ready();
        let worker_host = Arc::clone(&host);
        let worker =
            thread::spawn(move || worker_host.render("graph TD", "mermaid", RenderMode::Check));

        let job = host.next_job().expect("a job should be queued");
        let mut report = Report::new(true, 1, Vec::new());
        report.schema_version = 2;
        host.deliver(job.job_id, report);

        let error = worker
            .join()
            .expect("worker should finish")
            .expect_err("must fail");
        assert_eq!(error.code, "automation.failed");
    }

    #[test]
    fn shutdown_releases_a_waiting_page() {
        let host = host();
        let page_host = Arc::clone(&host);
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let job = page_host.next_job();
            let _ = sender.send(job.is_none());
        });

        host.shutdown();

        assert!(receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("page should be released"));
    }

    #[test]
    fn the_data_directory_sweep_keeps_live_processes_and_other_names() {
        let root = std::env::temp_dir().join(format!(
            "lumamark-automation-sweep-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp root");
        let live = root.join(format!("{AUTOMATION_DATA_DIR_PREFIX}42-1"));
        let dead = root.join(format!("{AUTOMATION_DATA_DIR_PREFIX}99-2"));
        let unrelated = root.join("lumamark-other");
        std::fs::create_dir_all(&live).expect("live dir");
        std::fs::create_dir_all(&dead).expect("dead dir");
        std::fs::create_dir_all(&unrelated).expect("unrelated dir");

        sweep_stale_automation_data_directories_in(&root, |pid| pid == 42);

        assert!(live.exists(), "a live pid must keep its data directory");
        assert!(!dead.exists(), "a dead pid must be removed");
        assert!(
            unrelated.exists(),
            "unrelated directories must be left alone"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
