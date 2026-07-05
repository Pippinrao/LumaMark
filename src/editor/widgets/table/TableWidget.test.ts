import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { tablePreviewExtension } from './TableWidget';

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
    state: EditorState.create({
      doc,
      extensions: [markdownLanguage(), history(), tablePreviewExtension()],
      selection: EditorSelection.cursor(selection),
    }),
  });

  return { parent, view };
}

describe('tablePreviewExtension', () => {
  it('renders a GFM table as a quiet read-only table widget without changing source text', () => {
    const doc = [
      'before',
      '',
      '| A | B |',
      '| --- | --- |',
      '| **bold** | `code` |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(doc);
    const cell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );

    expect(view.state.doc.toString()).toBe(doc);
    expect(parent.querySelector('.lm-table-widget table')).not.toBeNull();
    expect(parent.querySelector('.lm-table-widget')?.textContent).toContain('A');
    expect(cell?.getAttribute('contenteditable')).not.toBe('true');
    expect(parent.querySelector('.lm-table-toolbar:not([hidden])')).toBeNull();
    expect(cell?.querySelector('strong')?.textContent).toBe('bold');
    expect(parent.querySelector('.lm-table-widget code')?.textContent).toBe('code');

    view.destroy();
    parent.remove();
  });

  it('activates a cell editor on click updates only the table block and supports undo', async () => {
    const doc = ['before', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
    const { parent, view } = createView(doc);
    const cell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="1"]',
    );

    if (!cell) {
      throw new Error('Expected editable table cell to render.');
    }

    cell.click();
    const inlineEditor = parent.querySelector<HTMLElement>('.lm-table-cell-editor .cm-content');
    expect(parent.querySelector('.lm-table-toolbar:not([hidden])')).not.toBeNull();
    expect(inlineEditor).not.toBeNull();

    if (!inlineEditor) {
      throw new Error('Expected cell editor to render.');
    }

    inlineEditor.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'Updated',
        inputType: 'insertText',
      }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(view.state.doc.toString()).toBe(
      ['before', '', '| A | B |', '| --- | --- |', '| 1 | Updated |', '', 'after'].join('\n'),
    );

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('keeps the structured table widget active when the editor selection is inside the markdown table block', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const { parent, view } = createView(doc, doc.indexOf('1'));

    expect(parent.querySelector('.lm-table-widget table')).not.toBeNull();
    expect(parent.textContent).not.toContain('| A | B |');

    view.destroy();
    parent.remove();
  });

  it('hides table operations until a table cell is clicked for editing', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const { parent, view } = createView(doc);
    const firstCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );

    expect(parent.querySelector('.lm-table-toolbar:not([hidden])')).toBeNull();

    firstCell?.click();

    expect(parent.querySelector('.lm-table-toolbar:not([hidden])')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('moves between cells with Tab and Shift+Tab', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
    const { parent, view } = createView(doc);
    const firstCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );
    const secondCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="1"]',
    );

    firstCell?.click();
    firstCell?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));

    expect(secondCell?.dataset.active).toBe('true');

    secondCell?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', shiftKey: true }),
    );

    expect(firstCell?.dataset.active).toBe('true');

    view.destroy();
    parent.remove();
  });

  it('adds a row after the active body row with Enter', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
    const { parent, view } = createView(doc);
    const firstCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );

    firstCell?.click();
    firstCell?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));

    expect(view.state.doc.toString()).toBe(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |', '|  |  |', '', 'after'].join('\n'),
    );

    view.destroy();
    parent.remove();
  });

  it('returns focus to the editor with Escape', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
    const { parent, view } = createView(doc);
    const firstCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );

    firstCell?.click();
    firstCell?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));

    expect(parent.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.classList.contains('cm-content')).toBe(true);
    expect(parent.querySelector('.lm-table-toolbar:not([hidden])')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('edits rows columns and alignment from the table toolbar', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
    const { parent, view } = createView(doc);
    const firstCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );

    firstCell?.click();
    parent.querySelector<HTMLButtonElement>('[data-action="add-column"]')?.click();

    expect(view.state.doc.toString()).toBe(
      ['| A |  | B |', '| --- | --- | --- |', '| 1 |  | 2 |', '', 'after'].join('\n'),
    );

    parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="1"]',
    )?.focus();
    const alignCenterButton = parent.querySelector<HTMLButtonElement>(
      '[data-action="align-center"]',
    );
    alignCenterButton?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    );
    alignCenterButton?.click();

    expect(view.state.doc.toString()).toBe(
      ['| A |  | B |', '| --- | :---: | --- |', '| 1 |  | 2 |', '', 'after'].join('\n'),
    );

    parent.querySelector<HTMLButtonElement>('[data-action="add-row"]')?.click();

    expect(view.state.doc.toString()).toContain('|  |  |  |');

    view.destroy();
    parent.remove();
  });

  it('keeps dangerous row column actions inside the more menu', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    const { parent, view } = createView(doc);
    const firstCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );

    firstCell?.click();

    expect(parent.querySelector<HTMLElement>('.lm-table-more-menu')?.hidden).toBe(true);

    parent.querySelector<HTMLButtonElement>('[data-action="more"]')?.click();
    expect(parent.querySelector<HTMLElement>('.lm-table-more-menu')?.hidden).toBe(false);
    parent.querySelector<HTMLButtonElement>('[data-action="delete-row"]')?.click();

    expect(view.state.doc.toString()).toBe(
      ['| A | B |', '| --- | --- |', '| 3 | 4 |'].join('\n'),
    );

    view.destroy();
    parent.remove();
  });

  it('resizes the table from the adjust table picker', () => {
    const doc = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const { parent, view } = createView(doc);
    const firstCell = parent.querySelector<HTMLElement>(
      '[data-section="body"][data-row-index="0"][data-column-index="0"]',
    );

    firstCell?.click();
    parent.querySelector<HTMLButtonElement>('[data-action="adjust-size"]')?.click();
    parent.querySelector<HTMLButtonElement>('[data-size-rows="2"][data-size-columns="3"]')?.click();

    expect(view.state.doc.toString()).toBe(
      ['| A | B |  |', '| --- | --- | --- |', '| 1 | 2 |  |', '|  |  |  |'].join('\n'),
    );

    view.destroy();
    parent.remove();
  });
});
