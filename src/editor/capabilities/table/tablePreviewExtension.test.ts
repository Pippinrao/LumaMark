import { undo, undoDepth } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createEditorState } from '../../core/createEditorState';
import { CodeMirrorEditorApi } from '../../core/editorApi';

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
  it('preserves a programmatically loaded noncanonical table byte-for-byte', async () => {
    const doc = [
      'before',
      '',
      '| Target | Value |',
      '| --- | --- |',
      '| TABLE_ACCEPTANCE_MARKER | keep |',
      '',
      '| Other | Value |',
      '| --- | --- |',
      '| SECOND_TABLE_ACCEPTANCE_MARKER | preserve |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView('');

    view.dispatch({
      annotations: Transaction.addToHistory.of(false),
      changes: { from: 0, insert: doc },
    });
    const historyAfterLoad = undoDepth(view.state);

    await settleTablePreview();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.state.doc.toString()).toBe(doc);
    expect(undoDepth(view.state)).toBe(historyAfterLoad);
    expect(parent.querySelectorAll('.tbl-table-widget')).toHaveLength(0);

    view.destroy();
    parent.remove();
  });

  it('does not let passive table formatting intercept the first real input undo', async () => {
    const doc = [
      'before',
      '',
      '| Header | Value |',
      '| :--- | ---: |',
      '| x | longer value |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView('');

    view.dispatch({
      annotations: Transaction.addToHistory.of(false),
      changes: { from: 0, insert: doc },
    });
    await settleTablePreview();

    view.dispatch({
      annotations: Transaction.userEvent.of('input.type'),
      changes: { from: view.state.doc.length, insert: '!' },
    });

    expect(view.state.doc.toString()).toBe(`${doc}!`);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('preserves noncanonical table source when entering live preview', async () => {
    const doc = [
      'before',
      '',
      '| Header | Value |',
      '| :--- | ---: |',
      '| x | longer value |',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = new CodeMirrorEditorApi({
      displayMode: 'source',
      doc,
      parent,
    });

    editor.setDisplayMode('livePreview');
    await settleTablePreview();

    expect(editor.getDocumentText()).toBe(doc);
    expect(parent.querySelector('.tbl-table-widget')).toBeNull();

    editor.destroy();
    parent.remove();
  });

  it('allows the mature widget to commit a real canonical table cell edit', async () => {
    const doc = [
      'before',
      '',
      '| A     | B      |',
      '| ----- | ------ |',
      '| first | second |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);
    await settleTablePreview();
    const firstCell = [...parent.querySelectorAll<HTMLElement>('.tbl-data-cell')]
      .find((cell) => cell.textContent?.includes('first'));
    const cellView = firstCell?.querySelector<HTMLElement>('.tbl-cell-view');

    expect(firstCell).toBeDefined();
    expect(cellView).not.toBeNull();
    if (cellView) {
      cellView.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
      const range = document.createRange();
      range.selectNodeContents(cellView);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cellEditorDom = firstCell?.querySelector<HTMLElement>('.cm-editor');
    const cellEditor = cellEditorDom
      ? EditorView.findFromDOM(cellEditorDom)
      : null;
    expect(cellEditor).not.toBeNull();
    cellEditor?.dispatch({
      changes: { from: 0, insert: 'changed', to: cellEditor.state.doc.length },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(view.state.doc.toString()).toContain('changed');

    view.destroy();
    parent.remove();
  });

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
    const doc = [
      'before',
      '',
      '| A        | B      |',
      '| -------- | ------ |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc, doc.indexOf('bold'));

    expect(parent.querySelector('.tbl-table-widget .tbl-table')).not.toBeNull();
    expect(parent.textContent).not.toContain('| A        | B      |');

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
