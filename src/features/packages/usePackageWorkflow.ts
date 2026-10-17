import { useCallback, useRef } from 'react';
import type { RefObject } from 'react';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { CommandError } from '../../services/tauri/invokeCommand';
import {
  defaultPackageCommandClient,
  resolvePackageCommandClient,
  type PackageCommandClient,
} from '../../services/packages/packageCommandClient';
import type { OpenDocumentOutcome } from '../file-actions/useFileWorkflow';
import type { PackageSession } from './packageTypes';

type UsePackageWorkflowOptions = {
  commandClient?: PackageCommandClient;
  defaultDisplayMode: EditorDisplayMode;
  documentPortRef: RefObject<EditorDocumentPort | null>;
  openPath: (path: string, allowDirty?: boolean) => Promise<OpenDocumentOutcome>;
  session: PackageSession | null;
  setLastFileError: (error: CommandError | null) => void;
  setStatusKey: (statusKey: string) => void;
};

export function usePackageWorkflow({
  commandClient,
  defaultDisplayMode,
  documentPortRef,
  openPath,
  session,
  setLastFileError,
  setStatusKey,
}: UsePackageWorkflowOptions) {
  const busyRef = useRef(false);
  const commands =
    commandClient ??
    resolvePackageCommandClient() ??
    defaultPackageCommandClient;

  const unpackPackage = useCallback(async () => {
    if (!session || busyRef.current) {
      return;
    }

    busyRef.current = true;
    setStatusKey('status.opening');
    try {
      const selection = await commands.showExtractDialog();
      if (!selection.ok) {
        setLastFileError(selection.error);
        setStatusKey('status.ready');
        return;
      }
      if (!selection.data) {
        setStatusKey('status.ready');
        return;
      }

      const extracted = await commands.extract(
        session.zipPath,
        selection.data,
      );
      if (!extracted.ok) {
        setLastFileError(extracted.error);
        setStatusKey('status.ready');
        return;
      }

      documentPortRef.current?.setDisplayMode?.(defaultDisplayMode);
      const outcome = await openPath(extracted.data.entryPath, true);
      if (outcome.status === 'opened') {
        setStatusKey('status.packageExtracted');
      }
    } finally {
      busyRef.current = false;
    }
  }, [
    commands,
    defaultDisplayMode,
    documentPortRef,
    openPath,
    session,
    setLastFileError,
    setStatusKey,
  ]);

  return { unpackPackage };
}
