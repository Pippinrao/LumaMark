> Language: **English** · [中文](../zh/decisions/0003-live-preview-assets-code-and-table-inline.md)

# ADR 0003: Live Preview Image Cache, Code Highlighting, and Table Inline Syntax

Date: 2026-07-09

Updated: 2026-07-12 (local image authorization and insert strategy)

Updated: 2026-07-27 (wire local image targeted refresh and pre-save draft image finalize)

Updated: 2026-08-04 (tighten table inline preview vs native cell editor caret geometry contract)

Updated: 2026-08-04 (remove sibling overlay; use component source DOM token-level presentation)

Updated: 2026-08-12 (code-block language hint, fence completion, and line-box geometry contract)

Updated: 2026-08-13 (code-block surface, horizontal inset, and semantic theme contract)

Updated: 2026-08-13 (block mature table component from passively normalizing non-canonical Markdown)

Updated: 2026-08-19 (mount everyday GFM tables without format-on-load rewrite)

## Context

V1 live preview needs image, code-block, and table inline syntax experience while keeping source fidelity, mature-components-first, and editor capability boundaries. Using remote network URLs directly for images is weak for offline and cross-platform stability; automatically rewriting Markdown breaks user source intent. Code blocks need common-language highlighting without replacing CodeMirror. Table interaction is already owned by `codemirror-markdown-tables` and must not fall back to a custom full-table editor.

## Decision

- Remote images are displayed from beside-document local cache: download into `.lumamark/assets/remote-cache/`, preview uses a local asset URL, Markdown keeps the original URL.
- Remote image cache accepts only unauthenticated public HTTP(S) addresses: reject localhost, private / link-local / reserved direct IPs, and non-public addresses from DNS resolution; disable automatic redirects on download and set connect plus total request timeouts.
- Existing cache entries must be ordinary files smaller than 12 MiB; reject directories, symlinks, and other non-ordinary files so a cache hit cannot become an arbitrary path read/write entry.
- After remote image download completes, reuse the file service’s same-directory atomic write infrastructure to publish the cache; on write or sync failure, do not overwrite an existing cache file.
- `assets_cache_remote_image` is an async Tauri command; blocking HTTP download runs on a Tauri runtime blocking worker and does not occupy the command thread.
- Image cache injects `ImageAssetResolver` into the editor capability through the app/service layer; the editor capability does not depend directly on Tauri, app, features, or services.
- The service layer shares in-flight cache requests by “document path + remote URL”; duplicate image blocks do not re-trigger IPC, network download, or cache writes, and the key is released immediately when the task ends.
- Tauri asset protocol static scope stays empty; after a document is successfully opened or saved, Rust file commands dynamically grant recursive asset scope for that document’s parent directory. Relative images and beside-document remote cache can load without giving the WebView whole-filesystem asset read scope at startup.
- Existing Markdown local absolute paths, relative paths, and remote URLs are only resolved, authorized, or cached at runtime; preview must not rewrite Markdown source. Local absolute images outside the document directory must first be validated by Rust as supported ordinary images, then authorized for that file only via `allow_file`.
- Native local file drag-and-drop defaults to keeping the absolute path returned by Tauri as the Markdown `src`. Only when the user enables “copy inserted local images into the document assets directory” in settings and the current document already has a saved path are images copied into `<document-name>.assets/` with a relative reference inserted; unsaved documents without a stable target directory keep the original path.
- Clipboard bitmaps have no retainable original file path: saved documents write directly into `<document-name>.assets/`; unsaved documents first write into the app draft image directory and use a `lumamark-draft://` placeholder, then migrate into `<document-name>.assets/` on first save and replace only the matching placeholder references.
- Windows native drag-and-drop uses Tauri `onDragDropEvent` for file paths; physical coordinates are converted to CSS logical coordinates by window scale factor before entering the editor layer. Insert only when the drop lands inside the editor; if the document has switched or the controller has unmounted before async copy completes, discard the result.
- Code-block language highlighting uses official CodeMirror language packages: `@codemirror/language-data` covers common languages; `@codemirror/lang-javascript` directly supports `js/jsx/ts/tsx`.
- Whole code-block preview uses only CodeMirror line-level decorations. Do not apply multi-line mark decorations to `FencedCode` on the generic WYSIWYG path, because padding, border, or line-height on cross-line marks breaks caret positioning, selection, and background alignment.
- Tables still use `codemirror-markdown-tables` as the whole-table interaction core. Both inactive `.tbl-cell-view` and the activated nested CodeMirror use CodeMirror/Lezer syntax token DOM directly: delimiters and link targets are hidden only via CSS; bold, italic, strikethrough, code, and link labels render on the same source DOM. Do not create sibling overlays, a second HTML text surface, or hand-mapped coordinates.
- `codemirror-markdown-tables@1.0.0` wants to dispatch an internal `table.format` rewrite when a GFM pipe table is not already padded. LumaMark patches the library so a valid GFM table mounts the mature widget without that rewrite, and still drops any remaining `table.format` document changes at the table capability boundary. Everyday `| --- |` and alignment `| :--- | ---: |` tables therefore look like tables while source bytes stay verbatim. Real cell edits still commit through `table.edit`.
- Component-managed `.tbl-cell` does not add extra padding; the component cell view and nested editor share fixed font size, font family, and token CSS. Hidden-token rules must cover inactive view and nested editor together so click coordinates, visible caret, and source selection share one layout.
- Table caret regressions must use real browser coordinates: compute click points from visible character `Range`s, assert that after activation both nested CodeMirror selection and root selection land on the same character boundary, and remain in the same cell after typing. jsdom does not provide reliable font layout or native caret and cannot replace this E2E.

