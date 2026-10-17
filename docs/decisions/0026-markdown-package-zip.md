> Language: **English** · [中文](../zh/decisions/0026-markdown-package-zip.md)

# ADR 0026: Portable Markdown package (.zip) export and read-only opening

Status: Accepted. Date: 2026-10-18.

## Background

ADR 0025 added self-contained HTML/PDF export for LumaMark. Users also need a
transferable artifact that keeps Markdown editable: a document plus the images
it references, packaged so another Markdown tool can open the extracted folder
without LumaMark-specific URLs or absolute paths.

The repository had no archive capability before this decision. Document images
are resolved through the existing asset service and may be relative, absolute,
remote, draft (`lumamark-draft://`), or data URIs. ADR 0025 already owns the
export dialog, save dialog, image resolution policy, and cold-path renderer.
This decision adds a package format without creating a second export UI or a
second image-resolution implementation.

## Decision

### Package format

- Output is a standard deflate `.zip`. The root contains:
  `lumamark-package.json`, `<document-filename>.md`, and the referenced image
  resources.
- Document-relative resources keep their relative POSIX paths. Resources that
  are absolute, escape the document directory, come from drafts, are downloaded
  remote images, or whose names are ambiguous for URL parsing go to
  `lumamark-assets/<name>-<hash>.<ext>`.
- The manifest is a small, forward-compatible descriptor:
  `format: "lumamark-markdown-package"`, `formatVersion: 1`, `entry`, and
  `generator`. A newer `formatVersion`, an invalid manifest, an ambiguous entry,
  or a missing entry is rejected; LumaMark does not guess.
- Other Markdown tools ignore the manifest. The entry is a standard Markdown
  file at the zip root, so extracting the zip into a folder produces a directly
  loadable document tree.

### Portable image destinations

The exported copy must satisfy a hard invariant: every image destination is
either an `http(s)` URL, a `data:` URI, or a relative POSIX path that exists in
the package. No `asset://`, `lumamark-draft://`, `file://`, drive letter,
leading slash, or backslash may remain in an image destination.

The export planner rewrites only when portability requires it:

- backslashes become `/`; spaces/parentheses use angle-bracket destinations;
- a relative first segment containing `:` gets a `./` prefix to avoid URI
  ambiguity;
- names containing `#`, `?`, `%`, `<`, or `>` are moved to safe asset names;
- absolute or escaping local images are copied into the package and rewritten;
- downloaded remote and draft images are copied into the package and rewritten;
- `data:` images stay inline; `blob:` and raw HTML `<img>` are not packaged and
  produce visible warnings.

Markdown outside image destinations is preserved byte-for-byte, including BOM,
dominant line ending, and per-line line-ending overrides.

Export is fail-closed: every declared local, draft, or remote image must be
resolved, read, and written. If one fails, the export fails and no zip is
committed. This deliberately differs from HTML export, which renders a
placeholder and continues, because a package with missing resources is not
portable.

### GUI and reuse

- `ExportKind` gains `package`; the existing `useExportModel` and `ExportDialog`
  own preparing/writing/done/error, warnings, retry, save dialog, and E2E hooks.
- The File menu's Export submenu and the command palette expose “Export as
  Package…”. No new global shortcut is added.
- Package export reuses `resolve_local_image`, `resolve_draft_image`, and
  `fetch_remote_image_bytes` in Rust. The existing remote image protection
  (address, redirect, content type, size) applies.
- The settings toggle `images.downloadRemoteImagesOnExport` defaults to off.
  HTML/PDF export keeps its existing always-download behavior.

### Read-only opening and unpacking

- Opening a `.zip` extracts it to a cache session keyed by the zip fingerprint,
  then reuses the normal `openPath` pipeline with the extracted entry as the
  document path. This keeps document claims, recent-file overrides, startup
  restore, image authorization, and file watching on one code path.
- The package view forces a document-level read-only lock that is independent
  of the display mode. Opening in reading mode is the default, but switching to
  source or live preview must not unlock editing.
- Save/Save As are disabled and guarded; closing, autosave, and recovery drafts
  therefore cannot write the cache copy.
- Recent files and startup restore record the zip path, not the temporary entry
  path. Links to other Markdown files inside the session directory are refused
  with a “unpack first” message so the read-only contract is not bypassed.
- “Unpack Package to Folder…” re-extracts the zip into
  `<parent>/<zip-stem>/`, refuses to overwrite an existing folder, and opens the
  extracted entry as a normal editable document. The zip itself is never
  modified.
- The system `.zip` association is not registered; zip files are accepted
  through the Open dialog filter, CLI/“Open with”, recent files, and startup
  restore only.

### Security boundaries

- Extraction validates every entry name: no absolute path, `..`, backslash,
  drive letter, control character, Windows reserved/invalid name, duplicate
  case-insensitive name, or symbolic link.
- Limits: 4096 entries, 512 MiB per entry, 2 GiB total, 200 characters per
  archive path, 64 KiB manifest. Encrypted and unsupported compression methods
  are rejected.
- Export validates archive paths and entry names, and only writes the package
  after all resources have been read.
- Session directories live under the application cache. Sessions older than 30
  days that are not among the 20 most recent are pruned when a package opens.

## Rejected alternatives

- **Copy the document folder.** Not transferable as one artifact and cannot
  represent absolute or outside-folder resources.
- **Serve zip entries through a virtual asset protocol.** Requires a second
  asset pipeline, blob lifecycle management, and changes to the editor image
  resolver. Extraction reuses the existing pipeline and asset authorization.
- **Edit in the zip and write back on save.** Needs atomic zip rewrite,
  autosave semantics, conflict detection, and resource watching. Read-only
  viewing plus explicit unpack is a smaller and safer first contract.
- **Self-contained HTML as the package.** Not editable and loses the Markdown
  source; ADR 0025 already covers HTML export.
- **Package every local link and raw HTML image.** Expands parsing, rewriting,
  and rewrite-risk far beyond the requested image resources. v1 documents the
  boundary and warns for raw HTML images.

## Impact

- New Rust dependency `zip` (deflate only) and `package_service`/`package`
  commands.
- New `features/packages` module for format planning, export planning, read-only
  opening, unpacking, and package session state.
- Editor gains a document-level read-only override that is separate from display
  mode.
- Settings v5 gains an additive `images.downloadRemoteImagesOnExport` field; no
  schema version bump is required because missing values default to `false`.
- The export subsystem gains a third kind and reuses its dialog and save flow.

## Review conditions

Revisit this decision if editable write-back into packages is requested, if a
CLI package export is needed, if local attachments or raw HTML images must be
packaged, if the 12 MiB remote-image limit becomes a product blocker, or if
cache session retention proves insufficient for long-running sessions.
