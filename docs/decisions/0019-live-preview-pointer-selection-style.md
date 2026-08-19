> Language: **English** · [中文](../zh/decisions/0019-live-preview-pointer-selection-style.md)

# ADR 0019: Live-preview pointer selection style

**Status:** Accepted

**Date:** 2026-08-18

Updated: 2026-08-19 (drag-move head uses `posAtCoords`, not per-mousemove native caret hits)

## Context

Issues #14 and #19 both reported that clicking in live preview or reading mode selects nearby text instead of placing a caret. The earlier fixes kept CodeMirror's built-in mouse selection and corrected the result in a settlement step on `mouseup`. The symptom kept coming back in a weaker form: the wrong selection was still produced, only for a shorter time.

Installed-package evidence on Windows (WebView2, DPR 1.5, Win32 `SendInput`) and browser E2E show two distinct sources, both inside CodeMirror's `basicMouseSelection`:

- It hit-tests the press coordinates once when the gesture starts and again for every later pointer event, then takes the union of both results. Hidden WYSIWYG delimiters make those hits disagree, so a press on link text resolved to the link's `[` position while the release resolved to the clicked character; the caret visibly jumped on release.
- It has no click slop. A press that travels one or two CSS pixels — normal for a hand on a real mouse — maps to the next character and paints a one-character range until settlement collapses it.

Settlement can only correct the final state, so any correction it makes has already been painted for the duration of the press.

## Decision

- Live preview installs its own `EditorView.mouseSelectionStyle` (`editor/wysiwyg/pointerSelectionStyle.ts`) for plain left-button presses that the decorations plugin already resolved to a caret candidate.
- The style resolves the anchor exactly once, from the press candidate the plugin computed with the browser-native caret hit, and maps that anchor through document changes.
- While the pointer stays inside the DPR-aware click slop (`isPrimaryPointerClick`), the style returns a collapsed cursor at that anchor, so no range ever enters editor state.
- Once the pointer passes the slop, the head comes from CodeMirror `posAtCoords` mapped from the press coordinates. Native `caretPositionFromPoint` stays on press and mouseup settlement only; it must not run on every drag `mousemove`.
- The style returns `null` — leaving CodeMirror's built-in behavior in place — for double and triple clicks, inline-code chip presses that already `preventDefault`, and any press without a caret candidate.
- Pointer settlement on `mouseup` stays as-is. It is now a confirmation of the same position rather than the only correction point.

## Alternatives considered

- **Keep correcting only at settlement:** what the compositor paints during the press stays wrong; this is the approach that failed twice.
- **Collapse the selection again from a `mousemove` listener:** requires depending on DOM listener registration order relative to CodeMirror's own document listeners, and dispatches two transactions per pointer move.
- **`preventDefault` every press and drive selection manually:** loses CodeMirror's drag machinery — edge auto-scroll, atomic-range skipping, drag-and-drop of a selection, focus handling.
- **Patch CodeMirror's coordinate cache:** not reachable through public API, and the disagreement is inherent to hit-testing hidden delimiters.

## Consequences

- Single-click caret placement in live preview no longer depends on CodeMirror's coordinate mapping; it depends on the same browser-native caret hit the decorations plugin already trusted.
- Word and line selection semantics are unchanged, because the style declines those gestures.
- Changes to the click slop, the anchor resolution, or the plugin's candidate rules now affect what is painted during a press, not just the settled result.
- The style uses one `posAtCoords` lookup per pointer event beyond the slop. Native caret hits stay off the drag-move path.

## Verification requirements

- Unit tests cover slop behavior at several device pixel ratios, drag extension past the slop, and anchor mapping through document changes.
- Browser E2E asserts a collapsed selection at press, after a one-to-three pixel move, and after release for headings, bold, links, plain paragraphs, and list items, and asserts that a real drag still selects a range.
- `pnpm release:installed-preview-click-selection-os` drives Win32 `SendInput` press-move-release against the installed binary and fails if any sample taken during the press shows a range or if the caret moves between press and release.

## Revisit and rollback criteria

Revisit when any of the following occurs:

- CodeMirror changes `mouseSelectionStyle` semantics or its built-in hit-testing so the two positions agree.
- Word or line selection needs the same anchor treatment, which would mean the style must own those gestures too.
- Multi-cursor, rectangular selection, or a new pointer capability needs behavior the style declines today.
- Installed-package acceptance shows a press position that the browser-native caret hit resolves incorrectly.
