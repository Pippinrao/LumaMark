> Language: **English** · [中文](../zh/decisions/0014-settings-persistence.md)

# ADR 0014: Settings Persistence Moved Down to Rust Config File

**Status:** Accepted

**Date:** 2026-08-09

## Purpose and scope

This document records the decision to migrate LumaMark application settings from WebView `localStorage` to Rust-managed `settings.json`. Scope includes storage location, atomic writes, corruption handling, boundaries with session state, one-time migration, and rollback conditions. Product partitions and the field inventory follow [Settings System Design](../product/SETTINGS_SYSTEM_DESIGN.md).

## Context

Before this decision landed, preferences were scattered across multiple localStorage keys (`lumamark.app-preferences.v1`, `lumamark.reading-appearance.v1`, `lumamark.startup.v1`, `lumamark.sidebar-open.v1`, and others). `copyImagesToAssets` and `fontZoomPercent` existed only in memory and were lost on restart. WebView storage disappears when users clear site data or reinstall, and cannot be read uniformly by Rust-side tools or future export/backup paths. The product therefore needs a single, migratable, testable settings source of truth.

## Decision

- Use a single versioned `LumaMarkSettings` (currently `version: 2`), read and written by Rust `settings_service` at `app_config_dir()/settings.json`; v2 folds `updates.autoCheckOnStartup` into the sole settings source of truth.
- `settings_get` / `settings_set` only adapt `AppHandle` to the service; schema, field validation, defaults, atomic write, and corruption backup happen inside the service. Env/temp-root/canonical guardrails for acceptance-only config directories are fail-closed startup boundaries of the command adapter and do not enter the production settings schema.
- Writes use the existing dependency `atomic-write-file` for temp file + rename; do not introduce a new persistence crate.
- When the file is missing, return defaults and do not create the file; first user write persists to disk.
- On JSON parse failure: move the original file to a unique `settings.corrupt-<timestamp>[-n].json`, atomically write the default file, and return a structured recovery result; the same corrupt content is not re-backed up on every startup. Future schema versions return unsupported without backing up or rewriting the original file.
- The frontend accesses settings through `services/settings/settingsClient`; `features/settings/settingsStore` is the sole settings write entry. Debounce disk writes so high-frequency UI changes do not thrash disk.
- The store exposes structured load/recovery/write status; corruption recovery retains the backup path, ordinary read/write failures retain stable codes, and future versions explicitly block writes. Write failures keep the canonical snapshot for retry and do not degrade into mixed-meaning error booleans.
- An app-level close coordinator intercepts Tauri close requests and destroys the window only after pending settings flush succeeds; title-bar X, Alt+F4, and system close share that path. On flush failure the window stays open so the user can retry from the settings prompt.
- `appearance.theme` supports `light`, `dark`, and `system`; default remains `light` for determinism. `system` is resolved dynamically only at the consumer layer and does not write a second “currently resolved theme”.
- Shared contracts for TS/Rust defaults and validators are auto-checked by repository fixtures to avoid dual-language drift.
- Settings are separated from session state: recent files, `lastSession`, `recentWorkspaces`, and runtime temporary sidebar open/close stay in localStorage; only explicit user preferences enter `settings.json`.
- First-launch one-time migration: read old localStorage only when Rust explicitly returns that the config file does not exist; successfully write the new config first, then write the localStorage marker. Existence of the config file itself is the anti-overwrite guardrail; on save failure do not write the marker so the next startup can retry. Old keys are not deleted and are kept for at least one version cycle.
- Illegal enums or out-of-range numbers fall back to field defaults and report one visible error; do not discard the whole file when the file is readable but a single field is illegal.
- Documents without version, v0, and v1 are atomically written back to canonical v2 on read; future versions are rejected before any write-back, and after that hydration failure the frontend blocks the settings pending-write queue so defaults cannot overwrite an unknown version.
- Autosave and in-app recycle bin from issue #13 are out of scope for this decision; recovery drafts and OS recycle-bin file actions continue under their own contracts.

## Alternatives considered

- Keep using only localStorage: cannot solve restart loss and cross-reinstall migration, and multiple stores each serializing already caused field omissions.
- Write settings beside documents or into the workspace directory: settings are app-level preferences, not document metadata, and would pollute user repositories.
- Introduce a full embedded database or complex config center: current field volume is small; a JSON file is enough; excess infrastructure violates the plain-dependency principle.
- Delete old keys immediately on migration: removes rollback and comparison evidence.
- On corruption, silently overwrite with defaults and skip backup: violates “failure modes must be handled explicitly”.

## Consequences

- Adds `src-tauri/src/services/settings_service.rs`, `src-tauri/src/commands/settings.rs`, frontend `settingsClient`, and `settingsStore`.
- Existing preference stores must converge or become settings projections; startup hydration reads Rust settings first, then applies them to DOM / i18n / appearance.
- Pure browser web development mode needs a testable settings facade stand-in (in-memory or mock); unit/E2E must not hard-depend on a real app config directory.
- Automation must cover defaults, cross-language contracts, round-trips, corruption backup, structured errors, migration idempotence, debounce/retry, and close flush; Windows packaged acceptance must use real OS pointers for top theme-menu changes, immediate close, and restore after a fresh WebView profile restart.

## Rollback and revisit criteria

- If Rust config I/O is unstable on target platforms, temporarily fall back to a localStorage adapter implementing the same `settingsClient` interface, but keep error visibility; fallback requires revising this document’s status.
- If the product needs multi-profile / portable mode (USB-stick config), revisit path resolution and file layout.
- If large numbers of fields such as Markdown gates enter the schema, revisit splitting files or introducing a stricter schema migration framework; until then keep a single JSON file.
- If the atomic-write dependency changes, corruption and temp-file tests must be updated together.
