import { describe, expect, it, vi } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import type { CommandResult } from '../../services/tauri/invokeCommand';
import {
  createEditorApi,
  type EditorApi,
} from '../../editor/core/editorApi';
import { isDocumentDirty } from '../../editor/core/createEditorState';
import {
  createFileActions,
  type FileActionState,
} from './fileActions';

function createState(initial?: Partial<FileActionState>) {
  let state: FileActionState = {
    currentFile: null,
    dirty: false,
    dirtyRevision: 0,
    lastFileError: null,
    ...initial,
  };

  return {
    getState: () => state,
    setCurrentFile: vi.fn((currentFile: FileActionState['currentFile']) => {
      state = { ...state, currentFile };
    }),
    setDirty: vi.fn((dirty: boolean) => {
      state = {
        ...state,
        dirty,
        dirtyRevision: dirty ? state.dirtyRevision + 1 : state.dirtyRevision,
      };
    }),
    setLastFileError: vi.fn((error: FileActionState['lastFileError']) => {
      state = { ...state, lastFileError: error };
    }),
  };
}

function withExactSnapshotMethods<
  T extends Pick<
    EditorApi,
    'focus' | 'getDocumentText' | 'loadDocument' | 'markDocumentSaved'
  >,
>(
  editor: T,
): T &
  Pick<
    EditorApi,
    | 'captureDocumentSnapshot'
    | 'isDocumentSnapshotCurrent'
    | 'markDocumentUnsaved'
  > {
  return {
    ...editor,
    captureDocumentSnapshot: () => ({
      serializedText: editor.getDocumentText(),
    }),
    isDocumentSnapshotCurrent: (snapshot) =>
      snapshot.serializedText === editor.getDocumentText(),
    markDocumentUnsaved: vi.fn(),
  };
}

