> Language: **English** · [中文](../zh/decisions/0024-bundled-automation-host.md)

# ADR 0024: Automation host bundled into the desktop executable

Status: Accepted. Date: 2026-09-11.

## Background

[ADR 0023](0023-agent-cli-and-mcp.md) shipped the Mermaid/PlantUML checker and
MCP server as a repository Node tool under `tools/automation/`. Running it
required Node >= 22.18, the repository's development dependencies, and a
Playwright Chromium download. The desktop installer did not provide it, so
agents and users had to install and maintain a second runtime and point their
host configuration at a repository path.

The owner asked for the capability to be packaged with the main process instead
of being installed separately, without making it a heavyweight feature.

## Decision

- The desktop executable serves the capability itself:
  `LumaMark.exe check`, `LumaMark.exe diagram render`, `LumaMark.exe mcp`, and
  `LumaMark.exe mcp-config`. `main` recognizes these first arguments before the
  editor starts; every other invocation still opens the editor.
- Rendering reuses the **app's own WebView** through one hidden window
  (`automation-render.html`). No Node runtime and no downloaded browser are
  involved, so the installer gains no runtime dependency and essentially no
  size.
- The renderer page reuses the editor's engines — `mermaid` through
  `renderWithMermaid`/`safeMermaidConfig`, PlantUML through
  `renderPlantUmlOnThread`, and `dompurify` for the exported SVG. Fence
  extraction keeps using `@lezer/markdown`, so Markdown line mapping is the same
  code the editor uses.
- Rust owns the outer contract: argument parsing, exit codes, the
  `schemaVersion: 1` report shell, limits, timeouts, file output and the MCP
  server (official `rmcp` SDK over stdio). The page owns diagram semantics and
  returns a complete report; Rust validates `schemaVersion` and treats anything
  else as `automation.failed`.
- The hidden window pulls jobs (`automation_render_next`) instead of Rust
  pushing large payloads through `eval`. Progress is reported per diagram so a
  wedged renderer is detected instead of hanging the caller.
- `--help` is the usage reference. The repository does not ship a separate CLI
  or MCP manual, so the two cannot drift: `help.rs` renders the same command and
  option tables the parser uses, plus the limits, diagnostic codes, MCP tool
  names and environment variable from their real constants. Tests fail if the
  documented surface and the parser disagree.
- Tool text stays bilingual (`LUMAMARK_TOOLS_LANGUAGE=zh-CN`), and the language
  is resolved in Rust only: even the two engine sentences the page needs arrive
  in the job payload.
- `tools/automation/**` and its `pnpm cli` / `pnpm mcp` / `pnpm test:automation`
  entry points are removed. There is exactly one implementation.

## Contract changes

- `diagram.network_blocked` and `renderer.closed` disappear: the page runs under
  the application CSP (`default-src 'self'`), so remote PlantUML includes and
  external diagram resources fail as ordinary engine errors, and no renderer
  socket exists to close.
- `check` never returns `svg`; only `diagram render` and the `render_diagram`
  tool do, matching the previous behaviour.
- Exported SVG keeps mermaid's `securityLevel: 'strict'` but renders with
  `htmlLabels: false`, so the artifact stays self-contained and survives
  sanitization instead of losing `foreignObject` content.
- `mcp-config` no longer emits an `env` block: nothing outside the executable is
  required. `renderer.unavailable` no longer tells users to install Chromium.
- Rendering needs an interactive desktop session. It does not work in a headless
  service or session 0, because it uses the same WebView the editor uses.

## Platform notes (Windows)

- **Concurrent processes need separate WebView data.** Four simultaneous `LumaMark.exe check` runs against one shared WebView2 user data folder blocked indefinitely; three of them never returned. Each automation process therefore creates its own data directory under the temporary directory and removes it on exit. Verified: four parallel runs complete in about two seconds.
- **A GUI-subsystem binary is not attached to the shell's console.** Automation mode attaches to the parent console only when no usable standard handle was inherited, so interactive `--help` and report output are readable. Pipes and redirected handles are used unchanged, which is how MCP hosts, scripts, `cmd` pipelines and `Start-Process -RedirectStandardOutput` consume the tool. PowerShell's own `&`/`>` handling of GUI-subsystem processes still captures nothing; use `cmd /c`, a pipe, or an MCP host.
- **The CLI never hangs.** A startup watchdog reports `renderer.unavailable` when the hidden page does not become ready, and a stalled renderer is reported as `renderer.timeout`.
- **Rendering stays invisible.** The renderer window exists with the title `LumaMark automation` and is never visible; the packaged acceptance enumerates the process' top-level windows instead of trusting `Get-Process.MainWindowHandle`, which also reports tao's internal event-target window.

## Rejected alternatives

- **Keep the Node host and bundle Node plus Chromium into the installer.** The
  installer would grow by roughly the size of a browser, and the project would
  maintain a second runtime.
- **Ship a second bundled binary (`lumamark-tools.exe`).** It duplicates the
  Tauri/WebView stack and adds a build target without removing any dependency.
- **Reimplement mermaid/PlantUML in Rust.** No mature Rust engines exist; a
  second renderer would also diverge from what the editor shows.
- **A separate small Rust binary using `wry`/`tao` directly.** More hand-written
  runtime code than routing the existing executable, for no product benefit.
- **Declare MCP tools through a schema derive macro.** The macro takes literal
  descriptions, which cannot follow `LUMAMARK_TOOLS_LANGUAGE`; tool declarations
  are therefore written explicitly, while the protocol, framing, negotiation and
  transport still come from `rmcp`.

## Impact

- The editor startup path is unchanged: `run()` keeps its shape, the bundled
  context is created once through `app_context()`, and configuration windows are
  disabled for automation mode via `Context::config_mut()`.
- `AppHandle::exit` cannot carry a process exit code (the wry runtime maps it to
  `ControlFlow::Exit`), so automation mode destroys the hidden window and then
  sets the process status itself.
- Performance: each CLI invocation starts a WebView (a few hundred
  milliseconds). MCP is long-lived, so this only affects one-shot shell usage.
  Rendering stays outside the editor's typing path.

## Verification and review conditions

- `cargo test` covers argument parsing, help completeness, the report shell,
  exit codes, file reading and output protection, and MCP tool declarations.
- `pnpm test` covers fence extraction, report assembly, sanitization and the
  page's job loop.
- `pnpm release:packaged-automation` drives the packaged executable: help/version
  contracts, valid and invalid Mermaid and PlantUML, stdin, unknown extensions,
  the 2 MiB limit, `--output` protection, an official MCP client session, and a
  Win32 check that no window is ever visible. It requires a production build
  (`pnpm build` / `tauri build --no-bundle`): a plain `cargo build --release`
  binary is a development build that serves the Vite dev URL and has no embedded
  assets, so the gate reports `renderer.unavailable` with that hint.
- Revisit if the WebView requirement becomes a distribution problem, if
  rendering must work without a desktop session, or if `rmcp` loses
  maintenance.

References: [rmcp](https://github.com/modelcontextprotocol/rust-sdk),
[ADR 0023](0023-agent-cli-and-mcp.md),
[ADR 0018](0018-plantuml-local-rendering.md).
