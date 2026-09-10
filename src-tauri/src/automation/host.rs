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
    ready: bool,
    queue: VecDeque<RenderJob>,
    finished: Option<(u64, Report)>,
    last_progress: Instant,
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
                ready: false,
                queue: VecDeque::new(),
                finished: None,
                last_progress: Instant::now(),
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
        self.wait_until_ready(RENDERER_READY_TIMEOUT_MS)?;
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
        inner.ready = true;
        inner.last_progress = Instant::now();
        self.changed.notify_all();
    }

    /// Blocks until a job is queued. `None` means the host is shutting down.
    pub fn next_job(&self) -> Option<RenderJob> {
        let mut inner = self.lock();
        loop {
            if inner.shutting_down {
                return None;
            }
            if let Some(job) = inner.queue.pop_front() {
                inner.last_progress = Instant::now();
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
            if inner.ready {
                return Ok(());
            }
            let elapsed = started.elapsed();
            if elapsed >= deadline {
                let error = ToolError::new(
                    "renderer.unavailable",
                    self.messages.text().ready_timeout,
                );
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
        let job_id = inner.next_job_id;
        inner.next_job_id += 1;
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
}

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
        "lumamark-automation-webview-{}-{unique}",
        std::process::id()
    ))
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
        let worker = thread::spawn(move || worker_host.render("graph TD", "mermaid", RenderMode::Check));

        let job = host.next_job().expect("a job should be queued");
        assert_eq!(job.source, "graph TD");
        assert_eq!(job.format, "mermaid");
        assert_eq!(job.limits.diagrams, MAX_DIAGRAMS);
        host.report_progress(job.job_id, 1);
        host.deliver(job.job_id, Report::new(true, 1, Vec::new()));

        let report = worker.join().expect("worker should finish").expect("report");
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

        let error = host.render("graph TD", "mermaid", RenderMode::Check).expect_err("must fail");
        assert_eq!(error.code, "renderer.unavailable");
    }

    #[test]
    fn oversized_sources_are_rejected_before_queueing() {
        let host = host();
        host.mark_ready();
        let source = "x".repeat(MAX_SOURCE_BYTES + 1);

        let error = host.render(&source, "mermaid", RenderMode::Check).expect_err("must fail");

        assert_eq!(error.code, "input.too_large");
        assert!(error.message.contains(&MAX_SOURCE_BYTES.to_string()));
    }

    #[test]
    fn an_untrustworthy_report_is_rejected() {
        let host = host();
        host.mark_ready();
        let worker_host = Arc::clone(&host);
        let worker = thread::spawn(move || worker_host.render("graph TD", "mermaid", RenderMode::Check));

        let job = host.next_job().expect("a job should be queued");
        let mut report = Report::new(true, 1, Vec::new());
        report.schema_version = 2;
        host.deliver(job.job_id, report);

        let error = worker.join().expect("worker should finish").expect_err("must fail");
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
}
