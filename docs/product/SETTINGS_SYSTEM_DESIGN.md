> Language: **English** · [中文](../zh/product/SETTINGS_SYSTEM_DESIGN.md)

# LumaMark Settings System Design

> This document defines the information architecture of the LumaMark settings dialog, the `LumaMarkSettings` schema, persistence and migration contracts, the boundary between settings and session state, i18n/a11y, and acceptance criteria. It is for settings implementers, testers, and later Markdown capability maintainers. Current implementation order remains governed by the [Typora Parity Core Experience Improvement Plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md). Persistence-backend decisions are in [ADR 0014](../decisions/0014-settings-persistence.md).

## Purpose and scope

This design addresses the following confirmed problems:

- The settings page had only horizontal tabs and a few configurable items, lacking Typora-style left section navigation.
- Preferences were scattered across multiple localStorage keys and in-memory stores; `copyImagesToAssets` and `fontZoomPercent` were lost on restart.
- There was no unified settings schema or Rust-side config file, so settings were not migratable across sessions/reinstalls.
- The boundary between settings and session state was unclear, making it easy to stuff recent files or temporary sidebar state into the config file.

Scope includes:

- Vertical section navigation and section content for the settings dialog.
- Versioned `LumaMarkSettings` schema.
- Rust config-file read/write, corruption handling, and one-time localStorage migration.
- Consumption contracts for settings changes into theme, i18n, reading appearance, and editor compartments.
- Layered test design and acceptance criteria.

## Non-goals

- This round does not implement Markdown syntax toggle UI (Inline Math, Highlight, superscript/subscript, Diagrams, GitHub Style Alert), and does not write consumer-less fields into the code schema.
- Do not move “About LumaMark” into the settings page; version information continues to live in Help → About.
- Do not write the recent-files list, last-session path, or current-window temporary sidebar open/closed state into `settings.json`.
- Do not add issue #13 auto-save or an in-app recycle bin in this round. Recovery drafts continue to obey ADR 0004’s independent safety boundary; file delete uses only the OS recycle-bin semantics defined by workspace actions.
- Do not introduce a second settings UI component library; continue using Radix Dialog/Tabs, and use the same-family official AlertDialog for destructive confirmation focus and keyboard contracts.
- Do not replace CodeMirror, Zustand, Tauri, or the existing command-palette architecture.

## Sources of truth

- Typora Preferences facts come from the [Typora behavior baseline](typora-baseline/README.md). Most Markdown preference provenance is `support`; items not verified item-by-item on a local machine must not be written as confirmed GUI facts.
- LumaMark current state comes from code, the [Typora topical competitive analysis](typora-competitive-analysis/README.md), and [Menu System Design](MENU_SYSTEM_DESIGN.md).
- Persistence backend is governed by [ADR 0014](../decisions/0014-settings-persistence.md).

## Current problems and root causes

Before the redesign, `SettingsDialog` used horizontal Tabs, and persistence was owned by each feature store reading/writing its own `lumamark.*.v1` localStorage key. Image-copy policy and font zoom lived only in memory. The current implementation has already converged on the v2 schema, a Rust settings service, and vertical Radix Tabs; this section is kept to explain migration provenance, not as a current-state inventory. The root cause was the lack of a single settings source of truth and a clear “settings vs session state” boundary—not missing CSS.

## Option choice

### Adopted: Radix Dialog + Fluent/Mica adaptive workspace + Rust `settings.json`

- UI: keep an in-app modal dialog and set `Tabs.Root` to `orientation="vertical"` (left section navigation + right scrollable content). Wide windows use a large adaptive workspace; translucency, blur, and layered surfaces form a clear Fluent/Mica character, while opaque fallbacks cover environments without `backdrop-filter`, forced colors, or reduced visual effects. Radix owns Dialog, Tabs, RadioGroup, Switch, and AlertDialog ARIA, focus, and keyboard contracts.
- Data: a single `LumaMarkSettings`, invoked through `services/settings/settingsClient` via thin Tauri commands, atomically written by Rust `settings_service` to `app_config_dir()/settings.json`.
- Frontend `features/settings/settingsStore` is the only writable settings store; existing scattered preference stores gradually converge to field projections of this store or are replaced directly.

