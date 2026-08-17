> Language: **English** · [中文](../zh/roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)

# Typora Parity Core Experience Improvement Plan

> **Status: current execution plan**
>
> This document is LumaMark’s sole current implementation-route source of truth. Foundation and MarkText+ have formed a technical baseline; the current milestone is **Parity Reliability Foundation**. The goal is to bring existing capabilities to Typora-like reliability suitable for long-term daily use—not to keep stacking features by topic.

## Purpose and scope

This document turns approved product direction into a verifiable execution order, quality gates, and exit criteria. It constrains editor interaction, source serialization, representative Markdown behaviors, and verification work for the current milestone.

Implementation status must be evidenced by current code, test output, and change records. This document is not a completion ledger, does not backfill historical TDD steps, and does not treat checkboxes as a substitute for verification results. Historical Alpha design and task breakdown live in [V1 Version Design](../product/V1_VERSION_DESIGN.md) and [V1 Implementation Plan](V1_IMPLEMENTATION_PLAN.md); those are historical Alpha baseline only and are not the current execution source.

## Milestone outcomes

When this milestone is complete, existing editing capabilities must simultaneously satisfy:

- The Markdown source file remains the only source of truth; saves must not unintentionally rewrite BOM, newlines, trailing whitespace, or unrelated text.
- Focus, selection, first visible document position, and pixel offset remain stable across display-mode switches and controlled text transforms.
- Chinese IME composition, undo/redo, and cross-file history must not break one another.
- Inline marks expand only when the corresponding span is being edited; block structure expands only the current minimal structure.
- Mermaid editing modifies the primary CodeMirror document directly and shares the same undo stack; save, save-as, recovery, and close always read the latest body text.
- Data-corruption, IME, undo, and active-save blocking issues must be at zero before Beta-candidate evaluation.

Experience parity uses Typora 1.13.7 Windows as the public behavior baseline; source fidelity, security, and performance follow stricter LumaMark contracts. Related architecture decisions are in [ADR 0006](../decisions/0006-parity-reliability-editor-contracts.md).

## Non-goals

This milestone does not include:

- Complete new capabilities such as math formulas, footnotes, TOC, or Callout as full product features.
- Arbitrary HTML, iframes, global CSP relaxation, or uncontrolled embeds.
- Plugins, AI, cloud sync, or ecosystem building.
- Deep macOS/Linux polish.
- Binding a ship date or version number, or exiting by weakening the quality budget.

Until full capability implementation, YAML Front Matter, footnotes, `[toc]`, and Callout require only safe degradation: source remains visible and must not be mis-rendered as other semantics.

## Editor contracts that must hold first

### Shared interaction context

- `editor/interaction` derives `EditorInteractionContext` from CodeMirror `EditorState` and the syntax tree.
- Context includes composition state, the minimal block for each selection, inline span, delimiter, and protected source ranges.
- Context remaps and incrementally recomputes with transactions; it does not enter React store, and features or shell must not hold full Markdown text.
- Headings, lists, quotes, code fences, and inline marks all consume the same context; do not add conflicting “active line” special cases.

### Precise source format

- CodeMirror holds normalized `Text` internally; `DocumentSourceFormat` independently stores UTF-8 BOM, trailing newline, primary newline format, and per-line newline overrides.
- Unmodified lines retain original LF, CRLF, or CR. Newly inserted newlines inherit nearby format and fall back to the document primary format when inference is impossible.
- Save points capture current `Text` and format state directly; save boundaries perform precise serialization and forbid silent whole-file normalization.
- Controlled save transforms may only produce the minimal necessary CodeMirror changes, in the same transaction as selection/scroll mapping.

### Single primary editor

- The primary CodeMirror `EditorView` is the sole owner of body text, input, selection, and undo history.
- When Mermaid is active, the primary editor shows fence source with preview below the block; do not create a nested `EditorView` that holds pending body text.
- Any edit-mode save path must read the primary document directly and must not depend on blur, closing a panel, or an extra flush.

## Now: Parity Reliability Foundation

The following stages advance in order. Do not stack new editing-model changes on a stage before its blocking gates pass.

### Stage 0: Converge current reliability changes

**Expected outcome:** Existing uncommitted reliability work forms a stable baseline that can be verified independently.

Implementation scope:

