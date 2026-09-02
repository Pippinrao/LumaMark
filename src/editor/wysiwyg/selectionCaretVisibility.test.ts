import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorState } from '../core/createEditorState';
import { SELECTION_CARET_HIDDEN_CLASS } from './selectionCaretVisibility';

const mounted: Array<{ parent: HTMLElement; view: EditorView }> = [];

function mount(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: createEditorState({ doc }),
  });
  mounted.push({ parent, view });
  return view;
}

afterEach(() => {
  for (const { parent, view } of mounted.splice(0)) {
    view.destroy();
    parent.remove();
  }
});

describe('selection caret visibility', () => {
  it('does not hide the caret for an empty selection', () => {
    const view = mount('hello world');

    expect(view.contentDOM.classList.contains(SELECTION_CARET_HIDDEN_CLASS)).toBe(
      false,
    );
  });

  it('hides the caret for a single non-empty selection', () => {
    const view = mount('hello world');

    view.dispatch({ selection: EditorSelection.range(0, 5) });

    expect(view.contentDOM.classList.contains(SELECTION_CARET_HIDDEN_CLASS)).toBe(
      true,
    );
  });

  it('keeps the caret when a multi-selection includes a cursor', () => {
    const view = mount('hello world');

    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 5),
        EditorSelection.cursor(8),
      ]),
    });

    expect(view.contentDOM.classList.contains(SELECTION_CARET_HIDDEN_CLASS)).toBe(
      false,
    );
  });

  it('shows the caret again when a range collapses', () => {
    const view = mount('hello world');

    view.dispatch({ selection: EditorSelection.range(0, 5) });
    view.dispatch({ selection: EditorSelection.cursor(5) });

    expect(view.contentDOM.classList.contains(SELECTION_CARET_HIDDEN_CLASS)).toBe(
      false,
    );
  });
});
