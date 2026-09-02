> Language: **English** · [中文](../zh/decisions/0022-default-full-width-page.md)

# ADR 0022: Default page width is fit-window (fluid)

**Status:** Accepted

**Date:** 2026-08-30

## Context

ADR 0021 made `adaptive` (`clamp(720px, 70%, 1100px)`) the default page width. Users asked to default to fitting the screen/window width instead. `fluid` already exists as `100%`, and the existing paper CSS still applies the 96px (desktop) / 36px (mobile) safe gutter via `min(calc(100% - gutter), var(--lm-editor-page-width))`.

A v4 settings document with `pageWidth: "adaptive"` cannot be distinguished from an untouched default, so an upgrade must rewrite it.

## Decision

- Change the default `appearance.pageWidth` to `fluid`.
- Bump settings schema to version 5.
- On upgrade, rewrite `adaptive` to `fluid` when `sourceVersion < 5`. The ADR 0021 rewrite (`sourceVersion < 4` and `standard` → `adaptive`) still runs first, so a v3 `standard` ends as `fluid`.
- Keep the `adaptive` preset selectable with the same CSS.
- Keep explicit `narrow`, `standard`, `wide`, and `fluid` values unchanged.
- A current-version document that explicitly stores `adaptive` is kept.
- Legacy localStorage `adaptive` maps to `fluid` for the same reason: it was the previous default and cannot be distinguished from an explicit choice.

## Alternatives considered

- **Redefine `adaptive` CSS as `100%`:** would silently change the meaning of a named preset and of any user who later selects Adaptive.
- **Delete the `adaptive` preset and keep only `fluid`:** more migration surface than needed; Adaptive remains a useful constrained-width option.
- **Change the default only for new installs:** existing v4 `adaptive` profiles would stay on the old default, which is the opposite of the requested product change.

## Impact

- New installs and migrated v4 `adaptive` (and older `standard`) profiles get a full-window writing column minus the safe gutter.
- Wide tables, Mermaid, PlantUML, and images still use `--lm-editor-block-track-width`.
- Users who want the previous Adaptive column can still choose Adaptive in Settings.
- TypeScript and Rust share `tests/fixtures/settings-v5-contract.json`.

## Rollback or review conditions

- Mixed-document input P80 exceeds the existing 8 ms gate.
- Many-table file-open P80 exceeds 300 ms (32 everyday GFM tables, Fluid, Adaptive, or Standard).
- Installed UX-stutter scroll longtask P95/max exceeds 50 ms with fluid as the default.

Idle-memory measurement (issue #32) must be re-run after this default change, because scrollbar and track-width interaction changes with a full-window column. Use `pnpm release:installed-idle-memory` (and `--duration-ms 600000` for the 10-minute samples). The script sums the `lumamark` + WebView2 process tree. A 30s idle sample on the 2026-08-25 installed Windows binary was about 430–520 MB working set after warmup and then plateaued; it did not reproduce the reported 3 GB idle.