### Not adopted

- Keep localStorage only: cannot migrate across WebView data clears and reinstalls, and existing field loss already proves unreliability.
- Separate settings window / routed page: the product is still a single-window writing shell; a separate window adds focus and testing cost for insufficient benefit.
- Hand-rolled sidebar navigation: violates mature-components-first.
- Persistent settings search: there are only about ten real settings today; showing a search box without implementing search would be decorative fake capability. Reassess with a real index over searchable titles, descriptions, and categories when field count grows significantly.

## Form and interaction

- Open entries: File menu “Settings”, command palette `open-settings`, and any existing shortcut.
- The dialog uses an ideal size around `980 × 680` and is always constrained by viewport safe margins; it is not a fixed-pixel window. Dialog title, section titles, and descriptions go through i18n; the close button has an accessible name.
- Left section order is fixed: General → Appearance → Editor → Images.
- The left rail uses monochrome icons, visible text, a soft selected surface, and an accent indicator bar. It must not share the same visual style as segmented/radio controls in the content area.
- Each right-hand section has its own title, short description, and semantic settings groups. Groups share one lightweight surface; do not wrap every row in its own card. Rows contain the setting name, a necessary one-line helper when needed, and a compact control on the right.
- The right content area is the only primary scroll container. Switching sections does not reset unsaved control drafts—this design uses an immediate-write model (change takes effect and debounce persists), with no “Apply” button and no toast for normal saves.
- Theme and page width are the exceptions that need visual judgment: theme uses light/dark/system preview cards; page width uses measure-width graphics. Other enums and booleans continue to use compact mature controls to avoid turning the whole page into cards.
- Mica is an in-app visual material, not a new Tauri native window. Background blur must not be required for information readability; when blur is disabled, Windows forced colors are active, or transparency is unavailable, degrade to fully opaque surfaces.
- When width is sufficient, fix the left rail and content area. Narrow windows switch to single-column section navigation / content drill-in. Do not mechanically crush dual columns and long segmented controls, and do not create horizontal scrolling.
- Escape / close button closes the dialog; after close, focus returns to the trigger or editor per the existing menu focus contract. Clear recent files uses Radix AlertDialog: default focus on Cancel, Tab/Shift+Tab stay inside the confirm dialog, and Escape only cancels the nested confirm and returns to its trigger.
- Section and control information remain distinguishable in light/dark and Windows high contrast; respect `prefers-reduced-motion`.

## Sections and item inventory

Only list items with real execution paths. Parentheses show control type and default.

### General (`settings.sectionGeneral`)

| Item | Control | Default | Data field | Notes |
|---|---|---|---|---|
| Language | Radix RadioGroup: `zh-CN` / `en` | `zh-CN` | `general.language` | Shares the same source of truth as the top-bar language menu |
| Startup behavior | Radix RadioGroup: `home` / `restoreLastSession` | `home` | `general.startupBehavior` | Migrate this field out of `startupStore` |
| Auto-check for updates on startup | Radix Switch | `true` | `updates.autoCheckOnStartup` | Replaces the standalone `updatePreferencesStore`; update download progress remains session state of the updates feature |
| Clear recent files | Button + secondary confirm | — | Operates on `recentFilesStore` | The list itself is session state and does not enter `settings.json`; place the `settings.recentFilesPersistenceError` hint in this section |

### Appearance (`settings.sectionAppearance`)

