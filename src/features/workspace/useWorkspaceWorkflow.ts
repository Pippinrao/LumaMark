import { useCallback, useRef } from 'react';
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceChildren,
  openWorkspaceDirectory,
  openWorkspacePath,
  renameWorkspaceEntry,
  type WorkspaceDirectory,
  type WorkspaceEntry,
} from '../../services/workspace/workspaceCommands';
import type { CommandResult } from '../../services/tauri/invokeCommand';
import { useWorkspaceStore } from './workspaceStore';

export type WorkspaceWorkflow = {
  createDirectory: (
    parentPath: string,
    name: string,
  ) => Promise<CommandResult<WorkspaceEntry>>;
  createFile: (
    parentPath: string,
    name: string,
  ) => Promise<CommandResult<WorkspaceEntry>>;
  deleteEntry: (path: string) => Promise<CommandResult<void>>;
  dismissError: () => void;
  error: ReturnType<typeof useWorkspaceStore.getState>['error'];
  loadingPaths: Record<string, boolean>;
  loadChildren: (path: string, session?: number) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  openPath: (path: string) => Promise<OpenWorkspaceOutcome>;
  openWorkspace: () => Promise<OpenWorkspaceOutcome>;
  renameEntry: (
    path: string,
    newName: string,
  ) => Promise<CommandResult<WorkspaceEntry>>;
  root: ReturnType<typeof useWorkspaceStore.getState>['root'];
  tree: ReturnType<typeof useWorkspaceStore.getState>['tree'];
};

export type OpenWorkspaceOutcome =
  | { status: 'opened'; workspace: WorkspaceDirectory }
  | { status: 'cancelled' | 'failed' };

type UseWorkspaceWorkflowOptions = {
  openDocumentPath: (path: string) => Promise<unknown>;
  status: {
    setStatusKey: (statusKey: string) => void;
  };
};

function parentDirectoryPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return path;
  }
  return path.slice(0, index);
}

