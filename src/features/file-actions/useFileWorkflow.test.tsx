import '@testing-library/jest-dom/vitest';
import { act, render, waitFor } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { EditorDocumentSnapshot } from '../../editor/core/editorApi';
import type { FileCommandClient } from '../../services/files/fileCommandClient';
import type { FileWatchClient } from '../../services/file-watch/fileWatchClient';
import type { FileWatchChangeEvent } from '../../services/file-watch/fileWatchClient';
import type { CommandResult } from '../../services/tauri/invokeCommand';
import { createRecentFilesStore } from '../recent-files/recentFilesStore';
import { useFileWorkflow, type FileWorkflow } from './useFileWorkflow';
import type { FileActionState } from './fileActions';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type TestEditorDocumentPort = Omit<
  EditorDocumentPort,
  'captureSnapshot' | 'isSnapshotCurrent' | 'serializeText'
> &
  Partial<
    Pick<
      EditorDocumentPort,
      'captureSnapshot' | 'isSnapshotCurrent' | 'serializeText'
    >
  >;

function withSnapshotMethods(
  editor: TestEditorDocumentPort,
): EditorDocumentPort {
  return {
    ...editor,
    captureSnapshot:
      editor.captureSnapshot ??
      (() => ({ serializedText: editor.getText() })),
    isSnapshotCurrent:
      editor.isSnapshotCurrent ??
      ((snapshot: EditorDocumentSnapshot) =>
        snapshot.serializedText === editor.getText()),
    serializeText: editor.serializeText ?? editor.getText,
  };
}

