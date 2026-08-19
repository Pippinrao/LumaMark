> Language: **English** · [中文](../zh/decisions/0020-preview-scheduler.md)

# ADR 0020: Preview scheduler for live-preview decorations

**Status:** Accepted

**Date:** 2026-08-19

## Context

Live preview previously rebuilt WYSIWYG decorations (and therefore paid for the full plugin `update()` stack) on the same CodeMirror transaction that handled typing, drag-select, and scroll. Installed 0.3.31 evidence showed mixed-document scroll producing 10 long tasks (max 165 ms). Shaving individual `update()` methods did not change that coupling.

## Decision

- Add an editor-layer preview scheduler (`src/editor/preview/previewScheduler.ts`).
- Source text, caret, and selection stay on the synchronous CodeMirror update.
- Viewport-driven WYSIWYG decoration rebuilds wait for one coalesced animation-frame preview pass (~6–8 ms budget). A later user gesture cancels the pending frame and reschedules.
- Block widgets (tables, math, Mermaid, PlantUML, images) keep reserved heights from `blockWidgetGeometry.ts` so click→caret mapping does not drift while a pass is pending.
- Do not disable those widgets to buy smoothness, and do not treat jsdom two-rAF duration as installed UX evidence.

## Alternatives considered

- **Fourth round of per-plugin `update()` micro-opts:** already failed three times against installed long tasks.
- **Rebuild decorations synchronously on `viewportChanged`:** cheapest to write; puts table widgets on the scroll path after everyday GFM tables start mounting.
- **Hand-rolled table grid to avoid the library on scroll:** violates mature-components-first and does not fix math/Mermaid.

## Consequences

- Newly visible viewport ranges may wait one frame before heading/emphasis marks appear.
- Installed stutter gates must sample `longtask` during the gesture and require everyday table widgets, not two-rAF after `scrollTop += 280`.

## Rollback or review conditions

- Click→caret geometry drifts after deferred widget height (see `AGENTS.md` table/media rules).
- Preview marks stay missing for more than one frame during ordinary typing.
- Upstream CodeMirror grows a first-party decoration scheduler that can replace this plugin.
