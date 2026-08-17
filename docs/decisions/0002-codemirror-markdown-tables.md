> Language: **English** · [中文](../zh/decisions/0002-codemirror-markdown-tables.md)

# ADR 0002: CodeMirror Table Interaction Component Selection

Date: 2026-07-05

Updated: 2026-08-04 (pin 1.0.0 and patch vertical caret column retention)

## Context

V1 live-preview tables need a mature Typora-like writing experience: normal display by default, structured editing on click, stable row/column operations, copy/paste that preserves Markdown source, and no hiding of source in source mode. Project rules prefer mature components. The existing custom `TableWidget` already shows excessive UI noise, focus-state issues, nested editing friction, and high maintenance cost for row/column operations.

## Decision

Adopt `codemirror-markdown-tables` as the CodeMirror 6 table interaction core.

LumaMark keeps only a thin integration layer:

- Live preview enables `markdownTables()` and table autocompletion.
- Source mode does not enable table widgets; it shows raw Markdown.
- Menu commands only add “copy current table Markdown source” and “delete current table block”.
- Visual differences are adjusted via CSS/theme adapters; table editing interaction is not rewritten.
- The dependency is pinned to `1.0.0`. Until upstream ships an equivalent fix, a pnpm patch makes `ArrowUp` / `ArrowDown` keep the current source column and clamp to the end when the target cell is shorter. The patch does not take over the table state machine, serialization, or DOM selection.

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
- Upstream ships and we verify the same vertical column-retention behavior; then remove the local patch, unpin the exact version, and use the same E2E suite to prevent regressions.
- After V1, if the primary editor core is replaced as a whole, re-evaluate Milkdown, Toast UI Editor, or ProseMirror together.
