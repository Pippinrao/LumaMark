import { create } from 'zustand';
import {
  strictBrowserPreferenceStorage,
  type KeyValueStorage,
} from '../../services/preferences/browserPreferenceStorage';

export type StartupBehavior = 'home' | 'restoreLastSession';

export type LastSession =
  | { kind: 'file'; path: string }
  | { kind: 'workspace'; documentPath?: string; path: string };

export type RecentWorkspace = {
  name: string;
  openedAt: number;
  path: string;
};

export type RecentWorkspaceInput = Omit<RecentWorkspace, 'openedAt'> & {
  openedAt?: number;
};

type StartupState = {
  addRecentWorkspace: (workspace: RecentWorkspaceInput) => void;
  lastSession: LastSession | null;
  recentWorkspaces: RecentWorkspace[];
  setLastSession: (lastSession: LastSession | null) => void;
  setStartupBehavior: (startupBehavior: StartupBehavior) => void;
  setStartScreenOpen: (startScreenOpen: boolean) => void;
  startScreenOpen: boolean;
  startupBehavior: StartupBehavior;
  startupPersistenceError: boolean;
};

type PersistedStartupState = {
  lastSession: LastSession | null;
  recentWorkspaces: RecentWorkspace[];
  startupBehavior: StartupBehavior;
  version: 1;
};

const MAX_RECENT_WORKSPACES = 20;
const STARTUP_STORAGE_KEY = 'lumamark.startup.v1';

const DEFAULT_PERSISTED_STATE: PersistedStartupState = {
  lastSession: null,
  recentWorkspaces: [],
  startupBehavior: 'home',
  version: 1,
};

export function createStartupStore(
  storage: KeyValueStorage = strictBrowserPreferenceStorage,
) {
  const initialState = readPersistedState(storage);

  return create<StartupState>((set, get) => {
    const persist = (next: Partial<PersistedStartupState>) => {
      const state = get();
      return writePersistedState(storage, {
        lastSession: Object.hasOwn(next, 'lastSession')
          ? (next.lastSession ?? null)
          : state.lastSession,
        recentWorkspaces: next.recentWorkspaces ?? state.recentWorkspaces,
        startupBehavior: next.startupBehavior ?? state.startupBehavior,
        version: 1,
      });
    };

    return {
      ...initialState,
      startScreenOpen: true,
      addRecentWorkspace: (workspace) => {
        const recentWorkspace: RecentWorkspace = {
          ...workspace,
          openedAt: workspace.openedAt ?? Date.now(),
        };
        const recentWorkspaces = [
          recentWorkspace,
          ...get().recentWorkspaces.filter(({ path }) => path !== workspace.path),
        ].slice(0, MAX_RECENT_WORKSPACES);
        const startupPersistenceError = !persist({ recentWorkspaces });
        set({ recentWorkspaces, startupPersistenceError });
      },
      setLastSession: (lastSession) => {
        const startupPersistenceError = !persist({ lastSession });
        set({ lastSession, startupPersistenceError });
      },
      setStartupBehavior: (startupBehavior) => {
        const startupPersistenceError = !persist({ startupBehavior });
        set({ startupBehavior, startupPersistenceError });
      },
      setStartScreenOpen: (startScreenOpen) => {
        set({ startScreenOpen });
      },
    };
  });
}

function readPersistedState(
  storage: KeyValueStorage,
): PersistedStartupState & { startupPersistenceError: boolean } {
  try {
    const value = storage.getItem(STARTUP_STORAGE_KEY);
    if (!value) {
      return { ...DEFAULT_PERSISTED_STATE, startupPersistenceError: false };
    }

    const parsed: unknown = JSON.parse(value);
    if (!isPersistedStartupState(parsed)) {
      throw new Error('Persisted startup state is invalid.');
    }

    return {
      ...parsed,
      recentWorkspaces: parsed.recentWorkspaces.slice(0, MAX_RECENT_WORKSPACES),
      startupPersistenceError: false,
    };
  } catch {
    return { ...DEFAULT_PERSISTED_STATE, startupPersistenceError: true };
  }
}

function writePersistedState(
  storage: KeyValueStorage,
  state: PersistedStartupState,
): boolean {
  try {
    storage.setItem(STARTUP_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function isPersistedStartupState(value: unknown): value is PersistedStartupState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Record<string, unknown>;
  return (
    state.version === 1 &&
    (state.startupBehavior === 'home' || state.startupBehavior === 'restoreLastSession') &&
    (state.lastSession === null || isLastSession(state.lastSession)) &&
    Array.isArray(state.recentWorkspaces) &&
    state.recentWorkspaces.every(isRecentWorkspace)
  );
}

function isLastSession(value: unknown): value is LastSession {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const session = value as Record<string, unknown>;
  if (session.kind === 'file') {
    return typeof session.path === 'string';
  }

  return (
    session.kind === 'workspace' &&
    typeof session.path === 'string' &&
    (session.documentPath === undefined || typeof session.documentPath === 'string')
  );
}

function isRecentWorkspace(value: unknown): value is RecentWorkspace {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const workspace = value as Record<string, unknown>;
  return (
    typeof workspace.name === 'string' &&
    typeof workspace.openedAt === 'number' &&
    Number.isFinite(workspace.openedAt) &&
    typeof workspace.path === 'string'
  );
}

export const useStartupStore = createStartupStore();