export function useWorkspaceWorkflow({
  openDocumentPath,
  status,
}: UseWorkspaceWorkflowOptions): WorkspaceWorkflow {
  const workspaceLoadSessionRef = useRef(0);
  const workspaceLoadGenerationsRef = useRef(new Map<string, number>());
  const root = useWorkspaceStore((state) => state.root);
  const error = useWorkspaceStore((state) => state.error);
  const tree = useWorkspaceStore((state) => state.tree);
  const loadingPaths = useWorkspaceStore((state) => state.loadingPaths);
  const finishLoading = useWorkspaceStore((state) => state.finishLoading);
  const setWorkspaceChildren = useWorkspaceStore((state) => state.setChildren);
  const setWorkspaceError = useWorkspaceStore((state) => state.setError);
  const setWorkspaceRoot = useWorkspaceStore((state) => state.setRoot);
  const startLoading = useWorkspaceStore((state) => state.startLoading);

  const loadChildren = useCallback(
    async (path: string, session = workspaceLoadSessionRef.current) => {
      if (session !== workspaceLoadSessionRef.current) {
        return;
      }

      if (useWorkspaceStore.getState().loadingPaths[path]) {
        return;
      }

      const generation =
        (workspaceLoadGenerationsRef.current.get(path) ?? 0) + 1;
      workspaceLoadGenerationsRef.current.set(path, generation);
      startLoading(path);
      const result = await listWorkspaceChildren(path);

      if (
        session !== workspaceLoadSessionRef.current ||
        workspaceLoadGenerationsRef.current.get(path) !== generation
      ) {
        return;
      }

      if (result.ok) {
        setWorkspaceChildren(path, result.data);
        setWorkspaceError(null);
      } else {
        setWorkspaceError(result.error);
      }

      finishLoading(path);
    },
    [
      finishLoading,
      setWorkspaceChildren,
      setWorkspaceError,
      startLoading,
    ],
  );

  const applyWorkspace = useCallback(async (workspace: WorkspaceDirectory) => {
    workspaceLoadSessionRef.current += 1;
    workspaceLoadGenerationsRef.current.clear();
    const workspaceLoadSession = workspaceLoadSessionRef.current;
    setWorkspaceRoot(workspace);
    status.setStatusKey('status.workspaceOpened');
    await loadChildren(workspace.path, workspaceLoadSession);
    return { status: 'opened', workspace } as const;
  }, [
    loadChildren,
    status,
    setWorkspaceRoot,
  ]);

  const openWorkspace = useCallback(async () => {
    const result = await openWorkspaceDirectory();

    if (!result.ok) {
      setWorkspaceError(result.error);
      status.setStatusKey('status.workspaceOpenFailed');
      return { status: 'failed' } as const;
    }

    if (!result.data) {
      return { status: 'cancelled' } as const;
    }

    return applyWorkspace(result.data);
  }, [applyWorkspace, setWorkspaceError, status]);

  const openPath = useCallback(async (path: string) => {
    const result = await openWorkspacePath(path);

    if (!result.ok) {
      setWorkspaceError(result.error);
      status.setStatusKey('status.workspaceOpenFailed');
      return { status: 'failed' } as const;
    }

    return applyWorkspace(result.data);
  }, [applyWorkspace, setWorkspaceError, status]);

  const openFile = useCallback(
    async (path: string) => {
      await openDocumentPath(path);
    },
    [openDocumentPath],
  );

  const refreshParent = useCallback(
    async (path: string) => {
      const parentPath = parentDirectoryPath(path);
      const workspaceRoot = useWorkspaceStore.getState().root?.path;
      const refreshPath =
        workspaceRoot && parentPath === path ? workspaceRoot : parentPath;
      if (!workspaceRoot) {
        return;
      }
      workspaceLoadGenerationsRef.current.delete(refreshPath);
      await loadChildren(refreshPath);
    },
    [loadChildren],
  );

  const createFile = useCallback(
    async (parentPath: string, name: string) => {
      const workspaceRoot = useWorkspaceStore.getState().root?.path;
      if (!workspaceRoot) {
        return {
          ok: false as const,
          error: {
            code: 'file.invalid_path',
            message: 'Workspace root is unavailable.',
            recoverable: true,
          },
        };
      }

      const result = await createWorkspaceFile({
        name,
        parentPath,
        workspaceRoot,
      });
      if (result.ok) {
        setWorkspaceError(null);
        await refreshParent(result.data.path);
      } else {
        setWorkspaceError(result.error);
      }
      return result;
    },
    [refreshParent, setWorkspaceError],
  );

  const createDirectory = useCallback(
    async (parentPath: string, name: string) => {
      const workspaceRoot = useWorkspaceStore.getState().root?.path;
      if (!workspaceRoot) {
        return {
          ok: false as const,
          error: {
            code: 'file.invalid_path',
            message: 'Workspace root is unavailable.',
            recoverable: true,
          },
        };
      }

      const result = await createWorkspaceDirectory({
        name,
        parentPath,
        workspaceRoot,
      });
      if (result.ok) {
        setWorkspaceError(null);
        await refreshParent(result.data.path);
      } else {
        setWorkspaceError(result.error);
      }
      return result;
    },
    [refreshParent, setWorkspaceError],
  );

  const renameEntry = useCallback(
    async (path: string, newName: string) => {
      const workspaceRoot = useWorkspaceStore.getState().root?.path;
      if (!workspaceRoot) {
        return {
          ok: false as const,
          error: {
            code: 'file.invalid_path',
            message: 'Workspace root is unavailable.',
            recoverable: true,
          },
        };
      }

      const result = await renameWorkspaceEntry({
        newName,
        path,
        workspaceRoot,
      });
      if (result.ok) {
        setWorkspaceError(null);
        await refreshParent(result.data.path);
      } else {
        setWorkspaceError(result.error);
      }
      return result;
    },
    [refreshParent, setWorkspaceError],
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      const workspaceRoot = useWorkspaceStore.getState().root?.path;
      if (!workspaceRoot) {
        return {
          ok: false as const,
          error: {
            code: 'file.invalid_path',
            message: 'Workspace root is unavailable.',
            recoverable: true,
          },
        };
      }

      const result = await deleteWorkspaceEntry({
        path,
        workspaceRoot,
      });
      if (result.ok) {
        setWorkspaceError(null);
        await refreshParent(path);
      } else {
        setWorkspaceError(result.error);
      }
      return result;
    },
    [refreshParent, setWorkspaceError],
  );

  return {
    createDirectory,
    createFile,
    deleteEntry,
    dismissError: () => setWorkspaceError(null),
    error,
    loadChildren,
    loadingPaths,
    openFile,
    openPath,
    openWorkspace,
    renameEntry,
    root,
    tree,
  };
}
