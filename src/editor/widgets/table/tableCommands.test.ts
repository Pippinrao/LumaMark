import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import {
  copyCurrentMarkdownTable,
  deleteCurrentMarkdownTable,
  insertMarkdownTable,
  tableKeymap,
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

    await expect(copyCurrentMarkdownTable(view)).resolves.toBe(true);

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

  it('returns false when copy or delete runs outside a table', async () => {
    const { parent, view } = createView('plain text', 2);

    await expect(copyCurrentMarkdownTable(view)).resolves.toBe(false);
    expect(deleteCurrentMarkdownTable(view)).toBe(false);
    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('plain text');

    view.destroy();
    parent.remove();
  });

  it('exposes keyboard shortcuts for inserting copying and deleting tables', async () => {
    const insertBinding = findRunnableBinding('Alt-Mod-t');
    const copyBinding = findRunnableBinding('Alt-Mod-c');
    const deleteBinding = findRunnableBinding('Alt-Mod-Backspace');

    const { parent: insertParent, view: insertView } = createView('before\n', 7);
    expect(insertBinding.run(insertView)).toBe(true);
    expect(insertView.state.doc.toString()).toBe(
      ['before', '', '|   |   |', '| - | - |', '|   |   |', ''].join('\n'),
    );
    insertView.destroy();
    insertParent.remove();

    const source = createTableSource();
    const { parent, view } = createView(source, source.indexOf('1'));

    expect(copyBinding.run(view)).toBe(true);
    await Promise.resolve();
    expect(clipboardWriteText).toHaveBeenCalledWith(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
    );

    expect(deleteBinding.run(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(['before', '', '', '', 'after'].join('\n'));

    view.destroy();
    parent.remove();
  });
});

function findRunnableBinding(key: string): KeyBinding & { run: NonNullable<KeyBinding['run']> } {
  const binding = tableKeymap.find(
    (candidate): candidate is KeyBinding & { run: NonNullable<KeyBinding['run']> } =>
      candidate.key === key && typeof candidate.run === 'function',
  );

  expect(binding).toBeDefined();
  if (!binding) {
    throw new Error(`Missing runnable table key binding: ${key}`);
  }
  return binding;
}

function createView(doc: string, selection: number) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(selection),
    }),
  });

  return { parent, view };
}

function createTableSource(): string {
  return ['before', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
}
