//! Command and option surface of the bundled automation host.
//!
//! Parsing and `--help` read the same tables, so the documented surface cannot
//! drift from what the tool accepts.

use std::ffi::{OsStr, OsString};
use std::path::Path;

use crate::automation::messages::Messages;
use crate::automation::report::ToolError;

/// Documented input formats accepted by `check`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputFormat {
    Markdown,
    Mermaid,
    Plantuml,
}

impl InputFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Markdown => "markdown",
            Self::Mermaid => "mermaid",
            Self::Plantuml => "plantuml",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "markdown" => Some(Self::Markdown),
            "mermaid" => Some(Self::Mermaid),
            "plantuml" => Some(Self::Plantuml),
            _ => None,
        }
    }
}

/// Diagram formats accepted by `diagram render`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagramFormat {
    Mermaid,
    Plantuml,
}

impl DiagramFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mermaid => "mermaid",
            Self::Plantuml => "plantuml",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "mermaid" => Some(Self::Mermaid),
            "plantuml" => Some(Self::Plantuml),
            _ => None,
        }
    }

    pub fn from_input_format(format: InputFormat) -> Option<Self> {
        match format {
            InputFormat::Markdown => None,
            InputFormat::Mermaid => Some(Self::Mermaid),
            InputFormat::Plantuml => Some(Self::Plantuml),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandId {
    Check,
    DiagramRender,
    Mcp,
    McpConfig,
    Help,
    Version,
}

impl CommandId {
    pub const ALL: &'static [CommandId] = &[
        Self::Check,
        Self::DiagramRender,
        Self::Mcp,
        Self::McpConfig,
        Self::Help,
        Self::Version,
    ];
    pub const COUNT: usize = Self::ALL.len();

    pub const fn index(self) -> usize {
        match self {
            Self::Check => 0,
            Self::DiagramRender => 1,
            Self::Mcp => 2,
            Self::McpConfig => 3,
            Self::Help => 4,
            Self::Version => 5,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptionId {
    Format,
    Output,
    Json,
    Help,
    Version,
    EndOfOptions,
}

impl OptionId {
    pub const ALL: &'static [OptionId] = &[
        Self::Format,
        Self::Output,
        Self::Json,
        Self::Help,
        Self::Version,
        Self::EndOfOptions,
    ];
    pub const COUNT: usize = Self::ALL.len();

    pub const fn index(self) -> usize {
        match self {
            Self::Format => 0,
            Self::Output => 1,
            Self::Json => 2,
            Self::Help => 3,
            Self::Version => 4,
            Self::EndOfOptions => 5,
        }
    }
}

/// One documented command.
pub struct CommandSpec {
    pub id: CommandId,
    /// How the command is written in prose (`diagram render` is one command).
    pub name: &'static str,
    /// Usage line without the executable name.
    pub usage: &'static str,
}

pub const COMMANDS: &[CommandSpec] = &[
    CommandSpec {
        id: CommandId::Check,
        name: "check",
        usage: "check <file|-> [--format markdown|mermaid|plantuml] [--json]",
    },
    CommandSpec {
        id: CommandId::DiagramRender,
        name: "diagram render",
        usage: "diagram render <file|-> [--format mermaid|plantuml] [--output <file.svg>] [--json]",
    },
    CommandSpec {
        id: CommandId::Mcp,
        name: "mcp",
        usage: "mcp",
    },
    CommandSpec {
        id: CommandId::McpConfig,
        name: "mcp-config",
        usage: "mcp-config",
    },
    CommandSpec {
        id: CommandId::Help,
        name: "--help",
        usage: "--help | -h",
    },
    CommandSpec {
        id: CommandId::Version,
        name: "--version",
        usage: "--version",
    },
];

/// One documented option.
pub struct OptionSpec {
    pub id: OptionId,
    pub long: &'static str,
    pub short: Option<&'static str>,
    pub value: Option<&'static str>,
}

pub const OPTIONS: &[OptionSpec] = &[
    OptionSpec {
        id: OptionId::Format,
        long: "--format",
        short: None,
        value: Some("<value>"),
    },
    OptionSpec {
        id: OptionId::Output,
        long: "--output",
        short: Some("-o"),
        value: Some("<file.svg>"),
    },
    OptionSpec {
        id: OptionId::Json,
        long: "--json",
        short: None,
        value: None,
    },
    OptionSpec {
        id: OptionId::Help,
        long: "--help",
        short: Some("-h"),
        value: None,
    },
    OptionSpec {
        id: OptionId::Version,
        long: "--version",
        short: None,
        value: None,
    },
    OptionSpec {
        id: OptionId::EndOfOptions,
        long: "--",
        short: None,
        value: None,
    },
];

/// First arguments that switch the executable into automation mode.
pub const ENTRY_TOKENS: &[&str] = &[
    "check",
    "diagram",
    "mcp",
    "mcp-config",
    "--help",
    "-h",
    "--version",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invocation {
    Help,
    Version,
    Check {
        path: OsString,
        format: InputFormat,
        json: bool,
    },
    DiagramRender {
        path: OsString,
        format: DiagramFormat,
        output: Option<OsString>,
        json: bool,
    },
    Mcp,
    McpConfig,
}

impl Invocation {
    /// Help, version and `mcp-config` never need a WebView or a window.
    pub fn needs_renderer(&self) -> bool {
        matches!(
            self,
            Self::Check { .. } | Self::DiagramRender { .. } | Self::Mcp
        )
    }
}

/// A parsed invocation plus the raw `--json` intent, which also formats
/// argument errors.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub json: bool,
    pub invocation: Result<Invocation, ToolError>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detection {
    /// The executable was launched as the desktop editor.
    NotAutomation,
    Automation(Request),
}

/// Recognizes automation invocations. Anything else stays with the editor.
pub fn detect(args: &[OsString]) -> Detection {
    let Some(first) = args.get(1).and_then(|argument| argument.to_str()) else {
        return Detection::NotAutomation;
    };
    if !ENTRY_TOKENS.contains(&first) {
        return Detection::NotAutomation;
    }
    Detection::Automation(parse(args))
}

pub fn parse(args: &[OsString]) -> Request {
    parse_with_locale(args, Messages::new(crate::automation::messages::Locale::En))
}

pub fn parse_with_locale(args: &[OsString], messages: Messages) -> Request {
    let tokens: Vec<&OsStr> = args.iter().skip(1).map(OsString::as_os_str).collect();
    let json = tokens.iter().any(|token| token.to_str() == Some("--json"));
    Request {
        json,
        invocation: parse_tokens(&tokens, &messages),
    }
}

pub fn parse_tokens(tokens: &[&OsStr], messages: &Messages) -> Result<Invocation, ToolError> {
    if tokens
        .iter()
        .any(|token| matches!(token.to_str(), Some("--help") | Some("-h")))
    {
        return Ok(Invocation::Help);
    }
    if tokens.iter().any(|token| token.to_str() == Some("--version")) {
        return Ok(Invocation::Version);
    }

    let Some(first) = tokens.first().and_then(|token| token.to_str()) else {
        return Err(arguments_error(messages));
    };

    match first {
        "check" => parse_check(&tokens[1..], messages),
        "diagram" => parse_diagram_render(&tokens[1..], messages),
        "mcp" => parse_verbatim(&tokens[1..], messages, Invocation::Mcp),
        "mcp-config" => parse_verbatim(&tokens[1..], messages, Invocation::McpConfig),
        _ => Err(arguments_error(messages)),
    }
}

fn parse_verbatim(
    tokens: &[&OsStr],
    messages: &Messages,
    invocation: Invocation,
) -> Result<Invocation, ToolError> {
    if tokens.is_empty() {
        return Ok(invocation);
    }
    Err(ToolError::new(
        "input.arguments",
        messages.text().mcp_arguments,
    ))
}

fn parse_check(tokens: &[&OsStr], messages: &Messages) -> Result<Invocation, ToolError> {
    let parsed = parse_common(tokens, messages, false)?;
    let format = resolve_input_format(parsed.format.as_deref(), &parsed.path, false, messages)?;
    Ok(Invocation::Check {
        path: parsed.path,
        format,
        json: parsed.json,
    })
}

fn parse_diagram_render(tokens: &[&OsStr], messages: &Messages) -> Result<Invocation, ToolError> {
    let Some(subcommand) = tokens.first().and_then(|token| token.to_str()) else {
        return Err(arguments_error(messages));
    };
    if subcommand != "render" {
        return Err(arguments_error(messages));
    }
    let parsed = parse_common(&tokens[1..], messages, true)?;
    let format = resolve_input_format(parsed.format.as_deref(), &parsed.path, true, messages)?;
    let format =
        DiagramFormat::from_input_format(format).ok_or_else(|| format_error(messages, None))?;
    Ok(Invocation::DiagramRender {
        path: parsed.path,
        format,
        output: parsed.output,
        json: parsed.json,
    })
}

struct CommonOptions {
    path: OsString,
    format: Option<String>,
    output: Option<OsString>,
    json: bool,
}

fn parse_common(
    tokens: &[&OsStr],
    messages: &Messages,
    allow_output: bool,
) -> Result<CommonOptions, ToolError> {
    let mut path: Option<OsString> = None;
    let mut format: Option<String> = None;
    let mut output: Option<OsString> = None;
    let mut json = false;
    let mut end_of_options = false;
    let mut index = 0;

    while index < tokens.len() {
        let token = tokens[index];
        index += 1;

        if !end_of_options {
            if let Some(text) = token.to_str() {
                match text {
                    "--" => {
                        end_of_options = true;
                        continue;
                    }
                    "--json" => {
                        json = true;
                        continue;
                    }
                    "--format" => {
                        format = Some(next_utf8_value(tokens, &mut index, messages)?);
                        continue;
                    }
                    "--output" if allow_output => {
                        output = Some(tokens.get(index).ok_or_else(|| arguments_error(messages))?.to_os_string());
                        index += 1;
                        continue;
                    }
                    "-o" if allow_output => {
                        output = Some(tokens.get(index).ok_or_else(|| arguments_error(messages))?.to_os_string());
                        index += 1;
                        continue;
                    }
                    _ => {}
                }

                if let Some(value) = inline_value(text, "--format") {
                    format = Some(non_empty(value, messages)?);
                    continue;
                }
                if allow_output {
                    if let Some(value) = inline_value(text, "--output") {
                        output = Some(OsString::from(non_empty(value, messages)?));
                        continue;
                    }
                    if let Some(value) = inline_value(text, "-o") {
                        output = Some(OsString::from(non_empty(value, messages)?));
                        continue;
                    }
                }
                if text.len() > 1 && text.starts_with('-') {
                    return Err(arguments_error(messages));
                }
            }
        }

        if path.is_some() {
            return Err(arguments_error(messages));
        }
        path = Some(token.to_os_string());
    }

    let Some(path) = path else {
        return Err(arguments_error(messages));
    };

    Ok(CommonOptions {
        path,
        format,
        output,
        json,
    })
}

fn next_utf8_value(
    tokens: &[&OsStr],
    index: &mut usize,
    messages: &Messages,
) -> Result<String, ToolError> {
    let value = tokens.get(*index).ok_or_else(|| arguments_error(messages))?;
    *index += 1;
    value
        .to_str()
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| arguments_error(messages))
}

fn non_empty(value: &str, messages: &Messages) -> Result<String, ToolError> {
    if value.is_empty() {
        return Err(arguments_error(messages));
    }
    Ok(value.to_owned())
}

fn inline_value<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    text.strip_prefix(name)?.strip_prefix('=')
}

fn resolve_input_format(
    explicit: Option<&str>,
    path: &OsStr,
    render: bool,
    messages: &Messages,
) -> Result<InputFormat, ToolError> {
    let format = match explicit {
        Some(value) => InputFormat::parse(value)
            .ok_or_else(|| format_error(messages, Some(value)))?,
        None => match infer_format(path, render) {
            Some(format) => format,
            None => return Err(format_error(messages, None)),
        },
    };

    if render && format == InputFormat::Markdown {
        return Err(ToolError::new(
            "input.format",
            messages.text().render_format,
        ));
    }
    Ok(format)
}

fn infer_format(path: &OsStr, render: bool) -> Option<InputFormat> {
    if path.to_str() == Some("-") {
        return if render {
            None
        } else {
            Some(InputFormat::Markdown)
        };
    }
    let extension = Path::new(path)
        .extension()
        .and_then(OsStr::to_str)?
        .to_ascii_lowercase();
    match extension.as_str() {
        "md" | "markdown" => Some(InputFormat::Markdown),
        "mmd" | "mermaid" => Some(InputFormat::Mermaid),
        "puml" | "plantuml" => Some(InputFormat::Plantuml),
        _ => None,
    }
}

fn arguments_error(messages: &Messages) -> ToolError {
    ToolError::new("input.arguments", messages.text().arguments)
}

fn format_error(messages: &Messages, value: Option<&str>) -> ToolError {
    match value {
        Some(value) => ToolError::new("input.format", messages.unknown_format_value(value)),
        None => ToolError::new("input.format", messages.text().format),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::messages::Locale;

    fn messages() -> Messages {
        Messages::new(Locale::En)
    }

    fn os(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    fn parse_ok(values: &[&str]) -> Invocation {
        parse_with_locale(&os(values), messages())
            .invocation
            .expect("invocation should parse")
    }

    fn parse_err(values: &[&str]) -> ToolError {
        parse_with_locale(&os(values), messages())
            .invocation
            .expect_err("invocation should fail")
    }

    #[test]
    fn detection_leaves_the_editor_alone() {
        assert_eq!(detect(&os(&["LumaMark.exe"])), Detection::NotAutomation);
        assert_eq!(
            detect(&os(&["LumaMark.exe", "notes.md"])),
            Detection::NotAutomation
        );
        assert_eq!(
            detect(&os(&["LumaMark.exe", "check.md"])),
            Detection::NotAutomation
        );
        assert_eq!(
            detect(&os(&["LumaMark.exe", "diagram"])),
            Detection::Automation(parse(&os(&["LumaMark.exe", "diagram"])))
        );
    }

    #[test]
    fn every_documented_entry_token_starts_automation() {
        for token in ENTRY_TOKENS {
            let arguments = os(&["LumaMark.exe", token]);
            assert!(
                matches!(detect(&arguments), Detection::Automation(_)),
                "`{token}` must enter automation mode"
            );
        }
    }

    #[test]
    fn check_defaults_to_markdown_and_infers_extensions() {
        assert_eq!(
            parse_ok(&["LumaMark.exe", "check", "notes.md"]),
            Invocation::Check {
                path: OsString::from("notes.md"),
                format: InputFormat::Markdown,
                json: false,
            }
        );
        assert_eq!(
            parse_ok(&["LumaMark.exe", "check", "chart.puml"]),
            Invocation::Check {
                path: OsString::from("chart.puml"),
                format: InputFormat::Plantuml,
                json: false,
            }
        );
        assert_eq!(
            parse_ok(&["LumaMark.exe", "check", "-"]),
            Invocation::Check {
                path: OsString::from("-"),
                format: InputFormat::Markdown,
                json: false,
            }
        );
        assert_eq!(
            parse_ok(&["LumaMark.exe", "check", "-", "--format=mermaid", "--json"]),
            Invocation::Check {
                path: OsString::from("-"),
                format: InputFormat::Mermaid,
                json: true,
            }
        );
    }

    #[test]
    fn diagram_render_accepts_output_and_short_option() {
        let expected = Invocation::DiagramRender {
            path: OsString::from("chart.mmd"),
            format: DiagramFormat::Mermaid,
            output: Some(OsString::from("chart.svg")),
            json: true,
        };
        assert_eq!(
            parse_ok(&["LumaMark.exe", "diagram", "render", "chart.mmd", "--output", "chart.svg", "--json"]),
            expected
        );
        assert_eq!(
            parse_ok(&["LumaMark.exe", "diagram", "render", "chart.mmd", "-o", "chart.svg", "--json"]),
            expected
        );
        assert_eq!(
            parse_ok(&["LumaMark.exe", "diagram", "render", "chart.mmd", "--output=chart.svg", "--json"]),
            expected
        );
    }

    #[test]
    fn end_of_options_accepts_paths_that_start_with_a_dash() {
        assert_eq!(
            parse_ok(&["LumaMark.exe", "check", "--", "-weird.md"]),
            Invocation::Check {
                path: OsString::from("-weird.md"),
                format: InputFormat::Markdown,
                json: false,
            }
        );
    }

    #[test]
    fn help_and_version_win_over_other_arguments() {
        assert_eq!(parse_ok(&["LumaMark.exe", "check", "--help"]), Invocation::Help);
        assert_eq!(parse_ok(&["LumaMark.exe", "-h"]), Invocation::Help);
        assert_eq!(
            parse_ok(&["LumaMark.exe", "diagram", "render", "--version"]),
            Invocation::Version
        );
    }

    #[test]
    fn usage_and_format_errors_use_stable_codes() {
        assert_eq!(parse_err(&["LumaMark.exe", "check"]).code, "input.arguments");
        assert_eq!(
            parse_err(&["LumaMark.exe", "check", "a.md", "b.md"]).code,
            "input.arguments"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "check", "a.md", "--output", "a.svg"]).code,
            "input.arguments"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "diagram", "render", "notes"]).code,
            "input.format"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "diagram"]).code,
            "input.arguments"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "diagram", "draw", "a.mmd"]).code,
            "input.arguments"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "mcp", "extra"]).code,
            "input.arguments"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "mcp-config", "--json"]).code,
            "input.arguments"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "check", "notes.xyz"]).code,
            "input.format"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "check", "notes.md", "--format", "yaml"]).code,
            "input.format"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "check", "notes.md", "--format"]).code,
            "input.arguments"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "check", "notes.md", "--nope"]).code,
            "input.arguments"
        );
    }

    #[test]
    fn render_accepts_only_diagram_formats() {
        assert_eq!(
            parse_ok(&["LumaMark.exe", "diagram", "render", "-", "--format", "plantuml"]),
            Invocation::DiagramRender {
                path: OsString::from("-"),
                format: DiagramFormat::Plantuml,
                output: None,
                json: false,
            }
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "diagram", "render", "a.md"]).code,
            "input.format"
        );
        assert_eq!(
            parse_err(&["LumaMark.exe", "diagram", "render", "a.mmd", "--format", "markdown"]).code,
            "input.format"
        );
    }

    #[test]
    fn request_json_intent_survives_a_parse_failure() {
        let request = parse_with_locale(
            &os(&["LumaMark.exe", "check", "--json", "--nope"]),
            messages(),
        );
        assert!(request.json);
        assert!(request.invocation.is_err());
    }

    #[test]
    fn only_rendering_invocations_need_the_renderer() {
        assert!(!Invocation::Help.needs_renderer());
        assert!(!Invocation::Version.needs_renderer());
        assert!(!Invocation::McpConfig.needs_renderer());
        assert!(Invocation::Mcp.needs_renderer());
        assert!(parse_ok(&["LumaMark.exe", "check", "a.md"]).needs_renderer());
        assert!(parse_ok(&["LumaMark.exe", "diagram", "render", "a.mmd"]).needs_renderer());
    }

    #[test]
    fn chinese_arguments_errors_are_localized() {
        let request = parse_with_locale(
            &os(&["LumaMark.exe", "check"]),
            Messages::new(Locale::ZhCn),
        );
        let error = request.invocation.expect_err("usage error expected");
        assert_eq!(error.code, "input.arguments");
        assert!(error.message.contains("--help"));
        assert!(!error.message.contains("Use check"));
    }
}
