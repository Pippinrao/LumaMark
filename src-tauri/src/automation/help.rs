//! The complete `--help` reference.
//!
//! LumaMark returns CLI/MCP usage through this text instead of shipping a
//! separate manual, so the renderer is driven by the same command/option tables
//! and constants the parser uses.

use crate::automation::invocation::{OptionSpec, COMMANDS, OPTIONS};
use crate::automation::messages::{Locale, Messages};
use crate::automation::report::{
    DIAGNOSTIC_CODES, DIAGRAM_TIMEOUT_MS, EXIT_DIAGRAM_ERROR, EXIT_OK, EXIT_USAGE_ERROR,
    MAX_DIAGRAMS, MAX_SOURCE_BYTES,
};

/// Product version, taken from the crate so it always matches the binary.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub fn help_text(locale: Locale) -> String {
    let messages = Messages::new(locale);
    let text = messages.text();
    let mut out = String::new();

    out.push_str(&format!("LumaMark {} - {}\n\n", version(), text.tagline));

    section(
        &mut out,
        text.usage_title,
        &COMMANDS
            .iter()
            .map(|command| format!("  LumaMark.exe {}", command.usage))
            .collect::<Vec<_>>(),
    );

    let command_width = longest(
        COMMANDS
            .iter()
            .map(|command| command.name.to_owned())
            .collect(),
    );
    section(
        &mut out,
        text.commands_title,
        &COMMANDS
            .iter()
            .map(|command| {
                padded(
                    command.name,
                    command_width,
                    messages.command_summary(command.id),
                )
            })
            .collect::<Vec<_>>(),
    );

    let options = OPTIONS
        .iter()
        .map(|option| (option_display(option), messages.option_summary(option.id)))
        .collect::<Vec<_>>();
    let option_width = longest(options.iter().map(|(display, _)| display.clone()).collect());
    section(
        &mut out,
        text.options_title,
        &options
            .iter()
            .map(|(display, summary)| padded(display, option_width, summary))
            .collect::<Vec<_>>(),
    );

    section(&mut out, text.input_title, text.input_notes);

    let mut output_lines: Vec<String> = text.output_notes.iter().map(|l| (*l).to_owned()).collect();
    output_lines.push(messages.exit_codes_note(
        EXIT_OK,
        EXIT_DIAGRAM_ERROR,
        EXIT_USAGE_ERROR,
    ));
    section(&mut out, text.output_title, &output_lines);

    let mut report_lines: Vec<String> = text.report_notes.iter().map(|l| (*l).to_owned()).collect();
    report_lines.push(messages.report_codes_note(DIAGNOSTIC_CODES));
    section(&mut out, text.report_title, &report_lines);

    section(&mut out, text.mcp_title, text.mcp_notes);

    section(
        &mut out,
        text.limits_title,
        &[messages.limits_note(
            MAX_SOURCE_BYTES / (1024 * 1024),
            MAX_DIAGRAMS,
            DIAGRAM_TIMEOUT_MS / 1000,
        )],
    );

    section(&mut out, text.environment_title, text.environment_notes);
    section(
        &mut out,
        text.troubleshooting_title,
        text.troubleshooting_notes,
    );

    out
}

fn option_display(option: &OptionSpec) -> String {
    let mut display = option.long.to_owned();
    if let Some(short) = option.short {
        display.push_str(", ");
        display.push_str(short);
    }
    if let Some(value) = option.value {
        display.push(' ');
        display.push_str(value);
    }
    display
}

fn longest(values: Vec<String>) -> usize {
    values.iter().map(|value| value.chars().count()).max().unwrap_or(0)
}

fn padded(label: &str, width: usize, summary: &str) -> String {
    format!("  {label:width$}  {summary}")
}

