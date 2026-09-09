> Language: **English** · [中文](../../zh/superpowers/plans/2026-09-09-agent-tools-and-document-layout.md)

# Agent tools and document layout implementation plan

Purpose: implement the owner's approved CLI + MCP choice and two editor-shell corrections. This is temporary execution scratch, not a new architectural source of truth.

Architecture: the app shell owns sidebar selection; the existing table capability owns wrapping geometry. A separate Node tool host runs official diagram engines in local headless Chromium. CLI and the official MCP stdio SDK share one typed service; neither is imported by the app. No Markdown text enters React stores.

Scope: check Mermaid/PlantUML source or Markdown fences through actual rendering; return structured diagnostics and SVG. CLI reads explicit files/stdin and writes only explicitly requested outputs. MCP accepts source strings and returns results without filesystem writes. Node and Chromium are explicit tooling prerequisites; installing the desktop app alone does not install the tool runtime. PATH and a skill are optional. PDF conversion is outside this change.

Execution uses the writing-plans, executing-plans, TDD, React, and Playwright skills in the current session. The owner approved both interfaces; do not request another design approval.

- [x] Sidebar: add a failing AppShell integration test for standalone outline, workspace files, and retained manual selection. Run `pnpm exec vitest run src/app/shell/AppShell.test.tsx`. Put contextual state in `src/app/controllers/useSidebarTab.ts`, and pass the same tab to the sidebar and layout.
- [x] Tables: add `tests/e2e/editor-table-page-width.spec.ts` and demonstrate overflow before edits. Change only `src/editor/core/editor.css` and the table capability's CSS. Fit the prose page and wrap long tokens consistently in inactive/active cells. Preserve paint containment, real blank-line spacing and pointer replay.
- [x] Shared tooling: write Node tests for fenced-block extraction, valid/invalid diagrams, line locations, limits, and SVG output. Add typed modules under `tools/automation/`; use Lezer, Mermaid, PlantUML and DOMPurify. Isolate renderer jobs, restrict network and asset access, and enforce bounded rendering time.
- [x] CLI: cover help, stdin/files, JSON-only stdout, exit codes and explicit output writing in subprocess tests. Expose `check`, `diagram render`, and `mcp` commands from one absolute-path-capable entry.
- [x] MCP: test initialize, tools/list, valid/invalid calls, and clean shutdown using the official SDK client over stdio. Reuse the same service; protocol output alone goes to stdout.
- [ ] Verify: related unit/E2E, full table caret matrix, fixture round trips, typecheck, lint, web build, standalone performance gate, and packaged WebView + OS mouse table matrix. Document actual outcomes and any unavailable gates.
- [x] Documentation: update ADR 0021 for page-bound tables; add the agent-interface decision/usage contract and Chinese mirror, and link from the architecture and documentation maps. Verify links and self-review the scoped diff once.

Acceptance: no table overflow at supported page/window sizes, unchanged source on activation/resize, no caret regression, correct contextual sidebar default, and matching CLI/MCP diagnostics from the real local engines. Infrastructure failure must never be reported as a successful syntax check.

## Verification outcome

Implementation and documentation are present; overall desktop acceptance remains incomplete.

- `pnpm test`: 202 files, 2,043 tests passed. Focused fixture round-trip, table capability and visual-contract checks: 77 passed.
- `pnpm test:automation`: 16 passed, including real rendering, CLI subprocesses and official MCP client calls.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`, `pnpm quality:web-build`, and `pnpm exec tauri build --no-bundle`: passed.
- `pnpm perf:bench`, run alone: 43 passed. Results are recorded in the existing performance baseline.
- Related Playwright suite: initially 52/55 passed; three stale expectations were corrected for the approved sidebar/page-width contracts. Subsequent scoped reruns passed, including all AppShell cases and the narrow-page table test at 1,280, 900 and 720 px. The screenshot confirms wrapping inside the selected page; source-preservation assertions pass.
- OS mouse matrix against the rebuilt release executable: **2/12 passed**. The same script against the previously installed executable also gives **2/12**, with subsequent cases reading the earlier bold cell. This comparison does not establish the root cause or satisfy desktop acceptance. Logs: `.codex/table-caret-current.log` and `.codex/table-caret-baseline.log`. No speculative caret-code changes were retained.
- Existing table-library deferred selection errors also reproduce with baseline CSS; the quality strategy records this limitation. Playwright emits the environment's existing `NO_COLOR`/`FORCE_COLOR` warning.

Self-review covered the scoped app, CSS, CLI/MCP service and renderer boundaries. Documentation was checked against AGENTS, DEVELOPMENT_PROCESS, the detailed architecture and ADR 0021/0022, with English/Chinese pairing and local link targets verified. No commit, global installation, or MCP host configuration change was made.