| Item | Control | Default | Data field | Notes |
|---|---|---|---|---|
| Theme | Visual RadioGroup: `light` / `dark` / `system` | `light` | `appearance.theme` | Show three compact previews; shared with top-bar theme menu; `system` resolves dynamically via `prefers-color-scheme`; neither first frame nor runtime system switches rewrite the stored preference |
| Page width | Visual RadioGroup: `adaptive` / `narrow` / `standard` / `wide` / `fluid` | `fluid` | `appearance.pageWidth` | Express width with measure graphics; mapping is clamp(720px, 70%, 1100px) / 680 / 810 / 1040 / 100%. Current default is `fluid` (fit window); see ADR 0022. |
| Font zoom | number + stepper, 50–250, step 10 | `100` | `appearance.fontZoomPercent` | Do not use a continuous slider, to avoid drag-driven high-frequency shell re-renders; Ctrl+wheel and “Reset zoom” remain available |
| Expand sidebar on startup | Radix Switch | `true` | `appearance.sidebarOpenOnStartup` | Affects startup default only; runtime sidebar open/closed remains session state |

### Editor (`settings.sectionEditor`)

| Item | Control | Default | Data field | Notes |
|---|---|---|---|---|
| Default display mode | Radix RadioGroup: `livePreview` / `source` | `livePreview` | `editor.defaultDisplayMode` | Initial mode for new/opened documents; does not rebuild the current mode of an already open `EditorView` unless product later decides otherwise |
| Enter focus mode on startup | Radix Switch | `false` | `editor.focusModeOnStartup` | Applied once after startup |

### Images (`settings.sectionImages`)

| Item | Control | Default | Data field | Notes |
|---|---|---|---|---|
| Copy local images into document assets | Radix Switch | `false` | `images.copyImagesToAssets` | UI already exists; this round adds persistence |

### About

Not hosted on the settings page.

## Schema

```ts
export type LumaMarkSettings = {
  appearance: {
    fontZoomPercent: number;
    pageWidth: 'adaptive' | 'fluid' | 'narrow' | 'standard' | 'wide';
    sidebarOpenOnStartup: boolean;
    theme: 'dark' | 'light' | 'system';
  };
  editor: {
    defaultDisplayMode: 'livePreview' | 'source';
    focusModeOnStartup: boolean;
  };
  general: {
    language: 'en' | 'zh-CN';
    startupBehavior: 'home' | 'restoreLastSession';
  };
  images: {
    copyImagesToAssets: boolean;
  };
  updates: {
    autoCheckOnStartup: boolean;
  };
  version: 2;
};
```

Validation rules:

- `fontZoomPercent` must be an integer from 50–250 and a multiple of 10; otherwise fall back to default and report one visible error.
- Unknown enum values fall back to default and report one visible error; do not swallow silently.
- Missing or non-boolean boolean fields fall back to default per field and report; a missing v2 `updates` section on v0/v1 is normal schema migration, not corruption.
- Unknown top-level/section fields are ignored on read; server normalization writes back only known v2 fields. If plugins later need extension, revise the unknown-field retention contract then.
- Missing version, v0, and v1 are migrated to v2 after read. Files newer than the current version return `settings.unsupported_version`; the original file must not be backed up, overwritten, or written back as a downgrade.

## Settings vs session-state boundary

| Category | Storage | Examples |
|---|---|---|
| Settings | `settings.json` | Language, theme, page width, font zoom, startup behavior, image-copy policy, default display mode, auto-check updates |
| Session state | WebView localStorage | `lastSession`, `recentWorkspaces`, recent-files list, current-window temporary sidebar open/closed |

Therefore:

- `startupStore` migrates only `startupBehavior` into settings; `lastSession` and `recentWorkspaces` stay in place.
- `recentFilesStore` is not migrated at all; settings only provides a “Clear” action.
- Runtime `sidebarOpen` can still be toggled from the View menu; `sidebarOpenOnStartup` is read only at startup.

## Persistence and migration contracts

Data flow:

```text
SettingsDialog
    → features/settings/settingsStore
    → services/settings/settingsClient
    → commands/settings.rs (AppHandle / env / acceptance-path adapter)
    → services/settings_service.rs
    → app_config_dir()/settings.json
```

