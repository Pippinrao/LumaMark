import { EditorSelection, type ChangeSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

interface SelectedLine {
  readonly from: number;
  readonly text: string;
}

const blockquoteMarker = /^([ \t]*)(>)([ \t]?)/;

export function toggleBlockquote(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const lines = selectedLines(view);
  const currentLine = lines[0];

  if (selection.empty && currentLine && !currentLine.text.trim()) {
    const insertionPosition =
      currentLine.from + leadingIndentLength(currentLine.text);
    const changeSet = view.state.changes({
      from: insertionPosition,
      insert: '> ',
    });
    const mappedSelection = view.state.selection.map(changeSet);
    const mappedMain = EditorSelection.cursor(
      insertionPosition + 2,
      selection.assoc,
      selection.bidiLevel ?? undefined,
      selection.goalColumn,
    );

    view.dispatch({
      changes: changeSet,
      selection: mappedSelection.replaceRange(mappedMain),
      userEvent: 'input.format',
    });
    view.focus();

    return true;
  }

  const markers = lines.map((line) => blockquoteMarker.exec(line.text));
  const shouldRemove = markers.every((marker) => marker !== null);
  const changes: ChangeSpec[] = lines.map((line, index) => {
    const marker = markers[index];

    if (shouldRemove && marker) {
      const markerFrom = line.from + marker[1].length;

      return {
        from: markerFrom,
        to: markerFrom + marker[2].length + marker[3].length,
        insert: '',
      };
    }

    return {
      from: line.from + leadingIndentLength(line.text),
      insert: line.text.trim() ? '> ' : '>',
    };
  });
  const changeSet = view.state.changes(changes);

  view.dispatch({
    changes: changeSet,
    selection: view.state.selection.map(changeSet),
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}

function selectedLines(view: EditorView): SelectedLine[] {
  const { doc } = view.state;
  const selection = view.state.selection.main;
  const fromLine = doc.lineAt(selection.from);
  const selectionEndsAtNextLineStart =
    !selection.empty && doc.lineAt(selection.to).from === selection.to;
  const effectiveTo = selectionEndsAtNextLineStart
    ? selection.to - 1
    : selection.to;
  const toLine = doc.lineAt(effectiveTo);
  const lines: SelectedLine[] = [];

  for (
    let lineNumber = fromLine.number;
    lineNumber <= toLine.number;
    lineNumber += 1
  ) {
    const line = doc.line(lineNumber);
    lines.push({ from: line.from, text: line.text });
  }

  return lines;
}

function leadingIndentLength(text: string): number {
  return /^[ \t]*/.exec(text)?.[0].length ?? 0;
}