- Converge save serialization, save points, recovery drafts, cross-file undo isolation, and external file-change handling.
- Converge incremental update paths for code blocks, images, and Mermaid.
- Wire the local image watcher to the editor image refresh entry point.
- Preserve existing changes in the current worktree; avoid cross-rewriting with the next stage’s interaction-model changes.

Image and draft-finalize boundaries are in [ADR 0003](../decisions/0003-live-preview-assets-code-and-table-inline.md); recovery drafts are in [ADR 0004](../decisions/0004-local-recovery-drafts.md); external file and image watchers are in [ADR 0005](../decisions/0005-external-file-and-image-watch.md).

Exit evidence:

- typecheck, lint, regular tests, E2E, Rust tests, and production builds all pass with fresh output.
- Performance gates run separately and serially; results are not mixed with build or E2E resource contention.
- Independent code review finds no data corruption, cross-file history pollution, or watcher lifecycle blocking issues.

### Stage 1: Unify interaction and display-mode contracts

**Expected outcome:** All Markdown visualization behaviors share the same minimal edit range; IME and view state remain predictable.

Implementation scope:

- Build and test `EditorInteractionContext` derivation for block, inline span, delimiter, selection, and composition.
- Inline marks expand only when the caret or selection enters the corresponding span; block marks expand only the current minimal structure.
- During IME composition, map existing decorations; do not rebuild replacements near candidate text; recompute incrementally after composition ends.
- `Mod-/` toggles source / live-preview modes while preserving selection, undo history, first visible document position, and pixel offset.
- Clarify keymap priority so structural-block commands, composition, and cross-block selections are not swallowed by ordinary paragraph commands.

Exit evidence:

- Unit tests cover multi-selection, nested/adjacent spans, escapes, multiple backticks, and composition lifecycle.
- Integration and Playwright tests prove selection, undo, and scroll anchor do not drift across mode switches.
- Windows Tauri real Chinese IME paths show no candidate flicker, dropped characters, or incorrect expansion.

### Stage 2: Complete precise source serialization

**Expected outcome:** The editor can work on a normalized internal text model while saving to original byte intent.

Implementation scope:

- On load, parse BOM, trailing newline, and per-line LF/CRLF/CR, and establish a `DocumentSourceFormat` that remaps with transactions.
- Define newline-format inheritance rules for insert, delete, split, and join.
- Bind `EditorDocumentPort` snapshot, save-point, and serialization semantics to the current CodeMirror `Text` and format state.
- Establish a real `EditorView → production prepareTextForSave → write → reopen → byte diff` verification chain.
- Use `@codemirror/merge` only on sparse, controlled save-transform paths to generate minimal changes; when precise mapping cannot be guaranteed, degrade explicitly and expose evidence.

Exit evidence:

- Fixtures cover LF, CRLF, CR, mixed newlines, BOM, trailing whitespace, no trailing newline, and structural nesting.
- Unmodified documents round-trip with exact byte identity; after edits, unrelated byte diffs are zero.
- Save points no longer re-parse caller strings or rely on mocks returning the original fixture as core fidelity evidence.

### Stage 3: Deliver representative behavior slices

**Expected outcome:** Shared contracts are end-to-end verified on high-frequency and high-risk syntax so later capabilities can extend the same pattern.

#### Paragraphs

- Ordinary paragraph Enter creates a `\n\n` new paragraph in a single transaction.
- Shift+Enter creates a single newline; when already on an empty line, only one newline is added.
- Structural blocks, composition, and cross-block selections are handled by higher-priority contracts.

#### Inline spans

- Bold, italic, strikethrough, inline code, and links expand only the current span.
- Cover nested, adjacent, multiple backticks, escapes, multi-selection, and Chinese input.

#### Lists and quotes

- First lock CodeMirror continue/exit/Backspace behavior with characterization tests, then add minimal delta behavior.
- Complete list Tab/Shift+Tab, multi-paragraph quote blank lines, mixed selection, and keyboard-operable task checkboxes.

#### Code blocks, headings, and horizontal rules

- Migrate to the shared interaction context.
- Cover key-by-key creation, exit, unclosed fences, and YAML/Setext ambiguity.
- Do not add active-line judgments that serve only a single decorator.

#### Mermaid

- Edit mode uses only the primary `EditorView`; source is visible and preview sits below the block.
- Every keystroke immediately enters the primary document and the unified undo stack.
- Save, save-as, recovery-draft, and close paths read the latest body text while editing.

#### Safe degradation

