import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import {
  copyCurrentMarkdownTable,
  deleteCurrentMarkdownTable,
  insertMarkdownTable,
} from './tableCommands';

const clipboardWriteText = vi.fn<() => Promise<void>>().mockResolvedValue();

beforeEach(() => {
  clipboardWriteText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardWriteText,
    },
  });
});

describe('table commands', () => {
  it('inserts a legal starter GFM table through the mature component command', () => {
    const { parent, view } = createView('before\n', 7);

    expect(insertMarkdownTable(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      ['before', '', '|   |   |', '| - | - |', '|   |   |', ''].join('\n'),
    );

    view.destroy();
    parent.remove();
  });

  it('copies the complete markdown table block containing the selection', async () => {
    const source = createTableSource();
    const { parent, view } = createView(source, source.indexOf('1'));

    await expect(
      copyCurrentMarkdownTable(view, undefined, clipboardWriteText),
    ).resolves.toBe(true);

    expect(clipboardWriteText).toHaveBeenCalledWith(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
    );

    view.destroy();
    parent.remove();
  });

  it('deletes only the markdown table block containing the selection', () => {
    const source = [
      'before',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '| X | Y |',
      '| --- | --- |',
      '| 3 | 4 |',
      '',
      'after',
    ].join('\n');
    const { parent, view } = createView(source, source.indexOf('1'));

    expect(deleteCurrentMarkdownTable(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      ['before', '', '', '', '| X | Y |', '| --- | --- |', '| 3 | 4 |', '', 'after'].join('\n'),
    );

    view.destroy();
    parent.remove();
  });

  it('copies an explicit context target while preserving a selection in another table', async () => {
    const source = createTwoTableSource();
    const firstSelection = source.indexOf('1');
    const targetText = ['| X | Y |', '| --- | --- |', '| 3 | 4 |'].join('\n');
    const target = {
      from: source.indexOf('| X | Y |'),
      to: source.indexOf('| X | Y |') + targetText.length,
    };
    const { parent, view } = createView(source, firstSelection);
    const selectionBefore = view.state.selection.main;

    await expect(
      copyCurrentMarkdownTable(view, target, clipboardWriteText),
    ).resolves.toBe(true);

    expect(clipboardWriteText).toHaveBeenCalledWith(targetText);
    expect(view.state.selection.main).toEqual(selectionBefore);
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
    parent.remove();
  });

  it('deletes an explicit context target while preserving a selection in another table', () => {
    const source = createTwoTableSource();
    const firstSelection = source.indexOf('1');
    const targetText = ['| X | Y |', '| --- | --- |', '| 3 | 4 |'].join('\n');
    const target = {
      from: source.indexOf('| X | Y |'),
      to: source.indexOf('| X | Y |') + targetText.length,
    };
    const { parent, view } = createView(source, firstSelection);
    const selectionBefore = view.state.selection.main;

    expect(deleteCurrentMarkdownTable(view, target)).toBe(true);

    expect(view.state.doc.toString()).toBe(
      ['before', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', '', '', 'after'].join('\n'),
    );
    expect(view.state.selection.main).toEqual(selectionBefore);

    view.destroy();
    parent.remove();
  });

  it('returns false when copy or delete runs outside a table', async () => {
    const { parent, view } = createView('plain text', 2);

    await expect(copyCurrentMarkdownTable(view)).resolves.toBe(false);
    expect(deleteCurrentMarkdownTable(view)).toBe(false);
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('plain text');

    view.destroy();
    parent.remove();
  });

  it('keeps copy available but refuses insert and delete commands while read-only', async () => {
    const source = createTableSource();
    const { parent, view } = createView(source, source.indexOf('1'), true);

    await expect(
      copyCurrentMarkdownTable(view, undefined, clipboardWriteText),
    ).resolves.toBe(true);
    expect(insertMarkdownTable(view)).toBe(false);
    expect(deleteCurrentMarkdownTable(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
    parent.remove();
  });

});

function createView(doc: string, selection: number, readOnly = false) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        EditorState.readOnly.of(readOnly),
      ],
      selection: EditorSelection.cursor(selection),
    }),
  });

  return { parent, view };
}

function createTableSource(): string {
  return ['before', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
}

function createTwoTableSource(): string {
  return [
    'before',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '| X | Y |',
    '| --- | --- |',
    '| 3 | 4 |',
    '',
    'after',
  ].join('\n');
}