describe('file actions', () => {
  it('saves an immutable exact editor snapshot while newer input stays dirty', async () => {
    let finishWrite: (() => void) | undefined;
    let writtenText = '';
    const writePending = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: '\uFEFF# Saved\r\nfirst\rsecond\n',
      parent,
    });
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
      dirtyRevision: 1,
    });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: 'snapshot',
      },
    });
    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn(async (path, text) => {
          writtenText = text;
          await writePending;

          return {
            ok: true as const,
            data: {
              byteLength: Buffer.byteLength(text, 'utf8'),
              path,
            },
          };
        }),
      },
      editor,
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    const save = actions.saveCurrentFile();
    await vi.waitFor(() => {
      expect(writtenText).not.toBe('');
    });
    editor.view.dispatch({
      changes: {
        from: editor.view.state.doc.length,
        insert: ' newer',
      },
    });
    state.setDirty(true);
    finishWrite?.();
    await save;

    expect(writtenText).toBe('\uFEFF# Saved\r\nfirst\rsecond\nsnapshot');
    expect(isDocumentDirty(editor.view.state)).toBe(true);
    expect(undo(editor.view)).toBe(true);
    expect(editor.view.state.doc.toString()).toBe(
      '# Saved\nfirst\nsecond\nsnapshot',
    );
    expect(isDocumentDirty(editor.view.state)).toBe(false);

    editor.destroy();
    parent.remove();
  });

  it('loads migrated markdown back into the editor after a successful save', async () => {
    const loadDocument = vi.fn();
    const actions = createFileActions({
      commands: {
        readText: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn(),
        writeText: vi.fn().mockResolvedValue({ ok: true, data: { byteLength: 30, path: 'E:/docs/note.md' } }),
      },
      editor: withExactSnapshotMethods({
        focus: vi.fn(),
        getDocumentText: vi.fn(
          () => '![Draft](lumamark-draft://draft-1/image-001.png)',
        ),
        loadDocument,
        markDocumentSaved: vi.fn(),
      }),
      prepareTextForSave: async () => '![Draft](note.assets/image-001.png)',
      recentFiles: { addRecentFile: vi.fn() },
      state: createState({ currentFile: { name: 'note.md', path: 'E:/docs/note.md' }, dirty: true }),
    });

    await actions.saveCurrentFile();

    expect(loadDocument).toHaveBeenCalledWith(
      '![Draft](note.assets/image-001.png)',
      { preserveView: true, resetHistory: false },
    );
  });

  it('maps the real editor selection through a draft image save transform', async () => {
    const source = [
      '![Draft](lumamark-draft://draft-1/image-001.png)',
      'TARGET paragraph',
    ].join('\n');
    const prepared = [
      '![Draft](note.assets/image-001.png)',
      'TARGET paragraph',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: source, parent });
    const sourceTarget = source.indexOf('TARGET');
    const preparedTarget = prepared.indexOf('TARGET');
    editor.view.dispatch({
      selection: EditorSelection.range(sourceTarget, sourceTarget + 6),
    });
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
    });
    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn().mockResolvedValue({
          ok: true,
          data: { byteLength: prepared.length, path: 'E:/docs/note.md' },
        }),
      },
      editor,
      prepareTextForSave: async () => prepared,
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    try {
      await actions.saveCurrentFile();

      expect(editor.view.state.selection.main).toEqual(
        EditorSelection.range(preparedTarget, preparedTarget + 6),
      );
      expect(editor.view.state.sliceDoc(preparedTarget, preparedTarget + 6)).toBe(
        'TARGET',
      );
      expect(state.getState().dirty).toBe(false);
    } finally {
      editor.destroy();
      parent.remove();
    }
  });

  it('returns a recoverable error when save preparation fails', async () => {
    const writeText = vi.fn();
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
    });
    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText,
      },
      editor: withExactSnapshotMethods({
        focus: vi.fn(),
        getDocumentText: vi.fn(() => '# unsaved'),
        loadDocument: vi.fn(),
        markDocumentSaved: vi.fn(),
      }),
      prepareTextForSave: async () => {
        throw new Error('asset.finalize_failed');
      },
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    const result = await actions.saveCurrentFile();

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'file.prepare_failed',
        details: expect.any(Error),
        message: 'asset.finalize_failed',
        recoverable: true,
      },
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(state.getState().dirty).toBe(true);
    expect(state.getState().lastFileError?.code).toBe('file.prepare_failed');
  });

  it('creates an empty unsaved document without retaining the previous file context', () => {
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(),
      loadDocument: vi.fn(),
      markDocumentSaved: vi.fn(),
      setDocumentContext: vi.fn(),
    };
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
      lastFileError: {
        code: 'file.io_error',
        message: 'Previous error',
        recoverable: true,
      },
    });
    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn(),
      },
      editor: withExactSnapshotMethods(editor),
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    actions.createNewDocument();

    expect(editor.loadDocument).toHaveBeenCalledWith('');
    expect(editor.setDocumentContext).toHaveBeenCalledWith({ path: null });
    expect(editor.focus).toHaveBeenCalled();
    expect(state.getState()).toEqual({
      currentFile: null,
      dirty: false,
      dirtyRevision: 0,
      lastFileError: null,
    });
  });

  it('keeps dirty state when saving the current file fails', async () => {
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(() => '# unsaved'),
      loadDocument: vi.fn(),
      markDocumentSaved: vi.fn(),
    };
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
    });
    const writeText = vi
      .fn<
        () => Promise<CommandResult<{ byteLength: number; path: string }>>
      >()
      .mockResolvedValue({
        ok: false,
        error: {
          code: 'file.permission_denied',
          message: 'Permission denied',
          recoverable: true,
        },
      });

    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText,
      },
      editor: withExactSnapshotMethods(editor),
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    const result = await actions.saveCurrentFile();

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'file.permission_denied',
        message: 'Permission denied',
        recoverable: true,
      },
    });
    expect(state.getState().dirty).toBe(true);
  });

  it('clears dirty state and updates recent files after saving succeeds', async () => {
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(() => '# saved'),
      loadDocument: vi.fn(),
      markDocumentSaved: vi.fn(),
    };
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
      dirtyRevision: 4,
      lastFileError: {
        code: 'file.io_error',
        message: 'File operation failed.',
        recoverable: true,
      },
    });
    const addRecentFile = vi.fn();

    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            byteLength: 7,
            path: 'E:/docs/note.md',
          },
        }),
      },
      editor: withExactSnapshotMethods(editor),
      recentFiles: { addRecentFile },
      state,
    });

    const result = await actions.saveCurrentFile();

    expect(result.ok).toBe(true);
    expect(state.getState()).toEqual({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: false,
      dirtyRevision: 4,
      lastFileError: null,
    });
    expect(addRecentFile).toHaveBeenCalledWith({
      name: 'note.md',
      path: 'E:/docs/note.md',
    });
  });

  it('keeps dirty state when the document changes while save is in flight', async () => {
    const markDocumentSaved = vi.fn();
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(() => '# first snapshot'),
      loadDocument: vi.fn(),
      markDocumentSaved,
    };
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
      dirtyRevision: 7,
    });

    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn().mockImplementation(async () => {
          state.setDirty(true);

          return {
            ok: true,
            data: {
              byteLength: 16,
              path: 'E:/docs/note.md',
            },
          };
        }),
      },
      editor: withExactSnapshotMethods(editor),
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    const result = await actions.saveCurrentFile();

    expect(result.ok).toBe(true);
    expect(state.getState().dirty).toBe(true);
    expect(state.getState().dirtyRevision).toBe(8);
    expect(markDocumentSaved).toHaveBeenCalledWith({
      serializedText: '# first snapshot',
    });
  });

  it('does not replace newer editor text with a migrated save snapshot', async () => {
    let documentText = '![Draft](lumamark-draft://draft-1/image-001.png)';
    const loadDocument = vi.fn((text: string) => {
      documentText = text;
    });
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
      dirtyRevision: 3,
    });
    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn().mockImplementation(async () => {
          documentText += '\nnew input while saving';
          state.setDirty(true);

          return {
            ok: true,
            data: { byteLength: 48, path: 'E:/docs/note.md' },
          };
        }),
      },
      editor: withExactSnapshotMethods({
        focus: vi.fn(),
        getDocumentText: vi.fn(() => documentText),
        loadDocument,
        markDocumentSaved: vi.fn(),
      }),
      prepareTextForSave: async () => '![Draft](note.assets/image-001.png)',
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    await actions.saveCurrentFile();

    expect(loadDocument).not.toHaveBeenCalled();
    expect(documentText).toContain('new input while saving');
    expect(state.getState().dirty).toBe(true);
  });

  it('returns a path-required error when saving without a current file', async () => {
    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn(),
      },
      editor: withExactSnapshotMethods({
        focus: vi.fn(),
        getDocumentText: vi.fn(() => '# draft'),
        loadDocument: vi.fn(),
        markDocumentSaved: vi.fn(),
      }),
      recentFiles: { addRecentFile: vi.fn() },
      state: createState(),
    });

    const result = await actions.saveCurrentFile();

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'file.path_required',
        message: 'A target path is required before saving.',
        recoverable: true,
      },
    });
  });

  it('saves to the chosen path when using save as', async () => {
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(() => '# save as'),
      loadDocument: vi.fn(),
      markDocumentSaved: vi.fn(),
    };
    const state = createState({
      dirty: true,
      dirtyRevision: 2,
    });
    const addRecentFile = vi.fn();
    const writeText = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        byteLength: 9,
        path: 'E:/docs/copy.md',
      },
    });

    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn().mockResolvedValue({
          ok: true,
          data: 'E:/docs/copy.md',
        }),
        writeText,
      },
      editor: withExactSnapshotMethods(editor),
      recentFiles: { addRecentFile },
      state,
    });

    const result = await actions.saveFileAs();

    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('E:/docs/copy.md', '# save as');
    expect(state.getState()).toEqual({
      currentFile: { name: 'copy.md', path: 'E:/docs/copy.md' },
      dirty: false,
      dirtyRevision: 2,
      lastFileError: null,
    });
    expect(addRecentFile).toHaveBeenCalledWith({
      name: 'copy.md',
      path: 'E:/docs/copy.md',
    });
  });

  it('does not change state when the open dialog is canceled', async () => {
    const state = createState({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
    });

    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn().mockResolvedValue({ ok: true, data: null }),
        showSaveDialog: vi.fn(),
        writeText: vi.fn(),
      },
      editor: withExactSnapshotMethods({
        focus: vi.fn(),
        getDocumentText: vi.fn(),
        loadDocument: vi.fn(),
        markDocumentSaved: vi.fn(),
      }),
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    const result = await actions.openFileFromDialog();

    expect(result).toEqual({ ok: true, data: null });
    expect(state.getState()).toEqual({
      currentFile: { name: 'note.md', path: 'E:/docs/note.md' },
      dirty: true,
      dirtyRevision: 0,
      lastFileError: null,
    });
  });

  it('loads opened text into the editor without storing markdown source in app state', async () => {
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(),
      loadDocument: vi.fn(),
      markDocumentSaved: vi.fn(),
    };
    const state = createState({ dirty: true });
    const addRecentFile = vi.fn();

    const actions = createFileActions({
      commands: {
        readText: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            byteLength: 11,
            path: 'E:/docs/open.md',
            text: '# Opened',
          },
        }),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn(),
      },
      editor: withExactSnapshotMethods(editor),
      recentFiles: { addRecentFile },
      state,
    });

    const result = await actions.openFile('E:/docs/open.md');

    expect(result.ok).toBe(true);
    expect(editor.loadDocument).toHaveBeenCalledWith('# Opened');
    expect(state.getState()).toEqual({
      currentFile: { name: 'open.md', path: 'E:/docs/open.md' },
      dirty: false,
      dirtyRevision: 0,
      lastFileError: null,
    });
    expect(JSON.stringify(state.getState())).not.toContain('# Opened');
    expect(addRecentFile).toHaveBeenCalledWith({
      name: 'open.md',
      path: 'E:/docs/open.md',
    });
  });

  it('does not apply a stale open result after a newer request supersedes it', async () => {
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(),
      loadDocument: vi.fn(),
      markDocumentSaved: vi.fn(),
    };
    const state = createState({
      currentFile: { name: 'newer.md', path: 'E:/docs/newer.md' },
      dirty: false,
    });
    const addRecentFile = vi.fn();

    const actions = createFileActions({
      commands: {
        readText: vi.fn().mockResolvedValue({
          ok: true,
          data: {
            byteLength: 8,
            path: 'E:/docs/older.md',
            text: '# Older',
          },
        }),
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn(),
        writeText: vi.fn(),
      },
      editor: withExactSnapshotMethods(editor),
      recentFiles: { addRecentFile },
      shouldApplyOpenResult: () => false,
      state,
    });

    await actions.openFile('E:/docs/older.md');

    expect(editor.loadDocument).not.toHaveBeenCalled();
    expect(state.getState().currentFile).toEqual({
      name: 'newer.md',
      path: 'E:/docs/newer.md',
    });
    expect(addRecentFile).not.toHaveBeenCalled();
  });

  it('does not apply a stale open dialog error after a newer request succeeds', async () => {
    const state = createState({
      currentFile: { name: 'newer.md', path: 'E:/docs/newer.md' },
      lastFileError: null,
    });

    const actions = createFileActions({
      commands: {
        readText: vi.fn(),
        showOpenDialog: vi.fn().mockResolvedValue({
          ok: false,
          error: {
            code: 'dialog.failed',
            message: 'The dialog failed.',
            recoverable: true,
          },
        }),
        showSaveDialog: vi.fn(),
        writeText: vi.fn(),
      },
      editor: withExactSnapshotMethods({
        focus: vi.fn(),
        getDocumentText: vi.fn(),
        loadDocument: vi.fn(),
        markDocumentSaved: vi.fn(),
      }),
      recentFiles: { addRecentFile: vi.fn() },
      shouldApplyOpenResult: () => false,
      state,
    });

    await actions.openFileFromDialog();

    expect(state.getState().lastFileError).toBeNull();
    expect(state.getState().currentFile).toEqual({
      name: 'newer.md',
      path: 'E:/docs/newer.md',
    });
  });
});