- YAML Front Matter, footnotes, `[toc]`, and Callout keep visible source.
- Generic decorators must not misclassify them as horizontal rules, headings, ordinary links, or quotes.

Exit evidence:

- Every transaction has precise before/after unit tests.
- Integration tests cover structural-command priority, Mermaid active-save, recovery drafts, and external file conflicts.
- Playwright covers Enter/Shift+Enter, span expansion, list/quote continuation, `Mod-/`, task keyboard operation, and save-and-reopen.

### Stage 4: System verification and real self-use

**Expected outcome:** Reliability contracts hold on real Windows desktop environments and long-document workloads.

Verification scope:

- Windows Tauri real-path verification for Chinese IME, clipboard, Mermaid active-save, and minimal Narrator/NVDA paths.
- 1 MB, 5 MB, and 10 MB documents continue to meet existing open and input budgets.
- Add selection-only, mode-switch, code-block-dense, and real complex Mermaid long-task data.
- Performance baselines run independently and serially; existing primary budgets are not raised; 5-sample P80 and max gates follow [ADR 0007](../decisions/0007-stable-performance-sampling.md); later budget or statistics-policy changes still require a new decision record.
- Complete one real self-use feedback pass and link blocking issues to reproducible evidence.

The milestone exits only when data-corruption, IME, undo, and active-save blocking issues are at zero, and every applicable quality gate has fresh passing output.

## Parallel scope: reading mode and sidebar width

This section advances in parallel with Parity Reliability Foundation. It does not change the stage order above and does not participate in this milestone’s exit gates. It only constrains two approved shell and display-mode changes.

**Sidebar width first**, because it touches only the app shell and is independent of editor contracts:

- Drag lower bound drops to 120px with snap-collapse when narrower; upper bound is derived from the editor panel’s 360px minimum width.
- Adaptive basis becomes the longest expanded file-tree item, clamped to 200–480px, recomputed only on structure changes.
- Remove sidebar-width persistence; keep open/closed persistence; after a manual drag in the session, adaptive sizing yields.

**Reading mode next**, because it touches display-mode contracts and the table click path:

- View-menu `display-mode` radio gains a third item; `Ctrl+/` becomes a three-state cycle.
- Read-only is reconfigured via an independent Compartment on `EditorState.readOnly`, locking rendered state without expanding source marks.
- Tables must not activate nested editors in reading mode; that path is a high-cost defect area and must gain end-to-end assertions.

Boundaries and rejected options are in [ADR 0010](../decisions/0010-reading-mode-readonly-contract.md) and [ADR 0011](../decisions/0011-sidebar-adaptive-width.md).

Exit evidence:

- Existing unit, integration, and Playwright assertions that depend on 240/360 width boundaries are all rewritten and passing.
- Reading mode covers read-only rejecting edits, rendered state not expanding, tables not activating, save still available, and status-bar feedback.
- typecheck, lint, regular tests, and related E2E pass with fresh output.

## Quality and evidence matrix

| Layer | Behaviors that must be proven |
| --- | --- |
| Unit tests | interaction context, composition, keymap priority, newline-format mapping, precise before/after for every Markdown transaction |
| Integration tests | mode switch, selection/scroll retention, Mermaid active-save, recovery drafts, external file conflicts |
| Fidelity fixtures | LF/CRLF/CR, mixed newlines, BOM, trailing whitespace, no trailing newline, multiple spans on one line, unclosed syntax, structural nesting |
| Playwright | Enter/Shift+Enter, span expansion, lists/quotes, `Mod-/`, task keyboard operation, save-and-reopen |
| Windows Tauri | Chinese IME, clipboard, Mermaid edit-mode save, Narrator/NVDA minimal path |
| Independent performance gates | 1/5/10 MB open and input, selection-only, mode switch, code-block dense, complex Mermaid long tasks |

Full commands and Definition of Done follow [DEVELOPMENT_PROCESS.md](../../DEVELOPMENT_PROCESS.md) and [Quality Strategy](../quality/QUALITY_STRATEGY.md). Performance facts and budgets are governed by the corresponding baseline docs under `docs/performance/`.

## Next: Typora Migration Completeness

After the current milestone (Parity Reliability Foundation) exits, advance by the following tiers. Within a tier, keep dependency order; do not skip ahead and stack new capabilities before prerequisite gates pass.

