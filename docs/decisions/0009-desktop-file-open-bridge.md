> Language: **English** · [中文](../zh/decisions/0009-desktop-file-open-bridge.md)

# ADR 0009: Desktop File Open and Multi-Window Routing

**Status:** Accepted

**Date:** 2026-08-05 (updated 2026-08-15)

## Purpose and scope

This document defines LumaMark’s durable handoff, document identity, window ownership, and routing boundaries when opening Markdown files from OS launch args, file associations, and secondary-instance requests. Scope includes `multiWindow` / `aggregateWindow`, dynamic Tauri windows, crash recovery, exactly-once lifecycle, and isolated Windows routing acceptance. It does not introduce in-page tabs and does not change the principle that Markdown body is owned exclusively by CodeMirror.

## Context

Desktop open is not a disposable UI event. A new window may not be mounted yet, the target window may crash before request completion is acknowledged, and alias paths may point at the same file. Emitting events only or inspecting live windows only causes lost requests, duplicate opens, or the same document edited in two windows at once.

Tauri’s single-instance callback is a synchronous entry. Official [`WebviewWindowBuilder` known issues](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html#known-issues) explicitly note that creating a WebView directly inside a synchronous command/event handler on Windows can deadlock, so the callback must not parse files, read settings, access durable state, or create windows.

## Decision

- Use official `tauri-plugin-single-instance` and register it strictly as the first Tauri plugin; that is the upstream contract guaranteeing a secondary exits before other plugin setup. The builder pre-manages a readiness gate that does not read or write config; only after single-instance is a dedicated open-request state plugin registered. That plugin only initializes and manages durable authority and does not publish ready. The primary’s sole startup worker must first complete retained-target recovery and initial argv routing in fixed order, then permanently publish routing ready. Secondaries therefore neither restore nor rewrite durable state, and callbacks received by the primary during setup cannot bypass startup recovery. Ordinary UI/platform plugins such as dialog, updater, and opener continue after both. The Windows bundle declares `md`, `markdown`, and `mdown` file associations; ProgId / NSIS `FILECLASS` use stable identifiers, and descriptive copy does not enter registry keys.
- The first instance retains `std::env::args_os()`; secondary instances receive `Vec<String>` under upstream constraints. Parsing forbids `std::env::args()` and `to_string_lossy`. Within one launch, every valid Markdown argument enters the same serial routing worker in original order; non-Markdown args and flags are ignored; first-instance paths that cannot be represented as UTF-8 fail explicitly.
- The single-instance synchronous callback only copies `AppHandle`, args, and cwd, then posts work via `tauri::async_runtime::spawn_blocking`. The worker first bounded-waits for routing readiness; only after ready does it resolve config, identity, settings, or persistence. On timeout it fails closed with stable error `desktop.open_request_state_startup_timeout` and logs; infinite wait or bypassing authority is forbidden. First-instance setup uses the sole worker to restore retained targets first, then route initial argv; any step failure does not publish ready and must not bypass routing by writing directly to `main`.
- `DesktopWindowRoutingService` holds a global mutex. The lock covers arg parsing, one `DocumentPathIdentity::resolve`, claim-owner lookup, active-request lookup, window select/create, and durable enqueue, ensuring concurrent same-path opens do not double-create windows and concurrent different paths do not reuse the same `document-N` label.
- `DocumentClaimService` is the in-memory Pending/Owned authority; `OpenRequestService` is the durable handoff authority. Both share the same validated identity and do not invent a separate path-owner table. Durable records store lexical aliases and resolved identity snapshots; queries only scan the in-memory index; unrelated offline/UNC retained paths must not touch disk or block the current path.
- Durable requests use queued → processing → applied-pending → acknowledged lifecycle. Only acknowledged deletes the retained identity. `desktop-open-requests-available` is only a directed hint; after mount the window must actively recover/claim, so early or duplicate notifications do not lose requests. A relaunch for an already owned or active target still performs idempotent durable enqueue, then notifies and focuses, so query/ack/claim races cannot swallow the launch.
- Every file-bearing route first checks claim owner, then retained target; those authority hits do not depend on settings availability. Missing owner/target labels rebuild the window with the original label. Only new identities read `openWindowMode` from canonical settings:
  - `multiWindow`: on first-instance cold start, if the empty `main` already created by Tauri has no claim/retained authority, the first new identity reuses `main`; later paths in the same batch and secondary-instance new identities create the lowest available `document-N`, excluding both live labels and durable active targets. If `main` already has a retained target, overwriting is forbidden and the first new identity also creates `document-N`;
  - `aggregateWindow`: prefer reusing `main`, else the deterministic first managed live window, and only create `main` if no window exists;
  - No-file activation: focus `main` or the deterministic first managed live window; do not read settings or create requests.
- Dynamic windows may only be cloned from the main `WindowConfig`; labels may only be `main` or canonical `document-N`. The default capability precisely covers `['main', 'document-*']`; global `*` or expanded permission sets are forbidden.
- New windows must be safely created before durable enqueue. If enqueue returns failure or rejection, destroy the just-created empty window; rollback failure returns a combined error. Failure of create, notify, show, restore, or focus is logged explicitly and fails closed; after durable enqueue succeeds, notify/focus failure must not delete the request.
- On startup, read durable `active_target_windows`, rebuild missing labels in deterministic order, and notify them directionally so old queued/processing/applied-pending requests do not starve forever. Recovery and first-instance argv must run sequentially inside the same routing mutex on the same `spawn_blocking` worker (restore first, then route); two concurrent tasks must not race for order. Only after the whole batch succeeds may readiness be published and waiting secondary workers released.
- Routing acceptance uses `LUMAMARK_ROUTING_ACCEPTANCE_MODE=1` and must also provide a config dir that already passes existing settings acceptance checks: a dedicated random parent under the system temp directory, a precreated fixed `settings-config` leaf, no `.`/`..`, and still contained after canonicalization. When the marker is missing, menu acceptance continues to skip single-instance; when the marker is not `1` or the strict config is missing, startup fails closed. Routing scripts must also remove menu-only `LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR` from all child process environments to prevent cross-contamination between acceptance protocols. Acceptance scripts must use a run-unique ownership nonce/marker, re-prove canonical path, fixed leaf, ownership marker, and no occupying process before cleanup, and must never clean real user config.

## Alternatives considered

- Treat event payloads as file truth: lost before listeners attach, with no replay or completion acknowledgment.
- Enqueue primary argv directly to `main`: bypasses window mode and owner/retained authority and aggregates multi-path errors into one window.
- Place the open-request state plugin before single-instance: a secondary would restore or rewrite the primary’s durable state first; waiting for readiness inside the synchronous callback would also block the entry. Reading settings, resolving identity, persisting, or creating a WebView in the synchronous callback also introduces Windows deadlock risk.
- Re-resolve the full retained path table on every query: one unrelated offline/UNC path can block all routing and puts O(N) filesystem/network I/O on the startup chain.
- Deduplicate only by string or live window: path aliases, crash recovery, and query/ack races all break single ownership.
- Dynamic windows with arbitrary labels or capability `*`: permission boundaries cannot be audited.
- Custom single-instance socket/named pipe: the official plugin covers current platform needs; revisit only if secondary non-UTF-8 upstream limits become a real requirement.

## Consequences

- Rust gains a focused desktop window router, document claim authority, durable open-request lifecycle, and identity snapshots; Tauri commands stay thin entry points.
- The frontend actively recovers/claims by window label; after open it first record-applied, then acknowledges. Window destruction releases the processing lease but keeps applied-pending.
- Automation must cover default multi, aggregate, owner/pending coalesce, missing target/owner rebuild, no-file focus, create/enqueue rollback, same/different-path concurrency, label uniqueness, exact batch argv dispatch, authority hits when settings are unavailable, and startup recovery.
- Browser E2E, Rust fakes, and CDP synthetic input cannot prove Windows WebView, file associations, secondary instances, and real focus. Before release, still run the real executable on an isolated config and install path and retain commands, exit codes, logs, window label/path JSON, screenshots, and OS pointer evidence after `ClientToScreen`.

## Rollback and revisit criteria

- If dynamic windows or single-instance regress startup/packaging stability, temporarily disable file-association entry points, but do not degrade to lossy events or silently stuff every request back into `main`.
- If in-page tabs are introduced, redefine aggregate tab selection, dirty decisions, and document claim granularity.
- If real users need non-UTF-8 secondary-instance paths, evaluate Tauri upstream or platform-native IPC; do not use lossy conversion.
- If the installer cannot stably prove multi-window, aggregate reuse, crash recovery, and exactly-once, release gates fail and push/tag/Release must not proceed.
