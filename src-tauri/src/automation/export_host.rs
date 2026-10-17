//! Hidden renderer host for `LumaMark.exe export html|pdf`.
//!
//! The page owns Markdown/HTML rendering through the shared frontend export
//! pipeline. This module only carries one job, enforces readiness/stall
//! timeouts, writes the CLI report and prints PDF on Windows.

use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::automation::cli;
use crate::automation::invocation::{ExportFormat, Invocation};
use crate::automation::messages::{Locale, Messages};
use crate::automation::report::{
    Diagnostic, ToolError, EXIT_OK, EXIT_USAGE_ERROR, RENDERER_READY_TIMEOUT_MS,
};
use crate::services::export_service::validate_output_path;
use crate::services::pdf_export_service::{print_webview_to_pdf, PdfPrintOptions};

pub const EXPORT_WINDOW_LABEL: &str = "export";
pub const EXPORT_PAGE: &str = "export-render.html";
pub const EXPORT_STALL_TIMEOUT_MS: u64 = 180_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMathOptions {
    pub numbering: String,
    pub physics: bool,
    pub syntax_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMessages {
    pub diagram_failed: String,
    pub image_unavailable: String,
    pub math_failed: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub job_id: u64,
    pub document_path: Option<String>,
    pub force: bool,
    pub format: String,
    pub language: String,
    pub math: ExportMathOptions,
    pub messages: ExportMessages,
    pub output: String,
    pub plantuml_enabled: bool,
    pub source: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportWarning {
    pub code: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub line: Option<u32>,
    pub message: String,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    #[serde(default)]
    pub bytes: Option<u64>,
    #[serde(default)]
    pub diagnostics: Vec<Diagnostic>,
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub output: Option<String>,
    #[serde(default)]
    pub ready: Option<bool>,
    #[serde(default)]
    pub warnings: Vec<ExportWarning>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub bytes: Option<u64>,
    pub diagnostics: Vec<Diagnostic>,
    pub format: String,
    pub ok: bool,
    pub output: Option<String>,
    pub schema_version: u8,
    pub warnings: Vec<Diagnostic>,
}

impl ExportReport {
    fn success(format: &str, output: String, bytes: u64, warnings: Vec<Diagnostic>) -> Self {
        Self {
            bytes: Some(bytes),
            diagnostics: Vec::new(),
            format: format.to_owned(),
            ok: true,
            output: Some(output),
            schema_version: 1,
            warnings,
        }
    }

    fn failure(format: &str, code: &str, message: String) -> Self {
        Self {
            bytes: None,
            diagnostics: vec![Diagnostic::new(code, message)],
            format: format.to_owned(),
            ok: false,
            output: None,
            schema_version: 1,
            warnings: Vec::new(),
        }
    }
}

struct HostInner {
    failed: Option<ToolError>,
    job: Option<ExportJob>,
    last_progress: Instant,
    next_job_id: u64,
    ready: bool,
    result: Option<(u64, ExportResult)>,
    shutting_down: bool,
}

pub struct ExportHost {
    messages: Messages,
    inner: Mutex<HostInner>,
    changed: Condvar,
}

impl ExportHost {
    pub fn new(messages: Messages) -> Self {
        Self {
            messages,
            inner: Mutex::new(HostInner {
                failed: None,
                job: None,
                last_progress: Instant::now(),
                next_job_id: 1,
                ready: false,
                result: None,
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

    fn lock(&self) -> MutexGuard<'_, HostInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn mark_ready(&self) {
        let mut inner = self.lock();
        inner.ready = true;
        inner.last_progress = Instant::now();
        self.changed.notify_all();
    }

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

    fn run(&self, mut job: ExportJob) -> Result<ExportResult, ToolError> {
        self.wait_until_ready(RENDERER_READY_TIMEOUT_MS)?;
        let job_id = {
            let mut inner = self.lock();
            if inner.shutting_down {
                return Err(ToolError::new(
                    "renderer.unavailable",
                    self.messages.text().unavailable,
                ));
            }
            if inner.job.is_some() {
                return Err(ToolError::new(
                    "export.failed",
                    self.messages.text().export_busy,
                ));
            }
            let job_id = inner.next_job_id;
            inner.next_job_id += 1;
            job.job_id = job_id;
            inner.job = Some(job);
            inner.last_progress = Instant::now();
            self.changed.notify_all();
            job_id
        };
        self.wait_for(job_id)
    }

    pub fn next_job(&self) -> Option<ExportJob> {
        let mut inner = self.lock();
        loop {
            if inner.shutting_down {
                return None;
            }
            if let Some(job) = inner.job.take() {
                inner.last_progress = Instant::now();
                return Some(job);
            }
            inner = self
                .changed
                .wait(inner)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    pub fn report_progress(&self) {
        let mut inner = self.lock();
        inner.last_progress = Instant::now();
        self.changed.notify_all();
    }

    pub fn deliver(&self, job_id: u64, result: ExportResult) {
        let mut inner = self.lock();
        if inner.shutting_down {
            return;
        }
        inner.result = Some((job_id, result));
        inner.last_progress = Instant::now();
        self.changed.notify_all();
    }

    pub fn shutdown(&self) {
        let mut inner = self.lock();
        inner.shutting_down = true;
        self.changed.notify_all();
    }

    fn wait_for(&self, job_id: u64) -> Result<ExportResult, ToolError> {
        let stall = Duration::from_millis(EXPORT_STALL_TIMEOUT_MS);
        let mut inner = self.lock();
        let mut last_seen = inner.last_progress;
        loop {
            if let Some((id, result)) = inner.result.take() {
                if id == job_id {
                    return Ok(result);
                }
                inner.result = Some((id, result));
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
                    self.messages.text().export_timeout,
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

pub fn execute(invocation: &Invocation, host: &Arc<ExportHost>, handle: &AppHandle) -> i32 {
    let messages = host.messages();
    let Invocation::Export {
        force,
        format,
        json,
        output,
        path,
        title,
    } = invocation
    else {
        return EXIT_USAGE_ERROR;
    };
    let format_name = format.as_str();

    let source = match cli::read_source(path, &messages) {
        Ok(source) => source,
        Err(error) => return cli::fail(&error, *json),
    };

    let output = match output {
        Some(output) => {
            match validate_output_path(output.to_string_lossy().as_ref(), format_name) {
                Ok(output) => output,
                Err(error) => {
                    return fail(format_name, &error.code, error.message, *json, &messages);
                }
            }
        }
        None => {
            let input = std::path::PathBuf::from(path);
            let mut default = input.clone();
            default.set_extension(format_name);
            match validate_output_path(default.to_string_lossy().as_ref(), format_name) {
                Ok(output) => output,
                Err(error) => {
                    return fail(format_name, &error.code, error.message, *json, &messages);
                }
            }
        }
    };
    if output.exists() && !force {
        return fail(
            format_name,
            "output.exists",
            messages.output_exists(&output.display().to_string()),
            *json,
            &messages,
        );
    }
    let output_string = output.to_string_lossy().into_owned();

    let job = ExportJob {
        job_id: 0,
        document_path: document_path(path),
        force: *force,
        format: format_name.to_owned(),
        language: match messages.locale() {
            Locale::En => "en".to_owned(),
            Locale::ZhCn => "zh-CN".to_owned(),
        },
        math: ExportMathOptions {
            numbering: "none".to_owned(),
            physics: false,
            syntax_mode: "pandoc".to_owned(),
        },
        messages: ExportMessages {
            diagram_failed: messages.text().export_diagram_failed.to_owned(),
            image_unavailable: messages.text().export_image_unavailable.to_owned(),
            math_failed: messages.text().export_math_failed.to_owned(),
        },
        output: output_string.clone(),
        plantuml_enabled: true,
        source,
        title: title.clone(),
    };

    let result = match host.run(job) {
        Ok(result) => result,
        Err(error) => return cli::fail(&error, *json),
    };

    if !result.ok {
        let mut report = ExportReport::failure(
            format_name,
            "export.failed",
            messages.text().export_failed.to_owned(),
        );
        report.diagnostics.extend(result.diagnostics);
        report.warnings = result
            .warnings
            .iter()
            .map(warning_to_diagnostic)
            .collect();
        cli::print_export_report(&report, *json, &messages);
        return 1;
    }

    let mut bytes = result.bytes;
    if *format == ExportFormat::Pdf {
        let Some(window) = handle.get_webview_window(EXPORT_WINDOW_LABEL) else {
            return fail(
                format_name,
                "export.pdf_failed",
                messages.text().export_failed.to_owned(),
                *json,
                &messages,
            );
        };
        match print_webview_to_pdf(
            &window,
            &output_string,
            PdfPrintOptions {
                replace_existing: *force,
            },
        ) {
            Ok(length) => bytes = Some(length),
            Err(error) => {
                return fail(format_name, &error.code, error.message, *json, &messages);
            }
        }
    }

    let warnings = result
        .warnings
        .iter()
        .map(warning_to_diagnostic)
        .collect::<Vec<_>>();
    let report = ExportReport::success(
        format_name,
        result.output.unwrap_or(output_string),
        bytes.unwrap_or_default(),
        warnings,
    );
    cli::print_export_report(&report, *json, &messages);
    EXIT_OK
}

fn warning_to_diagnostic(warning: &ExportWarning) -> Diagnostic {
    let mut diagnostic = Diagnostic::new(warning.code.clone(), warning.message.clone());
    if let Some(format) = &warning.format {
        diagnostic = diagnostic.with_format(format.clone());
    }
    if let Some(line) = warning.line {
        diagnostic = diagnostic.with_line(line);
    }
    if let Some(source) = &warning.source {
        diagnostic = diagnostic.with_source(source.clone());
    }
    diagnostic
}

fn fail(format: &str, code: &str, message: String, json: bool, _messages: &Messages) -> i32 {
    let report = ExportReport::failure(format, code, message);
    cli::print_export_report(&report, json, _messages);
    1
}

fn document_path(path: &std::ffi::OsStr) -> Option<String> {
    if path == std::ffi::OsStr::new("-") {
        return None;
    }
    Some(
        std::path::absolute(path)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| path.to_string_lossy().into_owned()),
    )
}

type HostState<'a> = State<'a, Arc<ExportHost>>;

#[tauri::command]
pub fn export_host_ready(host: HostState<'_>) {
    host.mark_ready();
}

#[tauri::command]
pub async fn export_render_next(host: HostState<'_>) -> Result<Option<ExportJob>, String> {
    let host = Arc::clone(host.inner());
    tauri::async_runtime::spawn_blocking(move || host.next_job())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_render_progress(host: HostState<'_>) {
    host.report_progress();
}

#[tauri::command]
pub fn export_render_result(
    host: HostState<'_>,
    job_id: u64,
    result: ExportResult,
) {
    host.deliver(job_id, result);
}
