import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { editorMathPreferencesField } from './mathPreferences';
import { insertMathBlock, refreshMath } from './mathCommands';

describe('math commands', () => {
  it('inserts a block formula at the caret without rewriting surrounding text', () => {
    const view = createView('before  after', 7);

    expect(insertMathBlock(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('before $$\n\n$$ after');
    expect(view.state.selection.main.head).toBe(10);
  });

  it('refreshes math without changing document text, selection, or preferences', () => {
    const view = createView('$x$', 1);
    const selectionBefore = view.state.selection;

    expect(refreshMath(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('$x$');
    expect(view.state.selection.eq(selectionBefore)).toBe(true);
    expect(view.state.field(editorMathPreferencesField)).toEqual({
      equationNumbering: 'none',
      physicsEnabled: false,
      syntaxMode: 'pandoc',
    });
  });
});

function createView(doc: string, selection: number): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdownLanguage(), editorMathPreferencesField],
      selection: EditorSelection.cursor(selection),
    }),
  });
}