### 2026-07-27 implementation update

- Local image references are synced as watcher targets by `ImageAssetResolver.syncLocalSources`. Image events write the revision for the normalized path into the resolver, invalidate old authorization cache, then dispatch a refresh effect to the image capability via `EditorDocumentPort.refreshImages(path)`.
- Decoration rebuild image widget candidates, but widget identity includes the corresponding source revision; only images hitting that path get a new asset URL (`lmv=<revision>`), unrelated widgets are reused, and Markdown source does not receive a transaction.
- Before first save, the file workflow calls `finalizeAllDraftImages` from the editor’s exact serialized snapshot, migrates each draft batch in first-appearance order in the document, and replaces `lumamark-draft://` references. Only when file write succeeds and the original snapshot is still the current document is the converted text mapped back into the main document with minimal CodeMirror changes and marked as a save point; on failure, placeholder replacements are not committed to the body and dirty is kept.
- Current finalize atomically copies target images first, then writes the Markdown file; if image migration succeeds and later document write fails, asset files unreferenced by the document may remain. This is not a full filesystem transaction; image-strategy persistence and transactional rollback remain Next-stage work in the [current plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md). Exact snapshot and minimal-changes contracts are in [ADR 0006](0006-parity-reliability-editor-contracts.md).

### 2026-08-12 code-block implementation update

- “One blank line above and below” is implemented as stable visual rhythm, not as a source-normalization rule on open, render, or save. Existing Markdown is not rewritten with outside-block blank lines; only when the user presses Enter on a real, still-unclosed opening fence in live preview does the input transaction create an editable empty body line and a matching closing fence.
- Auto-close preserves backtick or tilde characters, fence length, 0–3 leading spaces, and the full info string; existing closing fences are not duplicated. Paste, IME composition, non-empty selection, programmatic load, undo/redo, and source mode are not auto-close triggers.
- Language hints continue to reuse `@codemirror/language-data` names and aliases. Known languages show the official canonical name; unknown languages show only the first word of the user’s original info and keep the unhighlighted fallback. Do not introduce a language picker or a second alias table.
- Focus hints consume the shared `EditorInteractionContext.activeBlocks` from ADR 0006, attach visual attributes on the code-block capability’s opening `Decoration.line`, and sync the language description onto active code lines and the currently focused CodeMirror content DOM. Visuals are absolutely positioned, `pointer-events: none` pseudo-elements; they are not block widgets, do not create a second interactive text surface, and do not change the generic fence/source reveal contract.
- Code-block focused/inactive states change only background color and inset border tokens. Do not add dedicated vertical margin, padding, line-height, transform, or unselectable placeholders on code-block lines or multi-line marks. Real `.cm-line` DOM bounds must stay consistent with the CodeMirror height map.

### 2026-08-13 code-block visual update

- Code-block surface and syntax token styles belong to the code-block capability; generic WYSIWYG styles no longer hold fenced-code-specific rules. Light/dark palettes live in shared theme tokens and continue to reuse semantic classes produced by CodeMirror/Lezer; do not introduce a custom tokenizer, extra DOM, or new dependencies.
- Code body lines use a consistent 12px `padding-inline`; active/inactive states do not change that value. The inset is part of real `.cm-line` click and selection geometry and is not simulated with fake spaces, copied text, or overlays. Do not add `padding-block`, dedicated `line-height`, vertical margin, transform, filter, or inner scroll containers.
- The surface is drawn by non-hit-testable empty `::before` inside each real code line. Body lines draw the full in-line surface; opening draws only the lower half of the real opening line; closing draws only the upper half of the real closing line; single-line degenerate nodes draw only the middle half-line. Pseudo-elements must not overflow the line box, insert characters, or create outside-block hit areas.
- Focused/inactive still only switch surface and border custom properties; the language hint stays inside the lower half-surface of the active opening line, remains absolutely positioned with `pointer-events: none`, and hides when source marks are revealed. The shell uses a neutral thin border, small radius, and no shadow in a Typora-like rhythm; internals use LumaMark’s own JetBrains-inspired semantic palette without copying proprietary themes or assets.
- Browser regressions must cover both light and dark themes, active/inactive geometry, language-hint contrast, semantic token contrast, native multi-line selection, and local pixel baselines. Windows packaged acceptance reads the real `::before` surface and continues to verify click, focus, no invented vertical hit areas, and source save with Win32 `SendInput`.

