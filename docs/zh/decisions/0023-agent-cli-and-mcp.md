> 语言：**中文** · [English](../../decisions/0023-agent-cli-and-mcp.md)

# ADR 0023：CLI 与 MCP 共用本地自动化服务

状态：已接受。日期：2026-09-09。

## 目的与范围

为 agent 提供通用 LumaMark 接口，在编写 Markdown 时检查图表语法和可渲染性。首批能力是 Markdown 围栏检查及 Mermaid/PlantUML SVG 渲染。Markdown/PDF 转换是未来能力，本次不实现。

## 决策

- 自动化宿主放在 `tools/automation/`，独立于前端包和 Rust 文件打开路由。`AutomationService` 管理请求，CLI 与 MCP 仅适配输入输出。全文不进入 React 状态，两个入口都不会启动桌面编辑器。
- 使用 Node 参数解析器及官方 `@modelcontextprotocol/sdk` 1.30.0 stdio 传输，Zod 定义参数。不自行实现 MCP 协议或图表解析器。
- 使用现有 `@lezer/markdown` 提取围栏，支持引用块和列表。复用项目安装的 Mermaid 和 `@plantuml/core` 版本，使用无头 Playwright Chromium 渲染，每张图表单独创建页面，隔离指令和引擎可变状态。导出 SVG 使用 DOMPurify 清理。
- 通过浏览器请求拦截在虚拟回环源提供渲染器及包内资源，不监听 HTTP 端口。阻止外部请求，不支持远程 PlantUML include 和外部图表资源。
- 输入最多 2 MiB UTF-8，单个 Markdown 请求最多 100 个支持的图表围栏。渲染串行执行，每张图表最多 30 秒。运行环境、资源和超时错误不能当作语法检查成功。
- MCP 接收源码并返回结构化结果，不读写用户文件。CLI 读取指定路径或标准输入，仅在提供 `--output` 时写 SVG，已有输出文件会被拒绝。检查和渲染均不改写输入 Markdown。
- 两个入口返回 `schemaVersion: 1`、`ok`、`checked`、`diagnostics`。诊断包含 `code`、`message`、图表 `format`，以及可确定时从 1 开始的 `blockLine`/`line`。`blockLine` 是开始围栏行；`line` 将引擎位置映射到源码，没有精确位置时回退到图表第一行。渲染成功附带 `svg` 或明确写入的 `output` 路径。
- 工具自身的帮助、描述和提示集中在双语 `messages.ts`；引擎及操作系统诊断保留原文。默认英文，设置 `LUMAMARK_TOOLS_LANGUAGE=zh-CN` 选择中文。诊断代码不随语言变化。

## 使用说明

安装、命令、MCP 配置和故障处理见 [CLI 与 MCP 使用说明](../release/AGENT_TOOLS.md)。

## 替代方案与影响

只有 CLI 不利于自动发现能力；只有 MCP 不便于 shell 管道。所有者选择同时提供两者，共享服务防止诊断分歧。

自定义语法检查器会偏离实际引擎；远程服务会传出文档内容；Java PlantUML sidecar 增加运行时，且与已有官方 TeaVM 能力行为不同。本方案复用已安装的引擎，但需要 Chromium，也有启动成本。这些成本不进入编辑器输入和启动路径。

可独立安装的工具包属于单独的分发改动。未来转换功能应增加服务能力及薄适配层，明确输出路径并验证源码保留。新增 MCP 传输方式必须保留源码/文件访问边界；本决策不授权网络监听服务。

## 验证与复审条件

`pnpm test:automation` 使用真实 CLI 子进程及官方 MCP 客户端验证握手、工具发现和调用，覆盖有效/无效 Mermaid/PlantUML、嵌套围栏、源码位置、输出保护、限制和超时。`pnpm typecheck` 包含自动化宿主，`pnpm lint` 也覆盖该目录。CI 在安装 Chromium 后运行工具测试，与不需要浏览器的单测门禁分开。

若 Chromium 的分发成本不可接受、SDK 版本停止维护，或工具引擎版本与编辑器分歧，需要重新评估。源码保真策略变化、写文件的 MCP 工具和安装包分发都需要独立明确边界及验收证据。

参考：[官方 MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)、[Mermaid API](https://mermaid.js.org/config/usage.html)、[官方 PlantUML 引擎 API](https://www.npmjs.com/package/@plantuml/core)、[本地 PlantUML 决策](0018-plantuml-local-rendering.md)。
