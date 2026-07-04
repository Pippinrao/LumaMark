import { create } from 'zustand';
import type { CommandError } from '../../services/tauri/invokeCommand';
import type { WorkspaceDirectory, WorkspaceEntry } from './workspaceCommands';

export type WorkspaceTreeNode = WorkspaceEntry & {
  children?: WorkspaceTreeNode[];
  id: string;
  loaded: boolean;
};

type WorkspaceState = {
  error: CommandError | null;
  loadingPaths: Record<string, boolean>;
  root: WorkspaceDirectory | null;
  tree: WorkspaceTreeNode[];
  clearWorkspace: () => void;
  finishLoading: (path: string) => void;
  setChildren: (parentPath: string, entries: readonly WorkspaceEntry[]) => void;
  setError: (error: CommandError | null) => void;
  setRoot: (root: WorkspaceDirectory | null) => void;
  startLoading: (path: string) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  error: null,
  loadingPaths: {},
  root: null,
  tree: [],

  clearWorkspace: () => {
    set({
      error: null,
      loadingPaths: {},
      root: null,
      tree: [],
    });
  },

  finishLoading: (path) => {
    set((state) => {
      const loadingPaths = { ...state.loadingPaths };
      delete loadingPaths[path];

      return { loadingPaths };
    });
  },

  setChildren: (parentPath, entries) => {
    set((state) => {
      const nextChildren = entries.map(entryToTreeNode);

      if (state.root?.path === parentPath) {
        return {
          tree: nextChildren,
        };
      }

      return {
        tree: replaceChildren(state.tree, parentPath, nextChildren),
      };
    });
  },

  setError: (error) => {
    set({ error });
  },

  setRoot: (root) => {
    set({
      error: null,
      loadingPaths: {},
      root,
      tree: [],
    });
  },

  startLoading: (path) => {
    set((state) => ({
      loadingPaths: {
        ...state.loadingPaths,
        [path]: true,
      },
    }));
  },
}));

function entryToTreeNode(entry: WorkspaceEntry): WorkspaceTreeNode {
  return {
    ...entry,
    children: entry.kind === 'directory' ? [] : undefined,
    id: entry.path,
    loaded: entry.kind !== 'directory',
  };
}

function replaceChildren(
  nodes: readonly WorkspaceTreeNode[],
  parentPath: string,
  children: WorkspaceTreeNode[],
): WorkspaceTreeNode[] {
  return nodes.map((node) => {
    if (node.path === parentPath) {
      return {
        ...node,
        children,
        loaded: true,
      };
    }

    if (!node.children?.length) {
      return node;
    }

    return {
      ...node,
      children: replaceChildren(node.children, parentPath, children),
    };
  });
}
