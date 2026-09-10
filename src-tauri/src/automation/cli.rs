//! Command-line execution of `check` and `diagram render`.

use std::ffi::{OsStr, OsString};
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::automation::host::{RenderHost, RenderMode};
use crate::automation::invocation::Invocation;
use crate::automation::messages::Messages;
use crate::automation::report::{
    error_report, exit_code, Diagnostic, Report, ToolError, EXIT_USAGE_ERROR, MAX_SOURCE_BYTES,
};

/// Runs one CLI invocation and returns the process exit code.
pub fn execute(invocation: &Invocation, host: &RenderHost) -> i32 {
    let messages = host.messages();
    match invocation {
        Invocation::Check { path, format, json } => {
            let source = match read_source(path, &messages) {
                Ok(source) => source,
                Err(error) => return fail(&error, *json),
            };
            match host.render(&source, format.as_str(), RenderMode::Check) {
                Ok(report) => {
                    print_report(&report, *json, None, &messages);
                    exit_code(&report)
                }
                Err(error) => fail(&error, *json),
            }
        }
        Invocation::DiagramRender {
            path,
            format,
            output,
            json,
        } => {
            let source = match read_source(path, &messages) {
                Ok(source) => source,
                Err(error) => return fail(&error, *json),
            };
            match host.render(&source, format.as_str(), RenderMode::Render) {
                Ok(mut report) => {
                    let mut written = None;
                    if report.ok {
                        if let (Some(output), Some(svg)) = (output, report.svg.as_deref()) {
                            match write_output(output, svg, &messages) {
                                Ok(path) => {
                                    written = Some(path);
                                    report.svg = None;
                                    report.output = written.clone();
                                }
                                Err(error) => return fail(&error, *json),
                            }
                        }
                    }
                    print_report(&report, *json, written.as_deref(), &messages);
                    exit_code(&report)
                }
                Err(error) => fail(&error, *json),
            }
        }
        _ => EXIT_USAGE_ERROR,
    }
}

/// Prints a tool failure as a report and returns the usage/runtime exit code.
pub fn fail(error: &ToolError, json: bool) -> i32 {
    let report = error_report(error);
    if json {
        write_stdout(&format!("{}\n", to_json(&report)));
    } else {
        let lines = report
            .diagnostics
            .iter()
            .map(format_diagnostic)
            .collect::<Vec<_>>()
            .join("\n");
        write_stderr(&format!("{lines}\n"));
    }
    EXIT_USAGE_ERROR
}

pub fn print_report(report: &Report, json: bool, output: Option<&str>, messages: &Messages) {
    if json {
        write_stdout(&format!("{}\n", to_json(report)));
        return;
    }

    if let Some(svg) = &report.svg {
        write_stdout(&format!("{svg}\n"));
        return;
    }

    if report.ok {
        write_stdout(&format!(
            "{}\n",
            messages.checked(report.checked, output)
        ));
        return;
    }

    let lines = report
        .diagnostics
        .iter()
        .map(format_diagnostic)
        .collect::<Vec<_>>()
        .join("\n");
    write_stderr(&format!("{lines}\n"));
}

fn format_diagnostic(diagnostic: &Diagnostic) -> String {
    match diagnostic.line {
        Some(line) => format!("{}:{}: {}", diagnostic.code, line, diagnostic.message),
        None => format!("{}: {}", diagnostic.code, diagnostic.message),
    }
}

fn to_json(report: &Report) -> String {
    serde_json::to_string(report).unwrap_or_else(|error| {
        // A report that cannot be serialized must still fail loudly.
        format!(
            "{{\"schemaVersion\":1,\"ok\":false,\"checked\":0,\"diagnostics\":[{{\"code\":\"automation.failed\",\"message\":\"report serialization failed: {error}\"}}]}}"
        )
    })
}

/// Reads the source document, or standard input for `-`.
pub fn read_source(path: &OsStr, messages: &Messages) -> Result<String, ToolError> {
    if path == OsStr::new("-") {
        return read_stdin(messages);
    }

    let path = PathBuf::from(path);
    let metadata = std::fs::metadata(&path).map_err(|error| read_error(&path, error, messages))?;
    if metadata.len() > MAX_SOURCE_BYTES as u64 {
        return Err(ToolError::new(
            "input.too_large",
            messages.too_large(MAX_SOURCE_BYTES),
        ));
    }

    let bytes = std::fs::read(&path).map_err(|error| read_error(&path, error, messages))?;
    Ok(decode(bytes))
}

