> 语言：**中文** · [English](../../../superpowers/plans/2026-09-11-bundled-automation-host.md)

# 内置自动化宿主实施计划

目的：落实项目负责人的决定——把 Mermaid/PlantUML 的 CLI 与 MCP 能力随桌面进程打包，而不是作为单独安装的 Node 工具。本文是临时执行草稿，不是新的架构事实来源；契约见 [ADR 0024](../../decisions/0024-bundled-automation-host.md)。

范围：`LumaMark.exe check|diagram render|mcp|mcp-config`、隐藏 WebView 渲染、以 `--help` 作为完整用法说明、删除 `tools/automation/**`，以及打包验收。不含 PDF/Markdown 转换、不含网络传输、不含写文件的 MCP 工具。

- [x] Rust 契约层：解析与帮助共用参数表、双语 `--help`、`schemaVersion: 1` 报告外壳、限制与退出码。`cargo test` 覆盖 43 个自动化用例，含帮助完整性。
- [x] `src/app/automation/` 渲染宿主页：围栏提取、报告组装、复用编辑器引擎（`renderWithMermaid`、`renderPlantUmlOnThread`）、DOMPurify 净化，以及拉取式任务循环。`pnpm test` 覆盖 29 个用例。
- [x] 隐藏窗口宿主：`Context::config_mut()` 关闭配置里的编辑器窗口，页面拉取任务，Rust 强制就绪与停滞时限；由于 `AppHandle::exit` 会丢弃退出码，改由工作线程显式设置进程状态。
- [x] 基于 `rmcp` 的 MCP stdio 服务，工具声明随语言本地化；已用官方客户端验证握手、工具发现与两个工具调用。
- [x] 删除 `tools/automation/**` 及其脚本、ESLint 覆盖、Vitest 排除项和 CI 步骤。
- [x] 打包验收 `scripts/release/verify-packaged-automation.mjs` 与 `scripts/release/automationWindowProbe.ps1`。
- [x] 文档：新增 ADR 0024，更新 ADR 0023 取代说明、架构文档、质量策略、README 索引与本计划，英文为主并同步中文镜像。

## 改变实现方式的实测发现

- `AppHandle::exit(code)` 会丢失进程退出码（wry 运行时把它映射为 `ControlFlow::Exit`）。因此由工作线程销毁窗口后自行退出。
- 四个并发调用共用同一个 WebView2 用户数据目录会无限期阻塞（三个永不返回）；改为每进程独立数据目录后，四个并行调用约 2 秒完成。
- Release 二进制是 GUI 子系统，shell 不会把重定向的标准句柄交给它。自动化模式仅在未继承到可用句柄时附着父控制台，管道保持原样。
- `--help`、`--version` 与 `mcp-config` 不得构建 WebView，否则运行时一旦异常，连用法说明本身都不可用。
- `check` 不得返回 `svg`，因此页面会显式收到 `check`/`render` 模式。
- 实际 `@plantuml/core` 引擎在缺少 `@enduml` 时直接抛异常（`IndexOutOfBoundsException`），而不是渲染错误页，验收样例据此选择。
- `Get-Process.MainWindowHandle` 不足以支撑「无可见窗口」门禁：tao 会发布一个内部事件窗口。验收改为枚举顶层窗口，并断言渲染窗口存在且不可见。

## 验证结果

- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：395 通过、1 忽略（其中 43 个为自动化用例）。
- `pnpm exec vitest run src/app/automation`：29 通过。`pnpm test`：205 个文件、2073 通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm test:fixtures`（8 通过）与 `pnpm quality:web-build`：通过；构建现在会产出并校验 `dist/automation-render.html`。
- 对**生产**构建（`pnpm exec tauri build --no-bundle`，未运行 Vite dev server）运行 `pnpm release:packaged-automation`：帮助令牌 27 项、版本 `0.3.66` 与 `Cargo.toml` 一致、`mcp-config` 指向该可执行文件、检查 27 张 gallery 图表、两个 MCP 工具均被发现并调用、渲染窗口存在且不可见（EnumWindows 证据）。
- 把生产可执行文件复制到其他路径运行，27 张图表约 1.3 秒完成，说明不依赖构建目录。
- `pnpm release:packaged-argv-open`：通过，说明 `app_context()` 改动没有影响编辑器启动与参数打开路径。
- `pnpm release:packaged-webview` 因 `--lm-editor-page-width === '810px'` 失败。该期望已过期：按 ADR 0022，产品默认早已是 `fluid`。此失败早于本次改动，为保持改动范围而未修改。

待办/未决项：

- `cargo build --release` 得到的是开发构建：走 Vite devUrl 且不含内嵌资源，因此打包门禁会以 `renderer.unavailable` 失败，必须先用 `pnpm build` 构建。门禁现在会给出该提示；本会话中早前那几次通过使用的是这种开发构建加运行中的 dev server，因此不构成打包证据。
- 打包验收仅在 Windows 上运行；macOS 与 Linux 走同一代码路径但未验证。
