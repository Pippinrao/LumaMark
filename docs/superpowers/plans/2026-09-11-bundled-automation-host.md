> Language: **English** · [中文](../../zh/superpowers/plans/2026-09-11-bundled-automation-host.md)

# Bundled automation host implementation plan

Purpose: implement the owner's decision to package the Mermaid/PlantUML CLI and MCP capability with the desktop process instead of a separately installed Node tool. This is temporary execution scratch, not a new architectural source of truth. The contract lives in [ADR 0024](../../decisions/0024-bundled-automation-host.md).

Scope: `LumaMark.exe check|diagram render|mcp|mcp-config`, hidden-WebView rendering, `--help` as the complete usage reference, removal of `tools/automation/**`, and packaged acceptance. No PDF/Markdown conversion, no network transport, no filesystem-writing MCP tools.

- [x] Rust contract layer: argument tables shared by parser and help, bilingual `--help`, `schemaVersion: 1` report shell, limits, exit codes. `cargo test` covers 43 automation cases including help completeness.
- [x] Renderer page under `src/app/automation/`: fence extraction, report assembly, editor engine reuse (`renderWithMermaid`, `renderPlantUmlOnThread`), DOMPurify sanitization, and the pull-based job loop. `pnpm test` covers 29 cases.
- [x] Hidden window host: `Context::config_mut()` disables the configured editor windows, the page pulls jobs, Rust enforces readiness and stall deadlines, and exit codes are set explicitly because `AppHandle::exit` drops them.
- [x] MCP stdio server on `rmcp` with localized tool declarations; verified with the official client handshake, discovery and both tools.
- [x] Removed `tools/automation/**` plus its scripts, ESLint override, Vitest exclusion and CI step.
- [x] Packaged acceptance `scripts/release/verify-packaged-automation.mjs` with `scripts/release/automationWindowProbe.ps1`.
- [x] Documentation: ADR 0024, ADR 0023 supersession notes, architecture, quality strategy, README indexes, and this plan, in English with Chinese mirrors.

## Findings that changed the implementation

- `AppHandle::exit(code)` loses the process code: the wry runtime maps it to `ControlFlow::Exit`. The worker tears the window down and exits itself.
- Four concurrent invocations sharing one WebView2 user data folder blocked indefinitely (three never returned); per-process data directories fix it (four parallel runs, ~2s).
- The release binary is GUI-subsystem, so shells do not hand it redirected standard handles. Automation mode attaches to the parent console only when no usable handle was inherited; pipes stay untouched.
- `--help`, `--version` and `mcp-config` must not build a WebView, or a broken runtime would break the reference itself.
- `check` must not return `svg`; the renderer page therefore receives an explicit `check`/`render` mode.
- The live `@plantuml/core` engine throws (`IndexOutOfBoundsException`) for a missing `@enduml` instead of rendering an error page, so the acceptance fixture uses that case.
- `Get-Process.MainWindowHandle` is not precise enough for the "no window" gate: tao publishes an internal event-target window. The acceptance enumerates top-level windows and asserts the renderer window exists and is invisible.

## Verification outcome

- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 395 passed, 1 ignored (43 of them automation cases).
- `pnpm exec vitest run src/app/automation`: 29 passed. `pnpm test`: 205 files, 2073 passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm test:fixtures` (8 passed) and `pnpm quality:web-build`: passed; the build now emits and verifies `dist/automation-render.html`.
- `pnpm release:packaged-automation` against the **production** build (`pnpm exec tauri build --no-bundle`, no Vite dev server running): help tokens 27, version `0.3.66` matching `Cargo.toml`, `mcp-config` pointing at the executable, 27 gallery diagrams checked, both MCP tools discovered and called, renderer window present and invisible (EnumWindows evidence).
- A copy of the production executable at another path renders 27 diagrams in ~1.3s, so nothing depends on the build location.
- `pnpm release:packaged-argv-open`: passed, so the editor start-up and argv open path is unaffected by the `app_context()` change.
- `pnpm release:packaged-webview` fails on `--lm-editor-page-width === '810px'`. That expectation is stale: the product default has been `fluid` since ADR 0022. The failure predates this change and was left untouched to keep the change scoped.

Open items:

- A `cargo build --release` binary is a development build: it serves the Vite dev URL and has no embedded assets, so the packaged gate fails with `renderer.unavailable` until it is built with `pnpm build`. The gate now reports that hint; earlier passes in this session used such a binary together with a running dev server and were therefore not packaged evidence.
- The packaged automation gate runs on Windows only; macOS and Linux rendering through the same code path is unverified.