fn read_stdin(messages: &Messages) -> Result<String, ToolError> {
    let mut buffer = Vec::new();
    let mut stdin = std::io::stdin().lock().take(MAX_SOURCE_BYTES as u64 + 1);
    stdin.read_to_end(&mut buffer).map_err(|error| {
        ToolError::new("automation.failed", messages.stdin_failed(&error.to_string()))
    })?;
    if buffer.len() > MAX_SOURCE_BYTES {
        return Err(ToolError::new(
            "input.too_large",
            messages.too_large(MAX_SOURCE_BYTES),
        ));
    }
    Ok(decode(buffer))
}

/// Non-UTF-8 input is decoded lossily, matching the previous host's behaviour.
fn decode(bytes: Vec<u8>) -> String {
    String::from_utf8_lossy(&bytes).into_owned()
}

fn read_error(path: &Path, error: std::io::Error, messages: &Messages) -> ToolError {
    ToolError::new(
        "automation.failed",
        messages.read_failed(&format!("{}: {error}", path.display())),
    )
}

/// Writes SVG to a new file. Existing files are never overwritten.
fn write_output(output: &OsStr, svg: &str, messages: &Messages) -> Result<String, ToolError> {
    let path = PathBuf::from(output);
    let display = path.display().to_string();

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            let message = if error.kind() == std::io::ErrorKind::AlreadyExists {
                messages.output_exists(&display)
            } else {
                messages.write_failed(&format!("{display}: {error}"))
            };
            ToolError::new("automation.failed", message)
        })?;

    file.write_all(svg.as_bytes()).map_err(|error| {
        ToolError::new(
            "automation.failed",
            messages.write_failed(&format!("{display}: {error}")),
        )
    })?;

    Ok(std::path::absolute(&path)
        .map(|absolute| absolute.display().to_string())
        .unwrap_or(display))
}

/// Absolute path of this executable, used by `mcp-config`.
pub fn current_executable() -> OsString {
    std::env::current_exe()
        .map(PathBuf::into_os_string)
        .unwrap_or_else(|_| OsString::from("LumaMark.exe"))
}

/// Writing must never panic: a closed pipe (`--help | head`) is not a failure.
pub fn write_stdout(text: &str) {
    let mut stdout = std::io::stdout().lock();
    let _ = stdout.write_all(text.as_bytes());
    let _ = stdout.flush();
}

pub fn write_stderr(text: &str) {
    let mut stderr = std::io::stderr().lock();
    let _ = stderr.write_all(text.as_bytes());
    let _ = stderr.flush();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::messages::Locale;

    fn messages() -> Messages {
        Messages::new(Locale::En)
    }

    #[test]
    fn diagnostics_render_with_and_without_a_line() {
        assert_eq!(
            format_diagnostic(&Diagnostic::new("diagram.invalid", "bad").with_line(4)),
            "diagram.invalid:4: bad"
        );
        assert_eq!(
            format_diagnostic(&Diagnostic::new("renderer.timeout", "slow")),
            "renderer.timeout: slow"
        );
    }

    #[test]
    fn an_unserializable_report_still_fails_closed() {
        let report = Report::new(true, 1, Vec::new());
        let json = to_json(&report);

        assert!(json.contains("\"ok\":true"));
        assert!(json.contains("\"schemaVersion\":1"));
    }

    #[test]
    fn oversized_files_are_rejected_before_reading() {
        let path = std::env::temp_dir().join(format!(
            "lumamark-automation-large-{}.md",
            std::process::id()
        ));
        std::fs::write(&path, vec![b'x'; MAX_SOURCE_BYTES + 1]).expect("fixture should be written");

        let error = read_source(path.as_os_str(), &messages()).expect_err("must fail");
        let _ = std::fs::remove_file(&path);

        assert_eq!(error.code, "input.too_large");
    }

    #[test]
    fn a_missing_file_reports_a_read_failure() {
        let path = std::env::temp_dir().join("lumamark-automation-missing-notes.md");
        let _ = std::fs::remove_file(&path);

        let error = read_source(path.as_os_str(), &messages()).expect_err("must fail");

        assert_eq!(error.code, "automation.failed");
        assert!(error.message.contains("lumamark-automation-missing-notes.md"));
    }

    #[test]
    fn output_is_never_overwritten() {
        let path = std::env::temp_dir().join(format!(
            "lumamark-automation-output-{}.svg",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);

        let written =
            write_output(path.as_os_str(), "<svg/>", &messages()).expect("first write");
        assert!(written.ends_with(".svg"));
        let error = write_output(path.as_os_str(), "<svg/>", &messages()).expect_err("second write");
        let _ = std::fs::remove_file(&path);

        assert_eq!(error.code, "automation.failed");
        assert!(error.message.contains("never overwritten"));
    }

    #[test]
    fn utf8_input_survives_decoding() {
        assert_eq!(decode("图表".as_bytes().to_vec()), "图表");
    }
}
