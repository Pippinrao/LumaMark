> Language: **English** · [中文](../zh/decisions/0005-external-file-and-image-watch.md)

# ADR 0005: External Markdown and Local Image Change Watching

Date: 2026-07-12

Updated: 2026-07-27 (image watcher wired to editor refresh and late-event isolation)

## Context

LumaMark previously read from disk only when opening a file. After other programs modified Markdown or replaced local images, the editor still showed stale content until reopen or restart. Saves also use atomic replace, so different editors may emit write, truncate, rename, or delete/create event combinations. Relying on a single event type is unsafe, and unsaved user input must never be silently overwritten.

## Decision

- Use mature Rust `notify-debouncer-full` to build a single `FileWatchService`. Do not make frontend `plugin-fs.watch` the editor-core watching layer.
- Watch only the parent directories of the current Markdown file and authorized local images, non-recursively, then precisely filter registered targets. Parent-directory watchers are shared and reclaimed by reference count; the workspace is not watched recursively.
- Watch events are only invalidation hints. After a 200ms debounce, re-read the target and compute a SHA-256 fingerprint so real disk content determines modify, delete, recreate, and self-save notifications.
- Fingerprints returned from open/save-as and the baseline installed by `watch_document` use the same algorithm. The frontend re-reads only when they disagree, closing the read→watch race without creating routine duplicate reads. On Windows temporary lock contention, the watch callback makes 3 bounded retries; after exhaustion it emits `kind: error`, surfaces a recoverable error only, and never rewrites editor content.
- Rust sends low-frequency typed events serially over `file-watch://changed`; the frontend drops late events by monotonic revision. A service facade owns command, listen, and unlisten; UI components never call Tauri APIs directly.
- When the current document is clean, automatically load the new disk content. When dirty, show “Reload from disk / Keep current content” and never overwrite editor text before the user chooses. On reload, read disk again, keep the current path, and preserve selection when possible. On file deletion, keep editor content and prompt.
- Local image changes only update the runtime preview revision for that source, re-authorize that path, and add a cache-busting parameter to the asset URL. Both Rust authorization results and frontend revision keys must collapse `.` / `..`, normalize path separators, and on Windows compare case-insensitively so the same file is not missed due to path spelling differences. Other local/remote widgets stay unchanged; Markdown source and image references stay byte-identical. Remote HTTP images keep their existing cache lifecycle and are not added to the disk watcher.
- Document switches, reference-set changes, and window unmount replace or clear watch targets; generation prevents old-document events from overwriting the new document.

### 2026-07-27 implementation update

- `file-watch://changed` `kind: image` events are wired to app-layer `refreshLocalImage({ path, revision })`, which then updates the same-source revision store, invalidates the resolver path, calls `EditorDocumentPort.refreshImages(path)`, and dispatches the image capability refresh effect.
- Resolver and revision store share `normalizeLocalPathKey`; re-resolved asset URLs carry the same-source `lmv=<revision>`. Image widget identity includes source revision, so hit images replace DOM while other widgets remain equivalent for reuse; Markdown body, dirty, and undo stay unchanged.
- The frontend drops old events by monotonic watch revision. Document reload results are isolated by generation, request id, and current path. Image target sync uses a serial queue + generation; switching documents clears old authorize/invalidate sets so stale target updates cannot overwrite the new reference set.
- Browser unit/integration tests verify event→resolver→editor effect, cache-busting, and late-result discard. Rust tests verify real watchers, atomic replace, and fingerprints. Browser mocks still cannot replace real Windows Tauri image-replace proof; exit criteria are in the [current execution plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

## Alternatives considered

- Re-read only on window refocus: cannot refresh images promptly and cannot reliably cover long background edits and atomic saves.
- Use `@tauri-apps/plugin-fs.watch` directly: fast to wire, but expands WebView directory capabilities and spreads conflict strategy and atomic-save compatibility into the frontend.
- Recursively watch the whole workspace: simple, but event volume and permission scope exceed current-document refresh needs.
- Always auto-overwrite on external change: loses user input in dirty documents.

## Consequences

- Adds Rust dependency `notify-debouncer-full`. Watching, hashing, and event emission live in the Rust service; Tauri commands stay thin entry points.
- Each change re-reads the corresponding target on a thread worker. Scope is one current document and its local images, merged over 200ms, and stays off the typing hot path. Multi-image target updates converge serially to the latest set; document and image targets have separate lifecycles.
- Playwright verifies interaction at the web command/event boundary. Real watchers, atomic replace, and public image cache are validated by Rust integration tests; browser mocks must not be labeled complete desktop E2E.
- Editor refresh is a no-doc-change targeted invalidation signal and follows the single primary `EditorView` and source-ownership contracts in [ADR 0006](0006-parity-reliability-editor-contracts.md).

## Rollback or revisit criteria

- Large image-heavy documents cause measurable watcher count, hash I/O, or memory regression.
- Multi-window needs independent document sessions and conflict state per window.
- Linux/macOS filesystem backends cannot stably cover atomic replace, or network/removable disks need a polling fallback.
- Version merge, three-way diff, or history recovery is required and a binary conflict dialog is insufficient.