Code-block command entry and key-by-key fence completion landed on 2026-08-12 and are no longer Next. Later work may advance language pickers, copy actions, or broader Markdown auto-pairing only with independent evidence—do not fold those into this capability by implication.

Before entering Next, unified ordinary cut/copy/paste/select-all, editor and file-tree context menus, first-batch link/image right-click actions, plus v2 settings persistence and the vertical settings page form a prerequisite baseline; the tiers below do not re-list that infrastructure. Their implementation status is evidenced only by current code, build records, and fresh acceptance evidence; this document does not record completion progress for any particular branch.

### Tier 1 (blocks day-to-day migration)

1. **Complete link workflows**
   - Remaining: Ctrl/Cmd+Click and internal heading-anchor jumps; right-click open/copy, unified hit model, and opener allowlist have already landed.
   - Dependencies: [Menu System Design](../product/MENU_SYSTEM_DESIGN.md) right-click contracts; [ADR 0015](../decisions/0015-external-open-and-file-mutations.md) opener and protocol allowlist.
2. **Clipboard contracts**
   - Copy as plain text (verified item in Typora 1.13 context menu), Copy as Markdown, and `Ctrl+Shift+V` paste as plain text; then wire into right-click and top chrome.
   - Prerequisite: clear HTML/Markdown/plain-text serialization fidelity and visible failure behavior; do not silently rewrite source.

### Tier 2 (high-frequency editing and assets)

3. **Image picker transactional rollback and `typora-root-url` preview resolution**
   - Image strategy persistence and copy-path / reveal / delete-reference right-click actions have already landed; deleting on-disk files remains out of this round.
4. **Table row/column, alignment, paste contracts, and in-component menu bilingualization**
   - Align `Ctrl+L` / `Ctrl+E` / delete-row and related semantics with Typora; move `codemirror-markdown-tables` copy into i18n (release blocker).
5. **Code-block create and exit path hardening** (complete typing/IME/fidelity evidence on top of the already-present menu entry).
6. **Find/replace depth triage**
   - First measure completeness of the existing `editor.search.*` UI, then decide gap-fix vs capability enhancement; do not write false completion claims before verification.

### Tier 3 (new capabilities that need architecture prerequisites)

7. **Block math:** MathJax has landed via [ADR 0017](../decisions/0017-mathjax-document-worker-chtml.md). Remaining work continues block/inline math coverage and Inline Math settings gating in the same batch or immediately after—do not reopen KaTeX vs MathJax engine selection as if it were still undecided. Landing MathJax does not claim the full Typora Parity milestone complete.
8. **Shared incremental heading identity:** reused by Outline, internal anchors, and TOC; no outline-anchor right-click until it is stable.
9. **After heading identity is stable:** YAML Front Matter, footnotes, `[toc]`, export, and related settings/shortcut loops.
10. **Callout / GitHub Style Alerts:** carried by a future settings `markdown` gate; when off, degrade to visible source.
11. **Constrained HTML / embeds:** enter only after independent security review and an ADR.

Until full implementation, the capabilities above require only protected-source safe degradation; do not treat “source visible” as product delivery of the capability.

Before their corresponding implementation batches start, these items keep only capability boundaries, dependency order, acceptance direction, and documentation contracts; per-task implementation detail is split at kickoff per `DEVELOPMENT_PROCESS.md`.

## Later: platform and ecosystem

- Callout, constrained HTML/embeds, and advanced diagrams.
- macOS/Linux deep polish.
- Plugins, AI, and ecosystem capability.

Later expresses strategic direction only and is not a near-term commitment. The GitHub NSIS updater has already landed via [ADR 0012](../decisions/0012-github-nsis-auto-update.md) and is not listed as future work here. If arbitrary HTML, iframes, or global CSP relaxation ever enter scope, they must complete separate security review and a decision record first.

## Maintenance rules

- This document is the sole current execution plan; update it directly when current milestone scope or order changes.
- [Evolution Plan](EVOLUTION_PLAN.md) maintains only stage positioning and Now/Next/Later summaries; it does not copy task detail from here.
- Product-goal changes update product source docs; architecture-contract changes update [Detailed Architecture](../architecture/DETAILED_ARCHITECTURE.md) and the corresponding ADRs.
- Do not write test-run results, temporary investigation notes, or day-by-day progress into this document.
- Raising performance budgets, changing save/source-fidelity strategy, restoring nested editors, or replacing the editor core requires adding or revising an ADR first.
