> Language: **English** · [中文](AGENTS.zh.md)

# AGENTS.md

This file is the working contract that every agent and contributor on LumaMark must follow.

All implementation tasks must also follow root `DEVELOPMENT_PROCESS.md`. When both `AGENTS.md` and `DEVELOPMENT_PROCESS.md` apply, both must be satisfied; if they conflict, the stricter, more verifiable rule wins.

## Project identity

LumaMark is a high-performance, modern, cross-platform WYSIWYG Markdown editor.

Product path:

- First replicate a mature Typora-like writing experience.
- Then innovate on performance, modern workflows, extensibility, and platform integration.
- Prioritize Windows experience while architecturally supporting macOS and Linux natively.
- Treat Chinese and English as first-class UI languages from day one.

Project conventions:

- App name: `LumaMark`
- Repository and package name: `lumamark`
- Product positioning: high-performance Typora-like Markdown editor

Typora may be used only as a public experience baseline. Do not copy Typora’s proprietary assets, branding, or private implementation details.

## Version number management

LumaMark versions use fixed `a.b.c` format; each part is a non-negative integer.

- Every time AI creates a Git commit—feature, fix, refactor, test, docs, config, or anything else—it must actively bump `c` by exactly `1` in that same commit.
- The version bump must live in the same commit as the corresponding change. Do not create a separate commit that only bumps the version.
- Without explicit instruction from the project owner, AI must not increase or otherwise change `a` or `b`, and must not infer major/minor bumps from change size.
- When the owner explicitly requests increasing `a` or `b`, update that part as requested and reset `c` to `0`; afterward continue bumping `c` on each AI commit.
- When changing the version, update `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and affected lockfiles together so all app version sources stay consistent.
- Before committing, AI must read the current version and inspect the staged content to confirm the commit contains exactly one correct patch bump and does not unauthorizedly change `a` or `b`.

## Product principles

1. Performance is a core product capability, not a later optimization.
2. The Markdown source file is the single source of truth.
3. WYSIWYG behavior must not destroy the user’s formatting, whitespace, line breaks, or source intent.
4. First-version layout should stay close to mature Typora-like patterns: a quiet central editing area, optional sidebar, and minimal visual noise.
5. Design for long writing sessions: restrained UI, predictable interaction, stable scrolling, fast typing.
6. Prefer mature, reliable, plain infrastructure over clever but fragile custom systems.
7. All user-visible copy must be localizable. Do not hard-code UI strings outside the i18n layer.

## Default architecture

Current default technical direction:

- Desktop framework: Tauri
- Frontend: React + TypeScript
- Primary editor core: CodeMirror 6
- Backend and system capabilities: Rust via Tauri commands
- UI primitives: prefer mature component libraries, ideally headless or strong on accessibility
- Icons: prefer mature icon libraries such as `lucide-react`
- Virtualization: when needed, prefer mature libraries such as TanStack Virtual
- Mermaid: prefer the official Mermaid rendering path, then add async rendering and caching as performance requires
- i18n: prefer mature i18n solutions such as i18next or equivalents

Milkdown and ProseMirror may be used for research or prototypes, but must not become the primary editor core unless a new written decision replaces the current default.

Use Rust where it clearly helps:

- File I/O
- Workspace indexing
- Search
- Cache management
- Large-document support
- Export pipelines
- Scheduling expensive parse or render work

Do not move features to Rust for novelty. Measure first, then decide.

## Dependency mirror iron rule

LumaMark dependency installs, build downloads, and system mirrors prefer Aliyun or Aliyun-ecosystem mirrors to improve stability and speed for China-based development.

Default priority:

1. Aliyun or Aliyun-ecosystem mirrors already configured in the project.
2. Explicitly available, stable, actively maintained domestic mirrors.
3. Official upstream sources.

Concrete conventions:

- npm, pnpm, and yarn default to `https://registry.npmmirror.com/`.
- Rust crates default to Aliyun crates.io sparse index: `sparse+https://mirrors.aliyun.com/crates.io-index/`.
- For Node, Rustup, system dependencies, binary tools, and CI images, prefer Aliyun mirror sites or Aliyun-ecosystem mirrors when downloads are needed.
- If a mirror is unavailable, out of sync, or fails verification, temporarily fall back to the official source, but record the reason and impact in the task report.
- Do not treat personal global registry settings as project truth. Prefer project-level config when possible.
- Do not disable lockfiles, checksums, signatures, or security checks just to use a mirror.

## Architecture iron rules

LumaMark is built from day one for long-term maintainable architecture. No agent may dump new requirements directly into existing files, UI components, global stores, editor hot paths, or Tauri commands.

