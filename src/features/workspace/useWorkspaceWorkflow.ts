import { useCallback, useRef } from 'react';
import {
  listWorkspaceChildren,
  openWorkspaceDirectory,
} from '../../services/workspace/workspaceCommands';
import { useWorkspaceStore } from './workspaceStore';

export type WorkspaceWorkflow = {
  loadingPaths: Record<string, boolean>;
  loadChildren: (path: string, session?: number) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  openWorkspace: () => Promise<void>;
  root: ReturnType<typeof useWorkspaceStore.getState>['root'];
  tree: ReturnType<typeof useWorkspaceStore.getState>['tree'];
};

type UseWorkspaceWorkflowOptions = {
  openDocumentPath: (path: string) => Promise<void>;
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

  const openWorkspace = useCallback(async () => {
    const result = await openWorkspaceDirectory();

    if (!result.ok) {
      setWorkspaceError(result.error);
      status.setStatusKey('status.workspaceOpenFailed');
      return;
    }

    if (!result.data) {
      return;
    }

    workspaceLoadSessionRef.current += 1;
    workspaceLoadGenerationsRef.current.clear();
    const workspaceLoadSession = workspaceLoadSessionRef.current;
    setWorkspaceRoot(result.data);
    status.setStatusKey('status.workspaceOpened');
    await loadChildren(result.data.path, workspaceLoadSession);
  }, [
    loadChildren,
    status,
    setWorkspaceError,
    setWorkspaceRoot,
  ]);

  const openFile = useCallback(
    async (path: string) => {
      await openDocumentPath(path);
    },
    [openDocumentPath],
  );

  return {
    loadChildren,
    loadingPaths,
    openFile,
    openWorkspace,
    root,
    tree,
  };
}
