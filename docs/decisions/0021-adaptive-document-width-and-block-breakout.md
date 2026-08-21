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
- After a track-width write, force CodeMirror `mustMeasureContent` so table widgets (which are not in `blockWidgetGeometry`) refresh the height map.

## Alternatives considered

- **`container-type: inline-size` on `.lm-editor-paper`:** pure CSS, but `contain: layout` makes the paper a containing block for fixed-position descendants (CodeMirror panels, table menus) and ignores scrollbar width.
- **Fluid (`100%`) as the new default:** body text becomes unreadably long on wide screens.
- **Inner table/image scroll or `max-width` clipping:** forbidden by the table/widget geometry contract in `AGENTS.md`.

## Consequences

- New installs and untouched `standard` profiles get a wider prose column and breakout blocks.
- A user who had deliberately chosen `standard` is indistinguishable from an untouched profile and is migrated; they can set Standard again.
- Sidebar auto-fit remains independent (see ADR 0011). Adaptive page width does not change sidebar measurement.

## Rollback or review conditions

- Mixed-document input P80 exceeds the existing 8 ms gate, or installed UX-stutter scroll longtask P95/max exceeds 50 ms with adaptive as the default.
- Table caret mapping below a table fails after a pane resize (height map missed the breakout).
- MathJax is later proven cheap enough to join breakout; revisit the math exclusion then.
