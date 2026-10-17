import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { OpenDocumentOutcome } from '../../features/file-actions/useFileWorkflow';
import { usePackageWorkflow } from '../../features/packages/usePackageWorkflow';
import { useSettingsStore } from '../../features/settings/settingsStore';
import type { CommandError } from '../../services/tauri/invokeCommand';
import { useAppStore, type StatusKey } from '../stores/appStore';

type UsePackageSessionModelOptions = {
  documentPortRef: RefObject<EditorDocumentPort | null>;
  editorReady: boolean;
  openPath: (path: string, allowDirty?: boolean) => Promise<OpenDocumentOutcome>;
  setLastFileError: (error: CommandError | null) => void;
  setStatusKey: (statusKey: StatusKey) => void;
};

export function usePackageSessionModel({
  documentPortRef,
  editorReady,
  openPath,
  setLastFileError,
  setStatusKey,
}: UsePackageSessionModelOptions) {
  const packageSession = useAppStore((state) => state.packageSession);
  const currentFilePath = useAppStore(
    (state) => state.currentFile?.path ?? null,
  );

  useEffect(() => {
    if (packageSession && currentFilePath !== packageSession.entryPath) {
      useAppStore.getState().setPackageSession(null);
    }
  }, [currentFilePath, packageSession]);

  useEffect(() => {
    documentPortRef.current?.setDocumentReadOnly?.(packageSession !== null);
  }, [editorReady, packageSession, documentPortRef]);

  const defaultDisplayMode = useSettingsStore(
    (state) => state.settings.editor.defaultDisplayMode,
  );
  const packageWorkflow = usePackageWorkflow({
    defaultDisplayMode,
    documentPortRef,
    openPath,
    session: packageSession,
    setLastFileError,
    setStatusKey: (statusKey) => {
      setStatusKey(statusKey as StatusKey);
    },
  });

  return { packageSession, packageWorkflow };
}
