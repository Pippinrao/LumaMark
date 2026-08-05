import { create } from 'zustand';
import {
  browserPreferenceStorage,
  type KeyValueStorage,
} from '../../services/preferences/browserPreferenceStorage';

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

type RecentFilesState = {
  recentFiles: RecentFile[];
  recentFilesPersistenceError: boolean;
  addRecentFile: (file: RecentFileInput) => void;
  clearRecentFiles: () => void;
};

const MAX_RECENT_FILES = 20;
const RECENT_FILES_STORAGE_KEY = 'lumamark.recent-files.v1';

function parseRecentFiles(value: string | null): RecentFile[] {
  if (value === null) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed) || !parsed.every(isRecentFile)) {
    throw new Error('Invalid persisted recent files');
  }

  return parsed.slice(0, MAX_RECENT_FILES);
}

function loadRecentFiles(
  storage: KeyValueStorage,
): Pick<RecentFilesState, 'recentFiles' | 'recentFilesPersistenceError'> {
  try {
    return {
      recentFiles: parseRecentFiles(storage.getItem(RECENT_FILES_STORAGE_KEY)),
      recentFilesPersistenceError: false,
    };
  } catch {
    return {
      recentFiles: [],
      recentFilesPersistenceError: true,
    };
  }
}

function persistRecentFiles(
  storage: KeyValueStorage,
  recentFiles: RecentFile[],
): boolean {
  try {
    storage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(recentFiles));
    return true;
  } catch {
    return false;
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

export function createRecentFilesStore(
  storage: KeyValueStorage = browserPreferenceStorage,
) {
  return create<RecentFilesState>((set) => ({
    ...loadRecentFiles(storage),
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

        return {
          recentFiles,
          recentFilesPersistenceError: !persistRecentFiles(
            storage,
            recentFiles,
          ),
        };
      });
    },
    clearRecentFiles: () => {
      const recentFiles: RecentFile[] = [];

      set({
        recentFiles,
        recentFilesPersistenceError: !persistRecentFiles(storage, recentFiles),
      });
    },
  }));
}

export const useRecentFilesStore = createRecentFilesStore();
