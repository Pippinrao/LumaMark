import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  createFileTreeContextMenuModels,
  type FileTreeContextTarget,
} from '../../features/commands/createCommandModels';
import type {
  CommandMenuNode,
  CommandPayloadHandlerMap,
} from '../../features/commands/commandTypes';
import { areWatchedPathsEqual } from '../../features/file-actions/useExternalFileWatch';
import type { FileTreeMutationRequest } from '../../features/file-tree/FileTreeMutationDialog';
import type { WorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { writeClipboardText } from '../../services/clipboard/clipboardTextClient';
import { revealPathInOs } from '../../services/opener/openerCommands';
import { useAppStore } from '../stores/appStore';

type UseFileTreeContextMenuOptions = {
  markOpenDocumentRemoved: (path: string) => void;
  retargetOpenDocument: (path: string) => void | Promise<void>;
  workspace: WorkspaceWorkflow;
};

export type FileTreeContextPayloadHandlers = Pick<
  CommandPayloadHandlerMap,
  | 'fileTreeCopyPath'
  | 'fileTreeCreateDirectory'
  | 'fileTreeCreateFile'
  | 'fileTreeDelete'
  | 'fileTreeRename'
  | 'fileTreeReveal'
>;

export function useFileTreeContextMenu({
  markOpenDocumentRemoved,
  retargetOpenDocument,
  workspace,
}: UseFileTreeContextMenuOptions) {
  const { t } = useTranslation();
  const [mutationRequest, setMutationRequest] =
    useState<FileTreeMutationRequest | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const mutationInFlightRef = useRef(false);
  const returnFocusPathRef = useRef<string | null>(null);

  const reportError = useCallback(
    (code: string, messageKey: string) => {
      useAppStore.getState().setLastFileError({
        code,
        message: t(messageKey),
        recoverable: true,
      });
    },
    [t],
  );

  const onCopyPath = useCallback(
    (path: string) => {
      void writeFileTreeClipboardText(path, () => {
        reportError('workspace.copy_path_failed', 'fileTreeError.copyPathFailed');
      });
    },
    [reportError],
  );

  const onReveal = useCallback(
    (path: string) => {
      void revealPathInOs(path, {
        documentPath: useAppStore.getState().currentFile?.path ?? null,
        workspaceRoot: workspace.root?.path ?? null,
      }).then((result) => {
        if (!result.ok) {
          reportError(result.error.code, 'fileTreeError.revealFailed');
        }
      });
    },
    [reportError, workspace.root?.path],
  );

  const onCreateFile = useCallback(
    (parentPath: string) => {
      returnFocusPathRef.current = parentPath;
      setMutationRequest({
        defaultValue: t('contextMenu.defaultFileName'),
        mode: 'createFile',
        parentPath,
      });
    },
    [t],
  );

  const onCreateDirectory = useCallback(
    (parentPath: string) => {
      returnFocusPathRef.current = parentPath;
      setMutationRequest({
        defaultValue: t('contextMenu.defaultFolderName'),
        mode: 'createDirectory',
        parentPath,
      });
    },
    [t],
  );

  const onRename = useCallback(
    (
      path: string,
      currentName: string,
      entryKind: 'directory' | 'file',
    ) => {
      returnFocusPathRef.current = path;
      setMutationRequest({
        defaultValue: currentName,
        entryKind,
        mode: 'rename',
        path,
      });
    },
    [],
  );

  const onDelete = useCallback(
    (
      path: string,
      name: string,
      entryKind: 'directory' | 'file',
    ) => {
      returnFocusPathRef.current = parentPathOf(path) ?? workspace.root?.path ?? null;
      setMutationRequest({ entryKind, mode: 'delete', name, path });
    },
    [workspace.root?.path],
  );

  const payloadHandlers = useMemo<FileTreeContextPayloadHandlers>(
    () => ({
      fileTreeCopyPath: ({ path }) => onCopyPath(path),
      fileTreeCreateDirectory: ({ parentPath }) =>
        onCreateDirectory(parentPath),
      fileTreeCreateFile: ({ parentPath }) => onCreateFile(parentPath),
      fileTreeDelete: ({ entryKind, name, path }) =>
        onDelete(path, name, entryKind),
      fileTreeRename: ({ entryKind, name, path }) =>
        onRename(path, name, entryKind),
      fileTreeReveal: ({ path }) => onReveal(path),
    }),
    [
      onCopyPath,
      onCreateDirectory,
      onCreateFile,
      onDelete,
      onRename,
      onReveal,
    ],
  );

  const confirmMutation = useCallback(
    async (name: string | undefined) => {
      const request = mutationRequest;
      if (!request || mutationInFlightRef.current) {
        return;
      }

      const trimmedName = name?.trim();
      if (request.mode !== 'delete' && !trimmedName) {
        return;
      }

      if (
        request.mode === 'rename' &&
        trimmedName === request.defaultValue
      ) {
        setMutationRequest(null);
        return;
      }

      mutationInFlightRef.current = true;
      setMutationBusy(true);
      let succeeded = false;

      try {
        if (request.mode === 'createFile') {
          const result = await workspace.createFile(
            request.parentPath,
            trimmedName!,
          );
          if (!result.ok) {
            reportError(result.error.code, workspaceErrorKey(result.error.code));
            return;
          }
          await workspace.openFile(result.data.path);
          succeeded = true;
          // Opening the new file owns focus; closing the dialog must not steal it
          // back from the editor by focusing a newly-created tree row.
          returnFocusPathRef.current = null;
          return;
        }

        if (request.mode === 'createDirectory') {
          const result = await workspace.createDirectory(
            request.parentPath,
            trimmedName!,
          );
          if (!result.ok) {
            reportError(result.error.code, workspaceErrorKey(result.error.code));
            return;
          }
          succeeded = true;
          returnFocusPathRef.current = result.data.path;
          return;
        }

        if (request.mode === 'rename') {
          const result = await workspace.renameEntry(request.path, trimmedName!);
          if (!result.ok) {
            reportError(result.error.code, workspaceErrorKey(result.error.code));
            return;
          }

          const currentFile = useAppStore.getState().currentFile;
          const retargetedPath = currentFile
            ? request.entryKind === 'directory'
              ? replacePathPrefix(
                  currentFile.path,
                  request.path,
                  result.data.path,
                )
              : areWatchedPathsEqual(currentFile.path, request.path)
                ? result.data.path
                : null
            : null;
          if (retargetedPath) {
            await retargetOpenDocument(retargetedPath);
          }
          succeeded = true;
          returnFocusPathRef.current = result.data.path;
          return;
        }

        if (request.mode === 'delete') {
          const result = await workspace.deleteEntry(request.path);
          if (!result.ok) {
            reportError(result.error.code, workspaceErrorKey(result.error.code));
            return;
          }

          const currentFile = useAppStore.getState().currentFile;
          if (
            currentFile &&
            (request.entryKind === 'directory'
              ? pathIsEqualOrDescendant(currentFile.path, request.path)
              : areWatchedPathsEqual(currentFile.path, request.path))
          ) {
            markOpenDocumentRemoved(currentFile.path);
          }
          succeeded = true;
        }
      } finally {
        mutationInFlightRef.current = false;
        setMutationBusy(false);
        if (succeeded) {
          setMutationRequest(null);
        }
      }
    },
    [
      markOpenDocumentRemoved,
      mutationRequest,
      reportError,
      retargetOpenDocument,
      workspace,
    ],
  );

  const returnMutationFocus = useCallback(() => {
    const path = returnFocusPathRef.current;
    if (!path || typeof document === 'undefined') {
      return;
    }

    const target = Array.from(
      document.querySelectorAll<HTMLElement>('[data-file-tree-path]'),
    ).find((element) => element.dataset.fileTreePath === path);
    target?.focus({ preventScroll: true });
  }, []);

  const getContextMenuNodes = useCallback(
    (target: FileTreeContextTarget): CommandMenuNode[] =>
      createFileTreeContextMenuModels({
        t,
        target,
      }),
    [t],
  );

  return {
    getContextMenuNodes,
    payloadHandlers,
    mutationDialog: {
      busy: mutationBusy,
      cancel: () => {
        if (!mutationInFlightRef.current) {
          setMutationRequest(null);
        }
      },
      confirm: confirmMutation,
      request: mutationRequest,
      returnFocus: returnMutationFocus,
    },
  };
}

async function writeFileTreeClipboardText(
  text: string,
  onFailure: () => void,
): Promise<void> {
  try {
    await writeClipboardText(text);
  } catch {
    onFailure();
  }
}

function workspaceErrorKey(code: string): string {
  switch (code) {
    case 'file.already_exists':
      return 'fileTreeError.alreadyExists';
    case 'file.invalid_path':
      return 'fileError.invalidPath';
    case 'workspace.trash_unavailable':
      return 'fileTreeError.trashUnavailable';
    case 'workspace.invalid_entry_name':
      return 'fileTreeError.invalidName';
    default:
      return 'fileError.operationFailed';
  }
}

function parentPathOf(path: string): string | null {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : null;
}

function pathIsEqualOrDescendant(path: string, parentPath: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedParent = normalizePath(parentPath);
  const comparablePath = comparablePathForPlatform(normalizedPath);
  const comparableParent = comparablePathForPlatform(normalizedParent);

  return (
    comparablePath === comparableParent ||
    comparablePath.startsWith(`${comparableParent}/`)
  );
}

function replacePathPrefix(
  path: string,
  previousPrefix: string,
  nextPrefix: string,
): string | null {
  const normalizedPath = normalizePath(path);
  const normalizedPrevious = normalizePath(previousPrefix);

  if (!pathIsEqualOrDescendant(normalizedPath, normalizedPrevious)) {
    return null;
  }

  const suffix = normalizedPath.slice(normalizedPrevious.length).replace(/^\/+/, '');
  if (!suffix) {
    return nextPrefix;
  }

  const separator = nextPrefix.includes('\\') && !nextPrefix.includes('/') ? '\\' : '/';
  return `${nextPrefix.replace(/[\\/]+$/, '')}${separator}${suffix.replaceAll(
    '/',
    separator,
  )}`;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}

function comparablePathForPlatform(path: string): string {
  return /^[a-z]:\//i.test(path) || path.startsWith('//')
    ? path.toLocaleLowerCase('en-US')
    : path;
}
