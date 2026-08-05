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

async function settleTablePreview(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('scales table content with the editor font zoom variable', () => {
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
    const table = parent.querySelector<HTMLElement>('.tbl-table');

    expect(table).not.toBeNull();
    expect(
      getComputedStyle(table!)
        .getPropertyValue('--tbl-style-font-size')
        .replaceAll(/\s/g, ''),
    ).toBe('calc(15.5px*var(--lm-editor-font-scale,1))');

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

  it('uses the component source DOM as the only inactive cell text surface', async () => {
    const doc = [
      'before',
      '',
      '| A        | B      | C                           |',
      '| -------- | ------ | --------------------------- |',
      '| **bold** | `code` | [site](https://example.com) |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);

    await settleTablePreview();

    const widget = parent.querySelector('.tbl-table-widget');
    const boldCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell-view')]
      .find((cell) => cell.textContent === '**bold**');
    const codeCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell-view')]
      .find((cell) => cell.textContent === '`code`');
    const linkCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell-view')]
      .find((cell) => cell.textContent === '[site](https://example.com)');

    expect(widget).not.toBeNull();
    expect(parent.querySelector('.lm-table-inline-preview')).toBeNull();
    expect(
      boldCell?.querySelector('.lm-table-token-strong:not(.lm-table-token-mark)')
        ?.textContent,
    ).toBe('bold');
    expect(
      codeCell?.querySelector('.lm-table-token-code:not(.lm-table-token-mark)')
        ?.textContent,
    ).toBe('code');
    expect(boldCell?.querySelectorAll('.lm-table-token-mark')).toHaveLength(2);
    expect(codeCell?.querySelectorAll('.lm-table-token-mark')).toHaveLength(2);
    expect(
      linkCell?.querySelector('.lm-table-token-link:not(.lm-table-token-mark)')
        ?.textContent,
      linkCell?.innerHTML,
    ).toBe('site');
    expect(
      linkCell?.querySelector('.lm-table-token-link-destination')?.textContent,
    ).toBe('https://example.com');
    expect(linkCell?.querySelectorAll('.lm-table-token-mark')).toHaveLength(4);

    view.destroy();
    parent.remove();
  });

  it('does not swap the inactive cell DOM while hovering', async () => {
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

    await settleTablePreview();

    const boldCell = [...parent.querySelectorAll<HTMLElement>('.tbl-cell')]
      .find((cell) => cell.textContent?.includes('bold'));
    const boldCellView = boldCell?.querySelector<HTMLElement>('.tbl-cell-view');
    const initialMarkup = boldCellView?.innerHTML;

    expect(boldCell).toBeDefined();
    expect(boldCellView?.textContent).toBe('**bold**');
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBeUndefined();
    expect(boldCell?.querySelector('.lm-table-inline-preview')).toBeNull();

    boldCell?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    expect(boldCellView?.innerHTML).toBe(initialMarkup);
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBeUndefined();

    boldCell?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));

    expect(boldCellView?.innerHTML).toBe(initialMarkup);
    expect(boldCellView?.dataset.lmInlineMarkdownMode).toBeUndefined();

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

    await settleTablePreview();

    const header = parent.querySelector<HTMLElement>('.tbl-header-cell');
    const source = header?.querySelector<HTMLElement>('.tbl-cell-view');

    expect(source?.textContent).toBe('A');
    expect(header?.querySelector('.lm-table-inline-preview')).toBeNull();

    view.destroy();
    parent.remove();
  });
});
