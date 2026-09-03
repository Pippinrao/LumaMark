# Design: Issue #35 — Selection accuracy and drag sensitivity

**Date:** 2026-09-03
**Status:** Draft — awaiting review
**Issue:** https://github.com/Pippinrao/LumaMark/issues/35

## Purpose

Fix two drag-selection defects reported in #35:

1. **Shadow-to-cursor mismatch on release:** the painted selection during drag differs from the settled cursor after mouseup, because `settlePointerSelection` re-resolves the head via `caretPositionFromPoint` — overwriting the range that `pointerSelectionStyle` already committed.
2. **Excessive vertical sensitivity:** moving the pointer 1–2 CSS px vertically past the click slop immediately snaps the drag head to an adjacent line, because `stabilizeDragHead` only filters X-axis flicker and `posAtCoords(coords, false)` snaps to the nearest line.

## Root cause analysis

### Mismatch on release

ADR 0019 established that live-preview owns pointer selection via `EditorView.mouseSelectionStyle`. During drag (past slop), the style calls `view.posAtCoords(coords, false)` and paints a range. On `mouseup`, `settlePointerSelection` in `markdownDecorations.ts` runs and dispatches a new selection using `unclampedInlinePointerPosition` (which calls `caretPositionFromPoint`). This second resolution can disagree with `posAtCoords` because hidden delimiters shift the two coordinate systems. The user sees the range jump on release.

ADR 0019 already states: "A `detail === 2` drag that already painted a character range must not be overwritten with a word selection." The same principle must extend to `detail === 1` drags past the slop — if the style already painted a character range, settlement must not overwrite the head.

### Vertical sensitivity

`stabilizeDragHead` rejects a head that moves opposite the pointer on the X axis. It has no Y logic. `posAtCoords(coords, false)` with `precise: false` snaps to the closest line even when the pointer is only 1 px into the next line's territory. Real editors (VS Code, Typora, browser `<textarea>`) keep the selection on the current line until the pointer is well into the next line (roughly half a line-height). This is "line stickiness" or Y hysteresis.

## Decision

### 1. Settlement must not overwrite a drag selection

When `pointerSelectionStyle` was active and the drag passed the slop (i.e., a non-collapsed range was painted), `settlePointerSelection` must skip its own head re-resolution and keep the selection the style already committed. Implementation: the style sets a flag (e.g., `dragRangeCommitted`) that settlement reads; if true, settlement only dispatches `settlePointerMarkdownDecorations` without changing the selection.

### 2. Y hysteresis on the drag head

Add a `lastPointerY` tracker to `pointerSelectionRange`. When `posAtCoords` returns a position on a different line than `lastHead`, check whether the pointer has traveled at least half a line-height (approximated by `view.defaultLineHeight / 2`) from the Y coordinate where the current line was entered. If not, keep `lastHead`. This prevents 1–2 px vertical jitter from switching lines while still allowing intentional vertical drags.

### 3. Prefer `posAtCoords(coords, true)` during drag

Pass `precise: true` so that when the pointer is between lines or in widget gaps, `posAtCoords` returns `null` instead of snapping. The existing `stabilizeDragHead` null-path (`return lastHead`) already handles this correctly.

## Files changed

- `src/editor/wysiwyg/pointerSelectionStyle.ts` — add Y hysteresis, `dragRangeCommitted` flag, `precise: true`
- `src/editor/wysiwyg/pointerSelectionStyle.test.ts` — new failing tests first
- `src/editor/wysiwyg/markdownDecorations.ts` — read `dragRangeCommitted` in `settlePointerSelection`, skip head overwrite
- `src/editor/wysiwyg/markdownDecorations.test.ts` — settlement skip test
- `tests/e2e/editor-preview-click-selection.spec.ts` — drag release consistency E2E

## Alternatives rejected

**B. Use `caretPositionFromPoint` for drag:** ADR 0019 rejected this — widget interiors, hidden delimiters, per-frame cost.

**C. Full manual selection management:** Loses CodeMirror's drag machinery (edge scroll, atomic ranges, DnD). Overkill.

## Verification requirements

- Unit tests: Y hysteresis at multiple line heights; settlement skip when drag committed; existing slop/X-stabilization tests still pass.
- E2E: drag selection on bold/link text — release position equals last drag position.
- Installed-package: `pnpm release:installed-preview-click-selection-os` and `pnpm release:installed-selection-caret-os` must still pass.

## Non-goals

- Changing click (non-drag) behavior — already handled by ADR 0019.
- Table cell click accuracy — separate concern (#25, tableCellClickSync).
- Memory (#32) — unrelated.

## Rollback

Revert the three changes and the `dragRangeCommitted` flag. Existing ADR 0019 behavior is restored.
