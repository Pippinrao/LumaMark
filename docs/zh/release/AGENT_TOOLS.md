> 语言：**中文** · [English](../../release/AGENT_TOOLS.md)

# CLI 与 MCP 使用说明

本指南面向通过 shell 或 MCP 宿主编写 Markdown 的用户和 agent，说明安装、调用与故障处理。当前支持 Mermaid/PlantUML 语法与实际渲染检查、SVG 输出；Markdown/PDF 转换尚未实现。架构边界见 [ADR 0023](../decisions/0023-agent-cli-and-mcp.md)。

## 安装与基本用法

当前提供的是**仓库工具**，需要 Node >=22.18（推荐 Node 24 LTS）、包含开发依赖的仓库依赖以及 Playwright Chromium。尚未打包进 `lumamark.exe`，桌面安装器也不会将它全局安装。无需修改 PATH 或安装 skill；使用 Node 和入口文件的完整路径即可。

在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
node tools/automation/cli.ts --help
node tools/automation/cli.ts check notes.md --json
node tools/automation/cli.ts check chart.puml --json
node tools/automation/cli.ts diagram render chart.mmd --output chart.svg --json
```

依赖下载遵循项目镜像规则。下载 Chromium 时设置 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright`；仅在镜像失败时回退官方源并记录原因。

`-` 表示标准输入。`check -` 默认按 Markdown 处理；原始图表标准输入需要 `--format mermaid` 或 `--format plantuml`。支持扩展名 `.md`、`.markdown`、`.mmd`、`.mermaid`、`.puml`、`.plantuml`，其他文件名需要 `--format`。支持反引号和波浪号围栏，仅检查 `mermaid`、`plantuml` 代码块，忽略其他语言。没有图表时返回成功，`checked: 0`。

`diagram render` 不带 `--output` 时输出 SVG；加上 `--json` 时将 SVG 放入报告。CLI 退出码：0 成功，1 图表错误，2 参数、I/O、运行环境、资源或超时错误。机器调用应直接执行 Node，避免包管理器提示混入标准输出。

生成包含本机实际完整路径的宿主配置：

```sh
node tools/automation/cli.ts mcp-config
```

将生成的 `mcpServers.lumamark` 项复制到支持此结构的宿主配置；其他宿主使用其中的 `command` 和 `args` 配置 stdio 服务。命令仅打印配置，不修改宿主设置。服务实际以 `node <入口完整路径> mcp` 启动，不依赖工作目录。MCP 标准输出只包含协议消息。

MCP 工具：

| 工具 | 输入 | 结果 |
| --- | --- | --- |
| `check_diagrams` | `source`；`format` 为 `markdown`（默认）、`mermaid` 或 `plantuml` | 与 CLI 一致的检查报告；图表或运行错误设置 `isError` |
| `render_diagram` | `source`；`format` 为 `mermaid` 或 `plantuml` | 结构化结果与 JSON 文本中的清理后 SVG，或诊断 |

## PowerShell 示例

无需将 LumaMark 放入 PATH。将以下完整路径替换为本机实际路径；安装依赖后可以从任意目录运行：

~~~powershell
& 'C:\Program Files\nodejs\node.exe' 'E:\workspace\codes\LumaMark\tools\automation\cli.ts' check 'C:\notes\design.md' --json
'graph TD; A-->B' | node tools/automation/cli.ts check - --format mermaid --json
$env:LUMAMARK_TOOLS_LANGUAGE = 'zh-CN'
node tools/automation/cli.ts --help
~~~

首次下载 Chromium 前可设置：

~~~powershell
$env:PLAYWRIGHT_DOWNLOAD_HOST = 'https://npmmirror.com/mirrors/playwright'
pnpm exec playwright install chromium
~~~

## MCP 参数与结果

宿主通过 stdio 启动服务后自动发现工具，不需要 skill。调用 'check_diagrams' 时传入如下参数（这是工具参数，不是宿主配置）：

~~~json
{"format":"mermaid","source":"graph TD; A-->B"}
~~~

成功结果：

~~~json
{"schemaVersion":1,"ok":true,"checked":1,"diagnostics":[]}
~~~

'render_diagram' 使用相同参数并返回 'svg'。Markdown 检查将围栏内错误映射到原文件行号；'blockLine' 是开始围栏行，'line' 是从 1 开始的错误位置。不要把 'checked: 0' 当作文件里每一种代码块都已验证。

## 限制与故障处理

- 输入最多 2 MiB UTF-8；每个 Markdown 请求最多 100 个图表；每张图表渲染超时为 30 秒。
- 渲染只使用本地引擎，外部资源请求被阻止，不支持远程 include。
- 'renderer.unavailable'：检查 Node 版本、完整仓库依赖和当前运行账户的 Playwright Chromium 安装。
- 'input.format'：为未知扩展名或标准输入添加 '--format'。
- 输出文件已存在：选择一个新路径；工具不会覆盖文件。
- MCP 无法启动：重新运行 'mcp-config'，检查绝对路径是否仍有效，并将 stderr 与协议 stdout 分开。
- 更新仓库依赖后运行 'pnpm test:automation'，确认 CLI 和 MCP 均可调用真实引擎。
