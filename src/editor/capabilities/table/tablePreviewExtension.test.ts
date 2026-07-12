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

  it('renders inline markdown inside inactive table cells without exposing source markers', async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const widget = parent.querySelector('.tbl-table-widget');
    const overlays = [
      ...parent.querySelectorAll<HTMLElement>('.lm-table-inline-preview'),
    ];

    expect(widget).not.toBeNull();
    expect(overlays.some((overlay) => overlay.textContent === 'bold')).toBe(true);
    expect(overlays.some((overlay) => overlay.textContent === 'code')).toBe(true);
    expect(widget?.querySelector('.lm-table-inline-preview strong')?.textContent).toBe(
      'bold',
    );
    expect(widget?.querySelector('.lm-table-inline-preview code')?.textContent).toBe(
      'code',
    );

    view.destroy();
    parent.remove();
  });

  it('reveals markdown source markers while hovering an inactive table cell', async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const boldCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell')]
      .find((cell) => cell.textContent?.includes('bold'));
    const boldCellView = boldCell?.querySelector<HTMLElement>('.tbl-cell-view');
    const overlay = boldCell?.querySelector<HTMLElement>('.lm-table-inline-preview');

    expect(boldCell).toBeDefined();
    expect(boldCellView?.textContent).toBe('**bold**');
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBe('preview');
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.querySelector('strong')?.textContent).toBe('bold');

    boldCell?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    expect(boldCellView?.textContent).toBe('**bold**');
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBe('source');
    expect(overlay?.hidden).toBe(true);

    boldCell?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBe('preview');
    expect(overlay?.hidden).toBe(false);
    expect(overlay?.querySelector('strong')?.textContent).toBe('bold');

    view.destroy();
    parent.remove();
  });

  it('keeps a real table header aligned when earlier pipe-delimited prose is not a table', async () => {
    const doc = [
      '| this is pipe-delimited prose |',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const header = parent.querySelector<HTMLElement>('.tbl-header-cell');
    const preview = header?.querySelector<HTMLElement>('.lm-table-inline-preview');

    expect(preview?.textContent).toBe('A');

    view.destroy();
    parent.remove();
  });
});