Before adding or changing a requirement, decide which layer it belongs to:

- `app`: app startup, global providers, window-level layout, and cross-feature orchestration.
- `features`: user-facing product features such as file actions, workspace, command palette, settings, outline.
- `editor`: CodeMirror state, editor extensions, WYSIWYG, editor commands, and editor performance observation.
- `services`: filesystem, Tauri IPC, render tasks, persistence, platform capability facades.
- `shared`: i18n, theme tokens, shared types, pure utilities, and cross-feature infrastructure.
- `src-tauri`: Rust system capabilities, file I/O, workspace indexing, platform APIs, and expensive work.

Dependency direction must stay clear:

- UI may call feature actions or service facades, but must not scatter low-level platform calls.
- Features may compose editor APIs and services, but must not hold full Markdown text.
- Editor may expose stable APIs and events, but must not depend on a concrete UI shell.
- Services must not depend on React components.
- Rust commands must stay thin entry points; business logic belongs in Rust service modules.
- `shared` may hold only direction-free common capability; it must not become a junk drawer.

Before every new feature, run an architecture impact check:

1. Is there already an appropriate layer and module?
2. Is a new explicit boundary needed instead of stuffing an existing large file?
3. Does it raise risk for typing, scrolling, undo/redo, IME, or source fidelity?
4. Does it put large objects, full Markdown, or high-frequency data into React stores, props, or context?
5. Does it introduce cross-layer dependencies, cycles, or platform leakage?
6. Does architecture documentation or a decision record need updating?

If the answer is unclear, stop and explain architecture impact and options. Do not bypass layering, boundaries, or maintainability with “implement first.”

Keep single-file responsibilities focused. When growth would bloat a file, prefer extracting small modules with clear interfaces—but abstraction must serve real complexity; do not over-layer for appearance.

## Mature components first

Agents must prefer mature, actively maintained, well-documented components.

Do not hand-roll primitives unless all of the following are true:

1. Mature options have already been evaluated.
2. Mature options clearly cannot meet LumaMark goals such as performance, source fidelity, accessibility, cross-platform behavior, i18n, maintainability, or UX quality.
3. Failure reasons are evidenced (benchmarks, prototype results, issues, limitation notes, or integration failures).
4. The user has explicitly approved a custom implementation.

This rule applies to:

- UI primitives
- Menus
- Dialogs
- Tooltips
- Tree components
- Tabs
- Split panes
- Virtual lists
- Command palettes
- Editor integrations
- Markdown parsing and rendering
- i18n
- Shortcut handling
- File watching
- Search and indexing libraries

Custom code should only cover LumaMark differentiators:

- Typora-like Markdown WYSIWYG on the editor core
- Markdown source fidelity
- Large-document fluidity
- Async preview and render scheduling
- App-specific workflow integration
- Performance observation and tuning

Do not hand-roll primitives for a sense of control.

## Engineering standards

Code must be simple, readable, and type-safe.

- Prefer TypeScript strict mode.
- Avoid `any`. If a boundary truly requires it, explain why.
- Frontend state updates default to immutable updates.
- Names must be clear, not clever.
- File responsibilities must stay focused.
- Avoid speculative abstraction.
- Comments explain intent, trade-offs, or non-obvious behavior only.
- Failure modes must be handled explicitly.
- Do not hide errors behind silent fallbacks.

Once project patterns exist, follow them. Early structure should stay conventional, plain, and understandable.

## Frontend and UX standards

Search for mature components before writing custom UI.

Expected UX direction:

- Quiet, modern, professional
- Perceived performance is fast
- No decorative clutter
- Strong keyboard support
- Good accessibility
- Predictable focus behavior
- Polish for both light and dark themes
- App first screen must not look like a marketing landing page

UI control requirements:

- Prefer familiar icons for common tool actions.
- Uncommon icon-only controls must provide tooltips.
- Use segmented controls, toggles, sliders, menus, tabs, and dialogs according to mature UX conventions.
- Do not show extra in-app explanatory text for obviously understood controls.

## Editor standards

The editor must be designed around fluid interaction.

Core requirements:

- Typing remains responsive on large documents.
- Scrolling stays smooth.
- Expensive preview and render work must be async or deferred.
- Mermaid rendering must not block typing.
- Markdown source must be recoverable and predictable.
- Editing must not rearrange unrelated text.

Before accepting editor-core changes, check impact on:

- IME composition
- Undo and redo
- Selection and caret stability
- Copy and paste
- Markdown source fidelity
- Large-document behavior
- Accessibility

## Internationalization

LumaMark supports multiple languages by default.