## Alternatives considered

- Automatically rewrite remote image links to local relative paths: more thoroughly offline, but actively modifies user Markdown source.
- Default to copying dragged local images into `.assets`: changes path semantics before the user chooses an asset-management strategy, so only explicit opt-in is allowed.
- Restore broad static asset scopes such as `$HOME/**/*` or `$PICTURE/**/*`: simple, but gives the WebView unnecessary file-read scope at startup.
- Call Tauri commands directly inside an editor capability: breaks editor vs service/app layer boundaries.
- Custom code highlighting or a full table editor: no evidence mature components cannot meet the main current goals; maintenance cost and editor hot-path risk are higher.
- Keep or continue tuning sibling overlays: even short-term alignment leaves two geometry sources of truth when formatted tokens, fonts, wrapping, or component DOM change.
- Keep table font size as relative `em` and reverse-compensate each nesting level separately: the component consumes the same token across cell, view, and nested editor layers; the compensation chain is fragile and shifts with DOM depth.
- Intercept pointer events and hand-correct table caret coordinates: invades selection, IME, and cross-cell interaction owned by the mature component, and cannot cover every keyboard, touch, and assistive-technology entry.

## Consequences

- New npm dependencies: `@codemirror/language-data`, `@codemirror/lang-javascript`, `@lezer/highlight`, `@lezer/markdown`. Tables no longer need `markdown-it`; that direct dependency and its types package were removed.
- New Rust dependencies: `ureq` and `sha2`. `ureq`’s built-in HTTP URI parsing validates URL structure and uses a controlled resolver to filter DNS results. Under the Aliyun registry, `reqwest 0.13.4` conflicted with the lockfile’s `wasm-bindgen` link version, so this round chose the smaller mature blocking HTTP client `ureq`.
- Asset protocol scope tightened from global `**/*` to dynamic authorization of successfully opened or saved document directories. Opening multiple documents accumulates those directory scopes; Tauri’s current scope API has no matching allow-mode remove interface, so if closing a document later must reclaim access, switch to a custom asset service validated against current document context.
- Unsaved documents do not create beside-document remote image caches; the UI shows a localizable hint.
- Local file insert settings are low-frequency app state and do not enter CodeMirror document state or the typing hot path; toggling the setting does not rebuild the editor.
- Watcher revisions affect only runtime resolver and widget identity; they do not change image references, dirty state, or undo history.
- Code-block preview no longer wraps whole fenced code as a cross-line mark; the visual surface is carried by `.lm-md-code-block-line` line-level classes so the CodeMirror line-box model is unchanged.
- Table inline presentation reuses source token DOM generated by the mature table widget; it does not rewrite `.tbl-cell-view.innerHTML` or maintain extra render scheduling or HTML state.
- Current source-fidelity guard still watches the component’s internal annotation value `table.format`; compatibility casting exists only at the table capability boundary. Every component upgrade must re-verify everyday GFM load, alignment tables, source→live preview, undo depth, padded table widgets, and real cell edit. Remove that internal boundary once upstream provides a public autoformat opt-out that still mounts widgets.
- Real-browser diagnosis on 2026-08-04 first confirmed that extra padding, compound `em`, and hover font switches drift overlay/source; further formatted-cell cases showed that sibling overlays, even when plain-text geometry aligns, still treat visible offset as source offset. After finally removing the overlay, bold-cell clicks, mixed CJK/Latin width clicks, typing, and source selection share one token geometry.

## Rollback or revisit criteria

- Image cache breaks source fidelity, creates uncontrolled directory pollution, or introduces security risk on the download path.
- Image watcher refresh rebuilds unrelated widgets, changes source, creates undo records, or causes measurable typing latency.
- Orphan asset files from draft image migration become unacceptable, or atomic rollback across image and Markdown writes is required.
- Dynamic asset scope cannot meet least-privilege needs for multi-document or post-close scenarios, requiring a custom controlled asset protocol.
- Remote image concurrency, cancellation, or download-progress needs exceed the current blocking worker + dedupe model, requiring a cancellable task registry or streaming downloader.
- Controlled-resolver reliance on `ureq::unversioned` extension APIs changes compatibility in later `ureq` minor upgrades, or cancellation and concurrent dedupe cannot be guaranteed without blocking the command thread.
- CodeMirror language packages significantly increase startup time or bundle size.
- `codemirror-markdown-tables` limits on inline syntax, IME, undo/redo, or copy/paste block the V1 writing experience.
- If a later library version again refuses to mount widgets without rewriting source, restore the patch (or an upstream opt-out) rather than silently normalizing user Markdown or degrading valid GFM tables to pipe text.
