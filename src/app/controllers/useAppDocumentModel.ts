import { useCallback, useMemo } from 'react';
import type { RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import { useFileWorkflow } from '../../features/file-actions/useFileWorkflow';
import { useDebouncedOutline } from '../../features/outline/useDebouncedOutline';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { useAppStore, type StatusKey } from '../stores/appStore';

export function useAppDocumentModel(
  documentPortRef: RefObject<EditorDocumentPort | null>,
) {
  const currentFile = useAppStore((state) => state.currentFile);
  const dirty = useAppStore((state) => state.dirty);
  const statusKey = useAppStore((state) => state.statusKey);
  const setStatusKey = useAppStore((state) => state.setStatusKey);

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

  const fileWorkflow = useFileWorkflow({
    editorRef: documentPortRef,
    recentFiles,
    state: fileState,
    status,
  });

  const getDocumentText = useCallback(() => {
    return documentPortRef.current?.getText() ?? '';
  }, [documentPortRef]);
  const { headings, scheduleRefresh: scheduleOutlineRefresh } =
    useDebouncedOutline({
      getDocumentText,
    });

  return {
    currentFile,
    dirty,
    fileWorkflow,
    headings,
    scheduleOutlineRefresh,
    status,
    statusKey,
  };
}