- Default development languages: English and Simplified Chinese.
- All visible UI copy must live in i18n resources.
- Do not split translated strings into fragments and concatenate them; word order differs across languages.
- Command names, menu labels, settings items, errors, empty states, and tooltips must all be localizable.
- Code identifiers use English.
- Agent replies to the project owner default to Chinese unless the user switches language.

## Documentation language policy

Project documentation defaults to **English** at the canonical paths (`README.md`, `AGENTS.md`, `DEVELOPMENT_PROCESS.md`, `docs/**`).

- Full Chinese is retained as a mirror under `docs/zh/**` and root `*.zh.md`.
- For living docs, update the English default first, then update the Chinese mirror in the same change set.
- Language switchers link between paired files; internal links in English docs point to English default paths (except the language switcher itself).
- Agent chat replies to the owner still default to Chinese; this policy applies to documentation files, not chat language.

## Performance discipline

Prefer measurement over guessing.

When adding features that may affect responsiveness, include a performance note or test plan covering:

- Startup time
- File open time
- Input latency
- Scroll smoothness
- Memory use
- Expensive render paths

Use async, caching, cancellation, debounce, and incremental rendering where appropriate.

For editor-core and large-document decisions, “optimize later” is not allowed.

Performance benchmarks must run alone. Do not judge regressions from runs interleaved with E2E, build, typecheck, lint, or other heavy CPU gates.

## Testing requirements

Test intensity must match risk.

High-risk areas need explicit tests:

- Editor transforms
- Markdown source preservation
- File I/O
- Autosave and recovery
- Search and indexing
- i18n resource coverage
- Mermaid render lifecycle
- Shortcuts
- Table/widget click→caret geometry (including inactive/active alignment)
- Title-bar drag vs portal menu real pointer paths (installed package or equivalent desktop path)

Prefer focused unit tests for pure logic and integration tests for editor behavior. Bugs involving Tauri drag, nested editor activation, or OS pointer hit-testing need installed-package / OS mouse evidence beyond browser E2E; see “High-cost defect retrospectives.”

Test, build, and release script output should stay as warning-free as possible. New warnings must be rooted out; if confirmed as an existing external limitation, record the risk and follow-up work—do not silently ignore them.

## Documentation requirements

Important decisions must be recorded.

Write a short decision record when:

- Replacing a mature library with custom code
- Changing the editor core
- Introducing a major dependency
- Changing source-fidelity behavior
- Changing application architecture

Project docs must be direct, accurate, and timely. Do not let docs become vision drafts.

## Documentation maintenance

LumaMark must control document count and responsibility boundaries. Docs reduce communication cost; they must not create maintenance burden.

### Documentation entry points

- Root `README.md` holds only project intro, core principles, and entry links.
- `docs/README.md` is the documentation map and category index; every new project doc must be findable from there.
- `AGENTS.md` is the agent and contributor working contract.
- `DEVELOPMENT_PROCESS.md` is the AI development process and definition of done.

When adding, deleting, or renaming docs under `docs/`, update `docs/README.md` in the same change.

### Directory responsibilities

Current docs directories may only cover:

- `docs/product/`: product positioning, version goals, PRD, version design, competitor strategy.
- `docs/architecture/`: architecture principles, detailed architecture, module boundaries, technology choices.
- `docs/roadmap/`: phase plans, milestones, near-detail / far-outline evolution.
- `docs/quality/`: quality strategy, test strategy, performance gates, release quality requirements.

Create the following only when needed; do not pre-create empty directories:

- `docs/decisions/`: major architecture or dependency decisions.
- `docs/testing/`: test fixtures, detailed test strategy, E2E conventions.
- `docs/performance/`: performance benchmark methods and results.
- `docs/release/`: release process, release notes, packaging/signing notes.

`docs/superpowers/` is non-authoritative agent planning scratch (specs and plans). It is not a product, architecture, or roadmap source of truth.

`.claude/`, `.cursor/`, and similar tool directories are not project documentation directories and are not sources of truth for product, architecture, or roadmap.

### Fact-source hierarchy

Each topic may have only one primary source of truth.

Priority:

1. `AGENTS.md`: working rules, engineering discipline, documentation governance.
2. `DEVELOPMENT_PROCESS.md`: development process, testing, verification, and definition of done.
3. `docs/product/PROJECT_CHARTER.md`: project vision and long-term positioning.
4. `docs/roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md`: current implementation scope, order, and exit gates.
5. `docs/architecture/DETAILED_ARCHITECTURE.md`: current detailed architecture and technology choices.
6. `docs/roadmap/EVOLUTION_PLAN.md`: phases and evolution plan.

