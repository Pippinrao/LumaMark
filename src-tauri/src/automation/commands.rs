//! Commands the hidden renderer page calls to pull and answer jobs.

use std::sync::Arc;

use tauri::State;

use crate::automation::host::{RenderHost, RenderJob};
use crate::automation::report::Report;

type HostState<'a> = State<'a, Arc<RenderHost>>;

/// The renderer page finished loading and is ready to pull jobs.
#[tauri::command]
pub fn automation_host_ready(host: HostState<'_>) {
    host.mark_ready();
}

/// Blocking pull. Runs off the main thread so the WebView can keep painting the
/// job it is rendering.
#[tauri::command]
pub async fn automation_render_next(host: HostState<'_>) -> Result<Option<RenderJob>, String> {
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.next_job())
        .await
        .map_err(|error| error.to_string())
}

/// Keeps the stall watchdog alive while a large document renders.
#[tauri::command]
pub fn automation_render_progress(host: HostState<'_>, job_id: u64, completed: u32) {
    host.report_progress(job_id, completed);
}

/// Delivers the finished report for one job.
#[tauri::command]
pub fn automation_render_result(host: HostState<'_>, job_id: u64, report: Report) {
    host.deliver(job_id, report);
}
