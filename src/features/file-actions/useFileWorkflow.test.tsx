import '@testing-library/jest-dom/vitest';
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode, useEffect, useMemo, type RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { EditorDocumentSnapshot } from '../../editor/core/editorApi';
import type { FileCommandClient } from '../../services/files/fileCommandClient';
import type { FileWatchClient } from '../../services/file-watch/fileWatchClient';
import type { FileWatchChangeEvent } from '../../services/file-watch/fileWatchClient';
import type { CommandResult } from '../../services/tauri/invokeCommand';
import type { DocumentClaimClient } from '../../services/window/documentClaimClient';
import { createRecentFilesStore } from '../recent-files/recentFilesStore';
import {
  runRetargetOpenDocumentMutation,
  useFileWorkflow,
  type FileWorkflow,
} from './useFileWorkflow';
import {
  getDocumentClaimOwnedOperation,
  resolveDocumentClaimWorkflowRuntime,
} from './documentClaimWorkflowRuntime';
import type { FileActionState } from './fileActions';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type TestEditorDocumentPort = Omit<
  EditorDocumentPort,
  | 'captureSnapshot'
  | 'isSnapshotCurrent'
  | 'serializeText'
  | 'setTransitionLocked'
> &
  Partial<
    Pick<
      EditorDocumentPort,
      | 'captureSnapshot'
      | 'isSnapshotCurrent'
      | 'serializeText'
      | 'setTransitionLocked'
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
    setTransitionLocked: editor.setTransitionLocked ?? (() => undefined),
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function createTestDocumentClaimClient(): DocumentClaimClient {
  const unavailableFileCommand = () => ({
    error: {
      code: 'file.test_client_unavailable',
      message: 'The test file command client is unavailable.',
      recoverable: false,
    },
    ok: false as const,
  });

  return {
    beginSession: async () => ({
      data: { sessionGeneration: 1, status: 'began' },
      ok: true,
    }),
    commitReservation: async () => ({
      data: { status: 'committed' },
      ok: true,
    }),
    focusWindow: async () => ({
      data: { status: 'focused' },
      ok: true,
    }),
    releaseOwnedDocument: async () => ({
      data: { status: 'released' },
      ok: true,
    }),
    releaseReservation: async () => ({
      data: { status: 'released' },
      ok: true,
    }),
    releaseSession: async () => ({
      data: { releasedReservations: 0, status: 'released' },
      ok: true,
    }),
    readTextClaimed: async (_operationId, path) =>
      (await window.__LUMAMARK_E2E_FILE_COMMANDS__?.readText(path)) ??
      unavailableFileCommand(),
    reserveDocument: async () => ({
      data: { status: 'reserved' },
      ok: true,
    }),
    takeoverSession: async () => ({
      data: {
        releasedReservations: 0,
        sessionGeneration: 2,
        status: 'takenOver',
      },
      ok: true,
    }),
    writeTextClaimed: async (_operationId, path, text) =>
      (await window.__LUMAMARK_E2E_FILE_COMMANDS__?.writeText(path, text)) ??
      unavailableFileCommand(),
  };
}

