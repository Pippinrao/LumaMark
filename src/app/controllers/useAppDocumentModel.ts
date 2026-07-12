import { useCallback, useMemo } from 'react';
import type { RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import { useFileWorkflow } from '../../features/file-actions/useFileWorkflow';
import { useDocumentStatistics } from '../../features/document-statistics/useDocumentStatistics';
import { useDebouncedOutline } from '../../features/outline/useDebouncedOutline';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { useRecoveryDraft } from '../../features/recovery-drafts/useRecoveryDraft';
import { useAppStore, type StatusKey } from '../stores/appStore';
import { finalizeAllDraftImages } from '../../services/assets/assetCommands';
import type { FileWatchChangeEvent } from '../../services/file-watch/fileWatchClient';

export function useAppDocumentModel(
  documentPortRef: RefObject<EditorDocumentPort | null>,
  editorReady: boolean,
  onLocalImageChanged?: (event: FileWatchChangeEvent) => void,
) {
  const currentFile = useAppStore((state) => state.currentFile);
  const dirty = useAppStore((state) => state.dirty);
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
    onDocumentBecameSafe: recoveryDraft.clearRecoveryDraft,
    prepareTextForSave,
    recentFiles,
    state: fileState,
    status,
  });

  const dismissFileError = useCallback(() => {
    setLastFileError(null);
  }, [setLastFileError]);
  const { headings, scheduleRefresh: scheduleOutlineRefresh } =
    useDebouncedOutline({
      getDocumentText,
    });

  return {
    currentFile,
    documentStatistics,
    dismissFileError,
    dirty,
    fileWorkflow,
    headings,
    lastFileError,
    recentFiles: recentFileItems,
    recoveryDraft,
    scheduleOutlineRefresh,
    status,
    statusKey,
  };
}
