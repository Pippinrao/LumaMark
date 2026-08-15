import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import { resolveFileCommandClient } from '../../services/files/fileCommandClient';
import {
  createFileActions,
  type FileActionStateAdapter,
} from './fileActions';
import type { RecentFileInput } from '../recent-files/recentFilesStore';
import type { FileMetadata } from '../../services/files/fileTypes';
import {
  resolveFileWatchClient,
  type FileWatchChangeEvent,
  type FileWatchClient,
} from '../../services/file-watch/fileWatchClient';
import {
  useExternalFileWatch,
  areWatchedPathsEqual,
  type ExternalFileConflict,
} from './useExternalFileWatch';

export type { ExternalFileConflict } from './useExternalFileWatch';

export type OpenDocumentOutcome =
  | { file: FileMetadata; status: 'opened' }
  | { status: 'cancelled' | 'failed' | 'superseded' };

export type FileWorkflow = {
  createNewDocument: () => void;
  externalConflict: ExternalFileConflict | null;
  fileOpening: boolean;
  keepCurrentContent: () => void;
  markDocumentDirty: (dirty: boolean) => void;
  markOpenDocumentRemoved: (path: string) => void;
  openFromDialog: () => Promise<OpenDocumentOutcome>;
  openPath: (path: string) => Promise<OpenDocumentOutcome>;
  reloadFromDisk: () => Promise<void>;
  retargetOpenDocument: (path: string) => Promise<void>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  supersedePendingOpen: () => void;
};

export type StatusAdapter = {
  setStatusKey: (statusKey: string) => void;
};

export type RecentFilesAdapter = {
  addRecentFile: (file: RecentFileInput) => void;
};

export type UseFileWorkflowOptions = {
  editorReady: boolean;
  editorRef: RefObject<EditorDocumentPort | null>;
  fileWatch?: FileWatchClient;
  onLocalImageChanged?: (event: FileWatchChangeEvent) => void;
  onDocumentLoaded?: () => void;
  onDocumentBecameSafe?: () => void;
  prepareTextForSave?: (path: string, text: string) => Promise<string>;
  recentFiles: RecentFilesAdapter;
  state: FileActionStateAdapter;
  status: StatusAdapter;
};

type DocumentOpenBaseline = {
  currentDocumentPath: string | null;
  dirtyRevision: number;
  snapshot: ReturnType<EditorDocumentPort['captureSnapshot']>;
};

function captureDocumentOpenBaseline(
  editor: EditorDocumentPort,
  state: FileActionStateAdapter,
): DocumentOpenBaseline | null {
  const current = state.getState();
  if (current.dirty) {
    return null;
  }

  return {
    currentDocumentPath: current.currentFile?.path ?? null,
    dirtyRevision: current.dirtyRevision,
    snapshot: editor.captureSnapshot(),
  };
}

function isDocumentOpenBaselineCurrent(
  baseline: DocumentOpenBaseline,
  editor: EditorDocumentPort,
  state: FileActionStateAdapter,
): boolean {
  const current = state.getState();
  const currentPath = current.currentFile?.path ?? null;
  const samePath =
    baseline.currentDocumentPath === null || currentPath === null
      ? baseline.currentDocumentPath === currentPath
      : areWatchedPathsEqual(baseline.currentDocumentPath, currentPath);

  return (
    !current.dirty &&
    current.dirtyRevision === baseline.dirtyRevision &&
    samePath &&
    editor.isSnapshotCurrent(baseline.snapshot)
  );
}

