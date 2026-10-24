//! Lazy start and idle release of the hidden MCP renderer window.
//!
//! An MCP session used to create a WebView at process start and keep it until
//! the client disconnected. This module creates that window on the first tool
//! call and destroys it after the renderer has been idle, so an unused session
//! does not hold a browser process tree.
//!
//! Window creation goes through [`RendererLauncher`]. Production calls Tauri
//! from the MCP worker thread: Tauri's runtime handle creates windows by
//! sending to the event loop and deadlocks if that call runs on the event-loop
//! thread itself.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::automation::host::{
    automation_data_directory, remove_data_directory, RenderHost, RenderMode,
};
use crate::automation::report::{Report, ToolError};

/// Creates and destroys the hidden renderer window for one generation.
pub trait RendererLauncher: Send + Sync {
    fn start(&self, generation: u64, data_directory: &Path) -> Result<(), String>;
    fn stop(&self, generation: u64);
}

enum LifecycleState {
    Stopped,
    Starting {
        generation: u64,
        data_directory: PathBuf,
    },
    Ready {
        generation: u64,
        data_directory: PathBuf,
    },
    Stopping {
        generation: u64,
        data_directory: PathBuf,
    },
}

enum StartDecision {
    Launch,
    WaitReady,
    Ready,
    WaitUntilStopped,
}

/// Owns the renderer window state machine and the idle reaper.
pub struct RendererLifecycle {
    host: Weak<RenderHost>,
    launcher: Arc<dyn RendererLauncher>,
    /// `None` keeps the renderer until process shutdown (`LUMAMARK_MCP_IDLE_SECONDS=0`).
    idle: Option<Duration>,
    state: Mutex<LifecycleState>,
    changed: Condvar,
    reaper_stop: AtomicBool,
    wake: Condvar,
    wake_mutex: Mutex<()>,
    reaper: Mutex<Option<JoinHandle<()>>>,
}

impl RendererLifecycle {
    /// Attaches a lifecycle without a reaper thread. Tests call [`poll`].
    pub fn attach(
        host: &Arc<RenderHost>,
        launcher: Arc<dyn RendererLauncher>,
        idle: Option<Duration>,
    ) -> Arc<Self> {
        Arc::new(Self::build(host, launcher, idle))
    }

    /// Attaches a lifecycle and starts the idle reaper.
    pub fn spawn(
        host: &Arc<RenderHost>,
        launcher: Arc<dyn RendererLauncher>,
        idle: Option<Duration>,
    ) -> Arc<Self> {
        let lifecycle = Arc::new(Self::build(host, launcher, idle));
        let reaper = Arc::clone(&lifecycle);
        let handle = std::thread::spawn(move || reaper.reaper_loop());
        *lifecycle
            .reaper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
        lifecycle
    }

    fn build(
        host: &Arc<RenderHost>,
        launcher: Arc<dyn RendererLauncher>,
        idle: Option<Duration>,
    ) -> Self {
        Self {
            host: Arc::downgrade(host),
            launcher,
            idle,
            state: Mutex::new(LifecycleState::Stopped),
            changed: Condvar::new(),
            reaper_stop: AtomicBool::new(false),
            wake: Condvar::new(),
            wake_mutex: Mutex::new(()),
            reaper: Mutex::new(None),
        }
    }

    /// Ensures a renderer is starting or ready, then renders one job.
    pub fn render(
        &self,
        source: &str,
        format: &str,
        mode: RenderMode,
    ) -> Result<Report, ToolError> {
        self.ensure_started()?;
        let host = self.upgrade()?;
        host.render(source, format, mode)
    }

    pub fn ensure_started(&self) -> Result<(), ToolError> {
        self.recover_if_failed()?;
        loop {
            let host = self.upgrade()?;
            self.promote(&host);
            let decision = {
                let mut state = self.lock();
                match &*state {
                    LifecycleState::Stopped => {
                        *state = LifecycleState::Starting {
                            generation: 0,
                            data_directory: PathBuf::new(),
                        };
                        StartDecision::Launch
                    }
                    LifecycleState::Starting { .. } => StartDecision::WaitReady,
                    LifecycleState::Ready { .. } => {
                        drop(state);
                        if host.note_activity_unless_stopping() {
                            StartDecision::Ready
                        } else {
                            StartDecision::WaitUntilStopped
                        }
                    }
                    LifecycleState::Stopping { .. } => StartDecision::WaitUntilStopped,
                }
            };
            match decision {
                StartDecision::Ready | StartDecision::WaitReady => return Ok(()),
                StartDecision::WaitUntilStopped => self.wait_until_stopped()?,
                StartDecision::Launch => return self.launch(),
            }
        }
    }

