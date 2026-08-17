> Language: **English** · [中文](../zh/quality/QUALITY_STRATEGY.md)

# Quality Strategy

## Background

LumaMark plans to rely heavily on AI for building. AI can greatly increase throughput, but it also tends to bring:

- Large amounts of unverified code.
- Ambiguous requirements that cause rework.
- Features that run but are not maintainable.
- Steadily rising manual-test pressure.
- Performance regressions that go unnoticed.
- Edge cases that keep slipping through.

Therefore LumaMark must establish an AI-native quality system from day one.

Detailed execution rules are in the root [DEVELOPMENT_PROCESS.md](../../DEVELOPMENT_PROCESS.md).

Current thematic gates, real Windows paths, and milestone exit criteria for Parity Reliability are in the [Typora Parity Core Experience Improvement Plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md). This document maintains the long-term quality layering and does not copy the current task list.

## Quality Goals

LumaMark’s quality system must:

- Keep each AI task small and clear.
- Let tests prove the feature—do not let the AI self-certify.
- Reduce manual testing to a small amount of experiential confirmation.
- Make source fidelity and performance automated gates.
- Fix bugs through a root-cause process, not guess-and-patch.

## Test Pyramid

### Unit Tests

Used to verify pure logic:

- Markdown token recognition.
- Cache keys.
- i18n keys.
- Settings parsing.
- File path handling.
- Search and indexing algorithms.

### Integration Tests

Used to verify module collaboration:

- Opening a file into the editor.
- Saving after edits.
- Mermaid render queue.
- Autosave and recovery.
- Rust command invocation.

### E2E Tests

Used to verify real user paths:

- Launching the app.
- Opening a file.
- Typing Markdown.
- Typing Chinese.
- Saving.
- Switching language.
- Switching theme.
- Rendering Mermaid.
- Search and replace.

### Fixture Regression Tests

Used to protect Markdown source fidelity.

Fixed fixtures in the repository provide stable, reproducible coverage of core syntax and editor interaction boundaries. `tests/fixtures/markdownFixtureManifest.ts` records syntax tags for each fixture; coverage tests must ensure newly added syntax does not leave samples uncovered.

Each fixture should cover one or more document characteristics:

- Headings.
- Lists.
- Task lists.
- Tables.
- Code blocks.
- Mermaid.
- Images.
- Links.
- Mixed Chinese and English.
- Large documents.

Mermaid uses layered corpora:

- `mermaid-gallery.md` covers the core Mermaid diagram types that V1 must render successfully.
- `mermaid-edge-cases.md` covers info-string variants, error diagrams, consecutive blocks, long diagrams, and fixture-only diagram types.
- Niche or beta Mermaid diagram types first get source-fidelity and fixture coverage; only after they are promoted to official support do they enter must-pass render gates.

Key check:

> open -> save -> diff; unrelated diffs must be 0.

External Markdown corpora supplement as real-world large samples and only verify parsing, source fidelity, and Lezer node coverage; they do not replace deterministic in-repo fixtures and are not the sole basis for Mermaid render correctness.

## Performance Gates

Every performance-sensitive change must watch:

- Startup time.
- File open time.
- Input latency.
- Scroll smoothness.
- Memory usage.
- Mermaid render time.
- Save time.

Performance benchmarks must run independently of the default unit tests: `pnpm test` does not include `tests/perf/**`; performance data and budget judgments run separately via `pnpm perf:bench`. `pnpm perf:bench` must run performance test files serially so large-document benchmarks do not contend for resources on the same machine and produce false regressions. Input paths always collect 5 samples; existing primary budgets constrain P80, and every single sample has an explicit maximum. Cold paths and pending-render each use an independent editor/activation/render lifecycle per sample. Do not drop the first sample, fail-and-rerun, or take the minimum; see [ADR 0007](../decisions/0007-stable-performance-sampling.md) for the full policy. Complex editing commands that have measured evidence of different cost boundaries must be named separately, budgeted separately, and documented in a new ADR—they must not be used to relax ordinary input gates; the code-block fence completion boundary is in [ADR 0013](../decisions/0013-code-block-completion-performance-budget.md).