export function useFileWorkflow({
  editorReady,
  editorRef,
  fileWatch = resolveFileWatchClient(),
  onLocalImageChanged = () => undefined,
  onDocumentLoaded = () => undefined,
  onDocumentBecameSafe = () => undefined,
  prepareTextForSave,
  recentFiles,
  state,
  status,
}: UseFileWorkflowOptions): FileWorkflow {
  const [fileOpening, setFileOpening] = useState(false);
  const fileOpeningRef = useRef(false);
  const operationIdRef = useRef(0);
  const activeSaveRef = useRef<Promise<void> | null>(null);
  const editorReadyWaitersRef = useRef(new Set<() => void>());

  useEffect(() => {
    if (!editorReady || !editorRef.current) {
      return;
    }

    for (const resolve of editorReadyWaitersRef.current) {
      resolve();
    }
    editorReadyWaitersRef.current.clear();
  }, [editorReady, editorRef]);

  useEffect(() => {
    const waiters = editorReadyWaitersRef.current;

    return () => {
      operationIdRef.current += 1;
      fileOpeningRef.current = false;

      for (const resolve of waiters) {
        resolve();
      }
      waiters.clear();
    };
  }, []);

  const waitForEditor = useCallback(() => {
    if (editorRef.current) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      editorReadyWaitersRef.current.add(resolve);
    });
  }, [editorRef]);

  const enqueueSave = useCallback((operation: () => Promise<void>) => {
    const activeSave = activeSaveRef.current;
    const nextSave = activeSave
      ? activeSave.then(operation, operation)
      : operation();
    activeSaveRef.current = nextSave;
    const clearActiveSave = () => {
      if (activeSaveRef.current === nextSave) {
        activeSaveRef.current = null;
      }
    };
    void nextSave.then(clearActiveSave, clearActiveSave);

    return nextSave;
  }, []);

  const markDocumentDirty = useCallback((dirty: boolean) => {
    state.setDirty(dirty);
  }, [state]);

  const externalFileWatch = useExternalFileWatch({
    editorRef,
    fileWatch,
    onDocumentBecameSafe,
    onLocalImageChanged,
    state,
    status,
  });
  const {
    conflict: externalConflict,
    keepCurrentContent,
    reloadFromDisk,
    replaceWatchedDocument,
  } = externalFileWatch;

  const createActions = useCallback((
    shouldApplyOpenResult?: () => boolean,
    shouldApplySaveResult?: () => boolean,
  ) => {
    const editor = editorRef.current;

    if (!editor) {
      return null;
    }

    return createFileActions({
      commands: resolveFileCommandClient(),
      editor: {
        captureDocumentSnapshot: editor.captureSnapshot,
        focus: editor.focus,
        isDocumentSnapshotCurrent: editor.isSnapshotCurrent,
        loadDocument: editor.loadText,
        markDocumentSaved: editor.markSaved,
        markDocumentUnsaved: editor.markUnsaved,
        setDocumentContext: editor.setContext,
      },
      recentFiles,
      prepareTextForSave,
      shouldApplyOpenResult,
      shouldApplySaveResult,
      state,
    });
  }, [editorRef, prepareTextForSave, recentFiles, state]);

  const openFromDialog = useCallback(async () => {
    if (fileOpeningRef.current || state.getState().dirty) {
      return { status: 'superseded' } as const;
    }

    const requestId = ++operationIdRef.current;
    const ownsRequest = () => requestId === operationIdRef.current;
    let baseline: DocumentOpenBaseline | null = null;
    let openResultWasCurrent = false;
    const isCurrentRequest = () => {
      const editor = editorRef.current;
      return Boolean(
        ownsRequest() &&
        baseline &&
        editor &&
        isDocumentOpenBaselineCurrent(baseline, editor, state),
      );
    };
    const shouldApplyOpenResult = () => {
      const current = isCurrentRequest();
      openResultWasCurrent = current;
      return current;
    };
    fileOpeningRef.current = true;
    setFileOpening(true);
    status.setStatusKey('status.opening');
    try {
      await waitForEditor();

      if (!ownsRequest()) {
        return { status: 'superseded' } as const;
      }

      const editor = editorRef.current;
      baseline = editor ? captureDocumentOpenBaseline(editor, state) : null;
      if (!baseline) {
        return { status: 'superseded' } as const;
      }

      const actions = createActions(shouldApplyOpenResult);

      if (!actions) {
        return { status: 'superseded' } as const;
      }

      const result = await actions.openFileFromDialog();

      if (result.ok && result.data) {
        if (!ownsRequest() || !openResultWasCurrent) {
          return { status: 'superseded' } as const;
        }
        const appliedBaseline = editorRef.current
          ? captureDocumentOpenBaseline(editorRef.current, state)
          : null;
        if (!appliedBaseline) {
          return { status: 'superseded' } as const;
        }
        onDocumentLoaded();
        await replaceWatchedDocument(
          result.data.path,
          result.data.fingerprint,
        );
        if (
          !ownsRequest() ||
          !editorRef.current ||
          !isDocumentOpenBaselineCurrent(
            appliedBaseline,
            editorRef.current,
            state,
          )
        ) {
          return { status: 'superseded' } as const;
        }
        onDocumentBecameSafe();
        status.setStatusKey('status.opened');
        const file = state.getState().currentFile;
        return file
          ? { file, status: 'opened' } as const
          : { status: 'failed' } as const;
      } else if (!result.ok) {
        if (!ownsRequest() || !openResultWasCurrent) {
          return { status: 'superseded' } as const;
        }
        status.setStatusKey('status.openFailed');
        return { status: 'failed' } as const;
      } else {
        if (!isCurrentRequest()) {
          return { status: 'superseded' } as const;
        }
        status.setStatusKey('status.ready');
        return { status: 'cancelled' } as const;
      }
    } finally {
      if (ownsRequest()) {
        fileOpeningRef.current = false;
        setFileOpening(false);
      }
    }
  }, [
    createActions,
    editorRef,
    onDocumentBecameSafe,
    onDocumentLoaded,
    replaceWatchedDocument,
    state,
    status,
    waitForEditor,
  ]);

  const openPath = useCallback(
    async (path: string) => {
      if (state.getState().dirty) {
        return { status: 'superseded' } as const;
      }

      const requestId = ++operationIdRef.current;
      const ownsRequest = () => requestId === operationIdRef.current;
      let baseline: DocumentOpenBaseline | null = null;
      let openResultWasCurrent = false;
      const isCurrentRequest = () => {
        const editor = editorRef.current;
        return Boolean(
          ownsRequest() &&
          baseline &&
          editor &&
          isDocumentOpenBaselineCurrent(baseline, editor, state),
        );
      };
      const shouldApplyOpenResult = () => {
        const current = isCurrentRequest();
        openResultWasCurrent = current;
        return current;
      };
      fileOpeningRef.current = true;
      setFileOpening(true);
      status.setStatusKey('status.opening');
      try {
        await waitForEditor();

        if (!ownsRequest()) {
          return { status: 'superseded' } as const;
        }

        const editor = editorRef.current;
        baseline = editor ? captureDocumentOpenBaseline(editor, state) : null;
        if (!baseline) {
          return { status: 'superseded' } as const;
        }

        const actions = createActions(shouldApplyOpenResult);

        if (!actions) {
          return { status: 'superseded' } as const;
        }

        const result = await actions.openFile(path);

        if (!ownsRequest() || !openResultWasCurrent) {
          return { status: 'superseded' } as const;
        }

        if (result.ok) {
          const appliedBaseline = editorRef.current
            ? captureDocumentOpenBaseline(editorRef.current, state)
            : null;
          if (!appliedBaseline) {
            return { status: 'superseded' } as const;
          }
          onDocumentLoaded();
          await replaceWatchedDocument(
            result.data.path,
            result.data.fingerprint,
          );
          if (
            !ownsRequest() ||
            !editorRef.current ||
            !isDocumentOpenBaselineCurrent(
              appliedBaseline,
              editorRef.current,
              state,
            )
          ) {
            return { status: 'superseded' } as const;
          }
          onDocumentBecameSafe();
          status.setStatusKey('status.opened');
          const file = state.getState().currentFile;
          return file
            ? { file, status: 'opened' } as const
            : { status: 'failed' } as const;
        } else {
          status.setStatusKey('status.openFailed');
          return { status: 'failed' } as const;
        }
      } finally {
        if (ownsRequest()) {
          fileOpeningRef.current = false;
          setFileOpening(false);
        }
      }
    },
    [
      createActions,
      editorRef,
      onDocumentBecameSafe,
      onDocumentLoaded,
      replaceWatchedDocument,
      state,
      status,
      waitForEditor,
    ],
  );

  const createNewDocument = useCallback(() => {
    operationIdRef.current += 1;
    fileOpeningRef.current = false;
    setFileOpening(false);
    const actions = createActions();

    if (actions) {
      actions.createNewDocument();
      onDocumentLoaded();
      void replaceWatchedDocument(null);
      onDocumentBecameSafe();
    }
    status.setStatusKey('status.ready');
  }, [
    createActions,
    onDocumentBecameSafe,
    onDocumentLoaded,
    replaceWatchedDocument,
    status,
  ]);

  const supersedePendingOpen = useCallback(() => {
    if (!fileOpeningRef.current) {
      return;
    }

    operationIdRef.current += 1;
    fileOpeningRef.current = false;
    setFileOpening(false);
    status.setStatusKey('status.ready');
  }, [status]);

  const save = useCallback(() => {
    if (fileOpeningRef.current) {
      return Promise.resolve();
    }

    const requestId = operationIdRef.current;
    const isCurrentRequest = () => requestId === operationIdRef.current;
    return enqueueSave(async () => {
      if (!isCurrentRequest() || fileOpeningRef.current) {
        return;
      }

      const actions = createActions(undefined, isCurrentRequest);

      if (!actions) {
        return;
      }

      const result = state.getState().currentFile
        ? await actions.saveCurrentFile()
        : await actions.saveFileAs();

      if (!isCurrentRequest()) {
        return;
      }

      if (!result.ok) {
        status.setStatusKey('status.saveFailed');
        return;
      }

      const savedState = state.getState();
      if (result.data && !savedState.dirty) {
        const savedRevision = savedState.dirtyRevision;
        await replaceWatchedDocument(
          result.data.path,
          result.data.fingerprint,
        );
        if (!isCurrentRequest()) {
          return;
        }
        const watchedState = state.getState();
        if (
          watchedState.dirty ||
          watchedState.dirtyRevision !== savedRevision
        ) {
          return;
        }
        onDocumentBecameSafe();
        status.setStatusKey('status.saved');
      }
    });
  }, [
    createActions,
    enqueueSave,
    onDocumentBecameSafe,
    replaceWatchedDocument,
    state,
    status,
  ]);

  const saveAs = useCallback(() => {
    if (fileOpeningRef.current) {
      return Promise.resolve();
    }

    const requestId = operationIdRef.current;
    const isCurrentRequest = () => requestId === operationIdRef.current;
    return enqueueSave(async () => {
      if (!isCurrentRequest() || fileOpeningRef.current) {
        return;
      }

      const actions = createActions(undefined, isCurrentRequest);

      if (!actions) {
        return;
      }

      const result = await actions.saveFileAs();

      if (!isCurrentRequest()) {
        return;
      }

      if (!result.ok) {
        status.setStatusKey('status.saveFailed');
        return;
      }

      const savedState = state.getState();
      if (result.data && !savedState.dirty) {
        const savedRevision = savedState.dirtyRevision;
        await replaceWatchedDocument(
          result.data.path,
          result.data.fingerprint,
        );
        if (!isCurrentRequest()) {
          return;
        }
        const watchedState = state.getState();
        if (
          watchedState.dirty ||
          watchedState.dirtyRevision !== savedRevision
        ) {
          return;
        }
        onDocumentBecameSafe();
        status.setStatusKey('status.saved');
      }
    });
  }, [
    createActions,
    enqueueSave,
    onDocumentBecameSafe,
    replaceWatchedDocument,
    state,
    status,
  ]);

  const retargetOpenDocument = useCallback(
    async (path: string) => {
      const current = state.getState().currentFile;
      if (!current) {
        return;
      }

      const nextFile = {
        name: path.split(/[\\/]/).at(-1)?.trim() || path,
        path,
      };
      editorRef.current?.setContext?.({ path: nextFile.path });
      state.setCurrentFile(nextFile);
      await replaceWatchedDocument(nextFile.path);
    },
    [editorRef, replaceWatchedDocument, state],
  );

  const markOpenDocumentRemoved = useCallback(
    (path: string) => {
      const current = state.getState().currentFile;
      if (!current || !areWatchedPathsEqual(current.path, path)) {
        return;
      }

      editorRef.current?.markUnsaved();
      if (!state.getState().dirty) {
        state.setDirty(true);
      }
      state.setLastFileError({
        code: 'file.not_found',
        message: 'The watched document is no longer available on disk.',
        recoverable: true,
      });
    },
    [editorRef, state],
  );

  return {
    createNewDocument,
    externalConflict,
    fileOpening,
    keepCurrentContent,
    markDocumentDirty,
    markOpenDocumentRemoved,
    openFromDialog,
    openPath,
    reloadFromDisk,
    retargetOpenDocument,
    save,
    saveAs,
    supersedePendingOpen,
  };
}
