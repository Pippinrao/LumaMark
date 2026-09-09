const en = {
  help: `LumaMark automation (Node >=22.18; local Chromium required for rendering)

  node tools/automation/cli.ts check <file|-> [--format markdown|mermaid|plantuml] [--json]
  node tools/automation/cli.ts diagram render <file|-> [--format mermaid|plantuml] [--output file.svg] [--json]
  node tools/automation/cli.ts mcp
  node tools/automation/cli.ts mcp-config

Use - for stdin. File formats: .md/.markdown, .mmd/.mermaid, .puml/.plantuml.
check defaults stdin to Markdown and actually renders every supported fence.
render prints SVG, or writes a new file with --output (existing files are never overwritten).
--json prints one schemaVersion=1 report. Exit codes: 0 success, 1 diagram errors, 2 input/runtime errors.
mcp serves check_diagrams and render_diagram over stdio. mcp-config prints absolute-path configuration.
No PATH entry or skill is required. Setup: pnpm install; pnpm exec playwright install chromium
Set LUMAMARK_TOOLS_LANGUAGE=zh-CN for Chinese help and tool-owned messages.
`,
  tooLarge: (bytes: number) => `Source exceeds ${bytes} UTF-8 bytes.`,
  tooMany: (count: number) => `At most ${count} diagrams are accepted per request.`,
  format: 'Specify --format markdown, mermaid, or plantuml.',
  renderFormat: 'Render accepts one Mermaid or PlantUML diagram.',
  arguments: 'Use check <file|->, diagram render <file|->, mcp, or mcp-config. See --help.',
  mcpArguments: 'mcp and mcp-config accept no additional arguments.',
  checked: (count: number, output?: string) => `Checked ${count} diagram(s).${output ? ` SVG: ${output}` : ''}`,
  closed: 'Renderer is closed.',
  empty: 'Diagram source is empty.',
  unavailable: (detail: string) => `Local Chromium could not start. Run pnpm exec playwright install chromium. ${detail}`,
  timeout: (milliseconds: number) => `Diagram rendering exceeded ${milliseconds} milliseconds.`,
  outside: 'Resource is outside the bundled engine assets.',
  unavailableAsset: 'Unavailable local asset',
  networkBlocked: 'The diagram requested a network resource; only bundled local assets are available.',
  sourceDescription: 'Markdown or diagram source text; UTF-8 size is also limited to 2 MiB.',
  checkDescription: 'Check Mermaid/PlantUML syntax and renderability locally. Accept a Markdown document or one diagram; return diagnostics with one-based Markdown locations. No network or filesystem writes.',
  renderDescription: 'Render one Mermaid or PlantUML diagram locally to sanitized SVG text. Returns SVG or diagnostics; never writes files.',
  browser: {
    loadFailed: 'Could not load the local PlantUML Graphviz engine.',
    noSvg: 'The engine returned no SVG.',
  },
};

const zh: typeof en = {
  help: `LumaMark 自动化工具（Node >=22.18，渲染需要本地 Chromium）

  node tools/automation/cli.ts check <文件|-> [--format markdown|mermaid|plantuml] [--json]
  node tools/automation/cli.ts diagram render <文件|-> [--format mermaid|plantuml] [--output 文件.svg] [--json]
  node tools/automation/cli.ts mcp
  node tools/automation/cli.ts mcp-config

- 表示标准输入。支持 .md/.markdown、.mmd/.mermaid、.puml/.plantuml。
check 默认按 Markdown 读取标准输入，对每个支持的围栏实际试渲染。
render 输出 SVG，也可通过 --output 写入新文件（不会覆盖已有文件）。
--json 输出单个 schemaVersion=1 报告。退出码：0 成功，1 图表错误，2 输入/运行环境错误。
mcp 通过 stdio 提供 check_diagrams 和 render_diagram；mcp-config 输出使用绝对路径的配置。
无需配置 PATH 或安装 skill。准备：pnpm install；pnpm exec playwright install chromium
LUMAMARK_TOOLS_LANGUAGE=zh-CN 可选择中文帮助和工具自身的提示。
`,
  tooLarge: (bytes) => `源码超过 ${bytes} 个 UTF-8 字节。`,
  tooMany: (count) => `每次请求最多接受 ${count} 个图表。`,
  format: '请指定 --format markdown、mermaid 或 plantuml。',
  renderFormat: 'render 只接受一个 Mermaid 或 PlantUML 图表。',
  arguments: '请使用 check <文件|->、diagram render <文件|->、mcp 或 mcp-config，参见 --help。',
  mcpArguments: 'mcp 和 mcp-config 不接受其他参数。',
  checked: (count, output) => `已检查 ${count} 个图表。${output ? ` SVG：${output}` : ''}`,
  closed: '渲染器已关闭。',
  empty: '图表源码为空。',
  unavailable: (detail) => `本地 Chromium 无法启动。请运行 pnpm exec playwright install chromium。${detail}`,
  timeout: (milliseconds) => `图表渲染超过 ${milliseconds} 毫秒。`,
  outside: '资源不在内置图表引擎资源范围内。',
  unavailableAsset: '本地资源不可用',
  networkBlocked: '图表请求了网络资源；仅允许使用内置的本地资源。',
  sourceDescription: 'Markdown 或图表源码，同时限制为最多 2 MiB UTF-8 字节。',
  checkDescription: '在本地检测 Mermaid/PlantUML 语法与可渲染性。接受 Markdown 文档或单个图表，返回行号从 1 开始的 Markdown 诊断。不访问网络、不写文件。',
  renderDescription: '在本地将一个 Mermaid 或 PlantUML 图表渲染为经过清理的 SVG 文本，返回 SVG 或诊断，不写文件。',
  browser: { loadFailed: '无法加载本地 PlantUML Graphviz 引擎。', noSvg: '引擎未返回 SVG。' },
};

export const messages = process.env.LUMAMARK_TOOLS_LANGUAGE === 'zh-CN' ? zh : en;
