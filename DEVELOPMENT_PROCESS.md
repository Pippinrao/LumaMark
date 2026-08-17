> Language: **English** · [中文](DEVELOPMENT_PROCESS.zh.md)

# DEVELOPMENT_PROCESS.md

This file defines LumaMark’s AI-native development process. The goal is to keep the project usable, testable, and maintainable even when AI writes a large share of the code, and to avoid accumulating uncontrollable bugs.

## Core principles

1. AI may write a lot of code, but it cannot prove its own correctness.
2. Every completion claim must have fresh verification evidence.
3. Features and bugfixes default to tests first.
4. Large work must be split into independently acceptable small tasks.
5. Manual testing is only a supplement; it cannot replace automated tests.
6. Performance, source fidelity, i18n, and editor interaction are first-class quality gates.
7. Find root cause before fixing; no guesswork patches.

## Standard workflow

Every implementation task must proceed in this order:

1. **Read context**: read `AGENTS.md`, this file, related requirements, and existing code.
2. **Split the task**: change only one clear behavior at a time.
3. **Write acceptance criteria**: define how this task proves completion.
4. **Tests first**: write a failing test or a repeatable verification script first.
5. **Confirm failure**: run the test and confirm it fails because the target behavior is missing.
6. **Minimal implementation**: write only the code needed to make the test pass.
7. **Verify pass**: re-run related tests, typecheck, lint, build, or E2E.
8. **Regression check**: confirm source fidelity, i18n, performance, and critical editor behavior were not broken.
9. **Implementer self-review**: quickly check omissions, extra changes, and obvious regressions against this task’s acceptance criteria. Stop here by default; do not open extra review rounds or review subagents.
10. **Record results**: state which verifications ran, what the results were, and remaining risks.

Do not skip tests-first unless the task is clearly pure documentation, a one-off prototype, generated files, or config initialization—and the reason must be stated in the result.

## Task granularity

AI tasks must be small and acceptable.

A task should:

- Be expressible in one sentence.
- Touch only one primary behavior or one thin slice.
- Be implementable, verifiable, and explainable in the same round.
- Have a clear automated acceptance path.

The following are too large and must be split:

- “Implement the editor”
- “Replicate Typora”
- “Build a complete filesystem”
- “Optimize performance”
- “Implement Mermaid”
- “Finish the UI”

Prefer splits such as:

- Wire CodeMirror and display Markdown text.
- Implement heading style decorations.
- Hide bold source markers.
- Detect Mermaid fenced blocks.
- Add Mermaid async render caching.
- Implement open file.
- Ensure save round-trip has no unrelated diff.

## TDD rules

Features, bugfixes, refactors, and behavior changes default to TDD.

Hard rules:

1. No production code without a failing test.
2. The test must fail first, and for the correct reason.
3. Implementation is only the minimal change that makes the test pass.
4. Before fixing a bug, write a failing test that reproduces it.
5. Refactor only after tests pass.
6. If something cannot be tested, the design may be over-coupled; revisit the interface first.

Exceptions are only:

- Pure documentation changes
- One-off exploration prototypes
- Config initialization
- Generated files

Exceptions must not be stretched. Even for exceptions, add static checks, screenshot checks, or a human acceptance note whenever possible.

## Automated test layers

LumaMark must gradually establish these layers.

### Unit tests

Cover pure logic:

- Markdown token recognition
- Source fragment transforms
- Settings parsing
- i18n key checks
- Cache key generation
- File path handling
- Search and indexing logic

### Integration tests

Cover module collaboration:

- Open file into the editor
- Edit then save
- Mermaid render task scheduling
- Autosave and recovery
- Rust commands and frontend callers
- Settings changes affecting UI and editor

### E2E tests

Use Playwright or an equivalent mature approach for real user paths:

- Launch the app
- Create a document
- Open a Markdown file
- Type Chinese and English
- Enter headings, lists, code blocks, Mermaid
- Save a file
- Search and replace
- Switch language
- Switch light/dark theme
- Critical screenshot checks

### Fixture regression tests

Maintain a fixed Markdown sample library:

- `basic.md`
- `headings.md`
- `lists.md`
- `task-list.md`
- `code-blocks.md`
- `table.md`
- `links-images.md`
- `mermaid.md`
- `math.md`
- `mixed-chinese-english.md`
- `large-1mb.md`
- `large-5mb.md`
- `large-10mb.md`

Every editor-core, save-logic, or parse-logic change must run open → save → diff tests. Unrelated diff must be zero.

## CI gates

