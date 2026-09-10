//! Tool-owned text for the bundled automation host.
//!
//! The CLI, the MCP server and the renderer page all read their sentences from
//! here, so `--help` stays the single usage reference and no separate manual can
//! drift from the implementation. Diagnostic `code` values are language-neutral;
//! only the human sentences change.

use crate::automation::invocation::{CommandId, OptionId};

/// Environment variable that selects Chinese tool text.
pub const LANGUAGE_ENV: &str = "LUMAMARK_TOOLS_LANGUAGE";
pub const LANGUAGE_ZH_CN: &str = "zh-CN";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    En,
    ZhCn,
}

impl Locale {
    pub fn from_env_value(value: Option<&str>) -> Self {
        match value {
            Some(LANGUAGE_ZH_CN) => Self::ZhCn,
            _ => Self::En,
        }
    }

    pub fn from_environment() -> Self {
        Self::from_env_value(std::env::var(LANGUAGE_ENV).ok().as_deref())
    }
}

/// Static, language-specific sentences.
#[derive(Clone, Copy)]
pub struct Text {
    pub tagline: &'static str,
    pub usage_title: &'static str,
    pub commands_title: &'static str,
    pub options_title: &'static str,
    pub input_title: &'static str,
    pub output_title: &'static str,
    pub report_title: &'static str,
    pub mcp_title: &'static str,
    pub limits_title: &'static str,
    pub environment_title: &'static str,
    pub troubleshooting_title: &'static str,
    pub input_notes: &'static [&'static str],
    pub output_notes: &'static [&'static str],
    pub report_notes: &'static [&'static str],
    pub mcp_notes: &'static [&'static str],
    pub environment_notes: &'static [&'static str],
    pub troubleshooting_notes: &'static [&'static str],
    pub command_summaries: [&'static str; CommandId::COUNT],
    pub option_summaries: [&'static str; OptionId::COUNT],
    pub report_codes: &'static str,
    pub exit_codes: &'static str,
    pub limits: &'static str,
    pub too_large: &'static str,
    pub too_many: &'static str,
    pub checked: &'static str,
    pub checked_with_output: &'static str,
    pub timeout: &'static str,
    pub unavailable: &'static str,
    pub ready_timeout: &'static str,
    pub invalid_result: &'static str,
    pub read_failed: &'static str,
    pub write_failed: &'static str,
    pub stdin_failed: &'static str,
    pub output_exists: &'static str,
    pub arguments: &'static str,
    pub mcp_arguments: &'static str,
    pub mcp_instructions: &'static str,
    pub format: &'static str,
    pub render_format: &'static str,
    pub unknown_format_value: &'static str,
    pub empty: &'static str,
    pub source_description: &'static str,
    pub check_description: &'static str,
    pub render_description: &'static str,
    pub browser_load_failed: &'static str,
    pub browser_no_svg: &'static str,
}

const EN: Text = Text {
    tagline: "local Mermaid and PlantUML checking and rendering",
    usage_title: "USAGE",
    commands_title: "COMMANDS",
    options_title: "OPTIONS",
    input_title: "INPUT",
    output_title: "OUTPUT",
    report_title: "REPORT",
    mcp_title: "MCP",
    limits_title: "LIMITS",
    environment_title: "ENVIRONMENT",
    troubleshooting_title: "TROUBLESHOOTING",
    input_notes: &[
        "  -             reads standard input. check defaults stdin to markdown; raw stdin needs --format.",
        "  Extensions    .md/.markdown = markdown, .mmd/.mermaid = mermaid, .puml/.plantuml = plantuml.",
        "                Any other name needs --format.",
        "  Fences        Both ``` and ~~~ fences are recognized; only mermaid and plantuml fences are checked.",
        "                Other languages are ignored; a document without a supported fence succeeds with checked 0.",
        "  Editor        A path given without a command still opens the desktop editor.",
    ],
    output_notes: &[
        "  check         Prints \"Checked N diagram(s).\" on stdout; diagnostics go to stderr.",
        "  render        Prints SVG on stdout, or writes the --output file and prints its path.",
        "  --json        stdout receives exactly one JSON report; diagnostics stay inside it.",
        "  Streams       Machine consumers should read stdout only and treat stderr as human text.",
    ],
    report_notes: &[
        "  schemaVersion   Always 1.",
        "  ok              false when a diagram or the runtime failed.",
        "  checked         Number of diagrams that were actually rendered.",
        "  diagnostics[]   code, message, format, blockLine (opening fence line) and line (one-based",
        "                  error line mapped back to the document; falls back to the first diagram line).",
        "  svg             Present for a successful render.",
        "  output          Present when --output wrote a file.",
    ],
    mcp_notes: &[
        "  Start the stdio server:            LumaMark.exe mcp",
        "  Host configuration for this build: LumaMark.exe mcp-config",
        "    {\"mcpServers\":{\"lumamark\":{\"command\":\"<absolute path to LumaMark.exe>\",\"args\":[\"mcp\"]}}}",
        "  Tools:",
        "    check_diagrams  { source, format?: \"markdown\" | \"mermaid\" | \"plantuml\" } -> the same check report",
        "    render_diagram  { source, format: \"mermaid\" | \"plantuml\" }               -> the same report with svg",
        "  Failures set isError and return the diagnostics. stdout carries protocol messages only, the",
        "  server opens no network listener, and it never reads or writes user files.",
    ],
    environment_notes: &[
        "  LUMAMARK_TOOLS_LANGUAGE=zh-CN   Chinese help, messages and MCP tool descriptions. Default: English.",
    ],
    troubleshooting_notes: &[
        "  No window appears: rendering runs in a hidden WebView window. It needs an interactive desktop",
        "  session and does not work in a headless service or session 0.",
        "  renderer.unavailable  The WebView runtime is missing or the renderer page failed to load.",
        "                        Reinstall LumaMark so the WebView2 runtime is present, then retry.",
        "  renderer.timeout      One diagram exceeded the 30 second deadline; simplify or split it.",
        "  input.format          Add --format for unknown extensions or raw stdin.",
        "  Output already exists: choose a new path; existing files are never overwritten.",
        "  Startup cost: every invocation starts the renderer (a few hundred milliseconds). Prefer one",
        "  long-lived MCP server over repeated short-lived CLI calls.",
        "  The engines ship with the app: updating LumaMark updates them, and no PATH entry, Node",
        "  install or browser download is ever required.",
    ],
    command_summaries: [
        "Check a Markdown document's Mermaid/PlantUML fences, or one diagram, by rendering it locally.",
        "Render exactly one Mermaid or PlantUML diagram to sanitized SVG.",
        "Serve check_diagrams and render_diagram over MCP stdio for an agent host.",
        "Print the MCP host configuration for this executable as JSON.",
        "Print this complete usage reference and exit.",
        "Print the version and exit.",
    ],
    option_summaries: [
        "check: markdown (default), mermaid or plantuml. render: mermaid or plantuml.",
        "render only: write the SVG to a new file. Existing files are never overwritten.",
        "Print one schemaVersion=1 JSON report on stdout instead of human-readable text.",
        "Print this complete usage reference and exit.",
        "Print the version and exit.",
        "Treat every following argument as a file path, not an option.",
    ],
    report_codes: "  Diagnostic codes: {codes}.",
    exit_codes: "  Exit code {ok} = success, {diagram} = diagram errors, {error} = argument, file, runtime, asset or timeout errors.",
    limits: "  {mib} MiB of UTF-8 source per request; {diagrams} diagrams per Markdown request; {seconds} seconds per diagram.",
    too_large: "Source exceeds {bytes} UTF-8 bytes.",
    too_many: "At most {count} diagrams are accepted per request.",
    checked: "Checked {count} diagram(s).",
    checked_with_output: "Checked {count} diagram(s). SVG: {output}",
    timeout: "Diagram rendering exceeded {milliseconds} milliseconds.",
    unavailable: "The local diagram renderer is unavailable. {detail}",
    ready_timeout: "The hidden renderer page did not become ready in time.",
    invalid_result: "The renderer returned an unusable result.",
    read_failed: "The source file could not be read. {detail}",
    write_failed: "The output file could not be written. {detail}",
    stdin_failed: "Standard input could not be read. {detail}",
    output_exists: "The output file already exists and is never overwritten: {path}",
    arguments: "Use check <file|->, diagram render <file|->, mcp, or mcp-config. Run --help for the complete reference.",
    mcp_arguments: "mcp and mcp-config accept no other arguments.",
    mcp_instructions: "Check and render Mermaid/PlantUML locally with LumaMark. Run `LumaMark.exe --help` for the complete CLI and MCP reference.",
    format: "Specify --format markdown, mermaid, or plantuml.",
    render_format: "Render accepts exactly one Mermaid or PlantUML diagram; --format markdown is not valid here.",
    unknown_format_value: "Unsupported --format value: {value}",
    empty: "Diagram source is empty.",
    source_description: "Markdown or diagram source text; UTF-8 size is limited to {mib} MiB.",
    check_description: "Check Mermaid/PlantUML syntax and renderability locally. Accept a Markdown document or one diagram; return diagnostics with one-based Markdown locations. No network or filesystem writes.",
    render_description: "Render one Mermaid or PlantUML diagram locally to sanitized SVG text. Returns SVG or diagnostics; never writes files.",
    browser_load_failed: "Could not load the local PlantUML Graphviz engine.",
    browser_no_svg: "The engine returned no SVG.",
};

const ZH_CN: Text = Text {
    tagline: "本地 Mermaid 与 PlantUML 检查与渲染",
    usage_title: "用法",
    commands_title: "命令",
    options_title: "选项",
    input_title: "输入",
    output_title: "输出",
    report_title: "报告",
    mcp_title: "MCP",
    limits_title: "限制",
    environment_title: "环境变量",
    troubleshooting_title: "故障处理",
    input_notes: &[
        "  -             读取标准输入。check 默认按 Markdown 处理；原始 stdin 需要 --format。",
        "  扩展名        .md/.markdown = markdown，.mmd/.mermaid = mermaid，.puml/.plantuml = plantuml。",
        "                其他名称必须提供 --format。",
        "  围栏          ``` 与 ~~~ 围栏都会识别；只检查 mermaid 与 plantuml 围栏。",
        "                其他语言忽略；没有受支持围栏的文档返回成功且 checked 为 0。",
        "  编辑器        不带子命令直接给出路径，仍会打开桌面编辑器。",
    ],
    output_notes: &[
        "  check         在 stdout 打印「已检查 N 个图表。」；诊断写入 stderr。",
        "  render        在 stdout 打印 SVG，或写入 --output 指定的新文件并打印其路径。",
        "  --json        stdout 只输出一个 JSON 报告，诊断包含在报告内部。",
        "  输出流        机器读取请只解析 stdout，把 stderr 当作人类可读文本。",
    ],
    report_notes: &[
        "  schemaVersion   恒为 1。",
        "  ok              图表或运行环境失败时为 false。",
        "  checked         实际完成渲染的图表数量。",
        "  diagnostics[]   含 code、message、format、blockLine（围栏起始行）与 line（映射回文档的、",
        "                  从 1 开始的错误行；引擎没有精确位置时回退到图表首行）。",
        "  svg             渲染成功时存在。",
        "  output          使用 --output 写入文件时存在。",
    ],
    mcp_notes: &[
        "  启动 stdio 服务：            LumaMark.exe mcp",
        "  当前构建的宿主配置：         LumaMark.exe mcp-config",
        "    {\"mcpServers\":{\"lumamark\":{\"command\":\"<LumaMark.exe 绝对路径>\",\"args\":[\"mcp\"]}}}",
        "  工具：",
        "    check_diagrams  { source, format?: \"markdown\" | \"mermaid\" | \"plantuml\" } -> 相同的检查报告",
        "    render_diagram  { source, format: \"mermaid\" | \"plantuml\" }               -> 相同的报告并含 svg",
        "  失败会置 isError 并返回诊断。stdout 只承载协议消息，服务不监听网络，也不读写用户文件。",
    ],
    environment_notes: &[
        "  LUMAMARK_TOOLS_LANGUAGE=zh-CN   中文帮助、提示与 MCP 工具描述。默认英文。",
    ],
    troubleshooting_notes: &[
        "  看不到窗口：渲染运行在隐藏的 WebView 窗口中，需要交互式桌面会话，在无桌面服务或",
        "  session 0 中不可用。",
        "  renderer.unavailable  缺少 WebView 运行时，或渲染页面加载失败。重新安装 LumaMark 以补齐",
        "                        WebView2 运行时后重试。",
        "  renderer.timeout      单个图表超过 30 秒上限；请简化或拆分。",
        "  input.format          未知扩展名或原始 stdin 需要补充 --format。",
        "  输出文件已存在：换一个新路径；已有文件永远不会被覆盖。",
        "  启动开销：每次调用都会启动渲染器（数百毫秒）。建议保持一个长驻 MCP 服务，而不是反复",
        "  启动短命的 CLI 进程。",
        "  引擎随应用一起分发：升级 LumaMark 即升级引擎，无需 PATH 配置、无需安装 Node、也无需",
        "  下载浏览器。",
    ],
    command_summaries: [
        "在本地实际渲染，检查 Markdown 中的 Mermaid/PlantUML 围栏，或检查单个图表。",
        "把恰好一个 Mermaid 或 PlantUML 图表渲染为已净化的 SVG。",
        "通过 MCP stdio 向 agent 宿主提供 check_diagrams 与 render_diagram。",
        "输出当前可执行文件的 MCP 宿主配置（JSON）。",
        "输出这份完整用法说明并退出。",
        "输出版本号并退出。",
    ],
    option_summaries: [
        "check：markdown（默认）、mermaid 或 plantuml。render：mermaid 或 plantuml。",
        "仅 render：把 SVG 写入新文件。永不覆盖已有文件。",
        "在 stdout 输出一个 schemaVersion=1 的 JSON 报告，替代人类可读文本。",
        "输出这份完整用法说明并退出。",
        "输出版本号并退出。",
        "其后的所有参数都按文件路径处理，不再当作选项。",
    ],
    report_codes: "  诊断码：{codes}。",
    exit_codes: "  退出码 {ok} = 成功，{diagram} = 图表错误，{error} = 参数、文件、运行环境、资源或超时错误。",
    limits: "  每次请求最多 {mib} MiB UTF-8 源码；每个 Markdown 请求最多 {diagrams} 个图表；每个图表 {seconds} 秒。",
    too_large: "源码超过 {bytes} 个 UTF-8 字节。",
    too_many: "每次请求最多接受 {count} 个图表。",
    checked: "已检查 {count} 个图表。",
    checked_with_output: "已检查 {count} 个图表。SVG：{output}",
    timeout: "图表渲染超过 {milliseconds} 毫秒。",
    unavailable: "本地图表渲染器不可用。{detail}",
    ready_timeout: "隐藏的渲染页面未能在限定时间内就绪。",
    invalid_result: "渲染器返回了不可用的结果。",
    read_failed: "无法读取源码文件。{detail}",
    write_failed: "无法写入输出文件。{detail}",
    stdin_failed: "无法读取标准输入。{detail}",
    output_exists: "输出文件已存在，本工具永不覆盖：{path}",
    arguments: "请使用 check <文件|->、diagram render <文件|->、mcp 或 mcp-config；完整说明见 --help。",
    mcp_arguments: "mcp 与 mcp-config 不接受其他参数。",
    mcp_instructions: "使用 LumaMark 在本地检查与渲染 Mermaid/PlantUML。完整说明请运行 `LumaMark.exe --help`。",
    format: "请指定 --format markdown、mermaid 或 plantuml。",
    render_format: "render 只接受一个 Mermaid 或 PlantUML 图表；此处不能用 --format markdown。",
    unknown_format_value: "不支持的 --format 取值：{value}",
    empty: "图表源码为空。",
    source_description: "Markdown 或图表源码；UTF-8 大小限制为 {mib} MiB。",
    check_description: "在本地检测 Mermaid/PlantUML 语法与可渲染性。接受 Markdown 文档或单个图表，返回行号从 1 开始的 Markdown 诊断。不访问网络、不写文件。",
    render_description: "在本地将一个 Mermaid 或 PlantUML 图表渲染为经过净化的 SVG 文本；返回 SVG 或诊断，不写文件。",
    browser_load_failed: "无法加载本地 PlantUML Graphviz 引擎。",
    browser_no_svg: "引擎未返回 SVG。",
};

/// Language-bound tool text.
#[derive(Clone, Copy)]
pub struct Messages {
    locale: Locale,
    text: &'static Text,
}

impl Messages {
    pub fn new(locale: Locale) -> Self {
        Self {
            locale,
            text: match locale {
                Locale::En => &EN,
                Locale::ZhCn => &ZH_CN,
            },
        }
    }

    pub fn locale(&self) -> Locale {
        self.locale
    }

    pub fn text(&self) -> &'static Text {
        self.text
    }

    pub fn command_summary(&self, command: CommandId) -> &'static str {
        self.text.command_summaries[command.index()]
    }

    pub fn option_summary(&self, option: OptionId) -> &'static str {
        self.text.option_summaries[option.index()]
    }

    pub fn report_codes_note(&self, codes: &[&str]) -> String {
        self.text.report_codes.replace("{codes}", &codes.join(", "))
    }

    pub fn exit_codes_note(&self, ok: i32, diagram: i32, error: i32) -> String {
        self.text
            .exit_codes
            .replace("{ok}", &ok.to_string())
            .replace("{diagram}", &diagram.to_string())
            .replace("{error}", &error.to_string())
    }

    pub fn limits_note(&self, mib: usize, diagrams: u32, seconds: u64) -> String {
        self.text
            .limits
            .replace("{mib}", &mib.to_string())
            .replace("{diagrams}", &diagrams.to_string())
            .replace("{seconds}", &seconds.to_string())
    }

    pub fn too_large(&self, bytes: usize) -> String {
        self.text.too_large.replace("{bytes}", &bytes.to_string())
    }

    pub fn too_many(&self, count: u32) -> String {
        self.text.too_many.replace("{count}", &count.to_string())
    }

    pub fn checked(&self, count: u32, output: Option<&str>) -> String {
        match output {
            Some(output) => self
                .text
                .checked_with_output
                .replace("{count}", &count.to_string())
                .replace("{output}", output),
            None => self.text.checked.replace("{count}", &count.to_string()),
        }
    }

    pub fn timeout(&self, milliseconds: u64) -> String {
        self.text
            .timeout
            .replace("{milliseconds}", &milliseconds.to_string())
    }

    pub fn unavailable(&self, detail: &str) -> String {
        self.text.unavailable.replace("{detail}", detail)
    }

    pub fn ready_timeout(&self) -> &'static str {
        self.text.ready_timeout
    }

    pub fn read_failed(&self, detail: &str) -> String {
        self.text.read_failed.replace("{detail}", detail)
    }

    pub fn write_failed(&self, detail: &str) -> String {
        self.text.write_failed.replace("{detail}", detail)
    }

    pub fn stdin_failed(&self, detail: &str) -> String {
        self.text.stdin_failed.replace("{detail}", detail)
    }

    pub fn output_exists(&self, path: &str) -> String {
        self.text.output_exists.replace("{path}", path)
    }

    pub fn unknown_format_value(&self, value: &str) -> String {
        self.text
            .unknown_format_value
            .replace("{value}", value)
    }

    pub fn source_description(&self, mib: usize) -> String {
        self.text
            .source_description
            .replace("{mib}", &mib.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_selection_defaults_to_english() {
        assert_eq!(Locale::from_env_value(None), Locale::En);
        assert_eq!(Locale::from_env_value(Some("en")), Locale::En);
        assert_eq!(Locale::from_env_value(Some("zh")), Locale::En);
        assert_eq!(Locale::from_env_value(Some("zh-CN")), Locale::ZhCn);
    }

    #[test]
    fn every_command_and_option_has_a_summary_in_both_languages() {
        let en = Messages::new(Locale::En);
        let zh = Messages::new(Locale::ZhCn);

        for command in CommandId::ALL {
            assert!(!en.command_summary(*command).is_empty());
            assert!(!zh.command_summary(*command).is_empty());
        }
        for option in OptionId::ALL {
            assert!(!en.option_summary(*option).is_empty());
            assert!(!zh.option_summary(*option).is_empty());
        }
    }

    #[test]
    fn formatted_sentences_interpolate_their_placeholders() {
        let en = Messages::new(Locale::En);
        let zh = Messages::new(Locale::ZhCn);

        assert_eq!(en.checked(3, None), "Checked 3 diagram(s).");
        assert_eq!(en.checked(3, Some("a.svg")), "Checked 3 diagram(s). SVG: a.svg");
        assert_eq!(zh.checked(3, Some("a.svg")), "已检查 3 个图表。SVG：a.svg");
        assert!(en.limits_note(2, 100, 30).contains('2'));
        assert!(en.limits_note(2, 100, 30).contains("100"));
        assert!(en.limits_note(2, 100, 30).contains("30"));
        assert!(zh.limits_note(2, 100, 30).contains("2"));
        assert!(en.report_codes_note(&["a.b", "c.d"]).contains("a.b, c.d"));
        for sentence in [
            en.too_large(7),
            en.too_many(7),
            en.timeout(7),
            en.unavailable("detail"),
            en.ready_timeout().to_owned(),
            en.read_failed("detail"),
            en.stdin_failed("detail"),
            en.output_exists("a.svg"),
            en.unknown_format_value("yaml"),
            en.source_description(2),
            en.exit_codes_note(0, 1, 2),
        ] {
            assert!(!sentence.contains('{'), "unfilled placeholder in {sentence}");
        }
    }
}
