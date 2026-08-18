import { EditorSelection } from '@codemirror/state';
import type {
  EditorView,
  MouseSelectionStyle,
  ViewUpdate,
} from '@codemirror/view';
import {
  isPrimaryPointerClick,
  unclampedInlinePointerPosition,
} from './inlinePointerSelection';

export type PointerSelectionAnchor = {
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
      const head = pointerHeadPosition(view, anchor, anchorPosition, event);
      const range = head === anchorPosition
        ? EditorSelection.cursor(anchorPosition)
        : EditorSelection.range(anchorPosition, head);

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

function pointerHeadPosition(
  view: EditorView,
  anchor: PointerSelectionAnchor,
  anchorPosition: number,
  event: MouseEvent,
): number {
  const coordinates = { x: event.clientX, y: event.clientY };
  if (isPrimaryPointerClick(anchor, coordinates)) {
    return anchorPosition;
  }

  // Edge auto-scroll drags leave the rendered content, where only the
  // imprecise lookup still yields a position.
  return unclampedInlinePointerPosition(view, coordinates)
    ?? view.posAtCoords(coordinates, false);
}