Initial targets:

- Open a 1MB file in under 300ms.
- Open a 5MB file in under 1s.
- A 10MB file remains editable without freezing.
- Input latency preferably under 16ms.
- Scrolling near 60 FPS.
- Mermaid rendering must not block input.

## AI Development Guardrails

AI agents must:

- Read `AGENTS.md` and `DEVELOPMENT_PROCESS.md` first.
- Break work into small tasks first.
- Write acceptance criteria first.
- Default to test-first for features and bugfixes.
- Never claim completion without fresh verification.
- Review against `DEVELOPMENT_PROCESS.md`: the implementer self-reviews by default; independent review or review sub-agents are not the default.
- Explicitly call out anything that cannot be verified automatically.

## Definition of Done

A task is done only when:

- Requirements map item by item.
- New behavior has tests.
- Related verification commands have been run.
- Verification output has been read.
- When UI copy is involved, i18n is updated.
- When the editor is involved, source-fidelity risk has been checked.
- When performance is involved, there is no obvious regression.
- When base components are involved, mature-component-first is satisfied.

## GitHub Quality Gates

The repository must maintain `.github/workflows/v1-quality.yml`, which automatically runs V1 quality gates on push and pull request to the default branch `main` (and the legacy `v1-implementation`), and supports manual trigger via `workflow_dispatch`.

That gate must at least cover:

- TypeScript typecheck.
- lint.
- Ordinary unit and integration tests.
- Fixture round-trip.
- Rust check/test.
- Playwright E2E.
- Production-build startup and Mermaid dynamic-import render regression.
- Deterministic remote-image mocks and separate real public-network cache integration tests.
- Web build chunk budgets.
- Separately executed performance benchmarks.

Known external limitation: when Vite 8 / Rolldown copies MathJax NewCM WOFF2 (105 files) and the lazily loaded PlantUML TeaVM engine, it emits `PLUGIN_TIMINGS` on `vite:asset`. That is the copy cost of packing known large assets, not a custom plugin getting slower. `quality:web-build` exempts only that diagnostic when it names `vite:asset` alone; other plugin-timing warnings still fail. Vite `build.rolldownOptions.checks.pluginTimings` turns off the same diagnostic so `pnpm build:web` logs are not drowned in noise. Follow-up: if Rolldown raises the asset-plugin threshold or font/engine copies stop triggering it, revoke the exemption and re-enable the check.

The repository must also maintain `.github/workflows/windows-release-build.yml` as a manual release-build gate that signs, generates, and uploads release exe, MSI, NSIS, and `*.sig` on a GitHub Windows runner. That workflow does not create a GitHub Release; formal distribution only accepts signed publish from `.github/workflows/windows-release-publish.yml`.

Any manual release build used for V1 release judgment must first run `pnpm release:verify-artifacts`, produce `lumamark-windows-artifacts.json` with sizes and SHA-256, and retain that manifest as a GitHub artifact. `docs/release/WINDOWS_V1_BUILD.md` must record the workflow run link, commit hash, conclusion, and artifact inventory. Without traceable run evidence and an artifact manifest, a GitHub runner release build must not be treated as verified.

Windows local candidate packages must also run `pnpm release:packaged-webview`: enter the release WebView from a real temporary Markdown file and require successful Mermaid SVG, immediate save of the main CodeMirror edit state, Unicode input, `Mod-/` round-trip, and accessible names for task checkboxes. That automation uses WebView2 CDP and only proves in-app DOM, keyboard events, and real Rust file writes; it does not replace foreground manual checks for Chinese IME candidate windows, the system clipboard, or Narrator/NVDA.

## Manual Test Strategy

Manual testing is reserved for:

- Visual aesthetic judgment.
- First experience of new interactions.
- Spot checks in real cross-platform environments.
- System behaviors that automation cannot yet cover stably.

Any manual test executed more than twice should be automated.

## Bug Strategy

Bug fixes must follow:

1. Reproduce.
2. Locate the root cause.
3. Write a failing test.
4. Minimal fix.
5. Verify.
6. Keep the regression test.

After three failed fix attempts, pause and re-examine the architecture or assumptions.