`docs/product/V1_PRODUCT_REQUIREMENTS.md`, `docs/product/V1_UX_DESIGN.md`, `docs/product/V1_VERSION_DESIGN.md`, and `docs/roadmap/V1_IMPLEMENTATION_PLAN.md` are historical Alpha baselines from Foundation / MarkText+. They are not sources of truth for current implementation status or execution order.

Other docs may only supplement the primary source; they must not copy whole sections that then diverge.

### Rules for adding documents

Before adding a document, decide whether an existing doc can be updated instead.

Add a new long-lived doc only when all of the following are true:

1. The topic has an independent lifecycle.
2. Putting it in an existing doc would clearly bloat or confuse responsibilities.
3. The new doc has a clear audience and use case.
4. `docs/README.md` can explain its responsibility and update timing.

Do not create long-lived docs for temporary discussion, one-off ideas, or repeated summaries. Put temporary content in issues, plans, drafts, or the current related doc.

### Splitting and merging

When a doc exceeds maintainable scope, prefer splitting by responsibility, not by date or author.

Split when:

- One doc serves two or more distinct audiences.
- One doc mixes product goals with low-level implementation detail.
- Updates often force unrelated readers to understand the whole document.

Merge when:

- Two docs are always updated together.
- Two docs duplicate content.
- A doc is only an index that `docs/README.md` already covers.

### Documentation update rules

When changing code or plans, check related docs.

Must update docs when:

- Product goals or V1 scope change.
- Default architecture or core technology choices change.
- Major dependencies are added or replaced.
- Markdown source-fidelity strategy changes.
- Test, performance, or completion gates change.
- Release process or platform support is added.
- The user explicitly changes project principles.

Do not put pure implementation detail into high-level product docs. Short-term implementation steps belong in implementation plans, not long-lived docs.

### Documentation format rules

Every long-lived doc must include:

- A clear title.
- A short purpose statement.
- Explicit scope.
- Actionable rules or conclusions.
- “Non-goals” when needed.

Long-lived docs must not:

- Heavily duplicate other docs.
- Contain outdated conclusions without source notes.
- Leave unfinished placeholder markers.
- Express vision only, without boundaries or decisions.
- Record diary-style discussion process.

### Decision record rules

Write to `docs/decisions/` and link from related primary docs when:

- Changing the editor core.
- Replacing a mature component with a custom primitive.
- Introducing a large dependency that affects architecture.
- Changing save or source-fidelity strategy.
- Changing performance gates.
- Changing cross-platform strategy.

Decision records should be short and include:

- Background.
- Decision.
- Rejected alternatives.
- Impact.
- Rollback or review conditions.

### Documentation maintenance checklist

Before finishing a documentation task, check:

- Does `docs/README.md` need updating?
- Were duplicate fact sources introduced?
- Are there stale links?
- Are there unfinished placeholders?
- Were short-term implementation details written into long-lived docs?
- Does the change violate near-detail / far-outline roadmap principles?
- Do `README.md`, `AGENTS.md`, or `DEVELOPMENT_PROCESS.md` need syncing?

Final replies for documentation tasks must state which files were read or searched to verify the written result.

## High-cost defect retrospectives (mandatory)

The following two defects were long misdiagnosed, repeatedly “fixed then broken again,” and only closed on the real installed-package path. When agents see similar symptoms, they must investigate using this section first—not start from “handler not wired” or “tweak CSS.”

### 1. Menu opens but clicks do nothing

**Real root cause (not “handler missing”):**

1. The title bar put `data-tauri-drag-region` or equivalent drag logic over the menu host.
2. Radix (and similar) menu content portals to `document.body`; the DOM target is no longer under the header subtree, but React synthetic events still bubble back to the header `onMouseDown`.
3. The header incorrectly starts window dragging and captures the pointer; subsequent `pointerup` / `click` are swallowed.
4. The feel is “About / Theme / Language clicks do nothing.” Playwright/CDP synthetic clicks often cannot reproduce it; only real OS mouse + installed package path reproduces reliably.

**Mandatory rules:**

- Native drag regions may only cover blank title-bar space; they must never cover menus, buttons, inputs, or other interactive controls.
- Current title bar uses a single native owner: only blank `.lm-titlebar-drag` may carry `data-tauri-drag-region`; the header or its ancestors must not also bind manual `startDragging`, to avoid double-invocation on click and drag-vs-maximize races on double-click.
- If a future switch to fully manual drag is required, remove the native drag-region first, and before starting drag reject portal / non-descendant targets, `[data-lm-window-interactive]`, `[role="menu"]` / `menuitem*`, and `.lm-menu-content`; native and manual schemes must not stack.
- When diagnosing “click does nothing,” check window drag, pointer capture, and portal event paths before checking whether actions are wired.
- Completion evidence for this class of bug must include real pointer operations on an installed package or equivalent WebView path; browser E2E alone must not claim a fix.

