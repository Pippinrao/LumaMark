> Language: **English** · [中文](../zh/decisions/0015-external-open-and-file-mutations.md)

# ADR 0015: External Open and Workspace File Mutations

**Status:** Accepted

**Date:** 2026-08-09

## Purpose and scope

This document records the dependencies, permissions, and security boundaries introduced for link context-menu “Open link”, image/file-tree “Reveal in File Explorer”, and file-tree create/rename/delete. Scope includes opener selection, protocol allowlist, workspace path-escape protection, delete semantics, and capability changes. Menu information structure follows [Menu System Design](../product/MENU_SYSTEM_DESIGN.md).

## Context

Before this decision landed, `src-tauri` only registered `tauri-plugin-dialog` and `tauri-plugin-single-instance`; `capabilities/default.json` granted only `core:*` window permissions and `dialog:default`. The 19 registered commands at that time had no ability to open external URLs, reveal in explorer, or create/rename/delete files. Therefore verified Typora-baseline link “Open link” and file-tree resource-manager actions could not be implemented. The editor already had `deriveEditorInteractionContext` to recognize Link/Image; the gap was platform capability, not the syntax tree.

## Decision

### External open

- Introduce official `tauri-plugin-opener` (Tauri 2), but do not expose plugin commands directly to WebView capabilities; the frontend may only call LumaMark Tauri commands that have passed business validation, and Rust executes system operations internally via `OpenerExt`. Do not adopt `tauri-plugin-shell` as the default, to avoid a broad command-execution surface.
- External URLs allow only `http:`, `https:`, and `mailto:`. `javascript:`, `data:`, `file:`, and all other protocols are rejected with clear error codes; frontend and Rust **double-validate**, and Rust validation is the security boundary.
- Relative-path Markdown links resolve to opening a file inside the workspace (or relative to the current document) through the existing file-open workflow and are not handed to the system opener.
- “Reveal in File Explorer” opens the parent directory and selects the target via opener/reveal capability (platform APIs follow plugin docs). When a workspace claim exists, first match the in-process `WorkspaceSession`, then require the target inside that root’s canonical boundary. For single-file scenarios without a workspace, allow fallback to a real existing Markdown document: the document must be an existing file, and the target must lie inside its canonical real parent directory. That fallback depends on the trusted built-in frontend passing the current document path and does not claim to resist an attacker who fully controls the WebView; if the threat model rises, add a managed `CurrentDocumentSession` before tightening the command.
- Unit tests use an injectable opener abstraction: assert that rejected protocols never call the real system opener. Real system open is only Windows manual/release sampling.

### Workspace file mutations

- Add thin Tauri commands: `workspace_create_file`, `workspace_create_directory`, `workspace_rename_entry`, `workspace_delete_entry`; reveal uniformly goes through `opener_reveal_path`, with business logic in the workspace/opener services.
- Every write validates that the target path is inside the **currently opened workspace root**; paths containing `..` or escaping the root after resolution return `invalid_path` and neither create, delete, nor rename.
- The Rust process maintains a single `WorkspaceSession`: the canonical root activates only after a workspace is successfully opened. Each mutation command still retains a frontend `workspaceRoot` parameter to keep the typed command contract, but must first prove that claim is equivalent to the current session’s canonical root. Switching workspaces immediately invalidates old claims; roots that were deleted, disconnected, or retargeted also stop authorizing.
- `WorkspaceSession` prevents stale/mismatched claims, path aliases, and workspace-switch concurrency pierce-through, but is not a sandbox against a fully controlled WebView: to support recent workspaces and session restore, the trusted built-in frontend may still call `workspace_open_path(path)` to activate any existing directory. The current threat model trusts frontend code shipped with the app; resisting a compromised WebView requires tightening activatable roots to Rust-persisted user-approved tokens/allowlists or allowing only native dialogs to establish authorization—do not equate the session with that stronger security boundary.
- Path boundaries use canonical checks on existing roots, parents, and targets to block symlink/junction escapes, and accommodate Windows path case and `\\?\` prefix differences; entry paths returned to the frontend keep the call-chain’s normalized non-canonical form to avoid leaking verbatim prefixes or changing file-tree keys.
- Name conflicts return clear errors and do not overwrite existing files.
- **Delete semantics: prefer moving to the OS recycle bin** (Windows Recycle Bin). If the platform API is unavailable, return a clear error and leave the file unchanged; do not silently permanently delete. If permanent delete is needed later, it must open a separate confirmation contract and ADR revision.
- When deleting the file corresponding to the currently open document, the frontend must follow the existing external-change / dirty contract and must not silently discard editor content.
- File-tree UI continues to use `react-arborist`; context menus reuse Radix Context Menu and the unified command-node model; do not custom-build trees or menus.

### Concurrent filesystem boundary

- New files use exclusive create; directory create uses the OS atomic “do not overwrite” semantics; dangling symlinks are also treated as occupied targets. Windows rename syscalls likewise do not overwrite existing targets.
- A namespace race between canonical validation and the final syscall remains incompletely eliminable—for example another process of the same logged-in user replacing a parent-directory junction in between. The current threat model treats “a local process already able to write the user workspace” as an external change source with equal privilege to the user; validation stays as close as possible to the syscall, and target conflicts fail rather than overwrite. If future workspaces come from untrusted multi-user directories or need to resist malicious local races, revisit to directory-handle-relative operations and platform-level no-replace rename; do not keep adding lexical path checks.

### Permissions

- Capabilities do not grant `opener:*` or general arbitrary-path `fs:allow-write` for direct frontend access, avoiding bypass of the URL allowlist and canonical path boundary; the system opener is only called internally by validated Rust commands.
- Business logic lives in Rust services; the frontend only calls typed clients.

## Alternatives considered

- Use `tauri-plugin-shell` `open` as the sole approach with no protocol allowlist: attack surface too large for a document app.
- Frontend directly `window.open`s arbitrary hrefs: WebView behavior is inconsistent and cannot unify protocol policy and error prompts.
- Recursive delete/write without workspace-root validation: path-escape risk.
- Default permanent delete: conflicts with the conservative stance toward mis-operations in “design for long writing sessions”.
- Introduce a second command registry for context menus: conflicts with menu system design.

## Consequences

- `Cargo.toml`, frontend typed command facades, and `lib.rs` registration lists change; `capabilities/default.json` was rechecked and still grants no `opener:*` permissions, so the WebView cannot bypass owned Rust command validation.
- Link workflows, image context-menu reveal, and file-tree context menus depend on this landing.
- Security tests must cover protocol rejection and path escape; E2E may cover copy path and menu structure; real opener/recycle bin depend on platform sampling.
- Connects to the external file-change contract in [ADR 0005](0005-external-file-and-image-watch.md): after workspace delete/rename, watcher and dirty prompts remain effective.

## Rollback and revisit criteria

- If the opener plugin is unstable on Windows WebView2 or the permission model is too broad, fall back to “copy link/path only”, disable open/reveal menu items, and revise the menu coverage matrix.
- If recycle-bin APIs are unavailable on a platform and the product still requires delete, revise this document’s delete semantics before implementing.
- If the product supports multiple workspace roots or complex resource management for single files outside a workspace, revisit path-validation boundaries.
- If a security audit requires a stricter protocol set or a user-configurable allowlist, extend via settings while keeping this document’s allowlist as the default.
