import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { moveToTableCellVisualLineEnd } from './tableCellEditing';

describe('table cell editing', () => {
  it('moves End before a trailing strong delimiter', () => {
    const view = createView('**bold**', 4);

    expect(moveToTableCellVisualLineEnd(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(6);

    view.destroy();
  });

  it('leaves a caret already at the source end unchanged', () => {
    const view = createView('**bold**', 8);

    expect(moveToTableCellVisualLineEnd(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(8);

    view.destroy();
  });

  it('uses the ordinary line end when no trailing inline marker exists', () => {
    const view = createView('plain text', 3);

    expect(moveToTableCellVisualLineEnd(view)).toBe(true);
    expect(view.state.selection.main.head).toBe(10);

    view.destroy();
  });
});

function createView(doc: string, anchor: number): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdownLanguage()],
    }),
  });
}