Reference implementations: `src/app/shell/TopChrome.tsx`, `src/app/controllers/useWindowControlsModel.ts`.

### 2. Table and WYSIWYG caret anomalies

**Real root causes (often stacked, not a single CSS issue):**

1. Inactive cell vs nested CodeMirror active-edit padding / line padding / hidden-mark geometry diverge; the hit box drifts at activation.
2. Click-to-activate unmounts/mounts a nested editor and loses original pointer coordinates; without root capture and `posAtCoords` replay, the caret lands at the default start or a wrong offset.
3. Decorative `margin` / `padding` on table block widgets create “looks like empty lines, actually unselectable” fake gaps; clicking above/below lands in first/last row.
4. Using `max-width` + `overflow-x: auto` to “narrow wide columns” introduces an inner scrollbar; the click coordinate system drifts, producing caret jumps and incomplete table display.
5. “Fake spaces / fake carets” mask geometry bugs and prolong the defect.

**Mandatory rules:**

- Table (and similar WYSIWYG widget) inactive views and active nested editors must share the same padding box; hidden marks must behave consistently in both states. Do not fake alignment with spaces or decorative carets.
- Cell activation must retain pre-activation pointer coordinates and, once the nested editor is ready, map them with CodeMirror `posAtCoords` to a real document position; clicks in empty padding should land at visible text ends, not invent placeholder characters.
- Do not add decorative top/bottom `margin`/`padding` on block widgets that becomes an unselectable hit region. Spacing between tables and body text must come from real Markdown blank lines (clickable `cm-line`). Same for images, Mermaid, and similar; vertical margin does not enter the CodeMirror height map and drifts all click→caret mapping below.
- Async-growing block widgets (image load, Mermaid render) must refresh the height map after size changes; when `requestMeasure()` alone is insufficient for off-viewport widgets, force a full height refresh.
- Do not use inner horizontal scroll or header `max-width` clipping to “beautify” column width. Wide tables should remain fully visible; scrollbars and clipping break click→caret mapping.
- If a caret fix changes overflow, transform, scale, scroll containers, or widget geometry, re-run the table caret matrix and verify at least one installed-package + OS-level mouse round.
- For OS-level click reproduction, convert screen coordinates from the WebView client origin (for example Win32 `ClientToScreen`). `GetWindowRect` includes the window frame and systematically biases by several pixels, creating false fails/passes.

Reference implementations: `src/editor/capabilities/table/tableCellClickSync.ts`, `src/editor/capabilities/table/table.css`; regressions: `tests/e2e/editor-table-caret*.spec.ts`, `scripts/release/repro-installed-table-caret*.mjs`.

### 3. General lessons from these two fixes

1. **Classify the symptom before changing code.** “No response” may mean the event was swallowed; “caret drifts” may be geometry/coordinates, not a wrong selection API.
2. **Verify desktop-shell bugs and browser bugs on separate evidence chains.** Tauri drag, installed path, OS mouse quantification, and CDP clicks are not the same chain.
3. **Fix geometry contracts first, then interaction enhancements.** Any CSS that disconnects hit-test area from visible text amplifies into caret disasters on tables/widgets.
4. **Do not mask hit issues with new visual constraints.** Scrollbars, clipping, fake blank space, and fake carets are high-risk shortcuts.
5. **Guard against “fixed then broken again.”** After caret fixes merge, later UI polish that touches table overflow/padding is a high-risk change, not pure styling.

## Agent workflow

Before changing:

1. Check current repository state.
2. Find existing conventions.
3. Read and follow the AI development process and definition of done in `DEVELOPMENT_PROCESS.md`.
4. Prefer mature libraries and existing project patterns.
5. If high-risk assumptions exist, state them before acting.

When changing files:

1. Keep the change scope focused.
2. Do not rewrite unrelated files.
3. Do not roll back user changes.
4. Do not do large refactors unrelated to the current task.
5. Verify with the most relevant available commands.

Before finishing a task:

1. Re-run verification commands related to this change.
2. Read verification output and exit codes.
3. Without fresh verification, do not claim “done,” “fixed,” “passing,” or equivalents.
4. If verification commands are not yet established, state clearly that only docs or static checks are possible, and do not claim automated functional verification.

If a mature component may not meet requirements, stop and record:

- Components evaluated
- Requirements they cannot meet
- Evidence
- Proposed alternatives
- Whether user approval is needed

Do not start hand-rolling primitives before explicit user confirmation.