Rules:

1. When the file does not exist, return defaults and do not create the file; first user write creates it on disk.
2. Writes use the existing `atomic-write-file` atomic replace; no leftover temp files after success.
3. JSON corruption: move the original file to a unique `settings.corrupt-<timestamp>[-n].json` (bytes identical to the corrupt original), then atomically write the default file and return a structured recovery result. The next startup reads the recovered file and does not re-backup the same corrupt content.
4. Frontend `settingsClient` does not depend on React; invoke failures throw explicit errors and do not silently fall back to defaults (startup hydration’s “defaults after corruption” path is an explicit structured result from the Rust service, distinct from “write failure”).
5. Debounce disk writes (suggested 300–500ms) so font-zoom dragging does not write every frame; settings changes are not on the editor input hot path.
6. Settings changes are consumed through existing providers / compartments and do not rebuild `EditorView`.
7. Migration runs once: when `settings_get` reports `settingsFileExists === false`, the frontend pure-reads old localStorage keys → maps to v2 → successfully writes `settings.json` → finally writes localStorage marker `lumamark.settings.migrated-from-localStorage.v2`. The migration function itself does not write the marker; save failure does not write the marker, so the next run can retry. Old keys are not deleted.
8. Config-file existence is the first anti-overwrite guardrail: as long as `settings.json` already exists, do not migrate even if the localStorage marker is missing. With an existing marker, likewise do not re-migrate. With no legacy values at all, create neither the config file nor the marker.
9. Recoverable field errors return `hadInvalidFields`; the frontend shows one visible tip and writes back the normalized document. JSON corruption, ordinary IO errors, and future versions are handled separately and must not share a silent fallback.
10. When reading versionless, v0, or v1 files, Rust persists canonical v2 via the same atomic write path before returning; normal version migration must not be presented as field corruption. After read failure for a future version or any file that cannot be safely read, the frontend blocks subsequent settings writes for that session and discards the pending-write queue, so defaults cannot overwrite an unknown document.
11. The frontend exposes only structured lifecycle: `loadState` distinguishes ready / read failed / unsupported; `recoveryState` distinguishes field recovery vs corruption recovery (including backup path); `writeState` distinguishes pending / saving / failed. UI maps stable codes to localized, actionable copy and does not show raw English Rust messages.
12. Write failure keeps the current canonical snapshot; `retryPendingWrites` retries the same snapshot; later new changes still merge on a serial queue. The app-level close coordinator synchronously intercepts Tauri close requests and waits for `flushPendingWrites` success before `destroy`; on failure the window stays open with a retryable tip. Title-bar X, Alt+F4, and system close share this contract.
13. TypeScript and Rust defaults and validators are cross-checked automatically via `tests/fixtures/settings-v5-contract.json`; field additions or enum extensions must update the fixture and both sides’ tests.

Old key mapping:

| Old key | Migrated field |
|---|---|
| `lumamark.app-preferences.v1` → `language` / `theme` | `general.language` / `appearance.theme` |
| `lumamark.reading-appearance.v1` → `pageWidth` | `appearance.pageWidth` |
| `lumamark.startup.v1` → `startupBehavior` | `general.startupBehavior` |
| `lumamark.sidebar-open.v1` | `appearance.sidebarOpenOnStartup` |
| `lumamark.update-preferences.v1` → `autoCheckOnStartup` | `updates.autoCheckOnStartup` |
| `appStore.copyImagesToAssets` (in-memory, no key) | No history to migrate; default `false` |
| `fontZoomPercent` (in-memory) | No history to migrate; default `100` |

## Deferred Markdown gating strategy

This round’s code schema does not include a `markdown` section. Design locks the following in advance so capability landing can implement them in the same batch:

1. Section name: `markdown`.
2. Gate consumers: corresponding editor capability / language compartment; changes hot-reconfigure via `Compartment.reconfigure` and do not rebuild `EditorView`.
3. Closed-state degradation: source remains visible as-is and must not be misclassified as other structures (consistent with current protected-source safe degradation).