Once project scaffolding exists, provide and maintain these commands or equivalents:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:e2e:production`
- `pnpm test:live-assets`
- `pnpm test:fixtures`
- `pnpm perf:bench`
- `pnpm quality:web-build`
- `cargo check`
- `cargo test`

GitHub Actions must maintain `.github/workflows/v1-quality.yml` and run V1 quality gates on push and pull request to default branch `main` (and legacy `v1-implementation`); `workflow_dispatch` manual trigger is also supported. The workflow must at least cover typecheck, lint, ordinary tests, fixture round-trip, Rust check/test, Web E2E, production-build launch regression, real public-network remote image cache, Web chunk gates, and standalone performance benchmarks.

Before finishing a task, run the commands relevant to the change.

`pnpm test` is the ordinary unit/integration gate and must not include `tests/perf/**`. Performance benchmarks must run via `pnpm perf:bench` alone, and tests inside `tests/perf/**` must also run serially so large-document benches do not contend for CPU, disk, or jsdom on the same machine. Performance benchmarks must not run in parallel with E2E, build, typecheck, lint, or other heavy CPU gates. Budget failures caused by parallel contention are not direct regression conclusions; reproduce alone before judging.

Warnings in test, build, and release script output are also quality signals. New warnings must be rooted and fixed; if confirmed as an existing external limitation, state evidence, impact, and follow-up governance in the result.

If a command is not yet established, the agent must state:

- Which verification command is missing.
- What substitute verification was used.
- Which automated gate should be added later.

Do not claim automated functional verification when the verification command is missing.

## Definition of Done

Before any implementation task is complete:

- Requirements and acceptance criteria map item by item.
- New behavior has tests that went from fail to pass.
- Related typecheck passes.
- Related lint passes.
- Related unit or integration tests pass.
- When UI is involved, related E2E or screenshot checks pass.
- When the editor is involved, check IME, undo/redo, selection, copy/paste, and source-fidelity risk.
- When save is involved, fixture round-trip has no unrelated diff.
- When performance-sensitive paths are involved, benchmarks show no clear regression.
- When UI copy is involved, Chinese and English i18n resources update together.
- When primitives are involved, confirm mature components were preferred.
- No new silent error handling was added.
- The final reply lists verification commands actually run and their results.

If the above are not met, you may only say “part of the change is done,” not that the task is complete.

## Performance benchmarks

Performance targets must be measured from early in the project.

Initial targets:

- Open a 1MB Markdown file in under 300ms.
- Open a 5MB Markdown file in under 1s.
- A 10MB Markdown file remains editable without freezing.
- Ordinary input latency preferably under 16ms.
- Scrolling near 60 FPS.
- Mermaid rendering must not block typing.
- Unrelated diff before/after save is 0.

These numbers may adjust with real measurement, but the performance gate must not be cancelled.

Changes in these areas must include a performance note:

- Editor core
- Decorations/widgets
- Mermaid
- Math
- Image preview
- File open and save
- Search and indexing
- Outline generation
- Virtual lists
- Workspace file tree

## Minimize manual testing

Manual testing is only for exploration and final experience confirmation. Any manual test repeated more than twice must become an automated test or verification script.

Allowed manual testing:

- Visual aesthetic judgment
- New interaction prototype experience
- Spot checks on real cross-platform devices
- System behavior that automation cannot yet cover reliably

Areas that must not depend on manual testing long term:

- Open and save
- Markdown round-trip
- Basic editing behavior
- i18n copy coverage
- Theme switching
- Mermaid lifecycle
- Search
- Shortcuts
- Large-document performance

## Bug handling process

On bugs, test failures, build failures, or performance anomalies, follow root-cause process:

1. Read the full error.
2. Reproduce stably.
3. Inspect recent changes.
4. Find the boundary where the problem occurs.
5. Form a single hypothesis.
6. Write a failing test or reproduction script.
7. Make a minimal fix.
8. Re-run verification.

Forbidden:

- Fixing without reproduction.
- Trying multiple fixes at once.
- Fixing symptoms instead of root cause.
- Shipping a fix without a regression test.
- Continuing brute-force attempts after three failed fixes. Three failures likely indicate an architecture problem; pause and re-discuss the approach.

## Code review rules

Quality gates center on tests, typecheck, lint, and implementer self-review. Review is an exception, not the default step.

By default do not:

- Dispatch a spec reviewer, quality reviewer, or any review subagent after every implementation slice.
- Split spec review and code-quality review into two rounds.
- Re-review the same diff repeatedly, expand scope, or treat P2 / style / abstraction preferences as blockers.
- Treat “independent review GO” as a merge or completion condition.

Implementer self-review covers only this task’s diff, once, focusing on:

- Whether acceptance criteria were missed.
- Whether out-of-scope changes were added.
- Whether there are regressions a test can directly prove (source fidelity, i18n, clear behavior errors).

Run an independent review only when the user explicitly requests it, or when the change alters save semantics, source-fidelity contracts, or security boundaries. That review must:

- Be done by reading the diff in the current session; do not default to spawning a subagent.
- Report only P0/P1 issues that would fail on real user paths, with file and line numbers.
- End after a single pass; after fixing P0/P1, verify only the fixed lines—do not re-review the whole diff.

P2, style, naming, layering preference, and “could be more elegant” are not blockers and must not stop follow-on work.

## Dependency and custom-build decisions

Before introducing a dependency, confirm:

- It is mature, actively maintained, and clearly documented.
- It fits LumaMark performance goals.
- It supports TypeScript or Rust type safety.
- It does not harm package size, startup, or cross-platform capability.
- It is compatible with i18n, accessibility, and the theme system.

Before replacing a mature component or hand-rolling a primitive, write down:

- Mature components evaluated.
- Goals they cannot meet.
- Evidence.
- Custom scope.
- Maintenance cost.
- Whether the user explicitly approved.

Do not hand-roll primitives without explicit user approval.

## Documentation and decision records

The following must be documented:

- Product positioning and version goals
- Architecture decisions
- Dependency choices
- Performance benchmark results
- Custom-build exceptions
- Editor-core behavior changes
- Source-fidelity strategy
- Test strategy changes

Recommended directories (English default paths):

- `docs/decisions/`: architecture and dependency decisions
- `docs/testing/`: test strategy and fixture notes
- `docs/performance/`: performance benchmarks and results
- `docs/product/`: product positioning, roadmap, PRD

Documentation defaults to English at canonical paths, with a full Chinese mirror under `docs/zh/**` and root `*.zh.md`. For living docs, update English first, then the Chinese mirror in the same change. See `AGENTS.md` documentation language policy and `docs/README.md` for the map and bilingual layout. `docs/superpowers/` is non-authoritative agent planning scratch only.

## Agent completion report format

Final reports for implementation tasks must include:

- What changed.
- Which verification commands ran.
- The result of each command.
- Verifications that could not run and why.
- Remaining risks.

Do not only say “done,” “should be fine,” or “looks okay.”

Pure documentation tasks must at least read the written files to confirm content landed on disk.
