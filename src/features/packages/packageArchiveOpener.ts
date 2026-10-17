import type { RefObject } from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import {
  defaultPackageCommandClient,
  resolvePackageCommandClient,
  type PackageCommandClient,
} from '../../services/packages/packageCommandClient';
import type { RecentFileInput } from '../recent-files/recentFilesStore';
import type {
  ApplyOpenResultOptions,
  FileActionStateAdapter,
} from '../file-actions/fileActions';
import type {
  OpenDocumentOutcome,
  StatusAdapter,
} from '../file-actions/useFileWorkflow';

export type PackageArchiveOpenerDeps = {
  commandClient?: PackageCommandClient;
  editorRef: RefObject<EditorDocumentPort | null>;
  openPath: (
    path: string,
    allowDirty: boolean,
    options?: ApplyOpenResultOptions,
  ) => Promise<OpenDocumentOutcome>;
  recentFiles: {
    addRecentFile: (file: RecentFileInput) => void;
  };
  setFileOpening: (open: boolean) => void;
  state: FileActionStateAdapter;
  status: StatusAdapter;
};

export function createPackageArchiveOpener({
  commandClient,
  editorRef,
  openPath,
  setFileOpening,
  state,
  status,
}: PackageArchiveOpenerDeps) {
  const commands =
    commandClient ??
    resolvePackageCommandClient() ??
    defaultPackageCommandClient;

  return async (
    zipPath: string,
    allowDirty = false,
  ): Promise<OpenDocumentOutcome> => {
    const current = state.getState();
    if (current.dirty && !allowDirty) {
      return { status: 'superseded' } as const;
    }

    setFileOpening(true);
    status.setStatusKey('status.opening');
    try {
      const opened = await commands.open(zipPath);
      if (!opened.ok) {
        state.setLastFileError(opened.error);
        status.setStatusKey('status.openFailed');
        return { status: 'failed' } as const;
      }

      const zipName = fileNameFromPath(zipPath);
      const outcome = await openPath(opened.data.entryPath, true, {
        recentFile: { name: zipName, path: zipPath },
      });
      if (outcome.status !== 'opened') {
        return outcome;
      }

      const editor = editorRef.current;
      editor?.setDocumentReadOnly?.(true);
      editor?.setDisplayMode?.('reading');
      state.setPackageSession?.({
        entryName: opened.data.entryName,
        entryPath: opened.data.entryPath,
        sessionDir: opened.data.sessionDir,
        zipName,
        zipPath,
      });
      status.setStatusKey('status.ready');
      return { ...outcome, sessionPath: zipPath };
    } finally {
      setFileOpening(false);
    }
  };
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/u);
  return parts.at(-1)?.trim() || path;
}
