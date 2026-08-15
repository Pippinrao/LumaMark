import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { searchPanelOpen } from '@codemirror/search';
import { createEditorApi } from '../core/editorApi';
import {
  createEditorCommandPort as createEditorCommandPortBase,
  createEditorDocumentPort,
} from './editorCommandPort';

let installedClipboard:
  | {
      readText: () => Promise<string>;
      writeText: (text: string) => Promise<void>;
    }
  | undefined;

function createEditorCommandPort(
  editor: Parameters<typeof createEditorCommandPortBase>[0],
  options: Parameters<typeof createEditorCommandPortBase>[1] = {},
) {
  return createEditorCommandPortBase(editor, {
    resolveClipboard: () => installedClipboard ?? null,
    ...options,
  });
}

describe('editor command port', () => {
  it('reports live selection, read-only, and clipboard capability state on demand', () => {
    installClipboard({
      readText: vi.fn().mockResolvedValue(''),
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'selected text', parent });
    editor.view.dispatch({ selection: { anchor: 0, head: 8 } });
    const commands = createEditorCommandPort(editor);

    expect(commands.getEditState()).toEqual({
      clipboardReadAvailable: true,
      clipboardWriteAvailable: true,
      readOnly: false,
      selectionEmpty: false,
    });

    editor.destroy();
    parent.remove();
  });

  it('copies the exact CodeMirror selection without changing document or selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard({ readText: vi.fn(), writeText });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before selected after', parent });
    editor.view.dispatch({ selection: { anchor: 7, head: 15 } });
    const selectionBefore = editor.view.state.selection.main;
    const commands = createEditorCommandPort(editor);

    await expect(commands.copy()).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('selected');
    expect(editor.getDocumentText()).toBe('before selected after');
    expect(editor.view.state.selection.main).toEqual(selectionBefore);

    editor.destroy();
    parent.remove();
  });

  it('deletes the selection only after a successful cut clipboard write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard({ readText: vi.fn(), writeText });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before selected after', parent });
    editor.view.dispatch({ selection: { anchor: 7, head: 15 } });
    const commands = createEditorCommandPort(editor);

    await expect(commands.cut()).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith('selected');
    expect(editor.getDocumentText()).toBe('before  after');

    editor.destroy();
    parent.remove();
  });

  it('keeps the selection and reports an observable error when cut clipboard write fails', async () => {
    const failure = new Error('clipboard denied');
    const onClipboardError = vi.fn();
    installClipboard({
      readText: vi.fn(),
      writeText: vi.fn().mockRejectedValue(failure),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before selected after', parent });
    editor.view.dispatch({ selection: { anchor: 7, head: 15 } });
    const selectionBefore = editor.view.state.selection.main;
    const commands = createEditorCommandPort(editor, { onClipboardError });

    await expect(commands.cut()).resolves.toBe(false);

    expect(editor.getDocumentText()).toBe('before selected after');
    expect(editor.view.state.selection.main).toEqual(selectionBefore);
    expect(onClipboardError).toHaveBeenCalledWith({
      cause: failure,
      operation: 'cut',
    });

    editor.destroy();
    parent.remove();
  });

  it('does not delete a stale range when the selection moves during an async cut', async () => {
    let finishWrite: (() => void) | undefined;
    const onClipboardError = vi.fn();
    installClipboard({
      readText: vi.fn(),
      writeText: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      ),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before selected after', parent });
    editor.view.dispatch({ selection: { anchor: 7, head: 15 } });
    const commands = createEditorCommandPort(editor, { onClipboardError });

    const pendingCut = commands.cut();
    editor.view.dispatch({ selection: { anchor: 0 } });
    finishWrite?.();

    await expect(pendingCut).resolves.toBe(false);
    expect(editor.getDocumentText()).toBe('before selected after');
    expect(editor.view.state.selection.main.head).toBe(0);
    expect(onClipboardError).toHaveBeenCalledWith({
      cause: expect.any(Error),
      operation: 'cut',
    });

    editor.destroy();
    parent.remove();
  });

  it('pastes clipboard text through one CodeMirror replacement transaction', async () => {
    installClipboard({
      readText: vi.fn().mockResolvedValue('replacement'),
      writeText: vi.fn(),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before selected after', parent });
    editor.view.dispatch({ selection: { anchor: 7, head: 15 } });
    const commands = createEditorCommandPort(editor);

    await expect(commands.paste()).resolves.toBe(true);

    expect(editor.getDocumentText()).toBe('before replacement after');
    expect(editor.view.state.selection.main.head).toBe(18);

    editor.destroy();
    parent.remove();
  });

  it('uses the injected desktop clipboard instead of the WebView navigator clipboard', async () => {
    const browserReadText = vi.fn().mockResolvedValue('browser fallback');
    const desktopReadText = vi.fn().mockResolvedValue('desktop clipboard');
    installClipboard({
      readText: browserReadText,
      writeText: vi.fn().mockResolvedValue(undefined),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '', parent });
    const commands = createEditorCommandPort(editor, {
      resolveClipboard: () => ({
        readText: desktopReadText,
        writeText: vi.fn().mockResolvedValue(undefined),
      }),
    });

    await expect(commands.paste()).resolves.toBe(true);

    expect(desktopReadText).toHaveBeenCalledOnce();
    expect(browserReadText).not.toHaveBeenCalled();
    expect(editor.getDocumentText()).toBe('desktop clipboard');

    editor.destroy();
    parent.remove();
  });

  it('does not replace a stale range when the selection moves during an async paste', async () => {
    let finishRead: ((text: string) => void) | undefined;
    const onClipboardError = vi.fn();
    installClipboard({
      readText: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finishRead = resolve;
          }),
      ),
      writeText: vi.fn(),
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before selected after', parent });
    editor.view.dispatch({ selection: { anchor: 7, head: 15 } });
    const commands = createEditorCommandPort(editor, { onClipboardError });

    const pendingPaste = commands.paste();
    editor.view.dispatch({ selection: { anchor: 0 } });
    finishRead?.('replacement');

    await expect(pendingPaste).resolves.toBe(false);
    expect(editor.getDocumentText()).toBe('before selected after');
    expect(editor.view.state.selection.main.head).toBe(0);
    expect(onClipboardError).toHaveBeenCalledWith({
      cause: expect.any(Error),
      operation: 'paste',
    });

    editor.destroy();
    parent.remove();
  });

  it('refuses cut and paste while the CodeMirror state is read-only', async () => {
    const readText = vi.fn().mockResolvedValue('replacement');
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard({ readText, writeText });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'selected',
      extensions: [EditorState.readOnly.of(true)],
      parent,
    });
    editor.view.dispatch({ selection: { anchor: 0, head: 8 } });
    const commands = createEditorCommandPort(editor);

    await expect(commands.cut()).resolves.toBe(false);
    await expect(commands.paste()).resolves.toBe(false);

    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(editor.getDocumentText()).toBe('selected');

    editor.destroy();
    parent.remove();
  });

  it('refuses contextual deletion and image insertion while read-only', () => {
    const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const image = '![cover](./cover.png)';
    const source = `${image}\n\n${table}`;
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: source,
      displayMode: 'source',
      extensions: [EditorState.readOnly.of(true)],
      parent,
    });
    const commands = createEditorCommandPort(editor);

    commands.deleteImageReference({ from: 0, to: image.length });
    expect(
      commands.deleteTable({
        from: source.indexOf('| A | B |'),
        to: source.length,
      }),
    ).toBe(false);
    commands.insertImages([
      { alt: 'other', markdownSource: '![other](./other.png)' },
    ]);

    expect(editor.getDocumentText()).toBe(source);

    editor.destroy();
    parent.remove();
  });

  it('refuses undo and redo history writes while read-only', () => {
    const undoParent = document.createElement('div');
    document.body.appendChild(undoParent);
    const undoEditor = createEditorApi({ doc: 'plain', parent: undoParent });
    const undoCommands = createEditorCommandPort(undoEditor);
    undoCommands.runFormat('bold');
    expect(undoEditor.getDocumentText()).toBe('**bold**plain');
    undoEditor.setDisplayMode('reading');

    undoCommands.undo();
    expect(undoEditor.getDocumentText()).toBe('**bold**plain');

    const redoParent = document.createElement('div');
    document.body.appendChild(redoParent);
    const redoEditor = createEditorApi({ doc: 'plain', parent: redoParent });
    const redoCommands = createEditorCommandPort(redoEditor);
    redoCommands.runFormat('bold');
    redoCommands.undo();
    expect(redoEditor.getDocumentText()).toBe('plain');
    redoEditor.setDisplayMode('reading');

    redoCommands.redo();
    expect(redoEditor.getDocumentText()).toBe('plain');

    undoEditor.destroy();
    undoParent.remove();
    redoEditor.destroy();
    redoParent.remove();
  });

  it('selects the complete document through a minimal selection transaction', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'all text', parent });
    editor.view.dispatch({ selection: { anchor: 3 } });
    const commands = createEditorCommandPort(editor);

    expect(commands.selectAll()).toBe(true);

    expect(editor.view.state.selection.main).toMatchObject({
      anchor: 0,
      head: 8,
    });
    expect(editor.getDocumentText()).toBe('all text');

    editor.destroy();
    parent.remove();
  });

  it('forwards a typed table range without replacing current-table command semantics', async () => {
    const browserWriteText = vi.fn().mockResolvedValue(undefined);
    const desktopWriteText = vi.fn().mockResolvedValue(undefined);
    installClipboard({ readText: vi.fn(), writeText: browserWriteText });
    const tableText = ['| X | Y |', '| --- | --- |', '| 3 | 4 |'].join('\n');
    const source = [
      'before',
      '',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      tableText,
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: source, displayMode: 'source', parent });
    editor.view.dispatch({ selection: { anchor: source.indexOf('1') } });
    const selectionBefore = editor.view.state.selection.main;
    const target = {
      from: source.indexOf('| X | Y |'),
      to: source.indexOf('| X | Y |') + tableText.length,
    };
    const commands = createEditorCommandPort(editor, {
      resolveClipboard: () => ({
        readText: vi.fn(),
        writeText: desktopWriteText,
      }),
    });

    await expect(commands.copyTable(target)).resolves.toBe(true);
    expect(desktopWriteText).toHaveBeenCalledWith(tableText);
    expect(browserWriteText).not.toHaveBeenCalled();
    expect(editor.view.state.selection.main).toEqual(selectionBefore);

    expect(commands.deleteTable(target)).toBe(true);
    expect(editor.getDocumentText()).toBe(
      [
        'before',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '',
        '',
        'after',
      ].join('\n'),
    );
    expect(editor.view.state.selection.main).toEqual(selectionBefore);

    editor.destroy();
    parent.remove();
  });

  it('reports unavailable and rejected clipboard writes for contextual table copy', async () => {
    const tableText = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: tableText,
      displayMode: 'source',
      parent,
    });
    const onClipboardError = vi.fn();
    const commands = createEditorCommandPort(editor, { onClipboardError });
    const range = { from: 0, to: tableText.length };

    installClipboard(undefined);
    await expect(commands.copyTable(range)).resolves.toBe(false);
    expect(onClipboardError).toHaveBeenLastCalledWith({
      cause: expect.any(Error),
      operation: 'copy',
    });

    const rejection = new Error('clipboard denied');
    installClipboard({
      readText: vi.fn(),
      writeText: vi.fn().mockRejectedValue(rejection),
    });
    await expect(commands.copyTable(range)).resolves.toBe(false);
    expect(onClipboardError).toHaveBeenLastCalledWith({
      cause: rejection,
      operation: 'copy',
    });

    editor.destroy();
    parent.remove();
  });

  it('separates normalized editor text from exact serialized source', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = '\uFEFFfirst\r\nsecond\rthird\n';
    const editor = createEditorApi({ doc: source, parent });
    const documentPort = createEditorDocumentPort(editor);

    expect(documentPort.getText()).toBe('first\nsecond\nthird\n');
    expect(documentPort.serializeText()).toBe(source);
    expect(documentPort.captureSnapshot().serializedText).toBe(source);

    editor.destroy();
    parent.remove();
  });

  it('opens the built-in search panel through the command port', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'Find this Markdown text.',
      parent,
    });
    const commands = createEditorCommandPort(editor);

    commands.openSearch();

    expect(searchPanelOpen(editor.view.state)).toBe(true);

    editor.destroy();
    parent.remove();
  });

  it('undoes and redoes editor changes without exposing document state to the caller', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'plain',
      parent,
    });
    const commands = createEditorCommandPort(editor);

    commands.runFormat('bold');
    expect(editor.getDocumentText()).toBe('**bold**plain');

    commands.undo();
    expect(editor.getDocumentText()).toBe('plain');

    commands.redo();
    expect(editor.getDocumentText()).toBe('**bold**plain');

    editor.destroy();
    parent.remove();
  });

  it('restores editor focus when undo or redo has no history entry', () => {
    const parent = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(parent, outside);
    const editor = createEditorApi({ doc: 'plain', parent });
    const commands = createEditorCommandPort(editor);

    outside.focus();
    commands.undo();
    expect(editor.view.hasFocus).toBe(true);

    outside.focus();
    commands.redo();
    expect(editor.view.hasFocus).toBe(true);

    editor.destroy();
    parent.remove();
    outside.remove();
  });

  it('inserts local image references without rewriting their markdown sources', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'before ',
      parent,
    });
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const commands = createEditorCommandPort(editor);

    commands.insertImages([
      {
        alt: '魔法森林动漫.png',
        markdownSource: 'C:\\Users\\pippin\\Pictures\\魔法森林动漫.png',
      },
      {
        alt: '魔法森林真人.png',
        markdownSource: 'C:\\Users\\pippin\\Pictures\\魔法森林真人.png',
      },
    ]);

    expect(editor.getDocumentText()).toBe(
      'before ![魔法森林动漫.png](C:\\Users\\pippin\\Pictures\\魔法森林动漫.png)\n' +
        '![魔法森林真人.png](C:\\Users\\pippin\\Pictures\\魔法森林真人.png)',
    );

    editor.destroy();
    parent.remove();
  });

  it('ignores native image drops outside the editor', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'unchanged', parent });
    const commands = createEditorCommandPort(editor);

    commands.insertImages(
      [{ alt: 'outside.png', markdownSource: 'C:\\Pictures\\outside.png' }],
      { x: -100, y: -100 },
    );

    expect(editor.getDocumentText()).toBe('unchanged');

    editor.destroy();
    parent.remove();
  });

  it('exposes image preview invalidation through the document port', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '![Local](./pic.png)', parent });
    const documentPort = createEditorDocumentPort(editor);

    expect(documentPort.refreshImages).toBeTypeOf('function');

    editor.destroy();
    parent.remove();
  });
});

function installClipboard(
  clipboard:
    | {
        readText: () => Promise<string>;
        writeText: (text: string) => Promise<void>;
      }
    | undefined,
) {
  installedClipboard = clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
}
