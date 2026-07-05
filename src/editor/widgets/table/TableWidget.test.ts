import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createEditorState } from '../../core/createEditorState';

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  });
}

function createView(doc: string, selection = doc.length) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: createEditorState({
      doc,
    }),
  });
  if (selection !== doc.length) {
    view.dispatch({
      selection: {
        anchor: selection,
      },
    });
  }

  return { parent, view };
}

describe('tablePreviewExtension', () => {
  it('renders GFM tables with the mature CodeMirror markdown tables component', () => {
    const doc = [
      'before',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);

    expect(view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector('.tbl-table-widget .tbl-table')).not.toBeNull();
    expect(parent.querySelector('.tbl-table-widget')?.textContent).toContain('A');
    expect(parent.querySelector('.tbl-table-widget')?.textContent).toContain('bold');
    expect(parent.querySelector('.lm-table-widget')).toBeNull();
    expect(parent.querySelector('.lm-table-toolbar')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('keeps the mature table widget active while the editor selection is inside the table block', () => {
    const doc = ['| A | B |', '| - | - |', '| 1 | 2 |'].join('\n');
    const { parent, view } = createView(doc, doc.indexOf('1'));

    expect(parent.querySelector('.tbl-table-widget .tbl-table')).not.toBeNull();
    expect(parent.textContent).not.toContain('| A | B |');

    view.destroy();
    parent.remove();
  });
});
