> Language: **English** · [中文](../zh/decisions/0021-adaptive-document-width-and-block-breakout.md)

# ADR 0021: Adaptive document width and wide-block breakout

**Status:** Accepted

**Date:** 2026-08-21

## Context

Fixed `standard` (810px) page width compressed images, Mermaid, and PlantUML on wide screens, and made everyday tables overflow the writing column so `.cm-scroller` grew a horizontal scrollbar. That scrollbar is also a click→caret geometry hazard. Users asked for an adaptive default, with a stop-if-it-hurts-typing gate.

## Decision

- Add an `adaptive` page-width preset: the prose column is `clamp(720px, 70%, 1100px)`, still wrapped by the existing safe-gutter `min()`.
- Make `adaptive` the new default. Settings schema version 4 rewrites a previous `standard` value to `adaptive` on upgrade. Explicit `narrow`, `wide`, `fluid`, and a later explicit `standard` are kept.
- Publish `--lm-editor-block-track-width` from a CodeMirror view plugin that observes `view.scrollDOM`, quantizes `clientWidth - gutter` to integer px, and writes the variable only when it changes.
- Let tables, Mermaid, PlantUML, and images use that track (centered if narrower). Math and fenced code stay on the prose column because MathJax CHTML re-renders on content-width change.
- After a later track-width change, force CodeMirror `mustMeasureContent` so table widgets (which are not in `blockWidgetGeometry`) refresh the height map. The first publish during editor construction does not remasure: CodeMirror’s first layout already measures widgets. ResizeObserver callbacks are coalesced to one animation frame so opening a many-table file cannot stack full remasures.
- Size `.tbl-table-widget` to the writing track with `min-width: min-content`, and keep library `contain: paint`. Long cell text still wraps at the track. Unwrappable wide tables grow the widget so paint containment cannot clip them. Do not force `width: max-content` (cells stop wrapping) or disable paint containment (multi-table open stalls even when page width is not Adaptive).

## Alternatives considered

- **`container-type: inline-size` on `.lm-editor-paper`:** pure CSS, but `contain: layout` makes the paper a containing block for fixed-position descendants (CodeMirror panels, table menus) and ignores scrollbar width.
- **Fluid (`100%`) as the new default:** body text becomes unreadably long on wide screens.
- **Inner table/image scroll or `max-width` clipping:** forbidden by the table/widget geometry contract in `AGENTS.md`.

## Consequences

- New installs and untouched `standard` profiles get a wider prose column and breakout blocks.
- A user who had deliberately chosen `standard` is indistinguishable from an untouched profile and is migrated; they can set Standard again.
- Sidebar auto-fit remains independent (see ADR 0011). Adaptive page width does not change sidebar measurement.
- Paper-width CSS must target only `.lm-codemirror > .cm-editor > .cm-scroller > .cm-content`. Nested table-cell editors inherit `.lm-codemirror` and must not receive the 96px gutter or paper padding.
- The table library reuses one nested `EditorView` across cells. Consecutive clicks are remembered in the capture phase and replayed onto that view after layout; a one-shot “already applied” flag is not enough.
- Table widgets use the writing track (`width: track; min-width: min-content`) so library `contain: paint` can stay on. Only inner `overflow-x: auto` is overridden; paint containment is not disabled.

## Rollback or review conditions

- Mixed-document input P80 exceeds the existing 8 ms gate, many-table file-open P80 exceeds 300 ms (32 everyday GFM tables, Adaptive or Standard), or installed UX-stutter scroll longtask P95/max exceeds 50 ms with adaptive as the default.
- Table caret mapping below a table fails after a pane resize (height map missed the breakout).
- Consecutive GFM cell clicks without blurring first miss the half-glyph caret budget.
- MathJax is later proven cheap enough to join breakout; revisit the math exclusion then.

Installed-package OS mouse gates (`pnpm release:packaged-table-caret`, `pnpm release:installed-media-caret-os`, `pnpm release:installed-ux-stutter`) remain required on Windows with adaptive as the default. A Linux agent run can only skip or fail those scripts; it must not close this review condition.
