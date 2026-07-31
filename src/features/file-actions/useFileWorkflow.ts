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
import {
  resolveFileWatchClient,
  type FileWatchChangeEvent,
  type FileWatchClient,
} from '../../services/file-watch/fileWatchClient';
import {
  useExternalFileWatch,
  type ExternalFileConflict,
} from './useExternalFileWatch';

export type { ExternalFileConflict } from './useExternalFileWatch';

export type FileWorkflow = {
  createNewDocument: () => void;
  externalConflict: ExternalFileConflict | null;
  fileOpening: boolean;
  keepCurrentContent: () => void;
  markDocumentDirty: (dirty: boolean) => void;
  openFromDialog: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  reloadFromDisk: () => Promise<void>;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
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
  onDocumentBecameSafe?: () => void;
  prepareTextForSave?: (path: string, text: string) => Promise<string>;
  recentFiles: RecentFilesAdapter;
  state: FileActionStateAdapter;
  status: StatusAdapter;
};

export function useFileWorkflow({
  editorReady,
  editorRef,
  fileWatch = resolveFileWatchClient(),
  onLocalImageChanged = () => undefined,
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
    if (fileOpeningRef.current) {
      return;
    }

    const requestId = ++operationIdRef.current;
    const isCurrentRequest = () => requestId === operationIdRef.current;
    fileOpeningRef.current = true;
    setFileOpening(true);
    status.setStatusKey('status.opening');
    try {
      await waitForEditor();

      if (!isCurrentRequest()) {
        return;
      }

      const actions = createActions(isCurrentRequest);

      if (!actions) {
        return;
      }

      const result = await actions.openFileFromDialog();

      if (!isCurrentRequest()) {
        return;
      }

      if (result.ok && result.data) {
        await replaceWatchedDocument(
          result.data.path,
          result.data.fingerprint,
        );
        if (!isCurrentRequest()) {
          return;
        }
        onDocumentBecameSafe();
        status.setStatusKey('status.opened');
      } else if (!result.ok) {
        status.setStatusKey('status.openFailed');
      } else {
        status.setStatusKey('status.ready');
      }
    } finally {
      if (isCurrentRequest()) {
        fileOpeningRef.current = false;
        setFileOpening(false);
      }
    }
  }, [
    createActions,
    onDocumentBecameSafe,
    replaceWatchedDocument,
    status,
    waitForEditor,
  ]);

  const openPath = useCallback(
    async (path: string) => {
      const requestId = ++operationIdRef.current;
      const isCurrentRequest = () => requestId === operationIdRef.current;
      fileOpeningRef.current = true;
      setFileOpening(true);
      status.setStatusKey('status.opening');
      try {
        await waitForEditor();

        if (!isCurrentRequest()) {
          return;
        }

        const actions = createActions(isCurrentRequest);

        if (!actions) {
          return;
        }

        const result = await actions.openFile(path);

        if (!isCurrentRequest()) {
          return;
        }

        if (result.ok) {
          await replaceWatchedDocument(
            result.data.path,
            result.data.fingerprint,
          );
          if (!isCurrentRequest()) {
            return;
          }
          onDocumentBecameSafe();
          status.setStatusKey('status.opened');
        } else {
          status.setStatusKey('status.openFailed');
        }
      } finally {
        if (isCurrentRequest()) {
          fileOpeningRef.current = false;
          setFileOpening(false);
        }
      }
    },
    [
      createActions,
      onDocumentBecameSafe,
      replaceWatchedDocument,
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
      void replaceWatchedDocument(null);
      onDocumentBecameSafe();
    }
    status.setStatusKey('status.ready');
  }, [createActions, onDocumentBecameSafe, replaceWatchedDocument, status]);

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

  return {
    createNewDocument,
    externalConflict,
    fileOpening,
    keepCurrentContent,
    markDocumentDirty,
    openFromDialog,
    openPath,
    reloadFromDisk,
    save,
    saveAs,
  };
}