fn section(out: &mut String, title: &str, lines: &[impl AsRef<str>]) {
    out.push_str(title);
    out.push('\n');
    for line in lines {
        out.push_str(line.as_ref());
        out.push('\n');
    }
    out.push('\n');
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::invocation::{CommandId, OptionId};
    use crate::automation::messages::LANGUAGE_ENV;

    fn both() -> [(Locale, String); 2] {
        [
            (Locale::En, help_text(Locale::En)),
            (Locale::ZhCn, help_text(Locale::ZhCn)),
        ]
    }

    #[test]
    fn help_documents_every_command_and_option_in_both_languages() {
        for (locale, text) in both() {
            for command in COMMANDS {
                assert!(
                    text.contains(command.name),
                    "{locale:?} help is missing command `{}`",
                    command.name
                );
                assert!(
                    text.contains(command.usage),
                    "{locale:?} help is missing the usage line of `{}`",
                    command.name
                );
            }
            for option in OPTIONS {
                assert!(
                    text.contains(option.long),
                    "{locale:?} help is missing option `{}`",
                    option.long
                );
                if let Some(short) = option.short {
                    assert!(
                        text.contains(short),
                        "{locale:?} help is missing short option `{short}`"
                    );
                }
            }
        }
    }

    #[test]
    fn help_documents_the_machine_contracts_in_both_languages() {
        for (locale, text) in both() {
            assert!(text.contains(&format!("LumaMark {}", version())));
            assert!(text.contains("schemaVersion"), "{locale:?} help must document the report schema");
            for code in DIAGNOSTIC_CODES {
                assert!(text.contains(code), "{locale:?} help is missing diagnostic `{code}`");
            }
            for tool in ["check_diagrams", "render_diagram"] {
                assert!(text.contains(tool), "{locale:?} help is missing tool `{tool}`");
            }
            assert!(text.contains("mcpServers"));
            assert!(text.contains(LANGUAGE_ENV));
            assert!(text.contains("zh-CN"));
            for limit in [
                (MAX_SOURCE_BYTES / (1024 * 1024)).to_string(),
                MAX_DIAGRAMS.to_string(),
                (DIAGRAM_TIMEOUT_MS / 1000).to_string(),
            ] {
                assert!(text.contains(&limit), "{locale:?} help is missing limit `{limit}`");
            }
            for exit_code in [EXIT_OK, EXIT_DIAGRAM_ERROR, EXIT_USAGE_ERROR] {
                assert!(
                    text.contains(&exit_code.to_string()),
                    "{locale:?} help is missing exit code `{exit_code}`"
                );
            }
            for extension in [".md", ".mmd", ".puml"] {
                assert!(
                    text.contains(extension),
                    "{locale:?} help is missing extension `{extension}`"
                );
            }
        }
    }

    #[test]
    fn help_sections_and_templates_are_fully_rendered() {
        for (locale, text) in both() {
            let messages = Messages::new(locale);
            for title in [
                messages.text().usage_title,
                messages.text().commands_title,
                messages.text().options_title,
                messages.text().input_title,
                messages.text().output_title,
                messages.text().report_title,
                messages.text().mcp_title,
                messages.text().limits_title,
                messages.text().environment_title,
                messages.text().troubleshooting_title,
            ] {
                assert!(text.contains(title), "{locale:?} help is missing section `{title}`");
            }
            for placeholder in ["{codes}", "{ok}", "{diagram}", "{error}", "{mib}", "{seconds}", "{detail}"] {
                assert!(
                    !text.contains(placeholder),
                    "{locale:?} help still contains the placeholder {placeholder}"
                );
            }
            assert!(!text.contains("\n\n\n"), "{locale:?} help has an empty section gap");
        }
    }

    #[test]
    fn help_explains_that_no_separate_manual_or_runtime_exists() {
        for (_, text) in both() {
            assert!(text.contains("MCP"));
            assert!(text.contains("--help"));
        }
    }

    #[test]
    fn every_summary_table_entry_is_reachable_from_a_documented_id() {
        for id in CommandId::ALL {
            assert!(COMMANDS.iter().any(|command| command.id == *id));
        }
        for id in OptionId::ALL {
            assert!(OPTIONS.iter().any(|option| option.id == *id));
        }
    }

    #[test]
    fn option_display_covers_short_forms_and_values() {
        let display = option_display(
            OPTIONS
                .iter()
                .find(|option| option.long == "--output")
                .expect("--output must stay documented"),
        );

        assert_eq!(display, "--output, -o <file.svg>");
    }
}
