import { EditorSelection } from '@codemirror/state';
import type {
  EditorView,
  MouseSelectionStyle,
  ViewUpdate,
} from '@codemirror/view';
import {
  isPrimaryPointerClick,
} from './inlinePointerSelection';

export type PointerSelectionKind = 'caret' | 'word-or-drag';

export type PointerSelectionAnchor = {
  readonly kind?: PointerSelectionKind;
  readonly position: number;
  readonly x: number;
  readonly y: number;
};

/**
 * CodeMirror's built-in mouse selection re-runs its own coordinate hit test for
 * the press and for every later pointer event, then unions both results. Hidden
 * WYSIWYG delimiters make those two hits disagree, so a press that never leaves
 * a single character still paints a range that settlement only collapses on
 * release. Anchoring the gesture to the position resolved once at press time
 * keeps a click collapsed until the pointer really travels past the click slop.
 */
export function createPointerSelectionStyle(
  view: EditorView,
  anchor: PointerSelectionAnchor,
): MouseSelectionStyle {
  let anchorPosition = anchor.position;
  let startSelection = view.state.selection;

  return {
    get(event: MouseEvent, extend: boolean, multiple: boolean) {
      const range = pointerSelectionRange(view, anchor, anchorPosition, event);

      if (extend) {
        return startSelection.replaceRange(
          startSelection.main.extend(range.from, range.to),
        );
      }

      if (multiple) {
        return startSelection.addRange(range);
      }

      return EditorSelection.create([range]);
    },
    update(update: ViewUpdate) {
      if (update.docChanged) {
        anchorPosition = update.changes.mapPos(anchorPosition);
        startSelection = startSelection.map(update.changes);
      }
    },
  };
}

function pointerSelectionRange(
  view: EditorView,
  anchor: PointerSelectionAnchor,
  anchorPosition: number,
  event: MouseEvent,
) {
  const coordinates = { x: event.clientX, y: event.clientY };
  const inSlop = isPrimaryPointerClick(anchor, coordinates);

  if (anchor.kind === 'word-or-drag' && inSlop) {
    return view.state.wordAt(anchorPosition) ?? EditorSelection.cursor(anchorPosition);
  }

  const head = inSlop
    ? anchorPosition
    : (view.posAtCoords(coordinates, false) ?? anchorPosition);

  return head === anchorPosition
    ? EditorSelection.cursor(anchorPosition)
    : EditorSelection.range(anchorPosition, head);
}
