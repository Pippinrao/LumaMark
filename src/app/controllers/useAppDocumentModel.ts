import { useCallback, useMemo } from 'react';
import type { RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import { useFileWorkflow } from '../../features/file-actions/useFileWorkflow';
import { saveVoidAsOutcome } from '../../features/file-actions/documentSaveOutcome';
import { useDocumentStatistics } from '../../features/document-statistics/useDocumentStatistics';
import { useDebouncedOutline } from '../../features/outline/useDebouncedOutline';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { useRecoveryDraft } from '../../features/recovery-drafts/useRecoveryDraft';
import { useWindowAutosave } from '../../features/autosave/useWindowAutosave';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { useAppStore, type StatusKey } from '../stores/appStore';
import { finalizeAllDraftImages } from '../../services/assets/assetCommands';
import type { FileWatchChangeEvent } from '../../services/file-watch/fileWatchClient';

export function useAppDocumentModel(
  documentPortRef: RefObject<EditorDocumentPort | null>,
  editorReady: boolean,
  onLocalImageChanged?: (event: FileWatchChangeEvent) => void,
  onDocumentLoaded?: () => void,
) {
  const currentFile = useAppStore((state) => state.currentFile);
  const dirty = useAppStore((state) => state.dirty);
  const dirtyRevision = useAppStore((state) => state.dirtyRevision);
  const lastFileError = useAppStore((state) => state.lastFileError);
  const recentFileItems = useRecentFilesStore((state) => state.recentFiles);
  const statusKey = useAppStore((state) => state.statusKey);
  const setStatusKey = useAppStore((state) => state.setStatusKey);
  const setLastFileError = useAppStore((state) => state.setLastFileError);

  const fileState = useMemo(
    () => ({
      getState: () => {
        const state = useAppStore.getState();

        return {
          currentFile: state.currentFile,
          dirty: state.dirty,
          dirtyRevision: state.dirtyRevision,
          lastFileError: state.lastFileError,
        };
      },
      setCurrentFile: useAppStore.getState().setCurrentFile,
      setDirty: useAppStore.getState().setDirty,
      setLastFileError: useAppStore.getState().setLastFileError,
    }),
    [],
  );

  const status = useMemo(
    () => ({
      setStatusKey: (nextStatusKey: string) => {
        setStatusKey(nextStatusKey as StatusKey);
      },
    }),
    [setStatusKey],
  );

  const recentFiles = useMemo(
    () => ({
      addRecentFile: useRecentFilesStore.getState().addRecentFile,
    }),
    [],
  );

  const getDocumentText = useCallback(() => {
    return documentPortRef.current?.getText() ?? '';
  }, [documentPortRef]);
  const getEditorState = useCallback(() => {
    return documentPortRef.current?.getEditorState?.() ?? null;
  }, [documentPortRef]);
  const prepareTextForSave = useCallback(async (path: string, text: string) => {
    return finalizeAllDraftImages({ documentPath: path, text });
  }, []);
  const documentStatistics = useDocumentStatistics({ getDocumentText });

  const recoveryDraft = useRecoveryDraft({
    currentFilePath: currentFile?.path ?? null,
    editorReady,
    editorRef: documentPortRef,
    onRestore: () => {
      fileState.setCurrentFile(null);
      fileState.setDirty(true);
      setLastFileError(null);
    },
  });

  const fileWorkflow = useFileWorkflow({
    editorReady,
    editorRef: documentPortRef,
    onLocalImageChanged,
    onDocumentLoaded,
    onDocumentBecameSafe: recoveryDraft.clearRecoveryDraft,
    prepareTextForSave,
    recentFiles,
    state: fileState,
    status,
  });

  const autosaveEnabled = useSettingsStore(
    (state) => state.settings.editor.autosaveEnabled,
  );
  const saveDocument = fileWorkflow.save;
  const saveAutosaveRevision = useCallback(
    (revision: number) =>
      saveVoidAsOutcome({
        attemptedRevision: revision,
        readSessionAfter: () => {
          const state = useAppStore.getState();
          return {
            dirty: state.dirty,
            revision: state.dirtyRevision,
          };
        },
        save: saveDocument,
      }),
    [saveDocument],
  );
  const autosave = useWindowAutosave({
    autosaveEnabled,
    currentFilePath: currentFile?.path ?? null,
    dirty,
    dirtyRevision,
    externalConflict: fileWorkflow.externalConflict !== null,
    fileOpening: fileWorkflow.fileOpening,
    save: saveAutosaveRevision,
  });
  const loadUnsavedSnapshot = useCallback(
    (text: string) => {
      const editor = documentPortRef.current;
      if (!editor) {
        return;
      }
      editor.loadText(text, { saved: false });
      editor.setContext({ path: null });
      editor.markUnsaved();
      fileState.setCurrentFile(null);
      fileState.setDirty(true);
      fileState.setLastFileError(null);
      editor.focus();
    },
    [documentPortRef, fileState],
  );

  const dismissFileError = useCallback(() => {
    setLastFileError(null);
  }, [setLastFileError]);
  const {
    awaitCurrentSnapshot: awaitCurrentOutlineSnapshot,
    headings,
    isCurrent: isOutlineCurrent,
    isCurrentHeading: isCurrentOutlineHeading,
    scheduleRefresh: scheduleOutlineRefresh,
  } = useDebouncedOutline({
    getEditorState,
  });

  return {
    autosave,
    awaitCurrentOutlineSnapshot,
    currentFile,
    dirtyRevision,
    documentStatistics,
    dismissFileError,
    dirty,
    fileWorkflow,
    headings,
    isCurrentOutlineHeading,
    isOutlineCurrent,
    lastFileError,
    loadUnsavedSnapshot,
    recentFiles: recentFileItems,
    recoveryDraft,
    scheduleOutlineRefresh,
    status,
    statusKey,
  };
}
