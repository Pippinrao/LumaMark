> Language: **English** · [中文](../zh/decisions/0019-live-preview-pointer-selection-style.md)

# ADR 0019: Live-preview pointer selection style

**Status:** Accepted

**Date:** 2026-08-18

Updated: 2026-09-03 (drag head stays on last valid hit when `posAtCoords` is null or jumps against pointer travel)

## Context

Issues #14 and #19 both reported that clicking in live preview or reading mode selects nearby text instead of placing a caret. The earlier fixes kept CodeMirror's built-in mouse selection and corrected the result in a settlement step on `mouseup`. The symptom kept coming back in a weaker form: the wrong selection was still produced, only for a shorter time.

Installed-package evidence on Windows (WebView2, DPR 1.5, Win32 `SendInput`) and browser E2E show two distinct sources, both inside CodeMirror's `basicMouseSelection`:

- It hit-tests the press coordinates once when the gesture starts and again for every later pointer event, then takes the union of both results. Hidden WYSIWYG delimiters make those hits disagree, so a press on link text resolved to the link's `[` position while the release resolved to the clicked character; the caret visibly jumped on release.
- It has no click slop. A press that travels one or two CSS pixels — normal for a hand on a real mouse — maps to the next character and paints a one-character range until settlement collapses it.

Settlement can only correct the final state, so any correction it makes has already been painted for the duration of the press.

## Decision

- Live preview installs its own `EditorView.mouseSelectionStyle` (`editor/wysiwyg/pointerSelectionStyle.ts`) for plain left-button presses that the decorations plugin already resolved to a caret or word-or-drag candidate.
- The style resolves the anchor exactly once, from the press candidate the plugin computed with the browser-native caret hit, and maps that anchor through document changes.
- While the pointer stays inside the DPR-aware click slop (`isPrimaryPointerClick`), a caret candidate returns a collapsed cursor; a `word-or-drag` candidate (OS `detail === 2`) returns the word at the press anchor.
- Once the pointer passes the slop, the head comes from CodeMirror `posAtCoords` mapped from the press coordinates, including for `detail === 2`. A `null` hit (widget interior) keeps the last valid head instead of collapsing back to the press anchor. A hit that moves opposite the pointer keeps the last head so hidden delimiters cannot flicker the range. Native `caretPositionFromPoint` stays on press and mouseup settlement only; it must not run on every drag `mousemove`.
- The style returns `null` — leaving CodeMirror's built-in behavior in place — for triple clicks, inline-code chip presses that already `preventDefault`, and any press without a candidate.
- Pointer settlement on `mouseup` stays as-is for caret clicks. A `detail === 2` drag that already painted a character range must not be overwritten with a word selection.

## Alternatives considered

- **Keep correcting only at settlement:** what the compositor paints during the press stays wrong; this is the approach that failed twice.
- **Collapse the selection again from a `mousemove` listener:** requires depending on DOM listener registration order relative to CodeMirror's own document listeners, and dispatches two transactions per pointer move.
- **`preventDefault` every press and drive selection manually:** loses CodeMirror's drag machinery — edge auto-scroll, atomic-range skipping, drag-and-drop of a selection, focus handling.
- **Patch CodeMirror's coordinate cache:** not reachable through public API, and the disagreement is inherent to hit-testing hidden delimiters.

## Consequences

- Single-click caret placement in live preview no longer depends on CodeMirror's coordinate mapping; it depends on the same browser-native caret hit the decorations plugin already trusted.
- Line selection stays with CodeMirror. Double-click-timing presses that resolve a candidate are owned by the style: inside slop → word; past slop → character drag from the press caret.
- Changes to the click slop, the anchor resolution, or the plugin's candidate rules now affect what is painted during a press, not just the settled result.
- The style uses one `posAtCoords` lookup per pointer event beyond the slop. Native caret hits stay off the drag-move path.

## Verification requirements

- Unit tests cover slop behavior at several device pixel ratios, drag extension past the slop, last-head retention when `posAtCoords` is null or jumps backward against pointer travel, reverse drags that still shrink the range, and anchor mapping through document changes.
- Browser E2E asserts a collapsed selection at press, after a one-to-three pixel move, and after release for headings, bold, links, plain paragraphs, and list items, and asserts that a real drag still selects a range. A drag-across matrix (bold, italic, strikethrough, inline code, inline math, links, mixed inline, image, Mermaid, fenced code, display math) samples during the press and fails if the range collapses or the native caret reappears after slop.
- `pnpm release:installed-preview-click-selection-os` drives Win32 `SendInput` press-move-release against the installed binary and fails if any sample taken during the press shows a range or if the caret moves between press and release.
- `pnpm release:installed-selection-caret-os` drives the same drag-across matrix with Win32 `SendInput` and fails if a held range collapses, if `caret-color` is opaque during the hold, or if collapsing the range does not restore a visible caret.

## Revisit and rollback criteria

Revisit when any of the following occurs:

- CodeMirror changes `mouseSelectionStyle` semantics or its built-in hit-testing so the two positions agree.
- Word or line selection needs different ownership than “slop = word, past slop = character drag”.
- Multi-cursor, rectangular selection, or a new pointer capability needs behavior the style declines today.
- Installed-package acceptance shows a press position that the browser-native caret hit resolves incorrectly.
