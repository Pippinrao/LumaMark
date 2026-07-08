import { useCallback, useState, type RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import { resolveFileCommandClient } from '../../services/files/fileCommandClient';
import {
  createFileActions,
  type FileActionStateAdapter,
} from './fileActions';
import type { RecentFileInput } from '../recent-files/recentFilesStore';

export type FileWorkflow = {
  fileOpening: boolean;
  markDocumentDirty: () => void;
  openFromDialog: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
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
  editorRef: RefObject<EditorDocumentPort | null>;
  recentFiles: RecentFilesAdapter;
  state: FileActionStateAdapter;
  status: StatusAdapter;
};

export function useFileWorkflow({
  editorRef,
  recentFiles,
  state,
  status,
}: UseFileWorkflowOptions): FileWorkflow {
  const [fileOpening, setFileOpening] = useState(false);

  const markDocumentDirty = useCallback(() => {
    const currentState = state.getState();

    if (!currentState.dirty) {
      state.setDirty(true);
    }
  }, [state]);

  const createActions = useCallback(() => {
    const editor = editorRef.current;

    if (!editor) {
      return null;
    }

    return createFileActions({
      commands: resolveFileCommandClient(),
      editor: {
        focus: editor.focus,
        getDocumentText: editor.getText,
        loadDocument: editor.loadText,
        setDocumentContext: editor.setContext,
      },
      recentFiles,
      state,
    });
  }, [editorRef, recentFiles, state]);

  const openFromDialog = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    setFileOpening(true);
    status.setStatusKey('status.opening');
    try {
      const result = await actions.openFileFromDialog();

      if (result.ok && result.data) {
        status.setStatusKey('status.opened');
      } else if (!result.ok) {
        status.setStatusKey('status.openFailed');
      } else {
        status.setStatusKey('status.ready');
      }
    } finally {
      setFileOpening(false);
    }
  }, [createActions, status]);

  const openPath = useCallback(
    async (path: string) => {
      const actions = createActions();

      if (!actions) {
      return;
    }

    setFileOpening(true);
      status.setStatusKey('status.opening');
      try {
        const result = await actions.openFile(path);

        if (result.ok) {
          status.setStatusKey('status.opened');
        } else {
          status.setStatusKey('status.openFailed');
        }
      } finally {
        setFileOpening(false);
      }
    },
    [createActions, status],
  );

  const save = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    const result = state.getState().currentFile
      ? await actions.saveCurrentFile()
      : await actions.saveFileAs();

    if (result.ok && result.data && !state.getState().dirty) {
      status.setStatusKey('status.saved');
    }
  }, [createActions, state, status]);

  const saveAs = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    const result = await actions.saveFileAs();

    if (result.ok && result.data && !state.getState().dirty) {
      status.setStatusKey('status.saved');
    }
  }, [createActions, state, status]);

  return {
    fileOpening,
    markDocumentDirty,
    openFromDialog,
    openPath,
    save,
    saveAs,
  };
}
