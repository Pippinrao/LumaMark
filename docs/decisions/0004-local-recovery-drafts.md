> Language: **English** · [中文](../zh/decisions/0004-local-recovery-drafts.md)

# ADR 0004: Safety Boundaries for Local Recovery Drafts

Date: 2026-07-11

Updated: 2026-07-27 (recovery drafts use exact source serialization)

## Context

A writing app should preserve unsaved work after unexpected exits as much as possible, but recovery must not bypass the user’s save intent and must never silently overwrite Markdown source files. Recovery also must not put high-frequency Markdown body text into React or Zustand state.

## Decision

- After edits, debounce 500ms and write the current CodeMirror exact serialized text plus an optional original file path into browser local storage via `EditorDocumentPort.serializeText()`. Do not substitute normalized `getText()`.
- Draft persistence lives in `services/drafts`. React features only schedule snapshots, present recovery choices, and read or load text through `EditorDocumentPort`.
- Serialized snapshots include UTF-8 BOM, mixed LF/CRLF/CR distribution, and trailing-newline intent recovered by `DocumentSourceFormat`. On restore, `loadText(..., { saved: false })` rebuilds normalized `Text` and format state and enters the editor as an unsaved document. Detailed contracts are in [ADR 0006](0006-parity-reliability-editor-contracts.md).
- After startup, once the editor port is ready, if a draft exists, a Radix dialog explicitly offers “Restore draft” and “Discard draft”. The dialog must not be dismissed via Escape or overlay click to skip the choice.
- Restore always creates a new unsaved document: clear the document context path, mark dirty, focus the editor; never write back or overwrite the recorded original file path.
- On successful open, new document, or successful save while the document stays clean, cancel pending write tasks and clear any existing recovery draft.
- If browser storage is unavailable or corrupt, recovery degrades safely without affecting in-progress editing.

## Alternatives considered

- Silently write recovered content back to the original file: bypasses user confirmation and may overwrite a newer on-disk version.
- Put full text in the app store: pulls high-frequency changing data into React subscriptions and breaks editor hot-path boundaries.
- Persist only on `beforeunload`: unreliable for abnormal exits, process termination, or WebView crashes.

## Consequences

- Recovery drafts are a short-term recovery capability inside the local browser profile, not cross-device sync or version history.
- The stored original file path is only used to explain provenance, never for automatic writes.
- Unit/integration tests cover scheduling, explicit restore, post-save cleanup, unavailable storage, and save/restore round-trips for BOM, mixed newlines, and trailing newlines. Playwright covers both real restore and discard user paths.
- Drafts store one exact serialized string; they do not hold a live `EditorState`, selection, or undo history. Undo boundaries after restore are still established by the primary EditorView.

## Rollback or revisit criteria

- Local storage capacity, privacy policy, or multi-window needs make a single draft slot insufficient.
- When multiple drafts across restarts, version history, encryption, or cross-device sync are required, move to an independent service with capacity management and conflict strategy.
- The restore path affects CodeMirror IME, undo/redo, selection stability, or startup performance.
- Browser storage or a later draft schema cannot preserve format intent expressed by `DocumentSourceFormat` byte-for-byte.

Current recovery-draft gates are included with active-save in the [Typora Parity core experience improvement plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).
