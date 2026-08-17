> Language: **English** · [中文](../zh/roadmap/EVOLUTION_PLAN.md)

# Evolution Plan

## Planning principles

LumaMark plans with a near-fine / far-coarse approach.

- **Near term, detailed:** The current Parity Reliability Foundation is written to be executable and verifiable in the sole [current execution plan](TYPORA_PARITY_IMPLEMENTATION_PLAN.md).
- **Mid term, directional:** Typora Migration Completeness keeps dependency order and capability boundaries, without locking implementation tasks before it enters Now.
- **Far term, flexible:** World-Class and ecosystem directions keep themes only, without over-specific commitments.

The reason is simple: real judgment for an editor product comes from prototypes, performance data, and user trials. Over-detailed far-term plans create false certainty and more rework.

Foundation and MarkText+ have formed an Alpha technical baseline. Their historical scope remains in [V1 Version Design](../product/V1_VERSION_DESIGN.md) and [V1 Implementation Plan](V1_IMPLEMENTATION_PLAN.md). Those documents are a historical Alpha baseline only—not the current execution source. This document maintains stage positioning and Now / Next / Later only; it does not copy current implementation detail. The current sole execution source is [TYPORA_PARITY_IMPLEMENTATION_PLAN.md](TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

## Overall path

LumaMark’s evolution path has four levels:

1. **Foundation:** Establish architecture, quality, and verification foundations.
2. **MarkText+:** Quickly surpass MarkText and form a trialable Alpha.
3. **Typora Parity:** Match Typora’s core day-to-day experience.
4. **World-Class:** Choose innovation directions from real feedback and aim for a world-class WYSIWYG Markdown editor.

Path principles:

- Every stage must produce a runnable artifact.
- Every stage must verify performance and source fidelity.
- Do not sacrifice input fluency for feature count.
- Do not build large systems early (plugins, cloud sync, and the like).
- Detailed plans for a later stage must expand only after verification results from the previous stage.

## Stage 0: Foundation

Goal: Establish a sustainable project foundation and prove the default architecture is viable.

**Status:** Technical baseline formed; the following is retained as historical stage definition.

### Core deliverables

- Initialize the Tauri + React + TypeScript project.
- Integrate CodeMirror 6 and display/edit Markdown text.
- Integrate basic i18n with Simplified Chinese and English.
- Establish a basic theme system with at least light and dark themes.
- Establish a test framework.
- Establish a Playwright E2E framework.
- Establish a Markdown fixture round-trip test framework.
- Establish a performance benchmark framework.
- Establish basic CI gates.

### Acceptance criteria

- The app can launch.
- The editor can display and edit Markdown text.
- typecheck, lint, unit tests, and basic E2E cases can run.
- open → save → diff fixture verification can run.
- All user-visible sample copy is in i18n.

### Stage exit criteria

Enter the MarkText+ stage only when all of the following hold:

- CodeMirror 6 runs as the primary editor core.
- React is not on the per-character editing hot path.
- The fixture round-trip verification mechanism runs.
- The performance baseline mechanism runs.
- The AI development process and Definition of Done are fixed in project docs.

## Stage 1: MarkText+

Goal: Quickly surpass MarkText on fluency, modernity, and source trustworthiness, and form a trialable Alpha.

**Status:** Alpha capability baseline formed; reliability gaps are folded into the current Parity Reliability Foundation for convergence.

### Core deliverables

Editing loop:

- Open Markdown files.
- Edit Markdown files.
- Save Markdown files.
- Recent files.
- Dirty-state indication.

Basic Typora-like editing:

- Headings.
- Bold.
- Italic.
- Strikethrough.
- Blockquotes.
- Ordered lists.
- Unordered lists.
- Task lists.
- Inline code.
- Code blocks.

App shell:

- Typora-like basic layout.
- Central editing area.
- Optional file tree.
- Outline.
- Light theme.
- Dark theme.
- Chinese and English UI.

First-pass complex blocks:

- Recognize Mermaid fenced code blocks.
- Asynchronous Mermaid rendering.
- Mermaid render-failure states.
- Mermaid rendering must not block input.

Quality and performance:

- 1MB, 5MB, and 10MB Markdown sample documents.
- Saves produce no unrelated diffs.
- Basic E2E.
- Large-document performance baselines.

### Acceptance criteria

- Windows development builds are usable.
- Users can complete the open → edit → save Markdown loop.
- Basic Markdown WYSIWYG behavior works.
- Mermaid works and does not block input.
- Opening and editing 1MB and 5MB files feels smooth.
- 10MB files do not freeze.
- Saves produce no unrelated diffs.
- Chinese and English UI can be switched.
- Basic E2E and fixture tests pass.

### Stage positioning

> On first use, users should feel LumaMark is smoother, more stable, and more modern than MarkText.

### Stage exit criteria

The historical stage definition required the following before entering detailed Typora Parity planning. Moving into reliability convergence now does not retroactively claim every item complete; missing evidence is absorbed into the current plan:

- MarkText+ core paths are automated-verified.
- Performance baseline data is stable.
- Markdown source-fidelity strategy is verified.
- Mermaid async-rendering strategy is verified.
- At least one round of real self-use or trial feedback is collected.

## Stage 2: Typora Parity

Goal: Match Typora’s core day-to-day writing experience.

**Status: current stage.** The first sub-stage is Parity Reliability Foundation: unify source fidelity, focus, input, and undo contracts first, then extend those contracts across representative Markdown behaviors. Full scope, order, and exit gates are maintained only in the [current execution plan](TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

### Directional scope

Priority directions:

- Current: source format, interaction context, IME, undo, mode switching, and the Mermaid single-primary-document model.
- Current representative slices: paragraphs, inline spans, lists and quotes, code blocks, headings, horizontal rules, and safe degradation.
- Later migration completeness: links, images, code-block entry, tables, and block math (MathJax landed via ADR 0017; remaining math gaps continue as follow-on work).
- Later product loop: shared heading identity, TOC, YAML, footnotes, find/replace, export, settings, and shortcuts.

### Planning principles

- Add only the core capabilities needed for day-to-day Typora migration.
- Every capability must define acceptance samples and automated tests first.
- Any capability that can affect the editing hot path must prototype performance first.
- Do not sacrifice input fluency to chase a feature checklist.

### Stage success criteria

- Typora users can complete a primary migration.
- Common Markdown writing actions feel natural.
- Images, tables, links, and math have no obvious day-to-day gaps.
- Saves still produce no unrelated diffs.
- Performance baselines show no clear regression.
- Data-corruption, IME, undo, and active-save blocking issues are at zero.

### Landed capabilities

These capabilities have landed and are available, but they do **not** mean the whole Typora Parity milestone is complete. Remaining Parity Reliability Foundation work and Migration Completeness remain open under the [current execution plan](TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

- Settings persistence: [ADR 0014](../decisions/0014-settings-persistence.md) + [Settings System Design](../product/SETTINGS_SYSTEM_DESIGN.md)
- Menu system: [Menu System Design](../product/MENU_SYSTEM_DESIGN.md)
- MathJax: [ADR 0017](../decisions/0017-mathjax-document-worker-chtml.md)
- PlantUML local rendering: [ADR 0018](../decisions/0018-plantuml-local-rendering.md)
- GitHub NSIS updater: [ADR 0012](../decisions/0012-github-nsis-auto-update.md)
- Desktop multi-window open routing: [ADR 0009](../decisions/0009-desktop-file-open-bridge.md)

## Stage 3: World-Class

Goal: Surpass Typora and form LumaMark’s own moat.

This stage keeps innovation themes only and does not pre-commit specific features. Real directions must come from performance data, user feedback, and product judgment from the prior stages.

### Candidate innovation themes

- Industry-leading large-document experience.
- Industry-leading source fidelity.
- Industry-leading async complex-block rendering.
- More modern workspace experience.
- Stronger search and indexing.
- More refined theme and visual systems.
- More stable cross-platform experience.
- AI-assisted writing and Markdown refactoring.
- Extension points or plugin capability.

### Planning principles

- Validate user pain points before choosing innovation directions.
- Finish the core writing experience before expanding the ecosystem.
- Build internal extension points before considering a public plugin system.
- No new direction may break “opens fast, types smoothly, scrolls steadily, saves trustworthily, looks polished.”

## Later: ecosystem and platform

These directions are long-term candidates only and are not near-term commitments:

- Plugin marketplace.
- Cloud sync.
- Git workflow integration.
- Team collaboration.
- Document publishing platform.
- Mobile.
- Knowledge-base enhancements.

Before entering any of these directions, re-evaluate:

- Whether there is enough user demand.
- Whether it would slow the core editing experience.
- Whether new commercial or operational capability is required.
- Whether maintenance cost would rise significantly.

## Now / Next / Later

### Now

- Converge existing reliability changes for save, recovery, external change handling, image watchers, and incremental rendering.
- Establish the shared editing context, precise `DocumentSourceFormat`, and single-primary `EditorView` contracts.
- Validate the contracts with representative slices: paragraphs, inline spans, lists/quotes, code blocks/headings/horizontal rules, and Mermaid.
- Complete real save-and-reopen, Windows Chinese IME, accessibility, independent performance gates, and self-use feedback.

Detailed tasks, order, and exit evidence are in [Typora Parity Core Experience Improvement Plan](TYPORA_PARITY_IMPLEMENTATION_PLAN.md); core architecture contracts are in [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md).

See also [Landed capabilities](#landed-capabilities) under Stage 2: landed work is available, but the Typora Parity milestone as a whole is not claimed complete.

### Next

- Complete link workflows.
- Image picker, strategy persistence, and transactional rollback.
- Code-block creation entry points and table row/column, alignment, and paste contracts.
- Remaining math gaps after landed MathJax ([ADR 0017](../decisions/0017-mathjax-document-worker-chtml.md)): continue block/inline math coverage and settings gating as follow-on work—do not reopen engine selection as if KaTeX vs MathJax were still undecided.
- Establish shared incremental heading identity, then advance Outline, internal anchors, TOC, YAML, footnotes, find/replace, export, settings, and shortcut loops.

### Later

- Callout, constrained HTML/embeds, and advanced diagrams.
- macOS/Linux deep polish.
- Choose plugin, AI, and ecosystem directions from real feedback.
- Arbitrary HTML, iframes, or global CSP relaxation are not near-term commitments.

The GitHub NSIS updater has already landed via [ADR 0012](../decisions/0012-github-nsis-auto-update.md) and is not listed as future work here.

## Stage status and current milestone

### Historical Alpha baseline

Original definitions for M0 runnable skeleton, M1 editable Markdown, and M2 day-to-day trialable Alpha remain in the historical [V1 Implementation Plan](V1_IMPLEMENTATION_PLAN.md). Those historical checkboxes must not be used to infer current completion status. They are historical Alpha baseline only; current execution is governed solely by [TYPORA_PARITY_IMPLEMENTATION_PLAN.md](TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

### Current: Parity Reliability Foundation

- Converge reliability with a thin core plus representative slices.
- Preserve Markdown byte intent, IME, selection, scroll, and unified undo contracts.
- Before exit, complete automation gates, Windows real-path verification, and real self-use.
- Data-corruption, IME, undo, and Mermaid active-save blocking issues must reach zero.

## Major risks

### Editor WYSIWYG difficulty

Risk: Typora-like behavior has many details; IME, undo, selection, paste, and other edge cases are easy to miss.

Response:

- Implement in small steps.
- Test every Markdown behavior.
- Cover critical input paths with E2E.

### Performance regression

Risk: Adding features slows typing and scrolling.

Response:

- Keep React off the editing hot path.
- Put performance baselines in CI.
- Async Mermaid, search, and export.

### Source-fidelity breakage

Risk: WYSIWYG or save logic produces unrelated diffs.

Response:

- Fixture round-trip tests.
- Markdown source as the only source of truth.
- No full-file auto-formatting.

### AI-generated quality variance

Risk: AI produces runnable but unmaintainable or unverified code.

Response:

- TDD.
- Definition of Done.
- Independent code review.
- Automated verification.
- Small task decomposition.

## Strategic judgment

The easiest way for LumaMark to fail is to become a Markdown tool with many features that types poorly, saves untrustworthily, and performs unstably.

The path LumaMark should hold is a narrow, high-quality core experience first:

> Opens fast, types smoothly, scrolls steadily, saves trustworthily, looks polished.

Only after those five hold should later plans be refined from real feedback.
