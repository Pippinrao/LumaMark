import { describe, expect, it, vi } from 'vitest';
import type { CommandResult } from '../../services/tauri/invokeCommand';
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

describe('file actions', () => {
  it('loads migrated markdown back into the editor after a successful save', async () => {
    const loadDocument = vi.fn();
    const actions = createFileActions({
      commands: {
        readText: vi.fn(), showOpenDialog: vi.fn(), showSaveDialog: vi.fn(),
        writeText: vi.fn().mockResolvedValue({ ok: true, data: { byteLength: 30, path: 'E:/docs/note.md' } }),
      },
      editor: { focus: vi.fn(), getDocumentText: vi.fn(() => '![Draft](lumamark-draft://draft-1/image-001.png)'), loadDocument },
      prepareTextForSave: async () => '![Draft](note.assets/image-001.png)',
      recentFiles: { addRecentFile: vi.fn() },
      state: createState({ currentFile: { name: 'note.md', path: 'E:/docs/note.md' }, dirty: true }),
    });

    await actions.saveCurrentFile();

    expect(loadDocument).toHaveBeenCalledWith('![Draft](note.assets/image-001.png)');
  });

  it('creates an empty unsaved document without retaining the previous file context', () => {
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(),
      loadDocument: vi.fn(),
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
      editor,
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
      editor,
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
      editor,
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
    const editor = {
      focus: vi.fn(),
      getDocumentText: vi.fn(() => '# first snapshot'),
      loadDocument: vi.fn(),
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
      editor,
      recentFiles: { addRecentFile: vi.fn() },
      state,
    });

    const result = await actions.saveCurrentFile();

    expect(result.ok).toBe(true);
    expect(state.getState().dirty).toBe(true);
    expect(state.getState().dirtyRevision).toBe(8);
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
      editor: {
        focus: vi.fn(),
        getDocumentText: vi.fn(() => documentText),
        loadDocument,
      },
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
      editor: {
        focus: vi.fn(),
        getDocumentText: vi.fn(() => '# draft'),
        loadDocument: vi.fn(),
      },
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
      editor,
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
      editor: {
        focus: vi.fn(),
        getDocumentText: vi.fn(),
        loadDocument: vi.fn(),
      },
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
      editor,
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
      editor,
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
      editor: {
        focus: vi.fn(),
        getDocumentText: vi.fn(),
        loadDocument: vi.fn(),
      },
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