function withSnapshotEditorRef(
  editorRef: RefObject<TestEditorDocumentPort | null>,
): RefObject<EditorDocumentPort | null> {
  return {
    get current() {
      return editorRef.current ? withSnapshotMethods(editorRef.current) : null;
    },
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function createState(initial?: Partial<FileActionState>) {
  let current: FileActionState = {
    currentFile: null,
    dirty: false,
    dirtyRevision: 0,
    lastFileError: null,
    ...initial,
  };

  return {
    getState: () => current,
    setCurrentFile: vi.fn((currentFile: FileActionState['currentFile']) => {
      current = { ...current, currentFile };
    }),
    setDirty: vi.fn((dirty: boolean) => {
      current = {
        ...current,
        dirty,
        dirtyRevision: dirty ? current.dirtyRevision + 1 : current.dirtyRevision,
      };
    }),
    setLastFileError: vi.fn((lastFileError: FileActionState['lastFileError']) => {
      current = { ...current, lastFileError };
    }),
  };
}

function createFileCommandClient(
  overrides: Partial<FileCommandClient> = {},
): FileCommandClient {
  return {
    readText: vi.fn(),
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    writeText: vi.fn(),
    ...overrides,
  };
}

function createFileWatchClient(
  overrides: Partial<FileWatchClient> = {},
): FileWatchClient {
  return {
    listen: vi.fn().mockResolvedValue(() => undefined),
    replaceLocalImageTargets: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    unwatchDocument: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    watchDocument: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    ...overrides,
  };
}

function WorkflowHarness({
  editorReady = true,
  editorRef,
  fileWatch,
  onLocalImageChanged,
  onWorkflow,
  onDocumentBecameSafe,
  recentFiles,
  state,
  status,
}: {
  editorReady?: boolean;
  editorRef: RefObject<TestEditorDocumentPort | null>;
  fileWatch?: FileWatchClient;
  onLocalImageChanged?: (event: FileWatchChangeEvent) => void;
  onWorkflow: (workflow: FileWorkflow) => void;
  onDocumentBecameSafe?: () => void;
  recentFiles: { addRecentFile: (file: { name: string; path: string }) => void };
  state: ReturnType<typeof createState>;
  status: { setStatusKey: (statusKey: string) => void };
}) {
  onWorkflow(
    useFileWorkflow({
      editorReady,
      editorRef: withSnapshotEditorRef(editorRef),
      fileWatch,
      onLocalImageChanged,
      onDocumentBecameSafe,
      recentFiles,
      state,
      status,
    }),
  );

  return null;
}

describe('useFileWorkflow', () => {
  it('advances the dirty revision for every dirty editor transaction', () => {
    const state = createState({ dirty: true, dirtyRevision: 4 });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    workflowRef.current?.markDocumentDirty(true);
    workflowRef.current?.markDocumentDirty(true);

    expect(state.getState().dirtyRevision).toBe(6);
  });

  afterEach(() => {
    delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
  });

  it('subscribes once and releases the file watcher when the workflow unmounts', async () => {
    const unlisten = vi.fn();
    const fileWatch = {
      listen: vi.fn().mockResolvedValue(unlisten),
      replaceLocalImageTargets: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
      unwatchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
      watchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
    };

    const view = render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={vi.fn()}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => undefined);
    expect(fileWatch.listen).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => undefined);

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(fileWatch.unwatchDocument).toHaveBeenCalledTimes(1);
  });

  it('replaces the watched document after a disk file opens successfully', async () => {
    const fileWatch = createFileWatchClient();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/notes/opened.md',
          text: '# Opened',
        },
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Opened'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    let outcome: Awaited<ReturnType<FileWorkflow['openPath']>> | undefined;
    await act(async () => {
      outcome = await workflowRef.current?.openPath('E:/notes/opened.md');
    });

    expect(fileWatch.unwatchDocument).toHaveBeenCalledTimes(1);
    expect(fileWatch.watchDocument).toHaveBeenCalledWith('E:/notes/opened.md');
    expect(outcome).toEqual({
      file: { name: 'opened.md', path: 'E:/notes/opened.md' },
      status: 'opened',
    });
  });

  it('finishes opening and watching when recent-file persistence fails', async () => {
    const fileWatch = createFileWatchClient();
    const recentFileStore = createRecentFilesStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('Recent-file storage unavailable');
      },
    });
    const onDocumentBecameSafe = vi.fn();
    const setStatusKey = vi.fn();
    const loadText = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 8,
          fingerprint: 'sha256:opened',
          path: 'E:/notes/opened.md',
          text: '# Opened',
        },
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Opened',
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{
          addRecentFile: recentFileStore.getState().addRecentFile,
        }}
        state={createState()}
        status={{ setStatusKey }}
      />,
    );

    let outcome: Awaited<ReturnType<FileWorkflow['openPath']>> | undefined;
    await act(async () => {
      outcome = await workflowRef.current?.openPath('E:/notes/opened.md');
    });

    expect(loadText).toHaveBeenCalledWith('# Opened');
    expect(fileWatch.watchDocument).toHaveBeenCalledWith('E:/notes/opened.md');
    expect(onDocumentBecameSafe).toHaveBeenCalledTimes(1);
    expect(setStatusKey).toHaveBeenLastCalledWith('status.opened');
    expect(outcome).toEqual({
      file: { name: 'opened.md', path: 'E:/notes/opened.md' },
      status: 'opened',
    });
    expect(recentFileStore.getState()).toMatchObject({
      recentFiles: [
        expect.objectContaining({
          name: 'opened.md',
          path: 'E:/notes/opened.md',
        }),
      ],
      recentFilesPersistenceError: true,
    });
  });

  it('automatically reloads a clean document when its disk contents change', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    const readText = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/notes/opened.md',
          text: '# Opened',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          byteLength: 13,
          path: 'E:/notes/opened.md',
          text: '# From disk',
        },
      });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ readText });
    const state = createState();
    const setStatusKey = vi.fn();
    const loadText = vi.fn((text: string) => {
      editorText = text;
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={vi.fn()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/opened.md');
    });

    await act(async () => {
      emitChange?.({
        fingerprint: 'sha256:new',
        kind: 'document',
        path: 'E:/notes/opened.md',
        revision: 2,
      });
      await Promise.resolve();
    });

    expect(readText).toHaveBeenCalledTimes(2);
    expect(loadText).toHaveBeenLastCalledWith('# From disk', {
      preserveView: true,
    });
    expect(state.getState().dirty).toBe(false);
    expect(setStatusKey).toHaveBeenLastCalledWith('status.externalReloaded');
  });

  it('offers a conflict instead of overwriting dirty editor contents', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 8,
            path: 'E:/notes/opened.md',
            text: '# Opened',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 13,
            path: 'E:/notes/opened.md',
            text: '# From disk',
          },
        }),
    });
    const state = createState();
    const loadText = vi.fn((text: string) => {
      editorText = text;
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/opened.md');
    });
    editorText = '# Local edits';
    state.setDirty(true);

    await act(async () => {
      emitChange?.({
        fingerprint: 'sha256:external',
        kind: 'document',
        path: 'E:/notes/opened.md',
        revision: 3,
      });
      await Promise.resolve();
    });

    expect(editorText).toBe('# Local edits');
    expect(state.getState().dirty).toBe(true);
    expect(workflowRef.current?.externalConflict).toEqual({
      fingerprint: 'sha256:external',
      path: 'E:/notes/opened.md',
      revision: 3,
    });
  });

  it('re-reads the latest disk contents when the user reloads a conflict', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    const readText = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/notes/opened.md',
          text: '# Opened',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          byteLength: 9,
          path: 'E:/notes/opened.md',
          text: '# Disk v1',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          byteLength: 9,
          path: 'E:/notes/opened.md',
          text: '# Disk v2',
        },
      });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ readText });
    const state = createState();
    const onDocumentBecameSafe = vi.fn();
    const loadText = vi.fn((text: string) => {
      editorText = text;
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/opened.md');
    });
    editorText = '# Local edits';
    state.setDirty(true);
    await act(async () => {
      emitChange?.({
        fingerprint: 'sha256:v1',
        kind: 'document',
        path: 'E:/notes/opened.md',
        revision: 4,
      });
      await Promise.resolve();
    });

    const reloadFromDisk = workflowRef.current?.reloadFromDisk;
    expect(reloadFromDisk).toEqual(expect.any(Function));

    if (!reloadFromDisk) {
      return;
    }

    await act(async () => {
      await reloadFromDisk();
    });

    expect(readText).toHaveBeenCalledTimes(3);
    expect(editorText).toBe('# Disk v2');
    expect(loadText).toHaveBeenLastCalledWith('# Disk v2', {
      preserveView: true,
    });
    expect(state.getState().dirty).toBe(false);
    expect(workflowRef.current?.externalConflict).toBeNull();
    expect(onDocumentBecameSafe).toHaveBeenCalledTimes(2);
  });

  it('keeps dirty editor contents and acknowledges only the current disk version', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    const readText = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/notes/opened.md',
          text: '# Opened',
        },
      })
      .mockResolvedValue({
        ok: true,
        data: {
          byteLength: 13,
          path: 'E:/notes/opened.md',
          text: '# From disk',
        },
      });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ readText });
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText: (text) => {
              editorText = text;
            },
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/opened.md');
    });
    editorText = '# Local edits';
    state.setDirty(true);
    const event: FileWatchChangeEvent = {
      fingerprint: 'sha256:kept',
      kind: 'document',
      path: 'E:/notes/opened.md',
      revision: 5,
    };
    await act(async () => {
      emitChange?.(event);
      await Promise.resolve();
    });

    const keepCurrentContent = workflowRef.current?.keepCurrentContent;
    expect(keepCurrentContent).toEqual(expect.any(Function));

    if (!keepCurrentContent) {
      return;
    }

    act(() => {
      keepCurrentContent();
    });

    expect(editorText).toBe('# Local edits');
    expect(state.getState().dirty).toBe(true);
    expect(workflowRef.current?.externalConflict).toBeNull();

    await act(async () => {
      emitChange?.(event);
      await Promise.resolve();
    });
    expect(readText).toHaveBeenCalledTimes(2);
    expect(workflowRef.current?.externalConflict).toBeNull();
  });

  it('keeps the editor contents visible when the watched document is removed', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/notes/opened.md',
          text: '# Opened',
        },
      }),
    });
    const state = createState();
    const markUnsaved = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText: (text) => {
              editorText = text;
            },
            markSaved: vi.fn(),
            markUnsaved,
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/opened.md');
    });

    await act(async () => {
      emitChange?.({
        kind: 'removed',
        path: 'E:/notes/opened.md',
        revision: 6,
      });
    });

    expect(editorText).toBe('# Opened');
    expect(state.getState().dirty).toBe(true);
    expect(markUnsaved).toHaveBeenCalledTimes(1);
    expect(state.getState().lastFileError?.code).toBe('file.not_found');
  });

  it('surfaces an exhausted watcher retry without changing editor contents', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/notes/opened.md',
          text: '# Opened',
        },
      }),
    });
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText: (text) => {
              editorText = text;
            },
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/opened.md');
    });
    act(() => {
      emitChange?.({
        fingerprint: null,
        kind: 'error',
        path: 'E:/notes/opened.md',
        revision: 7,
      } as FileWatchChangeEvent);
    });

    expect(editorText).toBe('# Opened');
    expect(state.getState().lastFileError?.code).toBe('file.watch_error');
  });

  it('forwards local image change events without coupling to the editor extension', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    const onLocalImageChanged = vi.fn();
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onLocalImageChanged={onLocalImageChanged}
        onWorkflow={vi.fn()}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const event: FileWatchChangeEvent = {
      fingerprint: 'sha256:image',
      kind: 'image',
      path: 'E:/notes/assets/picture.png',
      revision: 7,
    };
    act(() => {
      emitChange?.(event);
    });

    expect(onLocalImageChanged).toHaveBeenCalledWith(event);
  });

  it('ignores an external read that belongs to an older watched document generation', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const olderExternalRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 5,
            path: 'E:/notes/old.md',
            text: '# Old',
          },
        })
        .mockReturnValueOnce(olderExternalRead.promise)
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 5,
            path: 'E:/notes/new.md',
            text: '# New',
          },
        }),
    });
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText: (text) => {
              editorText = text;
            },
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/old.md');
    });
    await act(async () => {
      emitChange?.({
        fingerprint: 'sha256:old-external',
        kind: 'document',
        path: 'E:/notes/old.md',
        revision: 8,
      });
      await Promise.resolve();
    });
    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/new.md');
    });
    await act(async () => {
      olderExternalRead.resolve({
        ok: true,
        data: {
          byteLength: 14,
          path: 'E:/notes/old.md',
          text: '# Stale update',
        },
      });
      await olderExternalRead.promise;
    });

    expect(editorText).toBe('# New');
    expect(state.getState().currentFile?.path).toBe('E:/notes/new.md');
    expect(workflowRef.current?.externalConflict).toBeNull();
  });

  it('ignores an older external read that finishes after a newer event for the same document', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '';
    const olderRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    const newerRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 9,
            path: 'E:/notes/live.md',
            text: '# Initial',
          },
        })
        .mockReturnValueOnce(olderRead.promise)
        .mockReturnValueOnce(newerRead.promise),
    });
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText: (text) => {
              editorText = text;
            },
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/live.md');
    });
    act(() => {
      emitChange?.({
        fingerprint: 'sha256:older',
        kind: 'document',
        path: 'E:/notes/live.md',
        revision: 1,
      });
    });
    act(() => {
      emitChange?.({
        fingerprint: 'sha256:newer',
        kind: 'document',
        path: 'E:/notes/live.md',
        revision: 2,
      });
    });

    await act(async () => {
      newerRead.resolve({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/notes/live.md',
          text: '# Newest',
        },
      });
      await newerRead.promise;
    });
    await act(async () => {
      olderRead.resolve({
        ok: true,
        data: {
          byteLength: 7,
          path: 'E:/notes/live.md',
          text: '# Older',
        },
      });
      await olderRead.promise;
    });

    expect(editorText).toBe('# Newest');
  });

  it('starts watching an untitled document after Save As succeeds', async () => {
    const fileWatch = createFileWatchClient();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/notes/saved.md',
      }),
      writeText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 7,
          path: 'E:/notes/saved.md',
        },
      }),
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Saved',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState({ dirty: true })}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    expect(fileWatch.watchDocument).toHaveBeenCalledWith('E:/notes/saved.md');
  });

  it('finishes saving and watching when recent-file persistence fails', async () => {
    const fileWatch = createFileWatchClient();
    const recentFileStore = createRecentFilesStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('Recent-file storage unavailable');
      },
    });
    const onDocumentBecameSafe = vi.fn();
    const setStatusKey = vi.fn();
    const state = createState({
      currentFile: { name: 'saved.md', path: 'E:/notes/saved.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const writeText = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        byteLength: 7,
        fingerprint: 'sha256:saved',
        path: 'E:/notes/saved.md',
      },
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ writeText });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Saved',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{
          addRecentFile: recentFileStore.getState().addRecentFile,
        }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.save();
    });

    expect(writeText).toHaveBeenCalledWith('E:/notes/saved.md', '# Saved');
    expect(state.getState().dirty).toBe(false);
    expect(fileWatch.watchDocument).toHaveBeenCalledWith('E:/notes/saved.md');
    expect(onDocumentBecameSafe).toHaveBeenCalledTimes(1);
    expect(setStatusKey).toHaveBeenLastCalledWith('status.saved');
    expect(recentFileStore.getState()).toMatchObject({
      recentFiles: [
        expect.objectContaining({
          name: 'saved.md',
          path: 'E:/notes/saved.md',
        }),
      ],
      recentFilesPersistenceError: true,
    });
  });

  it('keeps recovery and unsaved status when the document changes while save installs its watcher', async () => {
    const pendingWatch = createDeferred<
      Awaited<ReturnType<FileWatchClient['watchDocument']>>
    >();
    const fileWatch = createFileWatchClient({
      watchDocument: vi.fn(() => pendingWatch.promise),
    });
    const onDocumentBecameSafe = vi.fn();
    const setStatusKey = vi.fn();
    const state = createState({
      currentFile: { name: 'saved.md', path: 'E:/notes/saved.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      writeText: vi.fn().mockResolvedValue({
        ok: true,
        data: { byteLength: 7, path: 'E:/notes/saved.md' },
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Saved',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    const pendingSave = workflowRef.current?.save();
    await waitFor(() => expect(fileWatch.watchDocument).toHaveBeenCalled());

    act(() => {
      workflowRef.current?.markDocumentDirty(true);
    });

    await act(async () => {
      pendingWatch.resolve({
        ok: true,
        data: { fingerprint: 'sha256:saved' },
      });
      await pendingSave;
    });

    expect(state.getState().dirty).toBe(true);
    expect(onDocumentBecameSafe).not.toHaveBeenCalled();
    expect(setStatusKey).not.toHaveBeenCalledWith('status.saved');
  });

  it('keeps recovery and unsaved status when the document changes while Save As installs its watcher', async () => {
    const pendingWatch = createDeferred<
      Awaited<ReturnType<FileWatchClient['watchDocument']>>
    >();
    const fileWatch = createFileWatchClient({
      watchDocument: vi.fn(() => pendingWatch.promise),
    });
    const onDocumentBecameSafe = vi.fn();
    const setStatusKey = vi.fn();
    const state = createState({ dirty: true });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/notes/saved-as.md',
      }),
      writeText: vi.fn().mockResolvedValue({
        ok: true,
        data: { byteLength: 7, path: 'E:/notes/saved-as.md' },
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Saved',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    const pendingSaveAs = workflowRef.current?.saveAs();
    await waitFor(() => expect(fileWatch.watchDocument).toHaveBeenCalled());

    act(() => {
      workflowRef.current?.markDocumentDirty(true);
    });

    await act(async () => {
      pendingWatch.resolve({
        ok: true,
        data: { fingerprint: 'sha256:saved-as' },
      });
      await pendingSaveAs;
    });

    expect(state.getState().dirty).toBe(true);
    expect(onDocumentBecameSafe).not.toHaveBeenCalled();
    expect(setStatusKey).not.toHaveBeenCalledWith('status.saved');
  });

  it('keeps Unix file path comparisons case-sensitive', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    const readText = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        byteLength: 8,
        path: '/notes/Readme.md',
        text: '# Opened',
      },
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ readText });
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Opened',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('/notes/Readme.md');
    });
    await act(async () => {
      emitChange?.({
        fingerprint: 'sha256:other-case',
        kind: 'document',
        path: '/notes/readme.md',
        revision: 10,
      });
      await Promise.resolve();
    });

    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('does not mark a document as watched when the watch command fails', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    const readText = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        byteLength: 8,
        path: 'E:/notes/opened.md',
        text: '# Opened',
      },
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ readText });
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
      watchDocument: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'command.failed',
          message: 'Native watch failed.',
          recoverable: true,
        },
      }),
    });
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Opened',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.openPath('E:/notes/opened.md');
    });

    expect(state.getState().lastFileError?.code).toBe('file.watch_error');

    await act(async () => {
      emitChange?.({
        fingerprint: 'sha256:not-watched',
        kind: 'document',
        path: 'E:/notes/opened.md',
        revision: 11,
      });
      await Promise.resolve();
    });
    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending open when creating a new document and restores the ready status', async () => {
    const pendingRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    const loadDocument = vi.fn();
    const setDocumentContext = vi.fn();
    const focus = vi.fn();
    const state = createState({
      currentFile: { name: 'existing.md', path: 'E:/docs/existing.md' },
    });
    const addRecentFile = vi.fn();
    const setStatusKey = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(() => pendingRead.promise),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus,
            getText: vi.fn(),
            loadText: loadDocument,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: setDocumentContext,
          },
        }}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    const workflow = workflowRef.current;

    if (!workflow) {
      throw new Error('File workflow was not initialized.');
    }

    const pendingOpen = workflow.openPath('E:/docs/older.md');

    await act(async () => {
      workflow.createNewDocument();
    });

    expect(loadDocument).toHaveBeenCalledWith('');
    expect(setDocumentContext).toHaveBeenCalledWith({ path: null });
    expect(state.getState().currentFile).toBeNull();
    expect(workflowRef.current?.fileOpening).toBe(false);
    expect(setStatusKey).toHaveBeenLastCalledWith('status.ready');

    await act(async () => {
      pendingRead.resolve({
        ok: true,
        data: {
          byteLength: 7,
          path: 'E:/docs/older.md',
          text: '# Older',
        },
      });
      await pendingOpen;
    });

    expect(loadDocument).not.toHaveBeenCalledWith('# Older');
    expect(state.getState().currentFile).toBeNull();
    expect(addRecentFile).not.toHaveBeenCalled();
  });

  it('does not clear recovery or overwrite ready status when an open becomes stale while watch starts', async () => {
    const pendingWatch = createDeferred<
      Awaited<ReturnType<FileWatchClient['watchDocument']>>
    >();
    const fileWatch = createFileWatchClient({
      watchDocument: vi.fn(() => pendingWatch.promise),
    });
    const onDocumentBecameSafe = vi.fn();
    const setStatusKey = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 8,
          path: 'E:/docs/older.md',
          text: '# Older',
        },
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Older'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey }}
      />,
    );

    const pendingOpen = workflowRef.current?.openPath('E:/docs/older.md');
    await waitFor(() => expect(fileWatch.watchDocument).toHaveBeenCalled());

    act(() => {
      workflowRef.current?.createNewDocument();
    });

    await act(async () => {
      pendingWatch.resolve({
        ok: true,
        data: { fingerprint: 'sha256:older' },
      });
      await pendingOpen;
    });

    expect(onDocumentBecameSafe).toHaveBeenCalledTimes(1);
    expect(setStatusKey).toHaveBeenLastCalledWith('status.ready');
  });

  it('does not clear recovery or overwrite an open failure after a stale save watch resolves', async () => {
    const pendingWatch = createDeferred<
      Awaited<ReturnType<FileWatchClient['watchDocument']>>
    >();
    const fileWatch = createFileWatchClient({
      watchDocument: vi.fn(() => pendingWatch.promise),
    });
    const onDocumentBecameSafe = vi.fn();
    const setStatusKey = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'file.not_found',
          message: 'Missing newer document.',
          recoverable: true,
        },
      }),
      writeText: vi.fn().mockResolvedValue({
        ok: true,
        data: { byteLength: 7, path: 'E:/docs/saved.md' },
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Saved'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState({
          currentFile: { name: 'saved.md', path: 'E:/docs/saved.md' },
          dirty: true,
        })}
        status={{ setStatusKey }}
      />,
    );

    const pendingSave = workflowRef.current?.save();
    await waitFor(() => expect(fileWatch.watchDocument).toHaveBeenCalled());

    await act(async () => {
      await workflowRef.current?.openPath('E:/docs/missing.md');
    });
    expect(setStatusKey).toHaveBeenLastCalledWith('status.openFailed');

    await act(async () => {
      pendingWatch.resolve({
        ok: true,
        data: { fingerprint: 'sha256:saved' },
      });
      await pendingSave;
    });

    expect(onDocumentBecameSafe).not.toHaveBeenCalled();
    expect(setStatusKey).toHaveBeenLastCalledWith('status.openFailed');
  });

  it('reports a recoverable save failure without clearing the dirty state', async () => {
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/docs/draft.md' },
      dirty: true,
    });
    const setStatusKey = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      writeText: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'file.io_error',
          message: 'The document could not be saved.',
          recoverable: true,
        },
      }),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Unsaved'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.save();
    });

    expect(state.getState().dirty).toBe(true);
    expect(state.getState().lastFileError?.code).toBe('file.io_error');
    expect(setStatusKey).toHaveBeenLastCalledWith('status.saveFailed');
  });

  it('continues with a queued newer save after an older save fails', async () => {
    const firstWrite = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
    }>>();
    const secondWrite = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
    }>>();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/docs/draft.md' },
      dirty: true,
    });
    const setStatusKey = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi
        .fn()
        .mockReturnValueOnce(firstWrite.promise)
        .mockReturnValueOnce(secondWrite.promise),
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# draft'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    const workflow = workflowRef.current;

    if (!workflow) {
      throw new Error('File workflow was not initialized.');
    }

    const olderSave = workflow.save();
    const newerSave = workflow.save();

    await act(async () => {
      firstWrite.resolve({
        ok: false,
        error: {
          code: 'file.io_error',
          message: 'The first save failed.',
          recoverable: true,
        },
      });
      await olderSave;
    });

    await act(async () => {
      secondWrite.resolve({
        ok: true,
        data: { byteLength: 7, path: 'E:/docs/draft.md' },
      });
      await newerSave;
    });

    expect(state.getState().dirty).toBe(false);
    expect(state.getState().lastFileError).toBeNull();
    expect(setStatusKey).toHaveBeenLastCalledWith('status.saved');
  });

  it('serializes saves so an older write cannot overwrite the latest snapshot', async () => {
    const firstWrite = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
    }>>();
    const secondWrite = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
    }>>();
    const writes: string[] = [];
    let documentText = '# Older snapshot';
    const markSaved = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/docs/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi
        .fn((_path: string, text: string) => {
          writes.push(text);
          return writes.length === 1 ? firstWrite.promise : secondWrite.promise;
        }),
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => documentText,
            loadText: vi.fn(),
            markSaved,
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const firstSave = workflowRef.current?.save();
    documentText = '# Latest snapshot';
    state.setDirty(true);
    const latestSave = workflowRef.current?.save();

    await act(async () => {
      await Promise.resolve();
    });

    expect(writes).toEqual(['# Older snapshot']);

    await act(async () => {
      firstWrite.resolve({
        ok: true,
        data: { byteLength: 16, path: 'E:/docs/draft.md' },
      });
      await firstSave;
    });

    expect(writes).toEqual(['# Older snapshot', '# Latest snapshot']);

    await act(async () => {
      secondWrite.resolve({
        ok: true,
        data: { byteLength: 17, path: 'E:/docs/draft.md' },
      });
      await latestSave;
    });

    expect(writes.at(-1)).toBe('# Latest snapshot');
    expect(
      markSaved.mock.calls.map(([snapshot]) => snapshot.serializedText),
    ).toEqual([
      '# Older snapshot',
      '# Latest snapshot',
    ]);
    expect(markSaved).toHaveBeenLastCalledWith({
      serializedText: '# Latest snapshot',
    });
    expect(state.getState().dirty).toBe(false);
  });

  it('does not start a save while a file open is in progress', async () => {
    const pendingRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    const writeText = vi.fn().mockResolvedValue({
      ok: true,
      data: { byteLength: 7, path: 'E:/docs/draft.md' },
    });
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/docs/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(() => pendingRead.promise),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText,
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# draft'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const workflow = workflowRef.current;

    if (!workflow) {
      throw new Error('File workflow was not initialized.');
    }

    const pendingOpen = workflow.openPath('E:/docs/next.md');
    await workflow.save();

    expect(writeText).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve({
        ok: true,
        data: {
          byteLength: 6,
          path: 'E:/docs/next.md',
          text: '# Next',
        },
      });
      await pendingOpen;
    });

    expect(workflowRef.current?.fileOpening).toBe(false);
    expect(state.getState().currentFile).toEqual({
      name: 'next.md',
      path: 'E:/docs/next.md',
    });
  });

  it('does not start a second open dialog while a file open is in progress', async () => {
    const pendingRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    const showOpenDialog = vi.fn().mockResolvedValue({
      ok: true,
      data: 'E:/docs/duplicate.md',
    });
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/docs/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi
        .fn()
        .mockReturnValueOnce(pendingRead.promise)
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 11,
            path: 'E:/docs/duplicate.md',
            text: '# Duplicate',
          },
        }),
      showOpenDialog,
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const workflow = workflowRef.current;

    if (!workflow) {
      throw new Error('File workflow was not initialized.');
    }

    const firstOpen = workflow.openPath('E:/docs/first.md');
    await workflow.openFromDialog();

    expect(showOpenDialog).not.toHaveBeenCalled();

    await act(async () => {
      pendingRead.resolve({
        ok: true,
        data: {
          byteLength: 7,
          path: 'E:/docs/first.md',
          text: '# First',
        },
      });
      await firstOpen;
    });

    expect(state.getState().currentFile).toEqual({
      name: 'first.md',
      path: 'E:/docs/first.md',
    });
  });

  it('keeps an open request pending until the editor port becomes available', async () => {
    const editorRef: RefObject<TestEditorDocumentPort | null> = {
      current: null,
    };
    const loadText = vi.fn();
    const setStatusKey = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const state = createState();

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 7,
          path: 'E:/docs/queued.md',
          text: '# Queued',
        },
      }),
      showOpenDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/docs/queued.md',
      }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    } satisfies FileCommandClient;

    const view = render(
      <WorkflowHarness
        editorReady={false}
        editorRef={editorRef}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey }}
      />,
    );
    const workflow = workflowRef.current;

    if (!workflow) {
      throw new Error('File workflow was not initialized.');
    }

    let settled = false;
    const pendingOpen = workflow.openFromDialog().then(() => {
      settled = true;
    });

    await act(async () => undefined);

    expect(setStatusKey).toHaveBeenLastCalledWith('status.opening');
    expect(settled).toBe(false);

    editorRef.current = {
      focus: vi.fn(),
      getText: vi.fn(),
      loadText,
      markSaved: vi.fn(),
      markUnsaved: vi.fn(),
      setContext: vi.fn(),
    };
    view.rerender(
      <WorkflowHarness
        editorReady={true}
        editorRef={editorRef}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey }}
      />,
    );

    await act(async () => {
      await pendingOpen;
    });

    expect(loadText).toHaveBeenCalledWith('# Queued');
    expect(setStatusKey).toHaveBeenLastCalledWith('status.opened');
  });

  it('cancels a queued open when the workflow unmounts', async () => {
    const editorRef: RefObject<TestEditorDocumentPort | null> = {
      current: null,
    };
    const loadText = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: 7,
          path: 'E:/docs/unmounted.md',
          text: '# Unmounted',
        },
      }),
      showOpenDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/docs/unmounted.md',
      }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    } satisfies FileCommandClient;

    const view = render(
      <WorkflowHarness
        editorReady={false}
        editorRef={editorRef}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    const workflow = workflowRef.current;

    if (!workflow) {
      throw new Error('File workflow was not initialized.');
    }

    const pendingOpen = workflow.openFromDialog();
    editorRef.current = {
      focus: vi.fn(),
      getText: vi.fn(),
      loadText,
      markSaved: vi.fn(),
      markUnsaved: vi.fn(),
      setContext: vi.fn(),
    };

    view.unmount();
    await pendingOpen;

    expect(loadText).not.toHaveBeenCalled();
  });

  it('clears a recovery snapshot only after a save leaves the document clean', async () => {
    const onDocumentBecameSafe = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/docs/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn().mockResolvedValue({
        ok: true,
        data: { byteLength: 7, path: 'E:/docs/draft.md' },
      }),
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# draft'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.save();
    });

    expect(onDocumentBecameSafe).toHaveBeenCalledTimes(1);
  });
});