    /// Promotes a ready page and releases the window once it has been idle.
    pub fn poll(&self) {
        let Some(host) = self.host.upgrade() else {
            return;
        };
        if self.reaper_stop.load(Ordering::SeqCst) {
            return;
        }
        self.promote(&host);
        let Some(idle) = self.idle else {
            return;
        };
        let ready = matches!(*self.lock(), LifecycleState::Ready { .. });
        if !ready || !host.try_begin_idle_stop(idle) {
            return;
        }
        self.finish_release(&host);
    }

    /// Stops the reaper and destroys a renderer that is still up.
    pub fn shutdown(&self) {
        self.reaper_stop.store(true, Ordering::SeqCst);
        self.wake.notify_all();
        if let Some(handle) = self
            .reaper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            if handle.thread().id() != std::thread::current().id() {
                let _ = handle.join();
            }
        }
        if let Some(host) = self.host.upgrade() {
            self.force_release(&host);
        }
    }

    fn launch(&self) -> Result<(), ToolError> {
        let host = self.upgrade()?;
        let generation = host.begin_generation();
        let data_directory = automation_data_directory();
        {
            let mut state = self.lock();
            *state = LifecycleState::Starting {
                generation,
                data_directory: data_directory.clone(),
            };
        }
        if let Err(error) = self.launcher.start(generation, &data_directory) {
            self.abandon_start(generation, &data_directory);
            return Err(ToolError::new(
                "renderer.unavailable",
                host.messages().unavailable(&error),
            ));
        }
        Ok(())
    }

    fn abandon_start(&self, generation: u64, data_directory: &Path) {
        self.launcher.stop(generation);
        remove_data_directory(data_directory);
        let mut state = self.lock();
        if matches!(
            *state,
            LifecycleState::Starting { generation: current, .. } if current == generation
        ) {
            *state = LifecycleState::Stopped;
        }
        self.changed.notify_all();
    }

    fn recover_if_failed(&self) -> Result<(), ToolError> {
        let host = self.upgrade()?;
        if !host.has_failure() {
            return Ok(());
        }
        let previous = {
            let mut state = self.lock();
            std::mem::replace(&mut *state, LifecycleState::Stopped)
        };
        if let Some((generation, data_directory)) = generation_directory(previous) {
            host.force_stop();
            host.wait_until_pullers_drained(Duration::from_secs(2));
            self.launcher.stop(generation);
            if !data_directory.as_os_str().is_empty() {
                remove_data_directory(&data_directory);
            }
        }
        host.clear_failure();
        Ok(())
    }

    fn promote(&self, host: &RenderHost) {
        if !host.is_ready() {
            return;
        }
        let generation = host.generation();
        let mut state = self.lock();
        if let LifecycleState::Starting {
            generation: current,
            data_directory,
        } = &*state
        {
            if *current == generation && *current != 0 {
                *state = LifecycleState::Ready {
                    generation,
                    data_directory: data_directory.clone(),
                };
                self.changed.notify_all();
            }
        }
    }

    fn finish_release(&self, host: &RenderHost) {
        let info = {
            let mut state = self.lock();
            match std::mem::replace(&mut *state, LifecycleState::Stopped) {
                LifecycleState::Ready {
                    generation,
                    data_directory,
                }
                | LifecycleState::Starting {
                    generation,
                    data_directory,
                } => {
                    *state = LifecycleState::Stopping {
                        generation,
                        data_directory: data_directory.clone(),
                    };
                    Some((generation, data_directory))
                }
                other => {
                    *state = other;
                    None
                }
            }
        };
        let Some((generation, data_directory)) = info else {
            return;
        };
        host.wait_until_pullers_drained(Duration::from_secs(2));
        self.launcher.stop(generation);
        remove_data_directory(&data_directory);
        host.finish_stop(generation);
        let mut state = self.lock();
        if matches!(
            *state,
            LifecycleState::Stopping { generation: current, .. } if current == generation
        ) {
            *state = LifecycleState::Stopped;
        }
        self.changed.notify_all();
    }

    fn force_release(&self, host: &RenderHost) {
        let info = {
            let mut state = self.lock();
            match std::mem::replace(&mut *state, LifecycleState::Stopped) {
                LifecycleState::Stopped => None,
                LifecycleState::Starting {
                    generation,
                    data_directory,
                }
                | LifecycleState::Ready {
                    generation,
                    data_directory,
                }
                | LifecycleState::Stopping {
                    generation,
                    data_directory,
                } => {
                    if generation == 0 || data_directory.as_os_str().is_empty() {
                        None
                    } else {
                        Some((generation, data_directory))
                    }
                }
            }
        };
        if let Some((generation, data_directory)) = info {
            host.force_stop();
            host.wait_until_pullers_drained(Duration::from_secs(2));
            self.launcher.stop(generation);
            remove_data_directory(&data_directory);
            host.finish_stop(generation);
        }
        self.changed.notify_all();
    }

    fn wait_until_stopped(&self) -> Result<(), ToolError> {
        let host = self.upgrade()?;
        let mut state = self.lock();
        let started = Instant::now();
        let limit = Duration::from_secs(10);
        loop {
            if matches!(*state, LifecycleState::Stopped) {
                return Ok(());
            }
            let elapsed = started.elapsed();
            if elapsed >= limit {
                return Err(ToolError::new(
                    "renderer.unavailable",
                    host.messages().unavailable("The renderer did not stop."),
                ));
            }
            let (guard, _) = self
                .changed
                .wait_timeout(state, limit.saturating_sub(elapsed))
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = guard;
        }
    }

    fn reaper_loop(self: &Arc<Self>) {
        let interval = match self.idle {
            Some(idle) => poll_interval(idle),
            None => Duration::from_secs(1),
        };
        while !self.reaper_stop.load(Ordering::SeqCst) {
            self.poll();
            let guard = self
                .wake_mutex
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let (_guard, _) = self
                .wake
                .wait_timeout(guard, interval)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    fn upgrade(&self) -> Result<Arc<RenderHost>, ToolError> {
        self.host.upgrade().ok_or_else(|| {
            ToolError::new("renderer.unavailable", "The automation host has shut down.")
        })
    }

    fn lock(&self) -> MutexGuard<'_, LifecycleState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn generation_directory(state: LifecycleState) -> Option<(u64, PathBuf)> {
    match state {
        LifecycleState::Stopped => None,
        LifecycleState::Starting {
            generation,
            data_directory,
        }
        | LifecycleState::Ready {
            generation,
            data_directory,
        }
        | LifecycleState::Stopping {
            generation,
            data_directory,
        } => Some((generation, data_directory)),
    }
}

fn poll_interval(idle: Duration) -> Duration {
    let quarter = idle / 4;
    if quarter < Duration::from_millis(200) {
        Duration::from_millis(200)
    } else if quarter > Duration::from_secs(1) {
        Duration::from_secs(1)
    } else {
        quarter
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::messages::{Locale, Messages};
    use crate::automation::report::Report;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::thread;
    use std::time::{Duration, Instant};

    struct FakeLauncher {
        starts: Mutex<Vec<u64>>,
        start_threads: Mutex<Vec<thread::ThreadId>>,
        stops: Mutex<Vec<u64>>,
        fail_start: AtomicBool,
        block_stop: AtomicBool,
        stop_entered: Condvar,
        stop_entered_flag: Mutex<bool>,
        release_stop: Condvar,
        release_flag: Mutex<bool>,
    }

    impl FakeLauncher {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                starts: Mutex::new(Vec::new()),
                start_threads: Mutex::new(Vec::new()),
                stops: Mutex::new(Vec::new()),
                fail_start: AtomicBool::new(false),
                block_stop: AtomicBool::new(false),
                stop_entered: Condvar::new(),
                stop_entered_flag: Mutex::new(false),
                release_stop: Condvar::new(),
                release_flag: Mutex::new(false),
            })
        }

        fn start_count(&self) -> usize {
            self.starts.lock().expect("starts").len()
        }

        fn stop_count(&self) -> usize {
            self.stops.lock().expect("stops").len()
        }
    }

    impl RendererLauncher for FakeLauncher {
        fn start(&self, generation: u64, _data_directory: &Path) -> Result<(), String> {
            if self.fail_start.load(Ordering::SeqCst) {
                return Err("webview failed".to_owned());
            }
            self.starts.lock().expect("starts").push(generation);
            self.start_threads
                .lock()
                .expect("threads")
                .push(thread::current().id());
            Ok(())
        }

        fn stop(&self, generation: u64) {
            if self.block_stop.load(Ordering::SeqCst) {
                {
                    let mut entered = self.stop_entered_flag.lock().expect("entered");
                    *entered = true;
                    self.stop_entered.notify_all();
                }
                let mut release = self.release_flag.lock().expect("release");
                while !*release {
                    release = self
                        .release_stop
                        .wait(release)
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                }
            }
            self.stops.lock().expect("stops").push(generation);
        }
    }

    fn fixture(
        idle: Option<Duration>,
    ) -> (Arc<RenderHost>, Arc<RendererLifecycle>, Arc<FakeLauncher>) {
        let host = RenderHost::new(Messages::new(Locale::En)).shared();
        let launcher = FakeLauncher::new();
        let lifecycle = RendererLifecycle::attach(
            &host,
            Arc::clone(&launcher) as Arc<dyn RendererLauncher>,
            idle,
        );
        (host, lifecycle, launcher)
    }

    fn serve_job(host: &RenderHost) {
        host.mark_ready();
        let job = host.next_job().expect("job");
        host.deliver(job.job_id, Report::new(true, 1, Vec::new()));
    }

    #[test]
    fn nothing_starts_before_the_first_call() {
        let (_host, _lifecycle, launcher) = fixture(Some(Duration::from_secs(120)));

        assert_eq!(launcher.start_count(), 0);
        assert_eq!(launcher.stop_count(), 0);
    }

    #[test]
    fn a_call_starts_the_renderer_on_the_calling_thread() {
        let (host, lifecycle, launcher) = fixture(Some(Duration::from_secs(120)));
        let caller = thread::current().id();
        let (started_tx, started_rx) = mpsc::channel();
        let launcher_probe = Arc::clone(&launcher);
        // Replace is unnecessary: start records the generation, and we assert
        // the caller of render() is the thread that observes the start.
        let worker_host = Arc::clone(&host);
        let worker = thread::spawn(move || {
            let _ = started_tx.send(thread::current().id());
            lifecycle.render("graph TD", "mermaid", RenderMode::Check)
        });

        let worker_id = started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("worker");
        while launcher_probe.start_count() == 0 {
            thread::sleep(Duration::from_millis(10));
        }
        serve_job(&worker_host);
        let report = worker.join().expect("worker").expect("report");

        assert!(report.ok);
        assert_eq!(launcher.start_count(), 1);
        assert_eq!(
            launcher.start_threads.lock().expect("threads").as_slice(),
            &[worker_id],
            "the window is created on the MCP worker, not the event-loop thread"
        );
        assert_ne!(worker_id, caller);
        assert_eq!(launcher.stop_count(), 0);
    }

    #[test]
    fn an_idle_renderer_stops_after_the_job_and_not_while_it_runs() {
        let (host, lifecycle, launcher) = fixture(Some(Duration::ZERO));
        let worker_lifecycle = Arc::clone(&lifecycle);
        let worker = thread::spawn(move || {
            worker_lifecycle.render("graph TD", "mermaid", RenderMode::Check)
        });

        while launcher.start_count() == 0 {
            thread::sleep(Duration::from_millis(10));
        }
        host.mark_ready();
        let job = host.next_job().expect("job");
        lifecycle.poll();
        assert_eq!(
            launcher.stop_count(),
            0,
            "a pulled job must keep the renderer"
        );

        host.deliver(job.job_id, Report::new(true, 1, Vec::new()));
        worker.join().expect("worker").expect("report");

        let page_host = Arc::clone(&host);
        let page = thread::spawn(move || page_host.next_job());
        let started = Instant::now();
        while host.puller_count() == 0 {
            if started.elapsed() > Duration::from_secs(5) {
                panic!("the page did not enter next_job");
            }
            thread::sleep(Duration::from_millis(5));
        }
        lifecycle.poll();

        assert_eq!(launcher.stop_count(), 1);
        assert!(
            page.join().expect("page").is_none(),
            "the page must observe the stop and exit its pull loop"
        );
    }

    #[test]
    fn a_call_during_stop_starts_the_next_generation() {
        let (host, lifecycle, launcher) = fixture(Some(Duration::ZERO));
        launcher.block_stop.store(true, Ordering::SeqCst);

        let first_host = Arc::clone(&host);
        let first_lifecycle = Arc::clone(&lifecycle);
        let first =
            thread::spawn(move || first_lifecycle.render("graph TD", "mermaid", RenderMode::Check));
        while launcher.start_count() == 0 {
            thread::sleep(Duration::from_millis(10));
        }
        serve_job(&first_host);
        first.join().expect("first").expect("report");

        let poll_lifecycle = Arc::clone(&lifecycle);
        let poller = thread::spawn(move || poll_lifecycle.poll());
        {
            let mut entered = launcher.stop_entered_flag.lock().expect("entered");
            let started = Instant::now();
            while !*entered {
                let (guard, timeout) = launcher
                    .stop_entered
                    .wait_timeout(entered, Duration::from_secs(5))
                    .expect("wait");
                entered = guard;
                if timeout.timed_out() && started.elapsed() > Duration::from_secs(5) {
                    panic!("stop did not begin");
                }
            }
        }

        let second_lifecycle = Arc::clone(&lifecycle);
        let second = thread::spawn(move || {
            second_lifecycle.render("graph TD", "mermaid", RenderMode::Check)
        });
        thread::sleep(Duration::from_millis(50));
        assert_eq!(
            launcher.start_count(),
            1,
            "the second call must wait out the stop"
        );

        {
            let mut release = launcher.release_flag.lock().expect("release");
            *release = true;
            launcher.release_stop.notify_all();
        }
        poller.join().expect("poller");

        while launcher.start_count() < 2 {
            thread::sleep(Duration::from_millis(10));
        }
        serve_job(&host);
        second.join().expect("second").expect("report");
        assert!(launcher.stop_count() >= 1);
    }

    #[test]
    fn a_start_timeout_can_be_retried() {
        let (host, lifecycle, launcher) = fixture(Some(Duration::from_secs(120)));
        host.set_ready_timeout(Duration::from_millis(80));

        let error = lifecycle
            .render("graph TD", "mermaid", RenderMode::Check)
            .expect_err("the page never became ready");
        assert_eq!(error.code, "renderer.unavailable");
        assert_eq!(launcher.start_count(), 1);

        let page_host = Arc::clone(&host);
        let page_launcher = Arc::clone(&launcher);
        let page = thread::spawn(move || {
            let started = Instant::now();
            while page_launcher.start_count() < 2 {
                if started.elapsed() > Duration::from_secs(5) {
                    panic!("the renderer was not started again");
                }
                thread::sleep(Duration::from_millis(10));
            }
            serve_job(&page_host);
        });

        let report = lifecycle
            .render("graph TD", "mermaid", RenderMode::Check)
            .expect("retry");
        page.join().expect("page");
        assert!(report.ok);
        assert_eq!(launcher.start_count(), 2);
        assert!(launcher.stop_count() >= 1);
    }

    #[test]
    fn a_failed_launch_does_not_stick() {
        let (host, lifecycle, launcher) = fixture(Some(Duration::from_secs(120)));
        launcher.fail_start.store(true, Ordering::SeqCst);
        let error = lifecycle
            .render("graph TD", "mermaid", RenderMode::Check)
            .expect_err("launch should fail");
        assert_eq!(error.code, "renderer.unavailable");

        launcher.fail_start.store(false, Ordering::SeqCst);
        let page_host = Arc::clone(&host);
        let page_launcher = Arc::clone(&launcher);
        let page = thread::spawn(move || {
            while page_launcher.start_count() == 0 {
                thread::sleep(Duration::from_millis(10));
            }
            serve_job(&page_host);
        });
        let report = lifecycle
            .render("graph TD", "mermaid", RenderMode::Check)
            .expect("retry after a failed launch");
        page.join().expect("page");
        assert!(report.ok);
    }
}
