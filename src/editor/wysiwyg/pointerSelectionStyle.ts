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
): MouseSelectionStyle & { dragRangeCommitted: boolean } {
  let anchorPosition = anchor.position;
  let lastHead = anchor.position;
  let lastPointerX = anchor.x;
  let lastPointerY = anchor.y;
  let lineEntryY = anchor.y;
  let startSelection = view.state.selection;
  let committed = false;

  return {
    get dragRangeCommitted() {
      return committed;
    },
    get(event: MouseEvent, extend: boolean, multiple: boolean) {
      const result = pointerSelectionRange(
        view,
        anchor,
        anchorPosition,
        lastHead,
        lastPointerX,
        lastPointerY,
        lineEntryY,
        event,
      );
      lastHead = result.range.head;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      lineEntryY = result.newLineEntryY;
      const range = result.range;

      if (!committed && !range.empty) {
        committed = true;
      }

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
        lastHead = update.changes.mapPos(lastHead);
        startSelection = startSelection.map(update.changes);
      }
    },
  };
}

function pointerSelectionRange(
  view: EditorView,
  anchor: PointerSelectionAnchor,
  anchorPosition: number,
  lastHead: number,
  lastPointerX: number,
  lastPointerY: number,
  lineEntryY: number,
  event: MouseEvent,
): { range: ReturnType<typeof EditorSelection.cursor>; newLineEntryY: number } {
  const coordinates = { x: event.clientX, y: event.clientY };
  const inSlop = isPrimaryPointerClick(anchor, coordinates);

  if (anchor.kind === 'word-or-drag' && inSlop) {
    return {
      range: view.state.wordAt(anchorPosition) ?? EditorSelection.cursor(anchorPosition),
      newLineEntryY: lineEntryY,
    };
  }

  if (inSlop) {
    return { range: EditorSelection.cursor(anchorPosition), newLineEntryY: lineEntryY };
  }

  // Pass precise=true so inter-line gaps return null instead of snapping.
  // CM6 types `precise` as `false` but the runtime accepts `true`.
  const mapped = (view.posAtCoords as (coords: {x: number; y: number}, precise?: boolean) => number | null)(coordinates, true);
  const head = stabilizeDragHead(
    view, mapped, lastHead, lastPointerX, event.clientX,
    event.clientY, lineEntryY,
  );

  const newLineEntryY = head !== lastHead
    ? event.clientY
    : lineEntryY;

  const range = head === anchorPosition
    ? EditorSelection.cursor(anchorPosition)
    : EditorSelection.range(anchorPosition, head);

  return { range, newLineEntryY };
}

function stabilizeDragHead(
  view: EditorView,
  mapped: number | null,
  lastHead: number,
  lastPointerX: number,
  pointerX: number,
  pointerY: number,
  lineEntryY: number,
): number {
  if (mapped === null) {
    return lastHead;
  }

  const pointerDelta = pointerX - lastPointerX;
  const headDelta = mapped - lastHead;
  if (pointerDelta * headDelta < 0) {
    return lastHead;
  }

  // Y hysteresis: reject line changes when vertical movement is too small.
  const docLen = view.state.doc.length;
  const clampedMapped = Math.max(0, Math.min(docLen, mapped));
  const clampedLast = Math.max(0, Math.min(docLen, lastHead));
  const mappedLine = view.state.doc.lineAt(clampedMapped).number;
  const lastLine = view.state.doc.lineAt(clampedLast).number;
  if (mappedLine !== lastLine) {
    const yTravel = Math.abs(pointerY - lineEntryY);
    if (yTravel < view.defaultLineHeight / 2) {
      return lastHead;
    }
  }

  return mapped;
}