function WorkflowHarness({
  documentClaims,
  editorReady = true,
  editorRef,
  fileWatch,
  onLocalImageChanged,
  onDocumentLoaded,
  onWorkflow,
  onDocumentBecameSafe,
  recentFiles,
  state,
  status,
}: {
  documentClaims?: DocumentClaimClient;
  editorReady?: boolean;
  editorRef: RefObject<TestEditorDocumentPort | null>;
  fileWatch?: FileWatchClient;
  onLocalImageChanged?: (event: FileWatchChangeEvent) => void;
  onDocumentLoaded?: () => void;
  onWorkflow: (workflow: FileWorkflow) => void;
  onDocumentBecameSafe?: () => void;
  recentFiles: { addRecentFile: (file: { name: string; path: string }) => void };
  state: ReturnType<typeof createState>;
  status: { setStatusKey: (statusKey: string) => void };
}) {
  const stableDocumentClaims = useMemo(
    () => documentClaims ?? createTestDocumentClaimClient(),
    [documentClaims],
  );
  const workflow = useFileWorkflow({
    documentClaims: stableDocumentClaims,
    editorReady,
    editorRef: withSnapshotEditorRef(editorRef),
    fileWatch,
    onLocalImageChanged,
    onDocumentLoaded,
    onDocumentBecameSafe,
    recentFiles,
    state,
    status,
  });

  useEffect(() => {
    onWorkflow(workflow);
  }, [onWorkflow, workflow]);

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

  it('leaves claim-session cleanup to the native window-destroy lifecycle', async () => {
    const beginSession = vi.fn(createTestDocumentClaimClient().beginSession);
    const releaseSession = vi.fn(createTestDocumentClaimClient().releaseSession);
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      beginSession,
      releaseSession,
    } satisfies DocumentClaimClient;

    const view = render(
      <WorkflowHarness
        documentClaims={documentClaims}
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
        onWorkflow={vi.fn()}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await waitFor(() => {
      expect(beginSession).toHaveBeenCalledTimes(1);
    });
    view.unmount();
    await act(async () => undefined);

    expect(releaseSession).not.toHaveBeenCalled();
  });

  it('keeps native claim operation ids monotonic across hook remounts', async () => {
    const reserveDocument = vi.fn(
      createTestDocumentClaimClient().reserveDocument,
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      reserveDocument,
    } satisfies DocumentClaimClient;
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const state = createState({ dirty: true });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/notes/saved.md',
      }),
      writeText: vi.fn().mockResolvedValue({
        ok: true,
        data: { byteLength: 7, path: 'E:/notes/saved.md' },
      }),
    });
    const editorRef = {
      current: {
        focus: vi.fn(),
        getText: () => '# Saved',
        loadText: vi.fn(),
        markSaved: vi.fn(),
        markUnsaved: vi.fn(),
        setContext: vi.fn(),
      },
    };
    const renderWorkflow = () =>
      render(
        <WorkflowHarness
          documentClaims={documentClaims}
          editorRef={editorRef}
          onWorkflow={(workflow) => {
            workflowRef.current = workflow;
          }}
          recentFiles={{ addRecentFile: vi.fn() }}
          state={state}
          status={{ setStatusKey: vi.fn() }}
        />,
      );

    const firstView = renderWorkflow();
    await act(async () => {
      await workflowRef.current?.saveAs();
    });
    firstView.unmount();

    state.setDirty(true);
    renderWorkflow();
    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    const [firstOperationId, secondOperationId] = reserveDocument.mock.calls.map(
      ([request]) => request.operationId,
    );
    expect(firstOperationId).toBe(1);
    expect(secondOperationId).toBeGreaterThan(firstOperationId!);
    expect(Number.isSafeInteger(secondOperationId)).toBe(true);
  });

  it('serializes saves across StrictMode hook remounts for the same claim client', async () => {
    const firstWrite = createDeferred<
      Awaited<ReturnType<FileCommandClient['writeText']>>
    >();
    const writeText = vi
      .fn<FileCommandClient['writeText']>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({
        data: { byteLength: 7, path: 'E:/notes/draft.md' },
        ok: true,
      });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ writeText });
    const documentClaims = createTestDocumentClaimClient();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const editorRef = {
      current: {
        focus: vi.fn(),
        getText: () => '# Draft',
        loadText: vi.fn(),
        markSaved: vi.fn(),
        markUnsaved: vi.fn(),
        setContext: vi.fn(),
      },
    };
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const mount = () =>
      render(
        <StrictMode>
          <WorkflowHarness
            documentClaims={documentClaims}
            editorRef={editorRef}
            onWorkflow={(workflow) => {
              workflowRef.current = workflow;
            }}
            recentFiles={{ addRecentFile: vi.fn() }}
            state={state}
            status={{ setStatusKey: vi.fn() }}
          />
        </StrictMode>,
      );

    const firstView = mount();
    const firstWorkflow = workflowRef.current;
    const firstSave = workflowRef.current?.save();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    firstView.unmount();
    workflowRef.current = null;
    mount();
    await waitFor(() => expect(workflowRef.current).not.toBeNull());
    expect(workflowRef.current).not.toBe(firstWorkflow);

    const remountedWorkflow = workflowRef.current as FileWorkflow | null;
    const secondSave = remountedWorkflow?.save();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstWrite.resolve({
        data: { byteLength: 7, path: 'E:/notes/draft.md' },
        ok: true,
      });
      await Promise.all([firstSave, secondSave]);
    });
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('reads an opened document through the reserved claim tuple', async () => {
    const plainRead = vi.fn().mockResolvedValue({
      data: {
        byteLength: 7,
        path: 'E:/notes/draft.md',
        text: '# Draft',
      },
      ok: true,
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: plainRead,
    });
    const readTextClaimed = vi.fn(async (operationId: number, path: string) => ({
      data: { byteLength: 7, path, text: '# Draft' },
      ok: true as const,
    }));
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
    };
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/notes/draft.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(readTextClaimed).toHaveBeenCalledWith(1, 'E:/notes/draft.md');
    expect(plainRead).not.toHaveBeenCalled();
  });

  it('overlaps the second-file claimed read with same-window reservation', async () => {
    const ipcDelayMs = 20;
    let secondReserveResolvedAt = Number.POSITIVE_INFINITY;
    let secondReadStartedAt = Number.NEGATIVE_INFINITY;
    const loadText = vi.fn();
    const lockCalls: boolean[] = [];
    const reserveDocument = vi.fn(async ({ path }: { path: string }) => {
      if (path.endsWith('b.md')) {
        await delay(ipcDelayMs);
        secondReserveResolvedAt = performance.now();
      }
      return {
        data: { status: 'reserved' as const },
        ok: true as const,
      };
    });
    const readTextClaimed = vi.fn(async (operationId: number, path: string) => {
      if (path.endsWith('b.md')) {
        secondReadStartedAt = performance.now();
        await delay(ipcDelayMs);
        return {
          data: {
            byteLength: 4,
            path,
            text: '# B',
          },
          ok: true as const,
        };
      }
      return {
        data: {
          byteLength: 4,
          path,
          text: '# A',
        },
        ok: true as const,
      };
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
      reserveDocument,
    } satisfies DocumentClaimClient;
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const state = createState();

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => (loadText.mock.calls.at(-1)?.[0] as string | undefined) ?? '',
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked: (locked) => {
              lockCalls.push(locked);
            },
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/notes/a.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    await expect(
      workflowRef.current?.openPath('E:/notes/b.md'),
    ).resolves.toMatchObject({ status: 'opened' });

    expect(secondReadStartedAt).toBeLessThan(secondReserveResolvedAt);
    expect(loadText).toHaveBeenLastCalledWith('# B');
    expect(lockCalls.filter((locked) => locked)).toHaveLength(2);
    expect(lockCalls.at(-1)).toBe(false);
  });

  it('does not load the document when an overlapped reservation fails', async () => {
    const loadText = vi.fn();
    const reserveError = {
      code: 'ipc.response_lost',
      message: 'The reserve response was lost.',
      recoverable: true,
    };
    const reserveDocument = vi.fn(async ({ path }: { path: string }) => {
      if (path.endsWith('b.md')) {
        await delay(20);
        return { error: reserveError, ok: false as const };
      }
      return {
        data: { status: 'reserved' as const },
        ok: true as const,
      };
    });
    const readTextClaimed = vi.fn(async (_operationId: number, path: string) => {
      if (path.endsWith('b.md')) {
        await delay(20);
        return {
          data: { byteLength: 4, path, text: '# B' },
          ok: true as const,
        };
      }
      return {
        data: { byteLength: 4, path, text: '# A' },
        ok: true as const,
      };
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
      releaseReservation: vi.fn(async () => ({
        data: { status: 'released' as const },
        ok: true as const,
      })),
      reserveDocument,
    } satisfies DocumentClaimClient;
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# A',
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/notes/a.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    loadText.mockClear();
    await expect(
      workflowRef.current?.openPath('E:/notes/b.md'),
    ).resolves.toEqual({ status: 'failed' });

    expect(readTextClaimed).toHaveBeenCalledWith(2, 'E:/notes/b.md');
    expect(loadText).not.toHaveBeenCalled();
  });

  it('retries the claimed read after reservation if the overlapped read lost the race', async () => {
    const loadText = vi.fn();
    const reserveDocument = vi.fn(async ({ path }: { path: string }) => {
      if (path.endsWith('b.md')) {
        await delay(30);
      }
      return {
        data: { status: 'reserved' as const },
        ok: true as const,
      };
    });
    const readTextClaimed = vi.fn(async (_operationId: number, path: string) => {
      if (path.endsWith('b.md')) {
        if (readTextClaimed.mock.calls.filter((call) => call[1] === path).length < 2) {
          return {
            error: {
              code: 'document_claim.stale_token',
              message: 'The overlapped read arrived before the reservation.',
              recoverable: true,
            },
            ok: false as const,
          };
        }
        return {
          data: { byteLength: 4, path, text: '# B' },
          ok: true as const,
        };
      }
      return {
        data: { byteLength: 4, path, text: '# A' },
        ok: true as const,
      };
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
      reserveDocument,
    } satisfies DocumentClaimClient;
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => (loadText.mock.calls.at(-1)?.[0] as string | undefined) ?? '',
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked: vi.fn(),
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/notes/a.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    await expect(
      workflowRef.current?.openPath('E:/notes/b.md'),
    ).resolves.toMatchObject({ status: 'opened' });

    expect(readTextClaimed.mock.calls.filter((call) => call[1] === 'E:/notes/b.md')).toHaveLength(2);
    expect(loadText).toHaveBeenLastCalledWith('# B');
  });

  it('reaches loadDocument within 50ms when same-window claim and read overlap', async () => {
    const ipcDelayMs = 20;
    const loadStartedAt: number[] = [];
    const reserveDocument = vi.fn(async ({ path }: { path: string }) => {
      if (path.endsWith('b.md')) {
        await delay(ipcDelayMs);
      }
      return {
        data: { status: 'reserved' as const },
        ok: true as const,
      };
    });
    const readTextClaimed = vi.fn(async (_operationId: number, path: string) => {
      if (path.endsWith('b.md')) {
        await delay(ipcDelayMs);
      }
      return {
        data: {
          byteLength: path.endsWith('b.md') ? 4 : 4,
          path,
          text: path.endsWith('b.md') ? '# B' : '# A',
        },
        ok: true as const,
      };
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
      reserveDocument,
    } satisfies DocumentClaimClient;
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# A',
            loadText: vi.fn((text: string) => {
              if (text === '# B') {
                loadStartedAt.push(performance.now());
              }
            }),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/notes/a.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    const openedAt = performance.now();
    await expect(
      workflowRef.current?.openPath('E:/notes/b.md'),
    ).resolves.toMatchObject({ status: 'opened' });

    expect(loadStartedAt[0]).toBeDefined();
    expect((loadStartedAt[0] ?? 0) - openedAt).toBeLessThan(50);
  });

  it('writes Save As through the active reservation tuple', async () => {
    const plainWrite = vi.fn().mockResolvedValue({
      data: { byteLength: 7, path: 'E:/notes/copy.md' },
      ok: true,
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn().mockResolvedValue({
        data: 'E:/notes/copy.md',
        ok: true,
      }),
      writeText: plainWrite,
    });
    const writeTextClaimed = vi.fn(
      async (operationId: number, path: string, text: string) => ({
        data: { byteLength: text.length, path },
        ok: true as const,
      }),
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      writeTextClaimed,
    };
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState({ dirty: true })}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await workflowRef.current?.saveAs();
    expect(writeTextClaimed).toHaveBeenCalledWith(
      1,
      'E:/notes/copy.md',
      '# Draft',
    );
    expect(plainWrite).not.toHaveBeenCalled();
  });

  it('uses the committed owner tuple for a regular save after remount', async () => {
    const plainRead = vi.fn();
    const plainWrite = vi.fn();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: plainRead,
      writeText: plainWrite,
    });
    const readTextClaimed = vi.fn(async (operationId: number, path: string) => ({
      data: { byteLength: 7, path, text: '# Draft' },
      ok: true as const,
    }));
    const writeTextClaimed = vi.fn(
      async (operationId: number, path: string, text: string) => ({
        data: { byteLength: text.length, path },
        ok: true as const,
      }),
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
      writeTextClaimed,
    };
    const state = createState();
    const editorRef = {
      current: {
        focus: vi.fn(),
        getText: () => '# Draft',
        loadText: vi.fn(),
        markSaved: vi.fn(),
        markUnsaved: vi.fn(),
        setContext: vi.fn(),
      },
    };
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const mount = (strict = false) => {
      const harness = (
        <WorkflowHarness
          documentClaims={documentClaims}
          editorRef={editorRef}
          fileWatch={createFileWatchClient()}
          onWorkflow={(workflow) => {
            workflowRef.current = workflow;
          }}
          recentFiles={{ addRecentFile: vi.fn() }}
          state={state}
          status={{ setStatusKey: vi.fn() }}
        />
      );
      return render(strict ? <StrictMode>{harness}</StrictMode> : harness);
    };

    const firstView = mount();
    await expect(
      workflowRef.current?.openPath('E:/notes/draft.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    firstView.unmount();
    workflowRef.current = null;
    mount(true);
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    const remountedWorkflow = workflowRef.current as FileWorkflow | null;
    if (!remountedWorkflow) {
      throw new Error('File workflow was not remounted.');
    }
    await remountedWorkflow.save();

    expect(readTextClaimed).toHaveBeenCalledWith(1, 'E:/notes/draft.md');
    expect(writeTextClaimed).toHaveBeenCalledWith(
      1,
      'E:/notes/draft.md',
      '# Draft',
    );
    expect(plainRead).not.toHaveBeenCalled();
    expect(plainWrite).not.toHaveBeenCalled();
  });

  it('hands a pending watcher installation to the latest workflow mount', async () => {
    const pendingFirstWatch = createDeferred<
      Awaited<ReturnType<FileWatchClient['watchDocument']>>
    >();
    const firstWatch = createFileWatchClient({
      watchDocument: vi.fn(() => pendingFirstWatch.promise),
    });
    const secondWatch = createFileWatchClient();
    const firstStatus = vi.fn();
    const secondStatus = vi.fn();
    const firstSafe = vi.fn();
    const secondSafe = vi.fn();
    const firstLoaded = vi.fn();
    const secondLoaded = vi.fn();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed: vi.fn(async (_operationId: number, path: string) => ({
        data: { byteLength: 7, path, text: '# Draft' },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={firstWatch}
        onDocumentBecameSafe={firstSafe}
        onDocumentLoaded={firstLoaded}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: firstStatus }}
      />,
    );

    const opened = workflowRef.current?.openPath('E:/notes/draft.md');
    await waitFor(() =>
      expect(firstWatch.watchDocument).toHaveBeenCalledWith(
        'E:/notes/draft.md',
      ),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={secondWatch}
        onDocumentBecameSafe={secondSafe}
        onDocumentLoaded={secondLoaded}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: secondStatus }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingFirstWatch.resolve({
      data: { fingerprint: 'sha256:opened' },
      ok: true,
    });
    await opened;

    expect(firstSafe).not.toHaveBeenCalled();
    expect(firstLoaded).not.toHaveBeenCalled();
    expect(firstStatus).not.toHaveBeenCalledWith('status.opened');
    expect(secondWatch.watchDocument).toHaveBeenCalledWith(
      'E:/notes/draft.md',
    );
    expect(secondSafe).toHaveBeenCalledTimes(1);
    expect(secondLoaded).toHaveBeenCalledTimes(1);
    expect(secondStatus).toHaveBeenCalledWith('status.opened');
  });

  it('applies a committed open only through the latest workflow editor', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(() => pendingCommit.promise),
      readTextClaimed: vi.fn(async (_operationId: number, path: string) => ({
        data: { byteLength: 5, path, text: '# New' },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const firstLoad = vi.fn();
    const firstContext = vi.fn();
    const secondLoad = vi.fn();
    const secondContext = vi.fn();
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: firstLoad,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: firstContext,
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const opened = workflowRef.current?.openPath('E:/notes/new.md');
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalled(),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: secondLoad,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: secondContext,
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingCommit.resolve({ data: { status: 'committed' }, ok: true });
    await opened;

    expect(firstLoad).not.toHaveBeenCalled();
    expect(firstContext).not.toHaveBeenCalled();
    expect(secondLoad).toHaveBeenCalledWith('# New');
    expect(secondContext).toHaveBeenCalledWith({ path: 'E:/notes/new.md' });
  });

  it('preserves latest-mount input when an open commits across remount', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(() => pendingCommit.promise),
      readTextClaimed: vi.fn(async (_operationId: number, path: string) => ({
        data: { byteLength: 5, path, text: '# New' },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const firstState = createState({
      currentFile: { name: 'old.md', path: 'E:/notes/old.md' },
    });
    const secondState = createState({
      currentFile: { name: 'old.md', path: 'E:/notes/old.md' },
      dirty: true,
      dirtyRevision: 1,
    });
    const secondLoad = vi.fn();
    const secondContext = vi.fn();
    const secondMarkUnsaved = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Old',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={firstState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const opened = workflowRef.current?.openPath('E:/notes/new.md');
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalledTimes(1),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Old with IME input',
            loadText: secondLoad,
            markSaved: vi.fn(),
            markUnsaved: secondMarkUnsaved,
            setContext: secondContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={secondState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingCommit.resolve({ data: { status: 'committed' }, ok: true });
    await expect(opened).resolves.toEqual({ status: 'failed' });

    expect(secondLoad).not.toHaveBeenCalled();
    expect(secondContext).toHaveBeenCalledWith({ path: 'E:/notes/new.md' });
    expect(secondMarkUnsaved).toHaveBeenCalledTimes(1);
    expect(secondState.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/new.md' },
      dirty: true,
      lastFileError: { code: 'document_claim.open_apply_incomplete' },
    });
  });

  it('contains an old-mount unlock failure while reconciling a committed open', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(() => pendingCommit.promise),
      readTextClaimed: vi.fn(async (_operationId: number, path: string) => ({
        data: { byteLength: 5, path, text: '# New' },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const firstState = createState();
    const secondState = createState();
    const secondContext = vi.fn();
    const secondMarkUnsaved = vi.fn();
    const secondTransitionLock = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked: vi.fn((locked: boolean) => {
              if (!locked) {
                throw new Error('old editor cannot unlock');
              }
            }),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={firstState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const opened = workflowRef.current?.openPath('E:/notes/new.md');
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalledTimes(1),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: secondMarkUnsaved,
            setContext: secondContext,
            setTransitionLocked: secondTransitionLock,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={secondState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingCommit.resolve({ data: { status: 'committed' }, ok: true });
    await expect(opened).resolves.toEqual({ status: 'failed' });

    expect(secondContext).toHaveBeenCalledWith({ path: 'E:/notes/new.md' });
    expect(secondMarkUnsaved).toHaveBeenCalledTimes(1);
    expect(secondTransitionLock.mock.calls).toEqual([[true], [false]]);
    expect(secondState.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/new.md' },
      dirty: true,
      lastFileError: {
        code: 'document_claim.transition_unlock_failed',
      },
    });
  });

  it('does not publish a late focus outcome from a stale workflow mount', async () => {
    const pendingFocus = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['focusWindow']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      focusWindow: vi.fn(() => pendingFocus.promise),
      reserveDocument: vi.fn(async () => ({
        data: { status: 'ownedBy' as const, windowLabel: 'document-2' },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const firstStatus = vi.fn();
    const secondStatus = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: firstStatus }}
      />,
    );

    const opened = workflowRef.current?.openPath('E:/notes/owned.md');
    await waitFor(() => expect(documentClaims.focusWindow).toHaveBeenCalled());
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState()}
        status={{ setStatusKey: secondStatus }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingFocus.resolve({ data: { status: 'focused' }, ok: true });
    await expect(opened).resolves.toEqual({ status: 'superseded' });

    expect(firstStatus).not.toHaveBeenCalledWith('status.ready');
    expect(secondStatus).not.toHaveBeenCalledWith('status.ready');
  });

  it('reports a late unknown ownership cleanup only through the latest workflow mount', async () => {
    const pendingRead = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['readTextClaimed']>>
    >();
    const pendingRelease = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['releaseReservation']>>
    >();
    const releaseError = {
      code: 'ipc.release_response_lost',
      message: 'The terminal release response was lost.',
      recoverable: true,
    };
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed: vi.fn(() => pendingRead.promise),
      releaseReservation: vi.fn(() => pendingRelease.promise),
    } satisfies DocumentClaimClient;
    const firstState = createState();
    const secondState = createState();
    const firstStatus = vi.fn();
    const secondStatus = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={firstState}
        status={{ setStatusKey: firstStatus }}
      />,
    );

    const opened = workflowRef.current?.openPath('E:/notes/stale.md');
    await waitFor(() =>
      expect(documentClaims.readTextClaimed).toHaveBeenCalledTimes(1),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={secondState}
        status={{ setStatusKey: secondStatus }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingRead.resolve({
      data: { byteLength: 7, path: 'E:/notes/stale.md', text: '# Stale' },
      ok: true,
    });
    await waitFor(() =>
      expect(documentClaims.releaseReservation).toHaveBeenCalledTimes(1),
    );
    pendingRelease.resolve({ error: releaseError, ok: false });
    await expect(opened).resolves.toEqual({ status: 'superseded' });

    expect(firstState.getState().lastFileError).toBeNull();
    expect(firstStatus).not.toHaveBeenCalledWith('status.openFailed');
    expect(secondState.getState().lastFileError).toEqual(releaseError);
    expect(secondStatus).toHaveBeenCalledWith('status.openFailed');
  });

  it('applies a released new document only through the latest workflow editor', async () => {
    const pendingRelease = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['releaseOwnedDocument']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument: vi.fn(() => pendingRelease.promise),
    } satisfies DocumentClaimClient;
    const firstLoad = vi.fn();
    const firstContext = vi.fn();
    const secondLoad = vi.fn();
    const secondContext = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: firstLoad,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: firstContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const created = workflowRef.current?.createNewDocument();
    await waitFor(() =>
      expect(documentClaims.releaseOwnedDocument).toHaveBeenCalled(),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: secondLoad,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: secondContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingRelease.resolve({ data: { status: 'released' }, ok: true });
    await expect(created).resolves.toBe(true);

    expect(firstLoad).not.toHaveBeenCalled();
    expect(firstContext).not.toHaveBeenCalled();
    expect(secondLoad).toHaveBeenCalledWith('');
    expect(secondContext).toHaveBeenCalledWith({ path: null });
  });

  it('preserves latest-mount input when creating a new document crosses remount', async () => {
    const pendingRelease = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['releaseOwnedDocument']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument: vi.fn(() => pendingRelease.promise),
    } satisfies DocumentClaimClient;
    const firstState = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const secondState = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
      dirtyRevision: 1,
    });
    const secondLoad = vi.fn();
    const secondContext = vi.fn();
    const secondMarkUnsaved = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={firstState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const created = workflowRef.current?.createNewDocument();
    await waitFor(() =>
      expect(documentClaims.releaseOwnedDocument).toHaveBeenCalled(),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft with IME input',
            loadText: secondLoad,
            markSaved: vi.fn(),
            markUnsaved: secondMarkUnsaved,
            setContext: secondContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={secondState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingRelease.resolve({ data: { status: 'released' }, ok: true });
    await expect(created).resolves.toBe(false);

    expect(secondLoad).not.toHaveBeenCalled();
    expect(secondContext).toHaveBeenCalledWith({ path: null });
    expect(secondMarkUnsaved).toHaveBeenCalledTimes(1);
    expect(secondState.getState()).toMatchObject({
      currentFile: null,
      dirty: true,
      lastFileError: { code: 'document_claim.new_apply_incomplete' },
    });
  });

  it('rebinds an already-owned document to the current session tuple before saving', async () => {
    const reserveDocument = vi.fn(async () => ({
      data: { status: 'alreadyOwned' as const },
      ok: true as const,
    }));
    const commitReservation = vi.fn();
    const writeTextClaimed = vi.fn(
      async (operationId: number, path: string, text: string) => ({
        data: { byteLength: text.length, path },
        ok: true as const,
      }),
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation,
      reserveDocument,
      writeTextClaimed,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={createFileWatchClient()}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await workflowRef.current?.save();

    expect(reserveDocument).toHaveBeenCalledWith({
      operationId: 1,
      path: 'E:/notes/draft.md',
    });
    expect(commitReservation).not.toHaveBeenCalled();
    expect(writeTextClaimed).toHaveBeenCalledWith(
      1,
      'E:/notes/draft.md',
      '# Draft',
    );
  });

  it('serializes an automatic external reload through the retained claimed tuple', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '# Initial';
    const pendingWrite = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['writeTextClaimed']>>
    >();
    const plainRead = vi.fn();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: plainRead,
    });
    const readTextClaimed = vi
      .fn<DocumentClaimClient['readTextClaimed']>()
      .mockResolvedValueOnce({
        data: {
          byteLength: 9,
          path: 'E:/notes/draft.md',
          text: '# Initial',
        },
        ok: true,
      })
      .mockResolvedValueOnce({
        data: {
          byteLength: 10,
          path: 'E:/notes/draft.md',
          text: '# External',
        },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
      writeTextClaimed: vi.fn(() => pendingWrite.promise),
    } satisfies DocumentClaimClient;
    const fileWatch = createFileWatchClient({
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
    });
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
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

    await workflowRef.current?.openPath('E:/notes/draft.md');
    state.setDirty(true);
    const save = workflowRef.current?.save();
    await waitFor(() =>
      expect(documentClaims.writeTextClaimed).toHaveBeenCalledTimes(1),
    );
    act(() => {
      emitChange?.({
        fingerprint: 'sha256:external',
        kind: 'document',
        path: 'E:/notes/draft.md',
        revision: 1,
      });
    });
    await Promise.resolve();
    expect(readTextClaimed).toHaveBeenCalledTimes(1);

    pendingWrite.resolve({
      data: {
        byteLength: 9,
        fingerprint: 'sha256:saved',
        path: 'E:/notes/draft.md',
      },
      ok: true,
    });
    await save;

    await waitFor(() => expect(editorText).toBe('# External'));
    expect(readTextClaimed.mock.calls).toEqual([
      [1, 'E:/notes/draft.md'],
      [1, 'E:/notes/draft.md'],
    ]);
    expect(plainRead).not.toHaveBeenCalled();
  });

  it('keeps dirty content when a manual claimed reload detects an identity change', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    let editorText = '# Local edits';
    const markUnsaved = vi.fn();
    const plainRead = vi.fn();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: plainRead,
    });
    const identityError = {
      code: 'document_claim.path_identity_changed',
      message: 'The document identity changed.',
      recoverable: false,
    };
    const readTextClaimed = vi
      .fn<DocumentClaimClient['readTextClaimed']>()
      .mockResolvedValueOnce({
        data: {
          byteLength: 13,
          path: 'E:/notes/draft.md',
          text: '# Local edits',
        },
        ok: true,
      })
      .mockResolvedValueOnce({
        data: {
          byteLength: 10,
          path: 'E:/notes/draft.md',
          text: '# External',
        },
        ok: true,
      })
      .mockResolvedValueOnce({ error: identityError, ok: false });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      readTextClaimed,
    } satisfies DocumentClaimClient;
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
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
        fileWatch={createFileWatchClient({
          listen: vi.fn(async (listener) => {
            emitChange = listener;
            return () => undefined;
          }),
        })}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await workflowRef.current?.openPath('E:/notes/draft.md');
    state.setDirty(true);
    act(() => {
      emitChange?.({
        fingerprint: 'sha256:external',
        kind: 'document',
        path: 'E:/notes/draft.md',
        revision: 1,
      });
    });
    await waitFor(() =>
      expect(workflowRef.current?.externalConflict).not.toBeNull(),
    );

    await workflowRef.current?.reloadFromDisk();

    expect(readTextClaimed).toHaveBeenLastCalledWith(
      1,
      'E:/notes/draft.md',
    );
    expect(readTextClaimed).toHaveBeenCalledTimes(3);
    expect(plainRead).not.toHaveBeenCalled();
    expect(editorText).toBe('# Local edits');
    expect(markUnsaved).toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      dirty: true,
      lastFileError: identityError,
    });
  });

  it('keeps an indeterminate ownership block across hook remounts', async () => {
    const documentClaims = createTestDocumentClaimClient();
    const writeText = vi.fn().mockResolvedValue({
      ok: true,
      data: { byteLength: 7, path: 'E:/notes/renamed.md' },
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ writeText });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const state = createState({
      currentFile: { name: 'old.md', path: 'E:/notes/old.md' },
      dirty: true,
    });
    const editorRef = {
      current: {
        focus: vi.fn(),
        getText: () => '# Unsaved',
        loadText: vi.fn(),
        markSaved: vi.fn(),
        markUnsaved: vi.fn(),
        setContext: vi.fn(),
      },
    };
    const renderWorkflow = () =>
      render(
        <WorkflowHarness
          documentClaims={documentClaims}
          editorRef={editorRef}
          onWorkflow={(workflow) => {
            workflowRef.current = workflow;
          }}
          recentFiles={{ addRecentFile: vi.fn() }}
          state={state}
          status={{ setStatusKey: vi.fn() }}
        />,
      );
    const ownershipError = {
      code: 'document_claim.ownership_unknown',
      message: 'Ownership could not be reconciled.',
      recoverable: true,
    };

    const firstView = renderWorkflow();
    await act(async () => {
      await workflowRef.current?.retargetOpenDocument('E:/notes/renamed.md', {
        expectedCurrentPath: 'E:/notes/old.md',
        failClosedError: ownershipError,
      });
    });
    firstView.unmount();

    renderWorkflow();
    await act(async () => {
      await workflowRef.current?.save();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(state.getState().lastFileError).toEqual(ownershipError);
  });

  it('replaces the watched document after a disk file opens successfully', async () => {
    const fileWatch = createFileWatchClient();
    const onDocumentLoaded = vi.fn();
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
        onDocumentLoaded={onDocumentLoaded}
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
    expect(onDocumentLoaded).toHaveBeenCalledTimes(1);
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

  it('claims an untitled Save target when Save routes through Save As', async () => {
    const sequence: string[] = [];
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => {
        sequence.push('commit');
        return {
          data: { status: 'committed' as const },
          ok: true as const,
        };
      }),
      reserveDocument: vi.fn(async () => {
        sequence.push('reserve');
        return { data: { status: 'reserved' as const }, ok: true as const };
      }),
    } satisfies DocumentClaimClient;
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => {
        sequence.push('select');
        return { data: 'E:/notes/saved.md', ok: true as const };
      }),
      writeText: vi.fn(async (path, text) => {
        sequence.push('write');
        return {
          data: { byteLength: text.length, path },
          ok: true as const,
        };
      }),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
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
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState({ dirty: true })}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.save();
    });

    expect(sequence).toEqual(['select', 'reserve', 'write', 'commit']);
  });

  it('retargets the watcher when the document changes while Save As writes', async () => {
    const pendingWrite = createDeferred<
      Awaited<ReturnType<FileCommandClient['writeText']>>
    >();
    const fileWatch = createFileWatchClient();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/notes/saved.md',
      }),
      writeText: vi.fn(() => pendingWrite.promise),
    });
    const state = createState({ dirty: true });
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
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const pendingSaveAs = workflowRef.current?.saveAs();
    await waitFor(() =>
      expect(window.__LUMAMARK_E2E_FILE_COMMANDS__?.writeText).toHaveBeenCalled(),
    );
    act(() => {
      workflowRef.current?.markDocumentDirty(true);
    });
    await act(async () => {
      pendingWrite.resolve({
        ok: true,
        data: { byteLength: 7, path: 'E:/notes/saved.md' },
      });
      await pendingSaveAs;
    });

    expect(state.getState()).toMatchObject({
      currentFile: { name: 'saved.md', path: 'E:/notes/saved.md' },
      dirty: true,
    });
    expect(fileWatch.watchDocument).toHaveBeenCalledWith('E:/notes/saved.md');
  });

  it('commits Save As ownership before retargeting the current document', async () => {
    const sequence: string[] = [];
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      beginSession: vi.fn(async () => {
        sequence.push('begin');
        return {
          data: { sessionGeneration: 1, status: 'began' as const },
          ok: true as const,
        };
      }),
      commitReservation: vi.fn(async () => {
        sequence.push('commit');
        return {
          data: { status: 'committed' as const },
          ok: true as const,
        };
      }),
      reserveDocument: vi.fn(async () => {
        sequence.push('reserve');
        return { data: { status: 'reserved' as const }, ok: true as const };
      }),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
      dirtyRevision: 3,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => {
        sequence.push('select');
        return { data: 'E:/notes/copy.md', ok: true as const };
      }),
      writeText: vi.fn(async (path, text) => {
        sequence.push('write');
        return {
          data: { byteLength: text.length, path },
          ok: true as const,
        };
      }),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(() => sequence.push('apply')),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    expect(sequence).toEqual([
      'begin',
      'select',
      'reserve',
      'write',
      'commit',
      'apply',
    ]);
    expect(state.getState().currentFile?.path).toBe('E:/notes/copy.md');
  });

  it('adopts a committed Save As path fail-closed when applying it throws', async () => {
    const fileWatch = createFileWatchClient();
    const markUnsaved = vi.fn();
    const writeText = vi.fn(async (path: string, text: string) => ({
      data: { byteLength: text.length, path },
      ok: true as const,
    }));
    const state = createState({ dirty: true });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => ({
        data: 'E:/notes/committed-copy.md',
        ok: true as const,
      })),
      writeText,
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(() => {
              throw new Error('editor apply failed');
            }),
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
      await workflowRef.current?.saveAs();
    });

    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/committed-copy.md' },
      dirty: true,
      lastFileError: { code: 'document_claim.save_apply_failed' },
    });
    expect(markUnsaved).toHaveBeenCalled();
    expect(fileWatch.watchDocument).not.toHaveBeenCalled();

    await act(async () => {
      await workflowRef.current?.save();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('retries a lost Save As reserve response with the same operation tuple', async () => {
    const reserveDocument = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'ipc.response_lost',
          message: 'The reserve response was lost.',
          recoverable: true,
        },
        ok: false,
      })
      .mockResolvedValueOnce({
        data: { status: 'reserved' as const },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      reserveDocument,
    } satisfies DocumentClaimClient;
    const writeText = vi.fn().mockResolvedValue({
      ok: true,
      data: { byteLength: 7, path: 'E:/notes/saved.md' },
    });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/notes/saved.md',
      }),
      writeText,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const state = createState({ dirty: true });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
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
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    expect(reserveDocument).toHaveBeenCalledTimes(2);
    expect(reserveDocument.mock.calls[1]).toEqual(reserveDocument.mock.calls[0]);
    expect(writeText).toHaveBeenCalledWith('E:/notes/saved.md', '# Saved');
    expect(state.getState().currentFile?.path).toBe('E:/notes/saved.md');
  });

  it('focuses the existing owner and does not write when Save As targets its document', async () => {
    const writeText = vi.fn();
    const focusWindow = vi.fn(async () => ({
      data: { status: 'focused' as const },
      ok: true as const,
    }));
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      focusWindow,
      reserveDocument: vi.fn(async () => ({
        data: { status: 'ownedBy' as const, windowLabel: 'document-2' },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => ({
        data: 'E:/notes/owned.md',
        ok: true as const,
      })),
      writeText,
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    expect(focusWindow).toHaveBeenCalledWith('document-2');
    expect(writeText).not.toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
  });

  it('does not write or release another operation when Save As finds an existing pending reservation', async () => {
    const writeText = vi.fn();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(),
      releaseReservation: vi.fn(async () => ({
        data: { status: 'released' as const },
        ok: true as const,
      })),
      reserveDocument: vi.fn(async () => ({
        data: { status: 'alreadyPending' as const },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => ({
        data: 'E:/notes/copy.md',
        ok: true as const,
      })),
      writeText,
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(documentClaims.commitReservation).not.toHaveBeenCalled();
    expect(documentClaims.releaseReservation).not.toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
  });

  it('keeps the old document dirty and releases Save As reservation when commit fails', async () => {
    const releaseReservation = vi.fn(async () => ({
      data: { status: 'released' as const },
      ok: true as const,
    }));
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: {
          code: 'document_claim.path_identity_changed',
          message: 'Document path identity changed.',
          recoverable: true,
        },
        ok: false as const,
      })),
      releaseReservation,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
      dirtyRevision: 4,
    });
    const setContext = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => ({
        data: 'E:/notes/copy.md',
        ok: true as const,
      })),
      writeText: vi.fn(async (path, text) => ({
        data: { byteLength: text.length, path },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    expect(setContext).not.toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
      lastFileError: { code: 'document_claim.path_identity_changed' },
    });
    expect(releaseReservation).toHaveBeenCalledWith(1, 'E:/notes/copy.md');
  });

  it('applies Save As when ownership committed but the commit response was lost', async () => {
    const releaseReservation = vi.fn(async () => ({
      data: { status: 'alreadyCommitted' as const },
      ok: true as const,
    }));
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: {
          code: 'tauri.invoke_failed',
          message: 'The commit response was lost.',
          recoverable: true,
        },
        ok: false as const,
      })),
      releaseReservation,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
      dirtyRevision: 4,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => ({
        data: 'E:/notes/copy.md',
        ok: true as const,
      })),
      writeText: vi.fn(async (path, text) => ({
        data: { byteLength: text.length, path },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await act(async () => {
      await workflowRef.current?.saveAs();
    });

    expect(releaseReservation).toHaveBeenCalledWith(1, 'E:/notes/copy.md');
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/copy.md' },
      dirty: false,
      lastFileError: null,
    });
  });

  it('adopts a Save As target fail-closed when commit and release outcomes remain unknown', async () => {
    const transportError = {
      code: 'tauri.invoke_failed',
      message: 'The Save As ownership outcome remained unknown.',
      recoverable: true,
    };
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: transportError,
        ok: false as const,
      })),
      releaseReservation: vi.fn(async () => ({
        error: transportError,
        ok: false as const,
      })),
    } satisfies DocumentClaimClient;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => ({
        data: 'E:/notes/copy.md',
        ok: true as const,
      })),
      writeText: vi.fn(async (path, text) => ({
        data: { byteLength: text.length, path },
        ok: true as const,
      })),
    });
    const markUnsaved = vi.fn();
    const setContext = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved,
            setContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await workflowRef.current?.saveAs();

    expect(setContext).toHaveBeenLastCalledWith({ path: 'E:/notes/copy.md' });
    expect(markUnsaved).toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/copy.md' },
      dirty: true,
      lastFileError: transportError,
    });
    expect(
      getDocumentClaimOwnedOperation(
        resolveDocumentClaimWorkflowRuntime(documentClaims),
      ),
    ).toEqual({ operationId: 1, path: 'E:/notes/copy.md' });
  });

  it('hands committed Save As watcher and status work to the latest StrictMode remount', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    let ownedPath: string | null = 'E:/notes/draft.md';
    const releaseOwnedDocument = vi.fn(async (path: string) => {
      if (ownedPath === path) {
        ownedPath = null;
      }
      return { data: { status: 'released' as const }, ok: true as const };
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn((_: number, path: string) => {
        ownedPath = path;
        return pendingCommit.promise;
      }),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/notes/copy.md',
      }),
      writeText: vi.fn().mockResolvedValue({
        ok: true,
        data: { byteLength: 7, path: 'E:/notes/copy.md' },
      }),
    });
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const oldFileWatch = createFileWatchClient();
    const newFileWatch = createFileWatchClient();
    const oldBecameSafe = vi.fn();
    const newBecameSafe = vi.fn();
    const oldStatus = { setStatusKey: vi.fn() };
    const newStatus = { setStatusKey: vi.fn() };
    const editorRef = {
      current: {
        focus: vi.fn(),
        getText: () => '# Draft',
        loadText: vi.fn(),
        markSaved: vi.fn(),
        markUnsaved: vi.fn(),
        setContext: vi.fn(),
      },
    };
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const view = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={editorRef}
        fileWatch={oldFileWatch}
        onDocumentBecameSafe={oldBecameSafe}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={oldStatus}
      />,
    );

    const pendingSaveAs = workflowRef.current?.saveAs();
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalledTimes(1),
    );
    view.unmount();
    render(
      <StrictMode>
        <WorkflowHarness
          documentClaims={documentClaims}
          editorRef={editorRef}
          fileWatch={newFileWatch}
          onDocumentBecameSafe={newBecameSafe}
          onWorkflow={(workflow) => {
            workflowRef.current = workflow;
          }}
          recentFiles={{ addRecentFile: vi.fn() }}
          state={state}
          status={newStatus}
        />
      </StrictMode>,
    );
    await act(async () => {
      pendingCommit.resolve({
        data: { status: 'committed' },
        ok: true,
      });
      await pendingSaveAs;
    });

    expect(releaseOwnedDocument).not.toHaveBeenCalled();
    expect(state.getState().currentFile?.path).toBe('E:/notes/copy.md');
    expect(ownedPath).toBe('E:/notes/copy.md');
    expect(oldFileWatch.watchDocument).not.toHaveBeenCalled();
    expect(newFileWatch.watchDocument).toHaveBeenCalledWith(
      'E:/notes/copy.md',
    );
    expect(oldBecameSafe).not.toHaveBeenCalled();
    expect(newBecameSafe).toHaveBeenCalledTimes(1);
    expect(oldStatus.setStatusKey).not.toHaveBeenCalledWith('status.saved');
    expect(newStatus.setStatusKey).toHaveBeenCalledWith('status.saved');
  });

  it('reconciles a Save As write through the latest workflow editor after remount', async () => {
    const pendingWrite = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['writeTextClaimed']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      writeTextClaimed: vi.fn(() => pendingWrite.promise),
    } satisfies DocumentClaimClient;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      showSaveDialog: vi.fn(async () => ({
        data: 'E:/notes/copy.md',
        ok: true as const,
      })),
    });
    const firstContext = vi.fn();
    const firstMarkSaved = vi.fn();
    const firstMarkUnsaved = vi.fn();
    const secondContext = vi.fn();
    const secondMarkSaved = vi.fn();
    const secondMarkUnsaved = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: firstMarkSaved,
            markUnsaved: firstMarkUnsaved,
            setContext: firstContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const saved = workflowRef.current?.saveAs();
    await waitFor(() =>
      expect(documentClaims.writeTextClaimed).toHaveBeenCalledTimes(1),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: secondMarkSaved,
            markUnsaved: secondMarkUnsaved,
            setContext: secondContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingWrite.resolve({
      data: {
        byteLength: 7,
        fingerprint: 'sha256:saved',
        path: 'E:/notes/copy.md',
      },
      ok: true,
    });
    await saved;

    expect(firstContext).not.toHaveBeenCalled();
    expect(firstMarkSaved).not.toHaveBeenCalled();
    expect(firstMarkUnsaved).not.toHaveBeenCalled();
    expect(secondContext).toHaveBeenCalledWith({ path: 'E:/notes/copy.md' });
    expect(secondMarkSaved).not.toHaveBeenCalled();
    expect(secondMarkUnsaved).toHaveBeenCalledTimes(1);
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/copy.md' },
      dirty: true,
      lastFileError: null,
    });
  });

  it('claims a renamed path before retargeting the open document', async () => {
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        data: { status: 'committed' as const },
        ok: true as const,
      })),
      reserveDocument: vi.fn(async () => ({
        data: { status: 'reserved' as const },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const setContext = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    let outcome:
      | Awaited<ReturnType<FileWorkflow['retargetOpenDocument']>>
      | undefined;
    await act(async () => {
      outcome = await workflowRef.current?.retargetOpenDocument(
        'E:/notes/renamed.md',
      );
    });

    expect(documentClaims.reserveDocument).toHaveBeenCalledWith({
      operationId: 1,
      path: 'E:/notes/renamed.md',
    });
    expect(documentClaims.commitReservation).toHaveBeenCalledWith(
      1,
      'E:/notes/renamed.md',
    );
    expect(setContext).toHaveBeenCalledWith({ path: 'E:/notes/renamed.md' });
    expect(state.getState().currentFile?.path).toBe('E:/notes/renamed.md');
    expect(outcome).toEqual({ status: 'retargeted' });
  });

  it('uses one client-scoped mutation barrier for saves and retargets', async () => {
    const firstWrite = createDeferred<
      Awaited<ReturnType<FileCommandClient['writeText']>>
    >();
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    const writeText = vi
      .fn<FileCommandClient['writeText']>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({
        data: { byteLength: 7, path: 'E:/notes/renamed.md' },
        ok: true,
      });
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ writeText });
    const reserveDocument = vi
      .fn<DocumentClaimClient['reserveDocument']>()
      .mockResolvedValueOnce({
        data: { status: 'alreadyOwned' },
        ok: true,
      })
      .mockResolvedValue({
        data: { status: 'reserved' },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(() => pendingCommit.promise),
      reserveDocument,
      writeTextClaimed: vi.fn((_operationId, path, text) =>
        writeText(path, text),
      ),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
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
    const firstSave = workflow.save();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const retarget = runRetargetOpenDocumentMutation(
      workflow.retargetOpenDocument,
      async (retargetWithinBarrier) => {
        await retargetWithinBarrier('E:/notes/renamed.md');
      },
    );
    await Promise.resolve();
    expect(reserveDocument).toHaveBeenCalledTimes(1);

    firstWrite.resolve({
      data: { byteLength: 7, path: 'E:/notes/draft.md' },
      ok: true,
    });
    await waitFor(() => expect(documentClaims.commitReservation).toHaveBeenCalled());

    state.setDirty(true);
    const secondSave = workflow.save();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingCommit.resolve({ data: { status: 'committed' }, ok: true });
      await Promise.all([firstSave, retarget, secondSave]);
    });
    expect(documentClaims.writeTextClaimed.mock.calls).toEqual([
      [1, 'E:/notes/draft.md', '# Draft'],
      [2, 'E:/notes/renamed.md', '# Draft'],
    ]);
    expect(documentClaims.commitReservation).toHaveBeenCalledWith(
      2,
      'E:/notes/renamed.md',
    );
    expect(state.getState().currentFile).toEqual({
      name: 'renamed.md',
      path: 'E:/notes/renamed.md',
    });
    expect(state.getState().lastFileError).toBeNull();
    expect(reserveDocument.mock.calls).toEqual([
      [{ operationId: 1, path: 'E:/notes/draft.md' }],
      [{ operationId: 2, path: 'E:/notes/renamed.md' }],
    ]);
    expect(writeText.mock.calls).toEqual([
      ['E:/notes/draft.md', '# Draft'],
      ['E:/notes/renamed.md', '# Draft'],
    ]);
  });

  it('applies a committed retarget only through the latest workflow editor', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(() => pendingCommit.promise),
    } satisfies DocumentClaimClient;
    const firstContext = vi.fn();
    const secondContext = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: firstContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const retargeted = workflowRef.current?.retargetOpenDocument(
      'E:/notes/renamed.md',
    );
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalled(),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: secondContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingCommit.resolve({ data: { status: 'committed' }, ok: true });
    await expect(retargeted).resolves.toEqual({ status: 'retargeted' });

    expect(firstContext).not.toHaveBeenCalled();
    expect(secondContext).toHaveBeenCalledWith({
      path: 'E:/notes/renamed.md',
    });
  });

  it('cancels reversible queued work from a stale workflow mount', async () => {
    const pendingFirstWrite = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['writeTextClaimed']>>
    >();
    const writeTextClaimed = vi
      .fn<DocumentClaimClient['writeTextClaimed']>()
      .mockImplementationOnce(() => pendingFirstWrite.promise)
      .mockResolvedValue({
        data: { byteLength: 8, path: 'E:/notes/draft.md' },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      writeTextClaimed,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    let sourceText = '# Save 1';
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => sourceText,
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    const staleWorkflow = workflowRef.current;
    if (!staleWorkflow) {
      throw new Error('File workflow was not initialized.');
    }

    const firstSave = staleWorkflow.save();
    await waitFor(() => expect(writeTextClaimed).toHaveBeenCalledTimes(1));
    sourceText = '# Save 2';
    state.setDirty(true);
    const queuedSave = staleWorkflow.save();
    const diskRename = vi.fn(async () => undefined);
    const queuedRename = runRetargetOpenDocumentMutation(
      staleWorkflow.retargetOpenDocument,
      async () => diskRename(),
    );

    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Latest mount',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingFirstWrite.resolve({
      data: { byteLength: 8, path: 'E:/notes/draft.md' },
      ok: true,
    });
    await Promise.all([firstSave, queuedSave, queuedRename]);

    expect(writeTextClaimed).toHaveBeenCalledTimes(1);
    expect(diskRename).not.toHaveBeenCalled();
  });

  it('reconciles an in-flight regular save through the latest workflow editor after remount', async () => {
    const pendingWrite = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['writeTextClaimed']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      writeTextClaimed: vi.fn(() => pendingWrite.promise),
    } satisfies DocumentClaimClient;
    const firstContext = vi.fn();
    const firstMarkSaved = vi.fn();
    const firstMarkUnsaved = vi.fn();
    const secondContext = vi.fn();
    const secondMarkSaved = vi.fn();
    const secondMarkUnsaved = vi.fn();
    const secondWatch = createFileWatchClient();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: firstMarkSaved,
            markUnsaved: firstMarkUnsaved,
            setContext: firstContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const saved = workflowRef.current?.save();
    await waitFor(() =>
      expect(documentClaims.writeTextClaimed).toHaveBeenCalledTimes(1),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: secondMarkSaved,
            markUnsaved: secondMarkUnsaved,
            setContext: secondContext,
          },
        }}
        fileWatch={secondWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingWrite.resolve({
      data: {
        byteLength: 7,
        fingerprint: 'sha256:saved',
        path: 'E:/notes/draft.md',
      },
      ok: true,
    });
    await saved;

    expect(firstContext).not.toHaveBeenCalled();
    expect(firstMarkSaved).not.toHaveBeenCalled();
    expect(firstMarkUnsaved).not.toHaveBeenCalled();
    expect(secondContext).toHaveBeenCalledWith({ path: 'E:/notes/draft.md' });
    expect(secondMarkSaved).not.toHaveBeenCalled();
    expect(secondMarkUnsaved).toHaveBeenCalledTimes(1);
    expect(secondWatch.watchDocument).toHaveBeenCalledWith(
      'E:/notes/draft.md',
    );
    expect(state.getState().dirty).toBe(true);
  });

  it('adopts a committed retarget path fail-closed when applying it throws', async () => {
    const fileWatch = createFileWatchClient();
    const markUnsaved = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved,
            setContext: vi.fn(() => {
              throw new Error('editor context failed');
            }),
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

    let outcome:
      | Awaited<ReturnType<FileWorkflow['retargetOpenDocument']>>
      | undefined;
    await act(async () => {
      outcome = await workflowRef.current?.retargetOpenDocument(
        'E:/notes/renamed.md',
      );
    });

    expect(outcome).toEqual({ status: 'failClosed' });
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/renamed.md' },
      dirty: true,
      lastFileError: { code: 'document_claim.retarget_apply_failed' },
    });
    expect(markUnsaved).toHaveBeenCalled();
    expect(fileWatch.watchDocument).not.toHaveBeenCalled();
  });

  it('retries a lost retarget reserve response with the same operation tuple', async () => {
    const reserveDocument = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'ipc.response_lost',
          message: 'The reserve response was lost.',
          recoverable: true,
        },
        ok: false,
      })
      .mockResolvedValueOnce({
        data: { status: 'reserved' as const },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      reserveDocument,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.retargetOpenDocument('E:/notes/renamed.md'),
    ).resolves.toEqual({ status: 'retargeted' });
    expect(reserveDocument).toHaveBeenCalledTimes(2);
    expect(reserveDocument.mock.calls[1]).toEqual(reserveDocument.mock.calls[0]);
    expect(state.getState().currentFile?.path).toBe('E:/notes/renamed.md');
  });

  it('finishes retargeting after native ownership commits across a hook unmount', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    let ownedPath: string | null = 'E:/notes/draft.md';
    const releaseOwnedDocument = vi.fn(async (path: string) => {
      if (ownedPath === path) {
        ownedPath = null;
      }
      return { data: { status: 'released' as const }, ok: true as const };
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn((_: number, path: string) => {
        ownedPath = path;
        return pendingCommit.promise;
      }),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const view = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const pendingRetarget = workflowRef.current?.retargetOpenDocument(
      'E:/notes/renamed.md',
    );
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalledTimes(1),
    );
    view.unmount();
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    let outcome:
      | Awaited<ReturnType<FileWorkflow['retargetOpenDocument']>>
      | undefined;
    await act(async () => {
      pendingCommit.resolve({
        data: { status: 'committed' },
        ok: true,
      });
      outcome = await pendingRetarget;
    });

    expect(outcome).toEqual({ status: 'retargeted' });
    expect(releaseOwnedDocument).not.toHaveBeenCalled();
    expect(state.getState().currentFile?.path).toBe('E:/notes/renamed.md');
    expect(ownedPath).toBe('E:/notes/renamed.md');
  });

  it('keeps the previous identity when a renamed path claim cannot commit', async () => {
    const commitError = {
      code: 'document_claim.path_identity_changed',
      message: 'Document path identity changed.',
      recoverable: true,
    };
    const releaseReservation = vi.fn(async () => ({
      data: { status: 'released' as const },
      ok: true as const,
    }));
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: commitError,
        ok: false as const,
      })),
      releaseReservation,
    } satisfies DocumentClaimClient;
    const setContext = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    let outcome:
      | Awaited<ReturnType<FileWorkflow['retargetOpenDocument']>>
      | undefined;
    await act(async () => {
      outcome = await workflowRef.current?.retargetOpenDocument(
        'E:/notes/renamed.md',
      );
    });

    expect(releaseReservation).toHaveBeenCalledWith(1, 'E:/notes/renamed.md');
    expect(setContext).not.toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/draft.md' },
      lastFileError: { code: 'document_claim.path_identity_changed' },
    });
    expect(outcome).toEqual({ error: commitError, status: 'failed' });
  });

  it('adopts the actual renamed path in a save-blocked state after rollback fails', async () => {
    const claimError = {
      code: 'document_claim.owned_by_other_window',
      message: 'Another window owns the renamed document.',
      recoverable: true,
    };
    const setContext = vi.fn();
    const markUnsaved = vi.fn();
    const releaseOwnedDocument = vi
      .fn<DocumentClaimClient['releaseOwnedDocument']>()
      .mockResolvedValueOnce({
        data: { status: 'released' },
        ok: true,
      })
      .mockResolvedValueOnce({
        data: { status: 'notOwned' },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const writeText = vi.fn(async (path: string) => ({
      data: { byteLength: 7, path },
      ok: true as const,
    }));
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      writeText,
    });
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved,
            setContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    let outcome:
      | Awaited<ReturnType<FileWorkflow['retargetOpenDocument']>>
      | undefined;
    await act(async () => {
      outcome = await workflowRef.current?.retargetOpenDocument(
        'E:/notes/renamed.md',
        {
          expectedCurrentPath: 'E:/notes/draft.md',
          failClosedError: claimError,
        },
      );
      await workflowRef.current?.save();
    });

    expect(outcome).toEqual({ status: 'failClosed' });
    expect(setContext).toHaveBeenCalledWith({ path: 'E:/notes/renamed.md' });
    expect(markUnsaved).toHaveBeenCalledTimes(1);
    expect(releaseOwnedDocument.mock.calls).toEqual([
      ['E:/notes/draft.md'],
      ['E:/notes/renamed.md'],
    ]);
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/renamed.md' },
      dirty: true,
      lastFileError: claimError,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('blocks saves and stops the old watcher before fail-closed ownership cleanup settles', async () => {
    const pendingRelease = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['releaseOwnedDocument']>>
    >();
    const releaseOwnedDocument = vi
      .fn<DocumentClaimClient['releaseOwnedDocument']>()
      .mockImplementationOnce(() => pendingRelease.promise)
      .mockResolvedValue({
        data: { status: 'notOwned' },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const fileWatch = createFileWatchClient();
    const writeText = vi.fn(async (path: string, text: string) => ({
      data: { byteLength: text.length, path },
      ok: true as const,
    }));
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 7, path, text: '# Draft' },
        ok: true as const,
      })),
      writeText,
    });
    const state = createState();
    let transitionLocked = false;
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked: (locked) => {
              transitionLocked = locked;
            },
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

    await expect(
      workflowRef.current?.openPath('E:/notes/draft.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    const unwatchCallsBeforeCleanup = vi.mocked(fileWatch.unwatchDocument).mock
      .calls.length;
    const failClosed = workflowRef.current?.retargetOpenDocument(
      'E:/notes/renamed.md',
      {
        expectedCurrentPath: 'E:/notes/draft.md',
        failClosedError: {
          code: 'document_claim.owned_by_other_window',
          message: 'Another window owns the renamed document.',
          recoverable: true,
        },
      },
    );
    await waitFor(() => expect(releaseOwnedDocument).toHaveBeenCalledTimes(1));

    const queuedSave = workflowRef.current?.save();
    await Promise.resolve();
    const writesWhileCleanupWasPending = writeText.mock.calls.length;
    const unwatchCallsWhileCleanupWasPending = vi.mocked(
      fileWatch.unwatchDocument,
    ).mock.calls.length;
    expect(transitionLocked).toBe(true);

    await act(async () => {
      pendingRelease.resolve({
        data: { status: 'released' },
        ok: true,
      });
      await Promise.all([failClosed, queuedSave]);
    });

    expect(writesWhileCleanupWasPending).toBe(0);
    expect(unwatchCallsWhileCleanupWasPending).toBeGreaterThan(
      unwatchCallsBeforeCleanup,
    );
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/renamed.md' },
      dirty: true,
    });
  });

  it('keeps fail-closed saves blocked when the editor transition lock throws', async () => {
    const claimError = {
      code: 'document_claim.owned_by_other_window',
      message: 'Another window owns the renamed document.',
      recoverable: true,
    };
    const writeText = vi.fn();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ writeText });
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked: vi.fn(() => {
              throw new Error('transition lock failed');
            }),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.retargetOpenDocument('E:/notes/renamed.md', {
        expectedCurrentPath: 'E:/notes/draft.md',
        failClosedError: claimError,
      }),
    ).resolves.toEqual({ status: 'failClosed' });
    await workflowRef.current?.save();

    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/renamed.md' },
      dirty: true,
      lastFileError: {
        code: 'document_claim.fail_closed_transition_lock_failed',
      },
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('adopts the actual path and reports an indeterminate retarget without releasing ownership', async () => {
    const transportError = {
      code: 'tauri.invoke_failed',
      message: 'The claim outcome remained unknown.',
      recoverable: true,
    };
    const releaseOwnedDocument = vi.fn(
      createTestDocumentClaimClient().releaseOwnedDocument,
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: transportError,
        ok: false as const,
      })),
      releaseReservation: vi.fn(async () => ({
        error: transportError,
        ok: false as const,
      })),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.retargetOpenDocument('E:/notes/renamed.md'),
    ).resolves.toEqual({ error: transportError, status: 'indeterminate' });
    await expect(
      workflowRef.current?.retargetOpenDocument('E:/notes/renamed.md', {
        expectedCurrentPath: 'E:/notes/renamed.md',
        failClosedError: transportError,
      }),
    ).resolves.toMatchObject({
      error: {
        code: 'document_claim.irreversible_transition_in_progress',
      },
      status: 'failed',
    });

    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/renamed.md' },
      dirty: true,
      lastFileError: transportError,
    });
    expect(
      getDocumentClaimOwnedOperation(
        resolveDocumentClaimWorkflowRuntime(documentClaims),
      ),
    ).toEqual({ operationId: 1, path: 'E:/notes/renamed.md' });
    expect(releaseOwnedDocument).not.toHaveBeenCalled();
  });

  it('adopts an indeterminate retarget only through the latest workflow facade after remount', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    const transportError = {
      code: 'tauri.invoke_failed',
      message: 'The claim outcome remained unknown.',
      recoverable: true,
    };
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(() => pendingCommit.promise),
      releaseReservation: vi.fn(async () => ({
        error: transportError,
        ok: false as const,
      })),
    } satisfies DocumentClaimClient;
    const firstState = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const secondState = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const firstContext = vi.fn();
    const firstMarkUnsaved = vi.fn();
    const secondContext = vi.fn();
    const secondMarkUnsaved = vi.fn();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const firstView = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: firstMarkUnsaved,
            setContext: firstContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={firstState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const retargeted = workflowRef.current?.retargetOpenDocument(
      'E:/notes/renamed.md',
    );
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalledTimes(1),
    );
    firstView.unmount();
    workflowRef.current = null;
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: secondMarkUnsaved,
            setContext: secondContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={secondState}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    await waitFor(() => expect(workflowRef.current).not.toBeNull());

    pendingCommit.resolve({ error: transportError, ok: false });
    await expect(retargeted).resolves.toEqual({
      error: transportError,
      status: 'indeterminate',
    });

    expect(firstContext).not.toHaveBeenCalled();
    expect(firstMarkUnsaved).not.toHaveBeenCalled();
    expect(firstState.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/draft.md' },
      dirty: false,
      lastFileError: null,
    });
    expect(secondContext).toHaveBeenCalledWith({
      path: 'E:/notes/renamed.md',
    });
    expect(secondMarkUnsaved).toHaveBeenCalledTimes(1);
    expect(secondState.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/renamed.md' },
      dirty: true,
      lastFileError: transportError,
    });
  });

  it('records the actual renamed path fail-closed while the editor port is unavailable', async () => {
    const claimError = {
      code: 'document_claim.owned_by_other_window',
      message: 'Another window owns the renamed document.',
      recoverable: true,
    };
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={createTestDocumentClaimClient()}
        editorRef={{ current: null }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.retargetOpenDocument('E:/notes/renamed.md', {
        expectedCurrentPath: 'E:/notes/draft.md',
        failClosedError: claimError,
      }),
    ).resolves.toEqual({ status: 'failClosed' });
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/renamed.md' },
      dirty: true,
      lastFileError: claimError,
    });
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
    const onDocumentLoaded = vi.fn();
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
        onDocumentLoaded={onDocumentLoaded}
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
      await workflow.createNewDocument();
    });

    expect(loadDocument).toHaveBeenCalledWith('');
    expect(setDocumentContext).toHaveBeenCalledWith({ path: null });
    expect(state.getState().currentFile).toBeNull();
    expect(workflowRef.current?.fileOpening).toBe(false);
    expect(setStatusKey).toHaveBeenLastCalledWith('status.ready');
    expect(onDocumentLoaded).toHaveBeenCalledTimes(1);

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
    expect(onDocumentLoaded).toHaveBeenCalledTimes(1);
  });

  it('releases the owned path before creating an untitled document', async () => {
    const sequence: string[] = [];
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument: vi.fn(async (path: string) => {
        sequence.push(`release:${path}`);
        return {
          data: { status: 'released' as const },
          ok: true as const,
        };
      }),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'owned.md', path: 'E:/notes/owned.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(),
            loadText: vi.fn(() => {
              sequence.push('apply-untitled');
            }),
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

    await act(async () => {
      await workflowRef.current?.createNewDocument();
    });

    expect(sequence).toEqual([
      'release:E:/notes/owned.md',
      'apply-untitled',
    ]);
    expect(state.getState().currentFile).toBeNull();
  });

  it('recovers the original text as untitled when New apply throws after release', async () => {
    const fileWatch = createFileWatchClient();
    const loadText = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('untitled apply failed');
      })
      .mockImplementationOnce(() => undefined);
    const markUnsaved = vi.fn();
    const setContext = vi.fn();
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Original draft',
            loadText,
            markSaved: vi.fn(),
            markUnsaved,
            setContext,
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

    await expect(workflowRef.current?.createNewDocument()).resolves.toBe(false);

    expect(loadText.mock.calls.map(([text]) => text)).toEqual([
      '',
      '# Original draft',
    ]);
    expect(setContext).toHaveBeenLastCalledWith({ path: null });
    expect(markUnsaved).toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: null,
      dirty: true,
      lastFileError: { code: 'document_claim.new_apply_failed' },
    });
    expect(fileWatch.watchDocument).not.toHaveBeenCalled();
  });

  it('finishes creating a new document after native ownership releases across a hook unmount', async () => {
    const pendingRelease = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['releaseOwnedDocument']>>
    >();
    let ownedPath: string | null = 'E:/notes/draft.md';
    const releaseOwnedDocument = vi.fn((path: string) => {
      if (ownedPath === path) {
        ownedPath = null;
      }
      return pendingRelease.promise;
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'draft.md', path: 'E:/notes/draft.md' },
      dirty: false,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const view = render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const pendingCreate = workflowRef.current?.createNewDocument();
    await waitFor(() => expect(releaseOwnedDocument).toHaveBeenCalledTimes(1));
    view.unmount();
    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Draft',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    let created: boolean | undefined;
    await act(async () => {
      pendingRelease.resolve({
        data: { status: 'released' },
        ok: true,
      });
      created = await pendingCreate;
    });

    expect(created).toBe(true);
    expect(state.getState().currentFile).toBeNull();
    expect(ownedPath).toBeNull();
  });

  it('locks editor input while releasing ownership and creating an untitled document', async () => {
    const pendingRelease = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['releaseOwnedDocument']>>
    >();
    const releaseOwnedDocument = vi.fn(() => pendingRelease.promise);
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    let editorText = '# Current';
    let transitionLocked = false;
    const setTransitionLocked = vi.fn((locked: boolean) => {
      transitionLocked = locked;
    });
    const loadText = vi.fn((text: string) => {
      editorText = text;
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const pendingNew = workflowRef.current?.createNewDocument();
    await waitFor(() => expect(releaseOwnedDocument).toHaveBeenCalledTimes(1));
    expect(transitionLocked).toBe(true);
    expect(loadText).not.toHaveBeenCalled();

    if (!transitionLocked) {
      editorText = '# Current\n\nNew IME input';
      state.setDirty(true);
    }

    let created: boolean | undefined;
    await act(async () => {
      pendingRelease.resolve({
        data: { status: 'released' },
        ok: true,
      });
      created = await pendingNew;
    });

    expect(created).toBe(true);
    expect(loadText).toHaveBeenCalledWith('');
    expect(setTransitionLocked.mock.calls).toEqual([[true], [false]]);
    expect(transitionLocked).toBe(false);
  });

  it('keeps the owned document intact when releasing its claim fails', async () => {
    const releaseError = {
      code: 'document_claim.release_failed',
      message: 'The document ownership could not be released.',
      recoverable: true,
    };
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument: vi.fn(async () => ({
        error: releaseError,
        ok: false as const,
      })),
    } satisfies DocumentClaimClient;
    const loadText = vi.fn();
    const setStatusKey = vi.fn();
    const state = createState({
      currentFile: { name: 'owned.md', path: 'E:/notes/owned.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Unsaved'),
            loadText,
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
      await workflowRef.current?.createNewDocument();
    });

    expect(loadText).not.toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { name: 'owned.md', path: 'E:/notes/owned.md' },
      dirty: true,
      lastFileError: releaseError,
    });
    expect(setStatusKey).toHaveBeenLastCalledWith('status.openFailed');
  });

  it('creates an untitled document when a lost release response reconciles as not owned', async () => {
    const releaseError = {
      code: 'tauri.invoke_failed',
      message: 'The ownership release response was lost.',
      recoverable: true,
    };
    const releaseOwnedDocument = vi
      .fn<DocumentClaimClient['releaseOwnedDocument']>()
      .mockResolvedValueOnce({ error: releaseError, ok: false })
      .mockResolvedValueOnce({
        data: { status: 'notOwned' },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const loadText = vi.fn();
    const state = createState({
      currentFile: { name: 'owned.md', path: 'E:/notes/owned.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Unsaved'),
            loadText,
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

    await expect(workflowRef.current?.createNewDocument()).resolves.toBe(true);

    expect(releaseOwnedDocument).toHaveBeenCalledTimes(2);
    expect(loadText).toHaveBeenCalledWith('');
    expect(state.getState().currentFile).toBeNull();
  });

  it('blocks later saves when an ownership release remains indeterminate', async () => {
    const releaseError = {
      code: 'tauri.invoke_failed',
      message: 'The ownership release response remained unavailable.',
      recoverable: true,
    };
    const releaseOwnedDocument = vi.fn(async () => ({
      error: releaseError,
      ok: false as const,
    }));
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const writeText = vi.fn(async (path: string) => ({
      data: { byteLength: 9, path },
      ok: true as const,
    }));
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      writeText,
    });
    const state = createState({
      currentFile: { name: 'owned.md', path: 'E:/notes/owned.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
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
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(workflowRef.current?.createNewDocument()).resolves.toBe(false);
    await workflowRef.current?.save();

    expect(releaseOwnedDocument).toHaveBeenCalledTimes(2);
    expect(writeText).not.toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/notes/owned.md' },
      dirty: true,
      lastFileError: releaseError,
    });
  });

  it('blocks a concurrent save while ownership is being released for a new document', async () => {
    const pendingRelease = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['releaseOwnedDocument']>>
    >();
    const writeText = vi.fn();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseOwnedDocument: vi.fn(() => pendingRelease.promise),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'owned.md', path: 'E:/notes/owned.md' },
      dirty: true,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText,
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
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
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    let creating: Promise<boolean> | undefined;
    await act(async () => {
      creating = workflowRef.current?.createNewDocument();
      await Promise.resolve();
    });
    expect(workflowRef.current?.fileOpening).toBe(true);

    await act(async () => {
      await workflowRef.current?.save();
    });
    expect(writeText).not.toHaveBeenCalled();

    await act(async () => {
      pendingRelease.resolve({
        data: { status: 'released' },
        ok: true,
      });
      await creating;
    });
    expect(workflowRef.current?.fileOpening).toBe(false);
    expect(state.getState().currentFile).toBeNull();
  });

  it('explicitly supersedes a pending link open before a newer non-file navigation', async () => {
    const pendingRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    const loadDocument = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
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
            focus: vi.fn(),
            getText: vi.fn(),
            loadText: loadDocument,
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

    const pendingOpen = workflow.openPath('E:/docs/older.md');
    act(() => {
      workflow.supersedePendingOpen();
    });

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

    expect(loadDocument).not.toHaveBeenCalled();
    expect(state.getState().currentFile?.path).toBe('E:/docs/current.md');
  });

  it('fails closed without changing status when an open starts on a dirty document', async () => {
    const readText = vi.fn();
    const showOpenDialog = vi.fn();
    const setStatusKey = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
      dirty: true,
      dirtyRevision: 3,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText,
      showOpenDialog,
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Current\n\nUnsaved',
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

    await expect(workflow.openPath('E:/docs/other.md')).resolves.toEqual({
      status: 'superseded',
    });
    await expect(workflow.openFromDialog()).resolves.toEqual({
      status: 'superseded',
    });

    expect(readText).not.toHaveBeenCalled();
    expect(showOpenDialog).not.toHaveBeenCalled();
    expect(setStatusKey).not.toHaveBeenCalled();
    expect(workflowRef.current?.fileOpening).toBe(false);
  });

  it('opens a dirty document only through the explicit discard transition', async () => {
    let editorText = '# Current\n\nUnsaved';
    const loadDocument = vi.fn((text: string) => {
      editorText = text;
    });
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
      dirty: true,
      dirtyRevision: 3,
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(async () => ({
        data: {
          byteLength: 7,
          fingerprint: 'sha256:other',
          path: 'E:/docs/other.md',
          text: '# Other',
        },
        ok: true as const,
      })),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    } satisfies FileCommandClient;

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText: loadDocument,
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

    await expect(
      workflowRef.current?.openPathAfterDiscard('E:/docs/other.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(loadDocument).toHaveBeenCalledWith('# Other');
    expect(state.getState()).toMatchObject({
      currentFile: { name: 'other.md', path: 'E:/docs/other.md' },
      dirty: false,
    });
  });

  it('does not discard edits made after an explicit dirty open begins', async () => {
    const pendingRead = createDeferred<CommandResult<{
      byteLength: number;
      fingerprint: string;
      path: string;
      text: string;
    }>>();
    let editorText = '# Current\n\nUnsaved';
    const loadDocument = vi.fn((text: string) => {
      editorText = text;
    });
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
      dirty: true,
      dirtyRevision: 3,
    });
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
            focus: vi.fn(),
            getText: () => editorText,
            loadText: loadDocument,
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

    const pendingOpen = workflowRef.current?.openPathAfterDiscard(
      'E:/docs/other.md',
    );
    editorText = '# Current\n\nNew IME input';
    state.setDirty(true);

    await act(async () => {
      pendingRead.resolve({
        data: {
          byteLength: 7,
          fingerprint: 'sha256:other',
          path: 'E:/docs/other.md',
          text: '# Other',
        },
        ok: true,
      });
      await expect(pendingOpen).resolves.toEqual({ status: 'superseded' });
    });

    expect(loadDocument).not.toHaveBeenCalled();
    expect(editorText).toBe('# Current\n\nNew IME input');
    expect(state.getState()).toMatchObject({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
      dirty: true,
      dirtyRevision: 4,
    });
  });

  it('does not apply a pending open after the current document changes', async () => {
    const pendingRead = createDeferred<CommandResult<{
      byteLength: number;
      path: string;
      text: string;
    }>>();
    let editorText = '# Current';
    const loadDocument = vi.fn((text: string) => {
      editorText = text;
    });
    const addRecentFile = vi.fn();
    const onDocumentLoaded = vi.fn();
    const onDocumentBecameSafe = vi.fn();
    const fileWatch = createFileWatchClient();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
      dirty: false,
      dirtyRevision: 7,
    });
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
            focus: vi.fn(),
            getText: () => editorText,
            loadText: loadDocument,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        fileWatch={fileWatch}
        onDocumentBecameSafe={onDocumentBecameSafe}
        onDocumentLoaded={onDocumentLoaded}
        onWorkflow={(value) => {
          workflowRef.current = value;
        }}
        recentFiles={{ addRecentFile }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );
    const workflow = workflowRef.current;
    if (!workflow) {
      throw new Error('File workflow was not initialized.');
    }

    const pendingOpen = workflow.openPath('E:/docs/other.md');
    editorText = '# Current\n\nNew IME input';
    state.setDirty(true);
    let outcome: Awaited<typeof pendingOpen> | undefined;
    await act(async () => {
      pendingRead.resolve({
        ok: true,
        data: {
          byteLength: 7,
          path: 'E:/docs/other.md',
          text: '# Other',
        },
      });
      outcome = await pendingOpen;
    });

    expect(outcome).toEqual({ status: 'superseded' });
    expect(loadDocument).not.toHaveBeenCalled();
    expect(editorText).toBe('# Current\n\nNew IME input');
    expect(state.getState()).toMatchObject({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
      dirty: true,
      dirtyRevision: 8,
    });
    expect(addRecentFile).not.toHaveBeenCalled();
    expect(fileWatch.watchDocument).not.toHaveBeenCalled();
    expect(onDocumentLoaded).not.toHaveBeenCalled();
    expect(onDocumentBecameSafe).not.toHaveBeenCalled();
    expect(workflowRef.current?.fileOpening).toBe(false);
  });

  it('starts the claimed read while reserving and commits ownership before applying the document', async () => {
    const sequence: string[] = [];
    const documentClaims = {
      beginSession: vi.fn(async () => {
        sequence.push('begin');
        return {
          data: { sessionGeneration: 1, status: 'began' as const },
          ok: true as const,
        };
      }),
      commitReservation: vi.fn(async () => {
        sequence.push('commit');
        return {
          data: { status: 'committed' as const },
          ok: true as const,
        };
      }),
      focusWindow: vi.fn(async () => ({
        data: { status: 'focused' as const },
        ok: true as const,
      })),
      releaseOwnedDocument: vi.fn(async () => ({
        data: { status: 'released' as const },
        ok: true as const,
      })),
      releaseReservation: vi.fn(async () => ({
        data: { status: 'released' as const },
        ok: true as const,
      })),
      releaseSession: vi.fn(async () => ({
        data: { releasedReservations: 0, status: 'released' as const },
        ok: true as const,
      })),
      readTextClaimed: vi.fn(async (_operationId: number, path: string) => {
        sequence.push('read');
        return {
          data: { byteLength: 6, path, text: '# Next' },
          ok: true as const,
        };
      }),
      reserveDocument: vi.fn(async () => {
        sequence.push('reserve');
        return { data: { status: 'reserved' as const }, ok: true as const };
      }),
      takeoverSession: vi.fn(async () => ({
        data: {
          releasedReservations: 0,
          sessionGeneration: 2,
          status: 'takenOver' as const,
        },
        ok: true as const,
      })),
      writeTextClaimed: vi.fn(),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient();

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText: vi.fn(() => sequence.push('apply')),
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

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(sequence.filter((step) => step !== 'read')).toEqual([
      'begin',
      'reserve',
      'commit',
      'apply',
    ]);
    expect(sequence.indexOf('read')).toBeGreaterThan(sequence.indexOf('begin'));
    expect(sequence.indexOf('read')).toBeLessThan(sequence.indexOf('commit'));
    expect(documentClaims.commitReservation).toHaveBeenCalledWith(
      1,
      'E:/docs/next.md',
    );
  });

  it('adopts a committed open path fail-closed when applying it throws', async () => {
    const fileWatch = createFileWatchClient();
    const markUnsaved = vi.fn();
    const writeText = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
      writeText,
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Current',
            loadText: vi.fn(() => {
              throw new Error('editor load failed');
            }),
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

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toEqual({ status: 'failed' });

    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/docs/next.md' },
      dirty: true,
      lastFileError: { code: 'document_claim.open_apply_failed' },
    });
    expect(markUnsaved).toHaveBeenCalled();
    expect(fileWatch.watchDocument).not.toHaveBeenCalled();

    await act(async () => {
      await workflowRef.current?.save();
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('retries a lost reserve response with the same operation tuple', async () => {
    const reserveDocument = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'ipc.response_lost',
          message: 'The reserve response was lost.',
          recoverable: true,
        },
        ok: false,
      })
      .mockResolvedValueOnce({
        data: { status: 'reserved' as const },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      reserveDocument,
    } satisfies DocumentClaimClient;
    const readText = vi.fn(async (path: string) => ({
      data: { byteLength: 6, path, text: '# Next' },
      ok: true as const,
    }));
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ readText });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Current',
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
        state={createState()}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(reserveDocument).toHaveBeenCalledTimes(2);
    expect(reserveDocument.mock.calls[1]).toEqual(reserveDocument.mock.calls[0]);
    expect(readText).toHaveBeenCalledWith('E:/docs/next.md');
  });

  it('fails closed when a lost reserve response cannot be reconciled', async () => {
    const reserveError = {
      code: 'ipc.response_lost',
      message: 'The reserve response was lost.',
      recoverable: true,
    };
    const releaseError = {
      code: 'ipc.release_response_lost',
      message: 'The release response was lost.',
      recoverable: true,
    };
    const reserveDocument = vi.fn().mockResolvedValue({
      error: reserveError,
      ok: false,
    });
    const releaseReservation = vi.fn().mockResolvedValue({
      error: releaseError,
      ok: false,
    });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseReservation,
      reserveDocument,
    } satisfies DocumentClaimClient;
    const readText = vi.fn();
    const loadText = vi.fn();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({ readText });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const state = createState();

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Current',
            loadText,
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

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toEqual({ status: 'failed' });
    await expect(
      workflowRef.current?.openPath('E:/docs/other.md'),
    ).resolves.toEqual({ status: 'failed' });

    expect(reserveDocument).toHaveBeenCalledTimes(2);
    expect(reserveDocument.mock.calls[1]).toEqual(reserveDocument.mock.calls[0]);
    expect(releaseReservation).toHaveBeenCalledTimes(2);
    expect(releaseReservation).toHaveBeenNthCalledWith(
      1,
      reserveDocument.mock.calls[0]![0].operationId,
      'E:/docs/next.md',
    );
    expect(loadText).not.toHaveBeenCalled();
    expect(state.getState().lastFileError).toEqual(releaseError);
  });

  it('locks editor input across the claim commit and document apply boundary', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(() => pendingCommit.promise),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    let transitionLocked = false;
    const setTransitionLocked = vi.fn((locked: boolean) => {
      transitionLocked = locked;
    });
    const loadText = vi.fn(() => {
      expect(transitionLocked).toBe(true);
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const pendingOpen = workflowRef.current?.openPath('E:/docs/next.md');
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalledTimes(1),
    );
    expect(transitionLocked).toBe(true);
    expect(loadText).not.toHaveBeenCalled();

    await act(async () => {
      pendingCommit.resolve({
        data: { status: 'committed' },
        ok: true,
      });
      await pendingOpen;
    });

    expect(loadText).toHaveBeenCalledTimes(1);
    expect(setTransitionLocked.mock.calls).toEqual([[true], [false]]);
    expect(transitionLocked).toBe(false);
  });

  it('retries and contains a transition unlock exception without skipping terminal cleanup', async () => {
    const releaseReservation = vi.fn(
      createTestDocumentClaimClient().releaseReservation,
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseReservation,
    } satisfies DocumentClaimClient;
    const setTransitionLocked = vi.fn((locked: boolean) => {
      if (!locked && setTransitionLocked.mock.calls.length === 2) {
        throw new Error('first unlock failed');
      }
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const state = createState();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Current',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toMatchObject({ status: 'opened' });

    expect(setTransitionLocked.mock.calls).toEqual([
      [true],
      [false],
      [false],
    ]);
    expect(releaseReservation).not.toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/docs/next.md' },
    });
  });

  it('releases a stale reservation even when every transition unlock attempt fails', async () => {
    const releaseReservation = vi.fn(
      createTestDocumentClaimClient().releaseReservation,
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseReservation,
    } satisfies DocumentClaimClient;
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    const setTransitionLocked = vi.fn((locked: boolean) => {
      if (locked) {
        workflowRef.current?.supersedePendingOpen();
        return;
      }
      throw new Error('unlock remains unavailable');
    });
    const state = createState();
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Current',
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toEqual({ status: 'superseded' });

    expect(releaseReservation).toHaveBeenCalledWith(1, 'E:/docs/next.md');
    expect(setTransitionLocked.mock.calls).toEqual([
      [true],
      [false],
      [false],
    ]);
    expect(state.getState().lastFileError).toMatchObject({
      code: 'document_claim.transition_unlock_failed',
    });
    expect(state.getState().currentFile).toBeNull();
  });

  it('unlocks editor input before waiting for the document watcher', async () => {
    const pendingWatch = createDeferred<
      Awaited<ReturnType<FileWatchClient['watchDocument']>>
    >();
    const fileWatch = createFileWatchClient({
      watchDocument: vi.fn(() => pendingWatch.promise),
    });
    let transitionLocked = false;
    const setTransitionLocked = vi.fn((locked: boolean) => {
      transitionLocked = locked;
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText: vi.fn(),
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
            setTransitionLocked,
          },
        }}
        fileWatch={fileWatch}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={createState({
          currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
        })}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const pendingOpen = workflowRef.current?.openPath('E:/docs/next.md');
    await waitFor(() => expect(fileWatch.watchDocument).toHaveBeenCalledTimes(1));
    expect(transitionLocked).toBe(false);

    await act(async () => {
      pendingWatch.resolve({ data: undefined, ok: true });
      await pendingOpen;
    });
    expect(setTransitionLocked.mock.calls).toEqual([[true], [false]]);
  });

  it('reports an applied open as opened when the user edits it while the watcher starts', async () => {
    const pendingWatch = createDeferred<
      Awaited<ReturnType<FileWatchClient['watchDocument']>>
    >();
    const fileWatch = createFileWatchClient({
      watchDocument: vi.fn(() => pendingWatch.promise),
    });
    const onDocumentBecameSafe = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    let editorText = '# Current';
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => editorText,
            loadText: vi.fn((text: string) => {
              editorText = text;
            }),
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

    const pendingOpen = workflowRef.current?.openPath('E:/docs/next.md');
    await waitFor(() => expect(fileWatch.watchDocument).toHaveBeenCalledTimes(1));

    editorText = '# Next\n\nUser input';
    state.setDirty(true);

    let outcome: Awaited<ReturnType<FileWorkflow['openPath']>> | undefined;
    await act(async () => {
      pendingWatch.resolve({ data: undefined, ok: true });
      outcome = await pendingOpen;
    });

    expect(outcome).toMatchObject({
      file: { path: 'E:/docs/next.md' },
      status: 'opened',
    });
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/docs/next.md' },
      dirty: true,
    });
    expect(onDocumentBecameSafe).not.toHaveBeenCalled();
  });

  it('replays an already-owned document into an empty WebView after reload', async () => {
    const commitReservation = vi.fn();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation,
      reserveDocument: vi.fn(async () => ({
        data: { status: 'alreadyOwned' as const },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const loadText = vi.fn();
    const state = createState();
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 9, path, text: '# Reloaded' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => ''),
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/docs/reloaded.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(loadText).toHaveBeenCalledWith('# Reloaded');
    expect(commitReservation).not.toHaveBeenCalled();
    expect(state.getState().currentFile?.path).toBe('E:/docs/reloaded.md');
  });

  it('applies a committed open when the commit response was lost', async () => {
    const releaseReservation = vi.fn(async () => ({
      data: { status: 'alreadyCommitted' as const },
      ok: true as const,
    }));
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: {
          code: 'tauri.invoke_failed',
          message: 'The commit response was lost.',
          recoverable: true,
        },
        ok: false as const,
      })),
      releaseReservation,
    } satisfies DocumentClaimClient;
    const loadText = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(releaseReservation).toHaveBeenCalledWith(1, 'E:/docs/next.md');
    expect(loadText).toHaveBeenCalledTimes(1);
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/docs/next.md' },
      lastFileError: null,
    });
  });

  it('adopts an open target fail-closed when commit and release outcomes remain unknown', async () => {
    const transportError = {
      code: 'tauri.invoke_failed',
      message: 'The open ownership outcome remained unknown.',
      recoverable: true,
    };
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: transportError,
        ok: false as const,
      })),
      readTextClaimed: vi.fn(async (_operationId: number, path: string) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
      releaseReservation: vi.fn(async () => ({
        error: transportError,
        ok: false as const,
      })),
    } satisfies DocumentClaimClient;
    const loadText = vi.fn();
    const markUnsaved = vi.fn();
    const setContext = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: () => '# Current',
            loadText,
            markSaved: vi.fn(),
            markUnsaved,
            setContext,
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toEqual({ status: 'failed' });

    expect(loadText).not.toHaveBeenCalled();
    expect(setContext).toHaveBeenLastCalledWith({ path: 'E:/docs/next.md' });
    expect(markUnsaved).toHaveBeenCalled();
    expect(state.getState()).toMatchObject({
      currentFile: { path: 'E:/docs/next.md' },
      dirty: true,
      lastFileError: transportError,
    });
    expect(
      getDocumentClaimOwnedOperation(
        resolveDocumentClaimWorkflowRuntime(documentClaims),
      ),
    ).toEqual({ operationId: 1, path: 'E:/docs/next.md' });
  });

  it('applies a committed open after a lost commit and one failed terminal reconciliation', async () => {
    const invokeError = {
      code: 'tauri.invoke_failed',
      message: 'The native response was lost.',
      recoverable: true,
    };
    const releaseReservation = vi
      .fn<DocumentClaimClient['releaseReservation']>()
      .mockResolvedValueOnce({ error: invokeError, ok: false })
      .mockResolvedValueOnce({
        data: { status: 'alreadyCommitted' },
        ok: true,
      });
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(async () => ({
        error: invokeError,
        ok: false as const,
      })),
      releaseReservation,
    } satisfies DocumentClaimClient;
    const loadText = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(releaseReservation).toHaveBeenCalledTimes(2);
    expect(loadText).toHaveBeenCalledTimes(1);
    expect(state.getState().currentFile?.path).toBe('E:/docs/next.md');
  });

  it('does not supersede an open after native ownership commits', async () => {
    const pendingCommit = createDeferred<
      Awaited<ReturnType<DocumentClaimClient['commitReservation']>>
    >();
    let ownedPath: string | null = 'E:/docs/current.md';
    const releaseOwnedDocument = vi.fn(
      async (path: string) => {
        if (ownedPath === path) {
          ownedPath = null;
        }
        return { data: { status: 'released' as const }, ok: true as const };
      },
    );
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn((_: number, path: string) => {
        ownedPath = path;
        return pendingCommit.promise;
      }),
      releaseOwnedDocument,
    } satisfies DocumentClaimClient;
    const loadText = vi.fn();
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText,
            markSaved: vi.fn(),
            markUnsaved: vi.fn(),
            setContext: vi.fn(),
          },
        }}
        onWorkflow={(workflow) => {
          workflowRef.current = workflow;
        }}
        recentFiles={{ addRecentFile: vi.fn() }}
        state={state}
        status={{ setStatusKey: vi.fn() }}
      />,
    );

    const pendingOpen = workflowRef.current?.openPath('E:/docs/next.md');
    await waitFor(() =>
      expect(documentClaims.commitReservation).toHaveBeenCalledTimes(1),
    );

    workflowRef.current?.supersedePendingOpen();
    let outcome: Awaited<ReturnType<FileWorkflow['openPath']>> | undefined;
    await act(async () => {
      pendingCommit.resolve({
        data: { status: 'committed' },
        ok: true,
      });
      outcome = await pendingOpen;
    });

    expect(outcome).toMatchObject({ status: 'opened' });
    expect(releaseOwnedDocument).not.toHaveBeenCalled();
    expect(loadText).toHaveBeenCalledTimes(1);
    expect(state.getState().currentFile?.path).toBe('E:/docs/next.md');
    expect(ownedPath).toBe('E:/docs/next.md');
  });

  it('performs one generation-fenced takeover before opening after a WebView reload', async () => {
    const sequence: string[] = [];
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      beginSession: vi.fn(async () => {
        sequence.push('begin');
        return {
          error: {
            code: 'document_claim.session_already_active',
            details: { activeGeneration: 5 },
            message: 'Another document claim session is already active.',
            recoverable: true,
          },
          ok: false as const,
        };
      }),
      reserveDocument: vi.fn(async () => {
        sequence.push('reserve');
        return { data: { status: 'reserved' as const }, ok: true as const };
      }),
      takeoverSession: vi.fn(async (expectedActiveGeneration: number) => {
        sequence.push(`takeover:${expectedActiveGeneration}`);
        return {
          data: {
            releasedReservations: 1,
            sessionGeneration: 6,
            status: 'takenOver' as const,
          },
          ok: true as const,
        };
      }),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => ({
        data: { byteLength: 6, path, text: '# Next' },
        ok: true as const,
      })),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
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

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toMatchObject({ status: 'opened' });
    expect(sequence.slice(0, 3)).toEqual(['begin', 'takeover:5', 'reserve']);
    expect(documentClaims.takeoverSession).toHaveBeenCalledTimes(1);
  });

  it('claims the selected open-dialog path before reading or applying it', async () => {
    const sequence: string[] = [];
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      beginSession: vi.fn(async () => {
        sequence.push('begin');
        return {
          data: { sessionGeneration: 1, status: 'began' as const },
          ok: true as const,
        };
      }),
      commitReservation: vi.fn(async () => {
        sequence.push('commit');
        return {
          data: { status: 'committed' as const },
          ok: true as const,
        };
      }),
      reserveDocument: vi.fn(async () => {
        sequence.push('reserve');
        return { data: { status: 'reserved' as const }, ok: true as const };
      }),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText: vi.fn(async (path) => {
        sequence.push('read');
        return {
          data: { byteLength: 6, path, text: '# Next' },
          ok: true as const,
        };
      }),
      showOpenDialog: vi.fn(async () => {
        sequence.push('select');
        return { data: 'E:/docs/next.md', ok: true as const };
      }),
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText: vi.fn(() => sequence.push('apply')),
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

    await expect(workflowRef.current?.openFromDialog()).resolves.toMatchObject({
      status: 'opened',
    });
    expect(sequence.filter((step) => step !== 'read')).toEqual([
      'begin',
      'select',
      'reserve',
      'commit',
      'apply',
    ]);
    expect(sequence.indexOf('read')).toBeGreaterThan(sequence.indexOf('select'));
    expect(sequence.indexOf('read')).toBeLessThan(sequence.indexOf('commit'));
  });

  it('does not apply a document after the claim operation was already released', async () => {
    const readText = vi.fn(async (path: string) => ({
      data: { byteLength: 6, path, text: '# Next' },
      ok: true as const,
    }));
    const loadText = vi.fn();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      releaseReservation: vi.fn(async () => ({
        data: { status: 'released' as const },
        ok: true as const,
      })),
      reserveDocument: vi.fn(async () => ({
        data: { status: 'alreadyReleased' as const },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText,
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText,
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

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toEqual({ status: 'superseded' });
    expect(loadText).not.toHaveBeenCalled();
    expect(documentClaims.releaseReservation).not.toHaveBeenCalled();
  });

  it('does not apply, commit, or release another operation when a document claim is already pending', async () => {
    const readText = vi.fn();
    const loadText = vi.fn();
    const documentClaims = {
      ...createTestDocumentClaimClient(),
      commitReservation: vi.fn(),
      releaseReservation: vi.fn(async () => ({
        data: { status: 'released' as const },
        ok: true as const,
      })),
      reserveDocument: vi.fn(async () => ({
        data: { status: 'alreadyPending' as const },
        ok: true as const,
      })),
    } satisfies DocumentClaimClient;
    const state = createState({
      currentFile: { name: 'current.md', path: 'E:/docs/current.md' },
    });
    const workflowRef: { current: FileWorkflow | null } = { current: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = createFileCommandClient({
      readText,
    });

    render(
      <WorkflowHarness
        documentClaims={documentClaims}
        editorRef={{
          current: {
            focus: vi.fn(),
            getText: vi.fn(() => '# Current'),
            loadText,
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

    await expect(
      workflowRef.current?.openPath('E:/docs/next.md'),
    ).resolves.toEqual({ status: 'superseded' });
    expect(loadText).not.toHaveBeenCalled();
    expect(documentClaims.commitReservation).not.toHaveBeenCalled();
    expect(documentClaims.releaseReservation).not.toHaveBeenCalled();
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

    await act(async () => {
      await workflowRef.current?.createNewDocument();
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

    await waitFor(() =>
      expect(writes).toEqual(['# Older snapshot', '# Latest snapshot']),
    );

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
      dirty: false,
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
