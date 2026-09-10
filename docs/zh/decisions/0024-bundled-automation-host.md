> 语言：**中文** · [English](../../decisions/0024-bundled-automation-host.md)

# ADR 0024：自动化宿主并入桌面可执行文件

状态：已接受。日期：2026-09-11。

## 背景

[ADR 0023](0023-agent-cli-and-mcp.md) 把 Mermaid/PlantUML 检查与 MCP 服务实现为仓库内的 Node 工具（`tools/automation/`），运行需要 Node >= 22.18、仓库开发依赖以及下载 Playwright Chromium。桌面安装包不提供该工具，用户与 agent 必须另外安装并维护第二套运行时，并把宿主配置指向仓库路径。

项目负责人要求该能力随主进程一起打包，而不是独立安装，同时不要把它做成一个很重的功能。

## 决策

- 由桌面可执行文件自身提供该能力：`LumaMark.exe check`、`LumaMark.exe diagram render`、`LumaMark.exe mcp`、`LumaMark.exe mcp-config`。`main` 在编辑器启动前识别这些首参；其他调用仍打开编辑器。
- 渲染复用**应用自带的 WebView**，通过一个隐藏窗口（`automation-render.html`）完成。不再涉及 Node 运行时，也不下载浏览器，因此安装包不新增运行时依赖，体积几乎不变。
- 宿主页复用编辑器引擎：mermaid 走 `renderWithMermaid`/`safeMermaidConfig`，PlantUML 走 `renderPlantUmlOnThread`，导出 SVG 用 `dompurify` 净化；围栏提取继续使用 `@lezer/markdown`，因此 Markdown 行号映射与编辑器同一套代码。
- 外层契约归 Rust：参数解析、退出码、`schemaVersion: 1` 报告外壳、限制、超时、文件输出，以及基于官方 `rmcp` SDK 的 stdio MCP 服务。图表语义归页面，页面返回完整报告；Rust 校验 `schemaVersion`，不符合即按 `automation.failed` 处理。
- 隐藏窗口以「拉取任务」（`automation_render_next`）方式工作，而不是由 Rust 通过 `eval` 推送大字符串；每张图上报进度，使卡死的渲染器能被发现而不是无限阻塞调用方。
- `--help` 即用法说明。仓库不再单独维护 CLI/MCP 手册，二者无法漂移：`help.rs` 用解析器同一张命令/选项表渲染帮助，限制、诊断码、MCP 工具名与环境变量都取自真实常量；一旦文档面与解析器不一致，测试即失败。
- 工具文案保持双语（`LUMAMARK_TOOLS_LANGUAGE=zh-CN`），且语言只在 Rust 侧解析：连页面需要的两句引擎文案也随任务载荷下发。
- 删除 `tools/automation/**` 及其 `pnpm cli` / `pnpm mcp` / `pnpm test:automation` 入口，只保留一套实现。

## 契约变化

- 移除 `diagram.network_blocked` 与 `renderer.closed`：页面运行在应用 CSP（`default-src 'self'`）之下，远程 PlantUML include 与外部图表资源会表现为普通引擎错误，也不存在可关闭的渲染器套接字。
- `check` 不再返回 `svg`，只有 `diagram render` 与 `render_diagram` 工具返回，与此前行为一致。
- 导出 SVG 保留 mermaid 的 `securityLevel: 'strict'`，但以 `htmlLabels: false` 渲染，使产物自包含并能通过净化，而不是丢失 `foreignObject` 内容。
- `mcp-config` 不再输出 `env`：可执行文件之外不再需要任何东西；`renderer.unavailable` 也不再提示安装 Chromium。
- 渲染需要交互式桌面会话，在无桌面服务或 session 0 中不可用，因为它使用编辑器同一套 WebView。

## 平台说明（Windows）