Do not render corresponding toggle UI until capability and baseline real-device verification are complete.

## i18n

- All section names, row labels, options, buttons, confirm copy, and error tips enter `en` and `zh-CN` resources.
- Do not concatenate translation fragments.
- All new and previously missing `settings.*` keys are added to `requiredCoreKeys` in `i18n.test.ts`.

Suggested key prefixes:

- `settings.sectionGeneral` / `settings.sectionAppearance` / `settings.sectionEditor` / `settings.sectionImages`
- `settings.fontZoom` / `settings.sidebarOpenOnStartup`
- `settings.defaultDisplayMode` / `settings.displayLivePreview` / `settings.displaySource`
- `settings.focusModeOnStartup`
- `settings.clearRecentFiles` / `settings.clearRecentFilesConfirmTitle` / `settings.clearRecentFilesConfirm`
- Existing `settings.theme*`, `settings.pageWidth*`, `settings.startup*`, `settings.copyImagesToAssets`, and persistence error keys continue to be used

## Accessibility

- Vertical Tabs: `aria-orientation="vertical"`; ArrowUp/ArrowDown switch sections.
- Enums use Radix RadioGroup `radiogroup` / `radio` semantics; booleans use Radix Switch `switch` / `checked` semantics—do not fake basic controls with ordinary buttons and hand-written `aria-pressed`.
- Font-zoom controls expose `aria-valuemin` / `aria-valuemax` / `aria-valuenow`.
- Theme and page-width visual options must not express selected state by color or thumbnail alone; they must also provide text, border/indicator, and an accessible checked state.
- Mica background and transparency fall back to opaque surfaces under forced-colors, unavailable `backdrop-filter`, and equivalent reduced-transparency environments; focus rings and selected states remain clear.
- Field recovery, corruption recovery, read failure, future-version block, and write failure each use `role="alert"`; write failure provides “Retry save”.
- Clear recent files must use Radix AlertDialog secondary confirmation; cancel does not clear; default focus, trap, Escape, and focus return are all covered by automation.

## Architecture boundaries

- `services/settings` must not depend on React, Zustand stores, or the app shell.
- `features/settings` must not `invoke` directly; only through `settingsClient`.
- The settings store does not hold full Markdown text or high-frequency editor selection.
- Settings schema, defaults, migration, field validation, and settings-file IO live in `settings_service`; Rust commands only adapt `AppHandle`, environment variables, and fail-closed acceptance-only config paths, and do not carry production settings business rules.

## Test design

Follow Vitest + jsdom, co-located tests, Rust inline `#[cfg(test)]` + `unique_test_dir`, and Playwright `tests/e2e/`. Tests first per `DEVELOPMENT_PROCESS.md`.

### Rust unit

1. Missing config file returns default settings and does not create the file.
2. After write, read-back equals field by field.
3. After successful atomic write, no leftover temp files in the directory.
4. Corrupt JSON returns defaults and produces a backup whose content matches the corrupt bytes.
5. First write creates the config directory when missing.
6. Unknown fields are ignored; `version` is never written back lower.
7. Illegal enums, booleans, and zoom recover only the corresponding fields, with `hadInvalidFields=true`; zoom falls back to `100`.
8. v0/v1/missing-version migrate and atomically write back v2; future-version original files stay untouched, no corrupt backup is created, and the current session must not overwrite that file.
9. Corrupt JSON is backed up only once; the second read uses the recovered default file.
10. Read/write IO errors use `settings.read_failed` / `settings.write_failed`.

### Frontend unit

