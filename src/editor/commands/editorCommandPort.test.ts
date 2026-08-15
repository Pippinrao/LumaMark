import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { history, undo, undoDepth } from '@codemirror/commands';
import {
  getSearchQuery,
  SearchQuery,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { createEditorApi } from '../core/editorApi';
import { isDocumentDirty } from '../core/createEditorState';
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
  it('reveals a valid position at the viewport center without adding undo history', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const updates: ViewUpdate[] = [];
    const source = ['# First', '', 'body', '', '# Target'].join('\n');
    const target = source.indexOf('# Target');
    const editor = createEditorApi({
      doc: source,
      extensions: [
        EditorView.updateListener.of((update) => {
          updates.push(update);
        }),
      ],
      parent,
    });
    const commands = createEditorCommandPort(editor);

    editor.view.dispatch({
      changes: { from: source.indexOf('body') + 4, insert: ' edited' },
      userEvent: 'input.type',
    });
    const undoDepthBefore = undoDepth(editor.view.state);
    const textBefore = editor.getDocumentText();

    commands.revealPosition(target);

    const navigation = updates.at(-1)?.transactions.at(0);
    const scrollEffect = navigation?.effects
      .map((effect) => effect.value as {
        range?: { from: number; to: number };
        y?: string;
      })
      .find((effect) => effect.y === 'center');
    expect(editor.view.state.selection.main).toMatchObject({
      anchor: target,
      head: target,
    });
    expect(scrollEffect).toMatchObject({
      range: { from: target, to: target },
      y: 'center',
    });
    expect(editor.getDocumentText()).toBe(textBefore);
    expect(isDocumentDirty(editor.view.state)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(undoDepthBefore);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe(source);

    editor.destroy();
    parent.remove();
  });

  it('ignores non-integer and out-of-range reveal positions', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before', parent });
    const commands = createEditorCommandPort(editor);
    const selectionBefore = editor.view.state.selection;

    commands.revealPosition(-1);
    commands.revealPosition(7);
    commands.revealPosition(1.5);

    expect(editor.view.state.selection).toEqual(selectionBefore);
    expect(undoDepth(editor.view.state)).toBe(0);

    editor.destroy();
    parent.remove();
  });

  it('reports live history, composition, selection, safety, and clipboard state on demand', () => {
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
      canFormat: true,
      canInsert: true,
      canRedo: false,
      canUndo: false,
      clipboardReadAvailable: true,
      clipboardWriteAvailable: true,
      composing: false,
      eligibleFindSelection: true,
      readOnly: false,
      selectionCount: 1,
      selectionEmpty: false,
      selectionLength: 8,
    });

    editor.destroy();
    parent.remove();
  });

  it('keeps pointer hits inside a half-open selection and moves the caret outside it', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '0123456789', parent });
    editor.view.dispatch({ selection: { anchor: 2, head: 6 } });
    const commands = createEditorCommandPort(editor);
    vi.spyOn(editor.view, 'posAtCoords')
      .mockReturnValueOnce(5)
      .mockReturnValueOnce(6);

    commands.prepareContextMenu(
      editor.view.contentDOM,
      { x: 10, y: 10 },
      'pointer',
    );
    expect(editor.view.state.selection.main).toMatchObject({ from: 2, to: 6 });

    commands.prepareContextMenu(
      editor.view.contentDOM,
      { x: 20, y: 10 },
      'pointer',
    );
    expect(editor.view.state.selection.main).toMatchObject({
      anchor: 6,
      head: 6,
    });

    editor.destroy();
    parent.remove();
  });

  it('does not move a pointer-targeted selection during IME composition', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '0123456789', parent });
    editor.view.dispatch({ selection: { anchor: 2, head: 6 } });
    const selectionBefore = editor.view.state.selection;
    const commands = createEditorCommandPort(editor);
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(8);
    vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true);

    commands.prepareContextMenu(
      editor.view.contentDOM,
      { x: 80, y: 10 },
      'pointer',
    );

    expect(editor.view.state.selection).toEqual(selectionBefore);

    vi.restoreAllMocks();
    editor.destroy();
    parent.remove();
  });

  it('routes standard edit and history commands to the prepared nested editor', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard({
      readText: vi.fn().mockResolvedValue('pasted'),
      writeText,
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'root', parent });
    const nested = createNestedView(editor.view, 'nested text');
    nested.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const commands = createEditorCommandPort(editor);

    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    await expect(commands.copy()).resolves.toBe(true);
    expect(writeText).toHaveBeenLastCalledWith('nested');
    await expect(commands.cut()).resolves.toBe(true);
    expect(nested.view.state.doc.toString()).toBe(' text');
    commands.undo();
    expect(nested.view.state.doc.toString()).toBe('nested text');
    commands.redo();
    expect(nested.view.state.doc.toString()).toBe(' text');
    commands.undo();
    expect(commands.selectAll()).toBe(true);
    expect(nested.view.state.selection.main).toMatchObject({ from: 0, to: 11 });
    expect(commands.deleteSelection()).toBe(true);
    expect(nested.view.state.doc.toString()).toBe('');
    commands.undo();
    nested.view.dispatch({ selection: { anchor: 0, head: 6 } });
    await expect(commands.paste()).resolves.toBe(true);
    expect(nested.view.state.doc.toString()).toBe('pasted text');
    expect(editor.getDocumentText()).toBe('root');

    nested.destroy();
    editor.destroy();
    parent.remove();
  });

  it('disables format and insert commands for a prepared nested editor', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'root', parent });
    const nested = createNestedView(editor.view, 'nested');
    nested.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    commands.runFormat('bold');
    commands.insertImages([
      { alt: 'blocked.png', markdownSource: './blocked.png' },
    ]);

    expect(commands.getEditState()).toMatchObject({
      canFormat: false,
      canInsert: false,
    });
    expect(nested.view.state.doc.toString()).toBe('nested');
    expect(editor.getDocumentText()).toBe('root');

    nested.destroy();
    editor.destroy();
    parent.remove();
  });

  it('falls back to the root after a nested target is detached', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'root text', parent });
    editor.view.dispatch({ selection: { anchor: 2 } });
    const nested = createNestedView(editor.view, 'nested text');
    nested.view.dispatch({ selection: { anchor: 1, head: 4 } });
    const detachedSelection = nested.view.state.selection;
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    nested.destroy();
    expect(commands.selectAll()).toBe(true);

    expect(editor.view.state.selection.main).toMatchObject({ from: 0, to: 9 });
    expect(nested.view.state.selection).toEqual(detachedSelection);

    editor.destroy();
    parent.remove();
  });

  it('replaces a stale pointer session with the next prepared target', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'root text', parent });
    const nested = createNestedView(editor.view, 'nested text');
    nested.view.dispatch({ selection: { anchor: 1, head: 4 } });
    vi.spyOn(nested.view, 'posAtCoords').mockReturnValue(2);
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(3);
    const commands = createEditorCommandPort(editor);

    commands.prepareContextMenu(
      nested.view.contentDOM,
      { x: 20, y: 20 },
      'pointer',
    );
    commands.prepareContextMenu(
      editor.view.contentDOM,
      { x: 30, y: 30 },
      'pointer',
    );
    commands.selectAll();

    expect(editor.view.state.selection.main).toMatchObject({ from: 0, to: 9 });
    expect(nested.view.state.selection.main).toMatchObject({ from: 1, to: 4 });

    nested.destroy();
    editor.destroy();
    parent.remove();
  });

  it('restores the active context editor on ordinary close but preserves action focus', () => {
    const parent = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(parent, outside);
    const editor = createEditorApi({ doc: 'root', parent });
    const nested = createNestedView(editor.view, 'nested');
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    outside.focus();
    commands.closeContextMenu(true);
    expect(nested.view.hasFocus).toBe(true);

    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );
    outside.focus();
    commands.closeContextMenu(false);
    expect(document.activeElement).toBe(outside);

    nested.destroy();
    editor.destroy();
    outside.remove();
    parent.remove();
  });

  it('keeps a captured async cut target after the context menu session closes', async () => {
    let finishWrite: (() => void) | undefined;
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
    const editor = createEditorApi({ doc: 'root', parent });
    const nested = createNestedView(editor.view, 'nested text');
    nested.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    const cut = commands.cut();
    commands.closeContextMenu(false);
    finishWrite?.();

    await expect(cut).resolves.toBe(true);
    expect(nested.view.state.doc.toString()).toBe(' text');
    expect(editor.getDocumentText()).toBe('root');

    nested.destroy();
    editor.destroy();
    parent.remove();
  });

  it('rejects an async paste when the captured nested selection changes', async () => {
    let finishRead: ((text: string) => void) | undefined;
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
    const editor = createEditorApi({ doc: 'root', parent });
    const nested = createNestedView(editor.view, 'nested text');
    nested.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    const paste = commands.paste();
    commands.closeContextMenu(false);
    nested.view.dispatch({ selection: { anchor: 1, head: 6 } });
    finishRead?.('changed');

    await expect(paste).resolves.toBe(false);
    expect(nested.view.state.doc.toString()).toBe('nested text');
    expect(editor.getDocumentText()).toBe('root');

    nested.destroy();
    editor.destroy();
    parent.remove();
  });

  it('rejects an async cut after the document changes and returns to equal content', async () => {
    let finishWrite: (() => void) | undefined;
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
    const editor = createEditorApi({ doc: 'selected', parent });
    editor.view.dispatch({ selection: { anchor: 0, head: 8 } });
    const commands = createEditorCommandPort(editor);

    const cut = commands.cut();
    editor.view.dispatch({ changes: { from: 8, insert: '!' } });
    editor.view.dispatch({
      changes: { from: 8, to: 9 },
      selection: { anchor: 0, head: 8 },
    });
    finishWrite?.();

    await expect(cut).resolves.toBe(false);
    expect(editor.getDocumentText()).toBe('selected');
    expect(editor.view.state.selection.main).toMatchObject({ from: 0, to: 8 });

    editor.destroy();
    parent.remove();
  });

  it('rejects an async paste after the document changes and returns to equal content', async () => {
    let finishRead: ((text: string) => void) | undefined;
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
    const editor = createEditorApi({ doc: 'selected', parent });
    editor.view.dispatch({ selection: { anchor: 0, head: 8 } });
    const commands = createEditorCommandPort(editor);

    const paste = commands.paste();
    editor.view.dispatch({ changes: { from: 8, insert: '!' } });
    editor.view.dispatch({
      changes: { from: 8, to: 9 },
      selection: { anchor: 0, head: 8 },
    });
    finishRead?.('replacement');

    await expect(paste).resolves.toBe(false);
    expect(editor.getDocumentText()).toBe('selected');
    expect(editor.view.state.selection.main).toMatchObject({ from: 0, to: 8 });

    editor.destroy();
    parent.remove();
  });

  it('disables formatting inside protected source and across fenced code', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = [
      '---',
      'title: protected',
      '---',
      '',
      'before',
      '',
      '```ts',
      'const answer = 42;',
      '```',
      '',
      'after',
    ].join('\n');
    const editor = createEditorApi({ doc: source, parent });
    const commands = createEditorCommandPort(editor);

    editor.view.dispatch({ selection: { anchor: 1 } });
    expect(commands.getEditState()).toMatchObject({
      canFormat: false,
      canInsert: false,
    });
    commands.runFormat('bold');
    expect(editor.getDocumentText()).toBe(source);

    editor.view.dispatch({
      selection: {
        anchor: source.indexOf('before'),
        head: source.indexOf('after') + 'after'.length,
      },
    });
    expect(commands.getEditState()).toMatchObject({
      canFormat: false,
      canInsert: false,
    });
    commands.runFormat('bold');
    expect(editor.getDocumentText()).toBe(source);

    editor.destroy();
    parent.remove();
  });

  it('disables formatting at a protected source insertion boundary', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = ['---', 'title: protected', '---', '', 'plain'].join('\n');
    const editor = createEditorApi({ doc: source, parent });
    const commands = createEditorCommandPort(editor);
    const closingMarkerEnd = editor.view.state.doc.line(3).to;

    editor.view.dispatch({ selection: { anchor: closingMarkerEnd } });

    expect(commands.getEditState()).toMatchObject({
      canFormat: false,
      canInsert: false,
    });
    commands.runFormat('bold');
    expect(editor.getDocumentText()).toBe(source);

    editor.destroy();
    parent.remove();
  });

  it('disables formatting when a selection endpoint touches fenced code', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = ['before', '', '```ts', 'const answer = 42;', '```', '', 'after'].join(
      '\n',
    );
    const editor = createEditorApi({ doc: source, parent });
    const commands = createEditorCommandPort(editor);
    const fenceStart = source.indexOf('```ts');

    editor.view.dispatch({ selection: { anchor: 0, head: fenceStart } });

    expect(commands.getEditState()).toMatchObject({
      canFormat: false,
      canInsert: false,
    });
    commands.runFormat('bold');
    expect(editor.getDocumentText()).toBe(source);

    editor.destroy();
    parent.remove();
  });

  it('prefills the root search panel from the prepared nested editor selection', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'root', parent });
    const nested = createNestedView(editor.view, 'nested text');
    nested.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    commands.openSearch();

    const searchInput = parent.querySelector<HTMLInputElement>(
      '.cm-panels-top [name="search"]',
    );
    expect(searchPanelOpen(editor.view.state)).toBe(true);
    expect(searchPanelOpen(nested.view.state)).toBe(false);
    expect(getSearchQuery(editor.view.state).search).toBe('nested');
    expect(searchInput?.value).toBe('nested');
    expect(document.activeElement).toBe(searchInput);

    commands.closeContextMenu(false);
    expect(document.activeElement).toBe(searchInput);

    nested.destroy();
    editor.destroy();
    parent.remove();
  });

  it('prefills an explicit short search query exactly in the root panel', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'selected root text', parent });
    editor.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          caseSensitive: true,
          replace: 'replacement',
          search: 'existing',
          wholeWord: true,
        }),
      ),
      selection: { anchor: 0, head: 8 },
    });
    const commands = createEditorCommandPort(editor);

    commands.openSearch('精确 query [a-z]?');

    expect(getSearchQuery(editor.view.state)).toMatchObject({
      caseSensitive: true,
      replace: 'replacement',
      search: '精确 query [a-z]?',
      wholeWord: true,
    });
    expect(
      parent.querySelector<HTMLInputElement>('[name="search"]')?.value,
    ).toBe('精确 query [a-z]?');

    editor.destroy();
    parent.remove();
  });

  it.each([
    {
      configureSelection(editor: ReturnType<typeof createEditorApi>) {
        editor.view.dispatch({ selection: { anchor: 0, head: 101 } });
      },
      doc: 'x'.repeat(101),
      explicitQuery: undefined,
      name: 'a selection longer than 100 characters',
    },
    {
      configureSelection(editor: ReturnType<typeof createEditorApi>) {
        editor.view.dispatch({
          selection: EditorSelection.create([
            EditorSelection.range(0, 3),
            EditorSelection.range(4, 7),
          ]),
        });
      },
      doc: 'one two',
      explicitQuery: undefined,
      name: 'multiple selections',
    },
    {
      configureSelection(editor: ReturnType<typeof createEditorApi>) {
        editor.view.dispatch({ selection: { anchor: 0, head: 3 } });
      },
      doc: 'one two',
      explicitQuery: 'x'.repeat(101),
      name: 'an explicit query longer than 100 characters',
    },
  ])('keeps the current search query for $name', ({
    configureSelection,
    doc,
    explicitQuery,
  }) => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc, parent });
    const existing = new SearchQuery({
      caseSensitive: true,
      regexp: true,
      replace: 'replace-existing',
      search: 'existing-query',
      wholeWord: true,
    });
    editor.view.dispatch({ effects: setSearchQuery.of(existing) });
    configureSelection(editor);
    const observedQueries: string[] = [];
    const originalDispatch = editor.view.dispatch.bind(editor.view);
    vi.spyOn(editor.view, 'dispatch').mockImplementation((...specs) => {
      for (const spec of specs) {
        for (const effect of Array.isArray(spec.effects)
          ? spec.effects
          : spec.effects
            ? [spec.effects]
            : []) {
          if (effect.is(setSearchQuery)) {
            observedQueries.push(effect.value.search);
          }
        }
      }
      originalDispatch(...specs);
    });
    const commands = createEditorCommandPort(editor);

    commands.openSearch(explicitQuery);

    expect(searchPanelOpen(editor.view.state)).toBe(true);
    expect(getSearchQuery(editor.view.state)).toEqual(existing);
    expect(observedQueries).not.toContain('');

    editor.destroy();
    parent.remove();
  });

  it('deletes one selected range in a single undoable transaction without using the clipboard', () => {
    const writeText = vi.fn();
    installClipboard({ readText: vi.fn(), writeText });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'before selected after', parent });
    editor.view.dispatch({ selection: { anchor: 7, head: 15 } });
    const commands = createEditorCommandPort(editor);

    expect(commands.deleteSelection()).toBe(true);

    expect(writeText).not.toHaveBeenCalled();
    expect(editor.getDocumentText()).toBe('before  after');
    expect(editor.view.state.selection.main.head).toBe(7);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getDocumentText()).toBe('before selected after');

    editor.destroy();
    parent.remove();
  });

  it('blocks composition-sensitive and main-selection-only mutations at the command port', async () => {
    const readText = vi.fn().mockResolvedValue('replacement');
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard({ readText, writeText });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: 'one two',
      extensions: [EditorState.allowMultipleSelections.of(true)],
      parent,
    });
    editor.view.dispatch({ selection: { anchor: 0, head: 3 } });
    const commands = createEditorCommandPort(editor);
    vi.spyOn(editor.view, 'composing', 'get').mockReturnValue(true);

    await expect(commands.cut()).resolves.toBe(false);
    await expect(commands.paste()).resolves.toBe(false);
    expect(commands.deleteSelection()).toBe(false);
    commands.runFormat('bold');

    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
    expect(editor.getDocumentText()).toBe('one two');

    vi.restoreAllMocks();
    editor.view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(4, 7),
      ]),
    });

    expect(commands.getEditState()).toMatchObject({
      eligibleFindSelection: false,
      selectionCount: 2,
      selectionLength: 6,
    });
    await expect(commands.cut()).resolves.toBe(false);
    await expect(commands.paste()).resolves.toBe(false);
    expect(commands.deleteSelection()).toBe(false);
    commands.runFormat('italic');
    expect(editor.getDocumentText()).toBe('one two');

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
    expect(undoEditor.getDocumentText()).toBe('****plain');
    undoEditor.setDisplayMode('reading');

    undoCommands.undo();
    expect(undoEditor.getDocumentText()).toBe('****plain');

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

  it('restores the prepared nested editor after copying a root table', async () => {
    let finishWrite: (() => void) | undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    installClipboard({ readText: vi.fn(), writeText });
    const tableText = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: tableText,
      displayMode: 'source',
      parent,
    });
    const nested = createNestedView(editor.view, 'cell');
    nested.view.focus();
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    const copy = commands.copyTable({ from: 0, to: tableText.length });
    commands.closeContextMenu(false);
    finishWrite?.();

    await expect(copy).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith(tableText);
    expect(nested.view.hasFocus).toBe(true);
    expect(editor.view.hasFocus).toBe(false);

    nested.destroy();
    editor.destroy();
    parent.remove();
  });

  it('falls back to the root if a prepared nested editor detaches during table copy', async () => {
    let finishWrite: (() => void) | undefined;
    installClipboard({
      readText: vi.fn(),
      writeText: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      ),
    });
    const tableText = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: tableText,
      displayMode: 'source',
      parent,
    });
    const nested = createNestedView(editor.view, 'cell');
    const commands = createEditorCommandPort(editor);
    commands.prepareContextMenu(
      nested.view.contentDOM,
      undefined,
      'keyboard',
    );

    const copy = commands.copyTable({ from: 0, to: tableText.length });
    nested.destroy();
    finishWrite?.();

    await expect(copy).resolves.toBe(true);
    expect(editor.view.hasFocus).toBe(true);

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
    expect(editor.getDocumentText()).toBe('****plain');

    commands.undo();
    expect(editor.getDocumentText()).toBe('plain');

    commands.redo();
    expect(editor.getDocumentText()).toBe('****plain');

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

function createNestedView(root: EditorView, doc: string) {
  const parent = document.createElement('div');
  root.dom.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [history()],
    }),
  });

  return {
    destroy() {
      view.destroy();
      parent.remove();
    },
    view,
  };
}
