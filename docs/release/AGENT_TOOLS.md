> Language: **English** · [中文](../zh/release/AGENT_TOOLS.md)

# CLI and MCP User Guide

This guide covers installation, invocation and troubleshooting for users and agents writing Markdown through a shell or MCP host. Current capabilities check Mermaid/PlantUML syntax and actual renderability, and return SVG. Markdown/PDF conversion is not implemented. Architecture boundaries live in [ADR 0023](../decisions/0023-agent-cli-and-mcp.md).

## Installation and basic usage

This release provides a **repository tool**, requiring Node >=22.18 (Node 24 LTS recommended), the repository's dependencies including development dependencies, and Playwright Chromium. It is not bundled into `lumamark.exe` or installed globally by the desktop installer. No PATH modification or skill is required; the full paths to Node and the entry file are sufficient.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
node tools/automation/cli.ts --help
node tools/automation/cli.ts check notes.md --json
node tools/automation/cli.ts check chart.puml --json
node tools/automation/cli.ts diagram render chart.mmd --output chart.svg --json
```

Dependency downloads follow the project's mirror policy. For Chromium downloads, use `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright`; use official upstream only if the mirror fails, recording the reason.

`-` reads stdin. `check -` defaults to Markdown; raw stdin needs `--format mermaid` or `--format plantuml`. Recognized extensions are `.md`, `.markdown`, `.mmd`, `.mermaid`, `.puml`, and `.plantuml`; other names require `--format`. Both backticks and tilde fences are recognized. Only `mermaid` and `plantuml` fenced blocks are checked; other languages are ignored. Zero supported fences returns success with `checked: 0`.

`diagram render` without `--output` prints SVG; with `--json`, it returns SVG inside the report. CLI exit codes are 0 for success, 1 for diagram errors, and 2 for argument, I/O, runtime, asset, or timeout failures. Machine consumers should call Node directly to keep package-manager messages out of stdout.

To obtain host configuration containing the actual absolute paths on this machine:

```sh
node tools/automation/cli.ts mcp-config
```

Copy the generated `mcpServers.lumamark` entry into a host accepting that configuration shape; for other hosts, copy its `command` and `args` into the host's stdio server settings. This command only prints configuration and never edits host settings. It launches `node <absolute-entry-path> mcp`, with no working-directory dependency. MCP stdout contains protocol messages only.

MCP tools:

| Tool | Input | Result |
| --- | --- | --- |
| `check_diagrams` | `source`; `format`: `markdown` (default), `mermaid`, or `plantuml` | Same check report as CLI; diagram or operational failures set `isError` |
| `render_diagram` | `source`; `format`: `mermaid` or `plantuml` | Sanitized SVG in structured content and JSON text, or diagnostics |

## PowerShell examples

LumaMark does not need to be in PATH. Replace these absolute paths with the actual local paths; after dependency setup, the first command works from any directory:

~~~powershell
& 'C:\Program Files\nodejs\node.exe' 'E:\workspace\codes\LumaMark\tools\automation\cli.ts' check 'C:\notes\design.md' --json
'graph TD; A-->B' | node tools/automation/cli.ts check - --format mermaid --json
$env:LUMAMARK_TOOLS_LANGUAGE = 'zh-CN'
node tools/automation/cli.ts --help
~~~

Before the first Chromium download, configure the mirror:

~~~powershell
$env:PLAYWRIGHT_DOWNLOAD_HOST = 'https://npmmirror.com/mirrors/playwright'
pnpm exec playwright install chromium
~~~

## MCP arguments and results

The host starts the stdio server and discovers its tools; no skill is required. Call 'check_diagrams' with these arguments (tool input, not host configuration):

~~~json
{"format":"mermaid","source":"graph TD; A-->B"}
~~~

Successful result:

~~~json
{"schemaVersion":1,"ok":true,"checked":1,"diagnostics":[]}
~~~

'render_diagram' accepts the same arguments and returns 'svg'. Markdown checking maps fenced-block errors back to original document lines: 'blockLine' is the opening fence and 'line' is the one-based error location. 'checked: 0' does not mean every code-block language was verified.

## Limits and troubleshooting

- Input is limited to 2 MiB UTF-8, each Markdown request to 100 diagrams, and each diagram render to 30 seconds.
- Rendering uses local engines; external resource requests are blocked, including remote includes.
- 'renderer.unavailable': check Node version, complete repository dependencies, and Playwright Chromium installed for the account running the tool.
- 'input.format': add '--format' for unknown extensions or raw stdin.
- Output already exists: choose a new path; the tool does not overwrite files.
- MCP startup fails: regenerate 'mcp-config', check absolute paths, and keep stderr separate from protocol stdout.
- After dependency updates, run 'pnpm test:automation' to verify both adapters against real engines.
