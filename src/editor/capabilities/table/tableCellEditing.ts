import { syntaxTree } from '@codemirror/language';
import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';

const TRAILING_INLINE_MARKS = new Set([
  'CodeMark',
  'EmphasisMark',
  'StrikethroughMark',
]);

export function moveToTableCellVisualLineEnd(view: EditorView): boolean {
  const selection = view.state.selection.main;

  if (!selection.empty) {
    return false;
  }

  const lineBlock = view.lineBlockAt(selection.head);
  let nativeVisualEnd = view.moveToLineBoundary(selection, true).head;
  if (
    nativeVisualEnd === selection.head &&
    nativeVisualEnd !== lineBlock.to
  ) {
    nativeVisualEnd = view.moveToLineBoundary(selection, true, false).head;
  }

  const line = view.state.doc.lineAt(selection.head);
  let visualEnd = nativeVisualEnd;

  if (nativeVisualEnd === line.to) {
    syntaxTree(view.state).iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        if (node.to === line.to && TRAILING_INLINE_MARKS.has(node.name)) {
          visualEnd = Math.min(visualEnd, node.from);
        }
      },
    });

    if (selection.head >= visualEnd) {
      visualEnd = line.to;
    }
  }

  if (visualEnd !== selection.head) {
    view.dispatch({
      scrollIntoView: true,
      selection: EditorSelection.cursor(visualEnd),
      userEvent: 'select',
    });
  }

  return true;
}

export function tableCellEditingExtension(): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: 'End',
        run: moveToTableCellVisualLineEnd,
      },
    ]),
  );
}
