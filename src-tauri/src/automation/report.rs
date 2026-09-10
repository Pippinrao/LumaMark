use serde::{Deserialize, Serialize};

/// Report schema shared by the CLI, the MCP tools and the renderer page.
pub const SCHEMA_VERSION: u8 = 1;

/// UTF-8 source budget, pre-checked by the CLI and re-checked by the renderer.
pub const MAX_SOURCE_BYTES: usize = 2 * 1024 * 1024;

/// Maximum supported diagram fences accepted in one Markdown request.
pub const MAX_DIAGRAMS: u32 = 100;

/// Per-diagram rendering deadline; the renderer page enforces the same value.
pub const DIAGRAM_TIMEOUT_MS: u64 = 30_000;

/// Backstop for a renderer that stops reporting progress during one diagram.
pub const RENDERER_STALL_TIMEOUT_MS: u64 = DIAGRAM_TIMEOUT_MS;

/// Deadline for the hidden renderer page to report readiness.
pub const RENDERER_READY_TIMEOUT_MS: u64 = 60_000;

pub const EXIT_OK: i32 = 0;
pub const EXIT_DIAGRAM_ERROR: i32 = 1;
pub const EXIT_USAGE_ERROR: i32 = 2;

/// Stable diagnostic codes. The help text renders this list, so it cannot drift.
pub const DIAGNOSTIC_CODES: &[&str] = &[
    "input.too_large",
    "input.too_many_diagrams",
    "input.format",
    "input.arguments",
    "diagram.empty",
    "diagram.invalid",
    "renderer.timeout",
    "renderer.unavailable",
    "automation.failed",
];

/// One reported problem, mapped back to the source document where possible.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    /// One-based line of the opening fence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_line: Option<u32>,
    /// One-based error line mapped back to the document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

impl Diagnostic {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            format: None,
            block_line: None,
            line: None,
        }
    }

    pub fn with_format(mut self, format: impl Into<String>) -> Self {
        self.format = Some(format.into());
        self
    }

    pub fn with_block_line(mut self, block_line: u32) -> Self {
        self.block_line = Some(block_line);
        self
    }

    pub fn with_line(mut self, line: u32) -> Self {
        self.line = Some(line);
        self
    }
}

/// Result of one check or render request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub schema_version: u8,
    pub ok: bool,
    pub checked: u32,
    #[serde(default)]
    pub diagnostics: Vec<Diagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub svg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

impl Report {
    pub fn new(ok: bool, checked: u32, diagnostics: Vec<Diagnostic>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            ok,
            checked,
            diagnostics,
            svg: None,
            output: None,
        }
    }

    pub fn failure(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(false, 0, vec![Diagnostic::new(code, message)])
    }

    /// A schema-version or transport failure must never read as success.
    pub fn is_trustworthy(&self) -> bool {
        self.schema_version == SCHEMA_VERSION
    }
}

/// Tool-owned failure that carries a stable code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    pub code: &'static str,
    pub message: String,
}

impl ToolError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub fn error_report(error: &ToolError) -> Report {
    Report::failure(error.code, error.message.clone())
}

/// Low-level failures (files, IPC, engine runtime) are usage/runtime errors.
pub fn runtime_report(code: &'static str, message: impl Into<String>) -> Report {
    Report::failure(code, message)
}

pub fn exit_code(report: &Report) -> i32 {
    if report.ok {
        EXIT_OK
    } else {
        EXIT_DIAGRAM_ERROR
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_serializes_with_the_documented_schema() {
        let report = Report::new(true, 2, Vec::new());
        let json = serde_json::to_string(&report).expect("report should serialize");

        assert_eq!(json, r#"{"schemaVersion":1,"ok":true,"checked":2,"diagnostics":[]}"#);
    }

    #[test]
    fn diagnostics_omit_absent_locations() {
        let report = Report::new(
            false,
            1,
            vec![Diagnostic::new("diagram.invalid", "bad").with_format("mermaid").with_block_line(3).with_line(4)],
        );
        let json = serde_json::to_string(&report).expect("report should serialize");

        assert_eq!(
            json,
            r#"{"schemaVersion":1,"ok":false,"checked":1,"diagnostics":[{"code":"diagram.invalid","message":"bad","format":"mermaid","blockLine":3,"line":4}]}"#
        );
    }

    #[test]
    fn reports_round_trip_through_deserialization() {
        let report = Report::new(false, 0, vec![Diagnostic::new("input.format", "specify")]);
        let json = serde_json::to_string(&report).expect("report should serialize");
        let decoded: Report = serde_json::from_str(&json).expect("report should deserialize");

        assert_eq!(decoded, report);
        assert!(decoded.is_trustworthy());
    }

    #[test]
    fn an_incompatible_schema_version_is_not_trustworthy() {
        let decoded: Report = serde_json::from_str(
            r#"{"schemaVersion":2,"ok":true,"checked":1,"diagnostics":[]}"#,
        )
        .expect("report should deserialize");

        assert!(!decoded.is_trustworthy());
    }

    #[test]
    fn exit_codes_follow_diagnostic_severity() {
        assert_eq!(exit_code(&Report::new(true, 1, Vec::new())), 0);
        assert_eq!(exit_code(&Report::new(false, 1, Vec::new())), 1);
        assert_eq!(EXIT_USAGE_ERROR, 2);
    }

    #[test]
    fn limits_match_the_documented_contract() {
        assert_eq!(MAX_SOURCE_BYTES / (1024 * 1024), 2);
        assert_eq!(MAX_DIAGRAMS, 100);
        assert_eq!(DIAGRAM_TIMEOUT_MS / 1000, 30);
        assert_eq!(RENDERER_STALL_TIMEOUT_MS, DIAGRAM_TIMEOUT_MS);
        assert_eq!(RENDERER_READY_TIMEOUT_MS / 1000, 60);
    }
}
