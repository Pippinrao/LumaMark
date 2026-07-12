import { create } from 'zustand';

export type RecentFile = {
  name: string;
  openedAt: number;
  path: string;
};

export type RecentFileInput = {
  name: string;
  openedAt?: number;
  path: string;
};

export type RecentFilesStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

type RecentFilesState = {
  recentFiles: RecentFile[];
  addRecentFile: (file: RecentFileInput) => void;
  clearRecentFiles: () => void;
};

const MAX_RECENT_FILES = 20;
const RECENT_FILES_STORAGE_KEY = 'lumamark.recent-files.v1';
const fallbackStorage = new Map<string, string>();

function isJsdomRuntime(): boolean {
  const userAgent = globalThis.navigator?.userAgent.toLowerCase() ?? '';

  return userAgent.includes('jsdom');
}

function getBrowserStorage(): RecentFilesStorage | null {
  if (isJsdomRuntime()) {
    return null;
  }

  try {
    return globalThis.document?.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

const defaultStorage: RecentFilesStorage = {
  getItem(key) {
    const storage = getBrowserStorage();

    if (!storage) {
      return fallbackStorage.get(key) ?? null;
    }

    try {
      return storage.getItem(key);
    } catch {
      return fallbackStorage.get(key) ?? null;
    }
  },
  setItem(key, value) {
    const storage = getBrowserStorage();

    if (!storage) {
      fallbackStorage.set(key, value);
      return;
    }

    try {
      storage.setItem(key, value);
    } catch {
      fallbackStorage.set(key, value);
    }
  },
};

function parseRecentFiles(value: string | null): RecentFile[] {
  if (!value) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isRecentFile)
      .slice(0, MAX_RECENT_FILES);
  } catch {
    return [];
  }
}

function loadRecentFiles(storage: RecentFilesStorage): RecentFile[] {
  try {
    return parseRecentFiles(storage.getItem(RECENT_FILES_STORAGE_KEY));
  } catch {
    return [];
  }
}

function isRecentFile(value: unknown): value is RecentFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const file = value as Record<string, unknown>;

  return (
    typeof file.name === 'string' &&
    typeof file.openedAt === 'number' &&
    Number.isFinite(file.openedAt) &&
    typeof file.path === 'string'
  );
}

export function createRecentFilesStore(storage: RecentFilesStorage = defaultStorage) {
  return create<RecentFilesState>((set) => ({
    recentFiles: loadRecentFiles(storage),
    addRecentFile: (file) => {
      set((state) => {
        const nextFile: RecentFile = {
          name: file.name,
          openedAt: file.openedAt ?? Date.now(),
          path: file.path,
        };
        const recentFiles = [
          nextFile,
          ...state.recentFiles.filter(
            (recentFile) => recentFile.path !== file.path,
          ),
        ].slice(0, MAX_RECENT_FILES);

        storage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(recentFiles));

        return { recentFiles };
      });
    },
    clearRecentFiles: () => {
      storage.setItem(RECENT_FILES_STORAGE_KEY, '[]');
      set({ recentFiles: [] });
    },
  }));
}

export const useRecentFilesStore = createRecentFilesStore();
