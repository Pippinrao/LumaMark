> 语言：**中文** · [English](../../../superpowers/plans/2026-09-09-agent-tools-and-document-layout.md)

# Agent 工具与文档布局实施计划

目的：落实所有者已确认的 CLI + MCP 方案及两项编辑器布局修正。本文件仅为执行草稿，不是新的架构事实来源。

架构：应用外壳管理侧栏选择，已有表格能力管理换行几何。独立 Node 工具宿主通过本地无头 Chromium 执行官方图表引擎。CLI 与官方 MCP stdio SDK 共用带类型的服务，不进入应用启动或输入路径。Markdown 全文不进入 React store。

范围：实际试渲染 Mermaid、PlantUML 源码或 Markdown 围栏，返回结构化诊断与 SVG。CLI 读取明确指定的文件或标准输入，仅写入明确指定的输出。MCP 接收源码字符串并返回结果，不写文件。Node 与 Chromium 是明确的工具运行前提，桌面安装包本身不安装工具运行时；PATH 和 skill 均可选。本次不实现 PDF 转换。

当前会话采用 writing-plans、executing-plans、TDD、React 和 Playwright 技能。所有者已批准两种接口，无需再次确认设计。

- [x] 侧栏：先增加 AppShell 集成失败测试，覆盖单文件大纲、工作区文件和手动选择保留。运行 `pnpm exec vitest run src/app/shell/AppShell.test.tsx`。在 `src/app/controllers/useSidebarTab.ts` 管理上下文状态，将同一页签传给侧栏和布局。
- [x] 表格：增加 `tests/e2e/editor-table-page-width.spec.ts` 并先复现溢出。只调整编辑器核心与表格 CSS，使表格适配正文页面，静态与激活单元格一致地换行。保留绘制包含、真实空行和指针坐标回放。
- [x] 共享工具：先用 Node 测试覆盖围栏提取、有效/无效图表、行号、限制及 SVG 输出。在 `tools/automation/` 增加带类型的模块，使用 Lezer、Mermaid、PlantUML 和 DOMPurify。隔离渲染任务，限制网络和资源访问，并设置渲染超时。
- [x] CLI：子进程测试覆盖帮助、标准输入/文件、纯 JSON 标准输出、退出码及明确指定的输出写入。单一入口提供 `check`、`diagram render` 和 `mcp`，支持完整路径调用。
- [x] MCP：通过官方 SDK stdio 客户端验证握手、工具发现、成功/失败调用及退出。复用同一服务，标准输出只写协议消息。
- [ ] 验证：相关单测/E2E、完整表格光标矩阵、fixture 往返、类型检查、lint、Web 构建、独立性能门禁，以及打包 WebView + 操作系统鼠标矩阵。记录真实结果和无法执行的门禁。
- [x] 文档：更新 ADR 0021 的表格宽度契约，新增接口决策/使用说明和中文镜像，并链接到架构与文档地图；检查链接，对本次 diff 自查一次。

验收：支持的页面/窗口尺寸下表格不溢出；激活和缩放不改源码、不破坏光标；侧栏默认项正确；CLI/MCP 使用本地真实引擎返回一致诊断。基础设施失败不能当作语法检查成功。

## 验证结果

代码与文档已落地，整体桌面验收尚未完成。

- `pnpm test`：202 个文件、2,043 个测试通过。针对 fixture 往返、表格能力和视觉契约的检查：77 个通过。
- `pnpm test:automation`：16 个通过，包含真实渲染、CLI 子进程和官方 MCP 客户端调用。
- `pnpm typecheck`、`pnpm lint`、`git diff --check`、`pnpm quality:web-build`、`pnpm exec tauri build --no-bundle`：通过。
- `pnpm perf:bench` 单独运行：43 个通过，结果已写入已有性能基线。
- 相关 Playwright 测试首轮 52/55 通过；三处旧断言已按批准的侧栏和页面宽度契约更新。后续定向重跑通过，覆盖全部 AppShell 用例以及 1,280、900、720 px 窗口下的窄页面表格。截图确认表格在所选页面内换行，源码保持断言通过。
- 重建 release 程序的操作系统鼠标矩阵：**2/12 通过**。同一脚本对此前安装的旧版也为 **2/12**，后续用例持续读到前面的粗体单元格。该对照尚不能确定根因，也不能代替桌面验收。日志：`.codex/table-caret-current.log`、`.codex/table-caret-baseline.log`。没有保留推测性的光标代码修改。
- 表格库延迟更新选区的既有错误在基线 CSS 下同样复现，质量策略已记录限制。Playwright 仍输出环境中已有的 `NO_COLOR`/`FORCE_COLOR` 警告。

自查覆盖本次应用、CSS、CLI/MCP 服务和渲染边界。文档已对照 AGENTS、DEVELOPMENT_PROCESS、详细架构和 ADR 0021/0022，并核对中英文配对和本地链接目标。未提交 Git、全局安装工具或修改 MCP 宿主配置。
