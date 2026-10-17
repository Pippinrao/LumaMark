> 语言：**中文** · [English](../../decisions/0025-markdown-html-pdf-export.md)

# ADR 0025：Markdown HTML/PDF 导出与 CLI/GUI 入口

状态：已接受。日期：2026-10-17。

## 背景

LumaMark 使用 CodeMirror 实时预览，DOM 只包含视口内容，不能直接打印完整文档。用户需要自包含 HTML 和 A4 PDF，其他 AI 工具也需要无需操作桌面 UI 的脚本入口。

应用已经内置 MathJax CHTML、官方 Mermaid、本地 PlantUML、DOMPurify 和隐藏 WebView automation host。导出必须复用这些成熟引擎，而不是再引入渲染器或打包浏览器。

## 决策

## 共享渲染器

- 冷路径使用 `markdown-it` + `markdown-it-task-lists` 渲染 Markdown，`highlight.js` 负责代码高亮。裸 HTML 保持关闭，与编辑器一致。
- 数学复用现有 MathJax 文档 Worker 和 CHTML；返回的样式表连同引用的 NewCM WOFF2 字体一起内联为 data URI。
- Mermaid/PlantUML 复用现有适配器；图表渲染器移动到 `services/diagrams`，automation 与 export 共用一份实现。
- 输出为单文件 HTML：内联 CSS、内联 SVG、图片 data URI、字体 data URI；无脚本、无外部字体请求。
- 图片通过现有 asset service 解析。本地/草稿图片由 Rust 授权读取；远程图片使用现有公网地址、禁重定向和大小限制。所有图片转为 data URI。
- 图表、数学或图片失败只生成可见占位和结构化 warning，不中断整篇导出。

## GUI

- 文件菜单与命令面板提供“导出为 HTML…”和“导出为 PDF…”。
- 导出对话框显示准备/渲染/写入/打印、warning、错误和重试。导出不修改正文、dirty、选区或撤销历史。
- GUI PDF 将同一份 HTML 注入离屏 print-only Shadow DOM 舞台。Windows 通过当前窗口的 `ICoreWebView2_7::PrintToPdf` 静默打印；macOS/Linux 首版使用系统打印对话框。

## CLI

- `LumaMark.exe export html|pdf <文件|-> [--output <文件>]` 属于现有 automation host 和 `--help` 手册；输出默认写到输入文件同目录。支持 `--title`、`--force`、`--json`。无 `--force` 时永不覆盖已有文件。
- CLI 启动与图表工具相同的隐藏 WebView。专用 `export-render.html` 拉取一个 job，运行共享渲染器；HTML 通过 `export_write_html` 写入，PDF 由 Rust 打印。
- `--json` 输出 `schemaVersion: 1` 导出报告，含 `ok`、`format`、`output`、`bytes`、`diagnostics`、`warnings`；人类可读 warning 写 stderr；退出码保持 0/1/2。
- CLI 默认值固定：Pandoc 数学、无编号、Physics 关闭、PlantUML 开启、浅色、A4；不读取用户设置。

## 安全

- 关闭裸 HTML；图表 SVG 经 DOMPurify；MathJax 保留 Safe handler 和 TeX 白名单。
- Markdown 链接校验拒绝 `javascript:`、`file:`、`data:`；仅图片 token 接受 `data:image/*`。
- 隐藏导出页只接收请求的 job，不扩大 Tauri capability，不向主窗口暴露导出内容。
- 限制：2 MiB Markdown 输入、单图 12 MiB、总资源 64 MiB、HTML 64 MiB。

## 被否方案

- **打包 Chromium/Playwright、wkhtmltopdf、WeasyPrint、Pandoc/LaTeX**：增加第二运行时或安装包体积；ADR 0024 已移除打包浏览器。
- **Typst/printpdf 作为第二排版引擎**：会重复 HTML/CSS、数学、图表、代码高亮逻辑并产生漂移。
- **jsPDF/html2canvas**：栅格输出丢失可搜索文本和字体质量。
- **抓取 CodeMirror DOM**：只含视口内容和 WYSIWYG 装饰，不是完整文档。
- **本次加入 MCP 导出工具**：首版先提供 CLI；MCP 文件写入需要单独的安全决策。

## 影响

- 新增懒加载前端 chunk（`renderExportDocument`）和三个运行时依赖。
- 仅 Windows 支持静默直出 PDF；其他平台走系统打印对话框。
- `services/diagrams/diagramRenderer.ts` 成为共享图表渲染器；`app/automation/diagramEngines.ts` 保留兼容 re-export。
- 版本和帮助文本随二进制更新；`--help` 仍是 CLI 唯一手册。

## 复核条件

如果 WebView2 PrintToPdf 无法可靠打印隐藏窗口或主窗口舞台、导出 chunk 超出 Web 构建预算、macOS/Linux 需要静默 PDF，或需要 MCP 导出工具，重新评估本决策。