- **并发进程必须使用独立的 WebView 数据目录。** 实测四个 `LumaMark.exe check` 同时运行并共用同一个 WebView2 用户数据目录时会无限期阻塞，其中三个始终不返回。因此每个自动化进程在临时目录下创建自己的数据目录，并在退出时删除。已验证：四个并行调用约两秒内全部完成。
- **GUI 子系统二进制不会附着到 shell 控制台。** 自动化模式仅在未继承到可用标准句柄时附着父控制台，从而让交互式 `--help` 与报告输出可读；管道与重定向句柄原样使用，这也是 MCP 宿主、脚本、`cmd` 管道与 `Start-Process -RedirectStandardOutput` 的调用方式。PowerShell 自身对 GUI 子系统进程的 `&`/`>` 处理仍然捕获不到内容；请改用 `cmd /c`、管道或 MCP 宿主。
- **CLI 永不挂死。** 启动看门狗在隐藏页面未按时就绪时报 `renderer.unavailable`；渲染停滞报 `renderer.timeout`。
- **渲染始终不可见。** 渲染窗口标题为 `LumaMark automation`，永不显示；打包验收枚举该进程的顶层窗口，而不是依赖 `Get-Process.MainWindowHandle`（它还会报出 tao 内部的事件窗口）。

## 被否决方案

- **保留 Node 宿主并把 Node 与 Chromium 打进安装包。** 安装包会增加约一个浏览器的体积，项目还要维护第二套运行时。
- **随包附带第二个二进制（`lumamark-tools.exe`）。** 复制一份 Tauri/WebView 栈、增加构建目标，却没有去掉任何依赖。
- **用 Rust 重写 mermaid/PlantUML 渲染。** 没有成熟的 Rust 引擎；第二套渲染器还会与编辑器显示结果分叉。
- **用 `wry`/`tao` 单独写一个精简 Rust 二进制。** 手写运行时比复用现有可执行文件更多，且无产品收益。
- **用 schema 派生宏声明 MCP 工具。** 宏的描述是字面量，无法跟随 `LUMAMARK_TOOLS_LANGUAGE`；因此工具声明显式书写，而协议、帧格式、协商与传输仍由 `rmcp` 提供。

## 影响

- 编辑器启动路径不变：`run()` 形状保持原样，内嵌上下文经 `app_context()` 只创建一次，自动化模式通过 `Context::config_mut()` 关闭配置窗口。
- `AppHandle::exit` 无法携带进程退出码（wry 运行时把它映射为 `ControlFlow::Exit`），因此自动化模式自行销毁隐藏窗口后再设置进程状态。
- 性能：每次 CLI 调用需启动一次 WebView（数百毫秒）。MCP 长驻，因此只影响一次性 shell 用法；渲染仍不进入编辑器输入路径。

## 验证与复审条件

- `cargo test` 覆盖参数解析、帮助完整性、报告外壳、退出码、文件读取与输出保护，以及 MCP 工具声明。
- `pnpm test` 覆盖围栏提取、报告组装、净化与页面任务循环。
- `pnpm release:packaged-automation` 驱动打包后的可执行文件：帮助/版本契约、有效与无效的 Mermaid 与 PlantUML、stdin、未知扩展名、2 MiB 上限、`--output` 保护、官方 MCP 客户端会话，以及「任何时刻都不出现可见窗口」的 Win32 断言。该门禁要求生产构建（`pnpm build` / `tauri build --no-bundle`）：直接 `cargo build --release` 得到的是开发构建，走 Vite devUrl 且不含内嵌资源，门禁会以 `renderer.unavailable` 并给出该提示。
- 若 WebView 依赖成为分发障碍、若必须在无桌面会话下渲染，或若 `rmcp` 失去维护，则重新评估。

参考：[rmcp](https://github.com/modelcontextprotocol/rust-sdk)、[ADR 0023](0023-agent-cli-and-mcp.md)、[ADR 0018](0018-plantuml-local-rendering.md)。
