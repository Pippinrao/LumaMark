> Language: **English** · [中文](../zh/decisions/0002-codemirror-markdown-tables.md)

# ADR 0002: CodeMirror Table Interaction Component Selection

Date: 2026-07-05

Updated: 2026-09-22 (preserve cell selections and original-source positions)

## Context

V1 live-preview tables need a mature WYSIWYG writing experience: normal display by default, structured editing on click, stable row/column operations, copy/paste that preserves Markdown source, and no hiding of source in source mode. Project rules prefer mature components. The existing custom `TableWidget` already shows excessive UI noise, focus-state issues, nested editing friction, and high maintenance cost for row/column operations.

## Decision

Adopt `codemirror-markdown-tables` as the CodeMirror 6 table interaction core.

LumaMark keeps only a thin integration layer:

- Live preview enables `markdownTables()` and table autocompletion.
- Source mode does not enable table widgets; it shows raw Markdown.
- Menu commands only add “copy current table Markdown source” and “delete current table block”.
- Visual differences are adjusted via CSS/theme adapters; table editing interaction is not rewritten.
- The dependency is pinned to `1.0.0`. A pnpm patch preserves vertical caret goals, mounts ordinary GFM tables without passive reformatting, and fixes the selection handoff described below. Table editing and serialization continue to use the mature component.

### Cell selection integration

Native selections in a passive cell must transfer both anchor and focus into the nested editor. Converting only the native range start loses double-click and drag selections. The coordinate replay adapter only positions a collapsed caret during activation; an already active editor owns word, line, drag, and Shift-click gestures.

Selection-only synchronization must use cell spans parsed from the original table source, not offsets into the library's column-padded representation. The patch reuses the component's Lezer parser and cell-span extraction and retains source spans between selection transactions. Otherwise ordinary unpadded tables can select unrelated text or raise `Selection points outside of document`. A real table edit still uses the component's existing serialization and the resulting canonical offsets; merely selecting or copying never rewrites the source.

Regression coverage lives in `tablePreviewExtension.test.ts`, `tests/e2e/editor-table-selection-copy.spec.ts`, and the existing table caret matrix. Run `node scripts/release/verify-table-selection-copy-os.mjs [executable]` for native Windows double-click/drag and clipboard acceptance against an installed or equivalent packaged WebView. The probe uses `ClientToScreen`, verifies the exact child PID, and checks in-memory and on-disk source preservation.

## Alternatives considered

- Keep patching the custom `TableWidget`: expands the self-maintained foundational component surface, with risk concentrated in IME, undo/redo, focus, copy/paste, and source fidelity.
- Switch to Milkdown, Toast UI Editor, or ProseMirror tables: these look more like replacing the primary editor core, not a local table fix for this round.
- Build a full custom table editor: no evidence that mature components cannot meet current goals; violates mature-components-first.

## Consequences

- Core interactions such as insert/delete/move/select rows and columns and copy/paste follow `codemirror-markdown-tables` behavior.
- LumaMark no longer maintains the cell editor, size picker, row/column operation state machine, or table serialization model.
- The new dependency enters `package.json` and the lockfile; installs follow `https://registry.npmmirror.com/`.
- Table theming is adapted to LumaMark tokens via `src/editor/capabilities/table/table.css` and extension config.
- `patches/codemirror-markdown-tables@1.0.0.patch` only changes the ESM entry actually used. LumaMark is an ESM/Vite app and does not consume the package’s CommonJS `require` entry.

## Rollback or revisit criteria

Revisit when any of the following occurs:

- The component breaks Markdown source fidelity, undo/redo, IME, or copy/paste.
- Table widgets cause measurable typing or scrolling regression in large documents.
- The component becomes unmaintained or blocks CodeMirror version upgrades.
- Upstream ships equivalent vertical movement, passive source preservation, and selection handoff fixes; remove each local patch only after the corresponding regression suite passes.
- After V1, if the primary editor core is replaced as a whole, re-evaluate Milkdown, Toast UI Editor, or ProseMirror together.
