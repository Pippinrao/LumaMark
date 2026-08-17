> Language: **English** · [中文](../zh/decisions/0010-reading-mode-readonly-contract.md)

# ADR 0010: Reading Mode Read-Only and Render-Lock Contract

**Status:** Accepted

**Date:** 2026-08-10

## Context

The View menu previously offered only live preview and source display modes, both of which allow document edits. For long reading sessions, users need a state that cannot change Markdown through accidental input while keeping rendered layout, images, and diagrams.

Existing live preview expands corresponding Markdown source marks when the caret enters a span or block. That is core writing-mode behavior, but for pure reading it makes the layout keep jumping. Therefore “no edits allowed” and “do not expand source” must hold together as one mode’s two constraints; turning only one off is insufficient.

CodeMirror provides two non-equivalent read-only mechanisms: `EditorState.readOnly` rejects document changes while keeping `contenteditable`, and `EditorView.editable` removes `contenteditable`. They differ substantially for caret, selection, keyboard navigation, and assistive technology, so the choice must be explicit.

## Decision

- Reading mode is the third item in the View menu `display-mode` radio group, mutually exclusive with live preview and source. It is session-level global state, not written to `settings.json`, and returns to editable after restart.
- Read-only is implemented by reconfiguring `EditorState.readOnly` through an independent Compartment alongside `editorDisplayModeCompartment`; mode switches do not rebuild `EditorView`. Selection, copy, search highlights, and keyboard navigation are all retained.
- The caret is hidden with `caret-color: transparent`. Text remains selectable and copyable, but no blinking vertical caret appears.
- In reading mode, `shouldRevealSyntaxNode` never expands source marks; the body always stays in rendered form.
- Tables do not activate nested editors; task checkboxes are not clickable; images and Mermaid keep click-to-expand preview because the viewer does not produce document changes.
- When the user triggers edit-class actions (typing, format shortcuts, paste), the status-bar read-only indicator flashes once and announces via `aria-live`. Format keymaps explicitly intercept while read-only and trigger that feedback; commands must not fail silently.
- Save paths are completely unaffected. `Ctrl+S` and autosave continue to work; entering reading mode with unsaved changes can still flush to disk normally.
- The search panel keeps find and highlight and hides replace.
- `Ctrl+/` changes from a two-state toggle to a three-state cycle: live preview → source → reading → live preview.

## Alternatives considered

- **Implement read-only with `EditorView.editable = false`:** removes `contenteditable` and also loses caret positioning, CodeMirror keyboard navigation, and some assistive-technology behavior. Reading mode still needs selectable, searchable, keyboard-browsable text; the cost is disproportionate.
- **Make reading mode an orthogonal switch stacked on live preview or source:** “read-only” in source mode conflicts with reading mode’s required “rendered state”, producing two of four combinations with no product meaning and complicating menu/shortcut semantics.
- **Introduce a toast system for “currently read-only” feedback:** the project has no notification infrastructure yet; a general toast for one hint would take on long-term stacking, auto-dismiss, `aria-live`, and i18n maintenance. The status bar already has a persistent place for this state.
- **Silently ignore edit actions:** violates the working contract “do not hide errors with silent fallbacks”; users cannot distinguish read-only from a broken program.
- **Persist reading mode in settings or per document:** reading mode is a temporary reading posture; persistence would leave users mysteriously unable to type on next open.

## Consequences

- The editor gains one Compartment and one read-only predicate entry; mode switches remain reconfigure and do not touch the document, undo stack, or scroll position.
- Table cell click-to-activate is closed entirely in reading mode. That path is a high-cost defect area marked in the working contract, so E2E assertions must cover “clicking a cell in reading mode neither enters edit mode nor produces document changes”.
- The status bar gains a read-only indicator and transient feedback styling; Chinese and English copy enter i18n resources.
- `Ctrl+/` semantics change from toggle to cycle; menu shortcut columns need matching updates so the cycle key is not labeled as belonging only to source mode.

## Rollback and revisit criteria

If three-state cycling proves less predictable than two-state toggling in real use, `Ctrl+/` can return to switching only live preview and source, with a dedicated key for reading mode; that change does not affect the read-only implementation itself. If a general notification infrastructure is introduced later, revisit whether status-bar flashing should be replaced by a unified prompt. If reading mode must persist across sessions or per document, re-evaluate persistence location and revise this record.