11. `settingsClient` preserves invoke `code/recoverable` and does not fall back to defaults on failure.
12. `settingsStore` triggers only one disk write for continuous changes inside the debounce window; `flushPendingWrites` writes the last value and stays serial; write failure keeps the canonical snapshot and returns to idle after successful retry.
13. Concurrent close requests flush/destroy only once; failure does not destroy and the next attempt can retry.
14. Migration: old localStorage snapshots map correctly; `lastSession` / `recentWorkspaces` are not migrated; updater preferences enter v2.
15. Existing config does not read legacy; marker is written only after successful save and failed saves remain retryable; with no legacy, neither file nor marker is written.
16. Illegal values fall back to defaults and produce one visible error.
17. After migration, old keys still exist.

### Component

18. Vertical section names and order, `aria-orientation="vertical"`, and arrow-key switching.
19. Accessible names and states for each new item, once each in Chinese and English.
20. Font-zoom range, step, and `aria-valuenow`.
21. Clear-recent-files Radix AlertDialog default cancel focus, focus trap, Escape, single confirm execution, and focus return.
22. `role="alert"` bilingual copy for invalid fields, corruption + backup path, read failure, unsupported/block, and write failure + retry remains visible in any section.

### Integration

23. Theme / page width / font zoom sync to the DOM or editor container.
24. After browser fallback adapter reload, `copyImagesToAssets` and `fontZoomPercent` reflect persisted values; that result only proves the Web/E2E facade and is not Rust config-file evidence.
25. Settings changes do not rebuild the `EditorView` instance.

### E2E

26. Open settings → keyboard-switch sections → change font zoom → reload → value retained.
27. Capture and manually approve [light Chinese](../../artifacts/settings-report/settings-light-zh.png), [dark Chinese](../../artifacts/settings-report/settings-dark-zh.png), and [dark English](../../artifacts/settings-report/settings-dark-en.png) representative four-section screenshots at 1440×900; automation also asserts the large panel does not overflow the viewport, English controls are not unnecessarily truncated, and theme/page-width selected states are distinguishable. Historical screenshots only describe structure at that time and do not automatically become the new visual baseline.
28. At 520×620 and key intermediate breakpoints, verify single-column navigation/content switching, independent main-content scrolling, and no horizontal overflow; under forced-colors and without `backdrop-filter`, surfaces are opaque and focus, radio, and switch states remain distinguishable.
29. Current worktree Release exe, in an isolated system-temp config, first establishes an on-disk baseline, then uses a real OS pointer from the top theme menu to switch to `system`, and immediately closes with the window X without waiting for that change to flush. After close-coordinator flush, restart with the same exe, same isolated config, and a fresh WebView profile, and read back from both the settings UI and canonical v2 `settings.json`. Browser localStorage reload, Rust service unit tests, or pre-written JSON alone cannot substitute for this combined evidence.

### i18n and architecture

30. All `settings.*`-related core keys enter `requiredCoreKeys`.
31. `tests/quality` architecture boundaries: services do not depend on React; features do not invoke directly.

### Gate commands

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm test:e2e`, `pnpm quality:web-build`; add `pnpm test:fixtures` when editor transactions are involved; performance benches run alone serially via `pnpm perf:bench`.

## Acceptance criteria

1. The settings dialog is an in-app Fluent/Mica adaptive workspace: vertical sections on wide windows, single column on narrow; four-section content matches this inventory; no fake search or unimplemented toggles.
2. `copyImagesToAssets` and `fontZoomPercent` survive restart.
3. Config read/write goes through Rust `settings.json`; corruption has backup and visible errors; no silent wipe.
4. localStorage migration uses config existence as the anti-overwrite guardrail, writes the marker only after successful save, is idempotent, and does not delete old keys; session-state fields are not migrated into the config file.
5. Chinese and English resources are symmetric; `requiredCoreKeys` covers settings-related keys.
6. Settings changes do not rebuild `EditorView` and do not put full Markdown text into React stores.
7. Automated items in this test design have fresh pass evidence; manual spot-check items are marked separately.

## When to update

- Add or remove settings sections or fields.
- Change persistence backend, migration strategy, or corruption handling.
- Markdown gating capabilities land and need toggle UI.
- Settings-related test gates or a11y contracts change.
