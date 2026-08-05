import { useCallback, useRef } from 'react';
import {
  listWorkspaceChildren,
  openWorkspaceDirectory,
  openWorkspacePath,
  type WorkspaceDirectory,
} from '../../services/workspace/workspaceCommands';
import { useWorkspaceStore } from './workspaceStore';

export type WorkspaceWorkflow = {
  dismissError: () => void;
  error: ReturnType<typeof useWorkspaceStore.getState>['error'];
  loadingPaths: Record<string, boolean>;
  loadChildren: (path: string, session?: number) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  openPath: (path: string) => Promise<OpenWorkspaceOutcome>;
  openWorkspace: () => Promise<OpenWorkspaceOutcome>;
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

  return {
    dismissError: () => setWorkspaceError(null),
    error,
    loadChildren,
    loadingPaths,
    openFile,
    openPath,
    openWorkspace,
    root,
    tree,
  };
}
