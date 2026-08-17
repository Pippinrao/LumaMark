> Language: **English** · [中文](../zh/decisions/0006-parity-reliability-editor-contracts.md)

# ADR 0006: Parity Reliability Editor Contracts

**Status:** Accepted

**Date:** 2026-07-27

## Context

Foundation and MarkText+ already established CodeMirror as the primary editor, a file loop, and multiple Markdown capabilities, but reliability behavior had been scattered across decorations, save callers, and complex blocks. Continuing to add per-syntax active-line special cases, string round-trips, or nested editors would amplify risk to IME, selection, undo, active-save, and source fidelity.

Current implementation scope is in the [Typora Parity core experience improvement plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

## Decision

### Shared editing context

- Derive `EditorInteractionContext` in `editor/interaction` to uniformly represent composition, the minimal block per selection, inline spans, delimiters, and protected source ranges.
- Context comes from CodeMirror state/syntax tree and is mapped or incrementally recomputed with transactions; it does not enter the React store.
- Headings, lists, quotes, code fences, and inline marks consume the same contract instead of each maintaining active-line rules.
- A collapsed caret activates only the innermost inline owner; a non-empty selection activates every intersecting inline owner. Ordinary multi-line quotes expand only the `QuoteMark` on the selection’s line; boundary-integrity semantics for code fences and Mermaid continue to expand the full block delimiter.
- In live preview, activated Markdown delimiters use weakened source-mark decorations that do not replace text; inactive delimiters still hide or replace per existing preview rules; source mode always shows original source.

### Exact source serialization

- CodeMirror internally uses normalized `Text`; `DocumentSourceFormat` stores UTF-8 BOM, trailing newline, primary newline format, and per-line LF/CRLF/CR overrides, mapped as the document changes.
- `EditorDocumentPort` snapshots and save points capture current `Text` and format state; serialization happens only at file boundaries.
- Unmodified lines keep their original format; newly inserted newlines follow neighboring format and fall back to the primary format. Silent whole-file normalization is forbidden.

### Mermaid single primary EditorView

- The primary `EditorView` is the sole owner of Markdown body, selection, and undo history.
- Mermaid edit mode shows fence source in the main document with preview below the block; do not create a nested `EditorView` that holds pending body text.
- Save, save-as, restore, and close read the primary document directly and do not depend on blur or an extra flush.
- Mermaid’s dynamic production splitting may split upstream dependencies by size, but Rolldown output must enable `strictExecutionOrder`; otherwise cyclic chunks from manual grouping and `maxSize` can execute before helper initialization, making Mermaid’s first render fail in production while development still works.

### Save transforms use mature diff capability

- Controlled `prepareTextForSave` transforms use the official CodeMirror package `@codemirror/merge` to compute minimal changes, then map selection and scroll snapshot in the same CodeMirror transaction.
- That dependency is used only for sparse, test-constrained save transforms and does not enter the ordinary typing hot path; LumaMark does not custom-build a general diff algorithm.
- Current raw `diff` calls are not configured with a timeout. They guarantee the target text after applying changes, but extreme inputs may use coarse scans, so semantic position mapping must not be advertised as unconditionally exact across all documents.

## Alternatives considered

- **Each decorator maintains its own active-line or composition special case:** rules drift and conflict.
- **Store body text or interaction context in the React store:** pulls high-frequency large objects into the render path and creates a second source of truth.
- **Re-parse format from caller strings at save time:** cannot reliably distinguish original format from transform results.
- **Mermaid uses a nested EditorView and commits on close:** creates a second body, a separate undo stack, and an active-save window.
- **Custom diff or full document replacement:** the former lacks mature validation; the latter breaks selection, scroll, and minimal-change semantics.

## Consequences

- Editor capabilities must obtain editing ranges through the shared interaction API and must not depend directly on shell or feature state.
- File workflows obtain snapshots and exact serialization through `EditorDocumentPort`; Rust commands remain thin entry points.
- Mermaid preview may still be async-cached and cancelled, but edit events only enter primary CodeMirror transactions.
- `@codemirror/merge` becomes a production dependency; version changes must run save-mapping, long-document, and fidelity regressions.
- Mermaid chunking config changes must pass both real `dist/` lazy-load rendering and Windows packaged WebView active-save gates; a successful build and acceptable chunk size alone do not prove execution order is correct.

## Verification requirements

- Unit tests cover context derivation, nested inline owners, per-line quote delimiters, composition, format mapping, and save-preparation changes.
- Use a real `EditorView → prepareTextForSave → write → reopen → byte diff` path to prove unrelated byte diff is 0.
- Integration/E2E covers mode switches, selection/scroll, unified undo, and Mermaid active-save.
- Production E2E must trigger Mermaid dynamic import and obtain SVG; Windows packaged WebView must enter edit mode from a real temp file and verify immediate active-save to disk, Unicode input, mode round-trips, and task checkbox accessible names.
- Diff/save benchmarks and 1/5/10 MB document performance gates run independently and serially.

## Revisit and rollback criteria

Revisit this decision when any of the following occurs:

- Save transforms expand from sparse normalization into large-scale rewrite.
- Large-document tests trigger coarse diffs, or selection/scroll mapping cannot be proven accurate.
- `scanLimit`, timeout, or other configs that may produce non-exact matches are introduced.
- `DocumentSourceFormat` mapping causes unacceptable memory or typing latency.
- A new capability proposes a second editable body or an independent undo stack.

When diff exactness is not observable, prefer APIs that can report precision status (for example `Chunk.build`) and explicitly adopt safe fallback, tests, and telemetry when `precise=false`; never silently claim position preservation is exact. Nested editors or source-fidelity contract changes are allowed only after a new ADR proves necessity and rollback.

