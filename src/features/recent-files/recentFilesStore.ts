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

type RecentFilesState = {
  recentFiles: RecentFile[];
  addRecentFile: (file: RecentFileInput) => void;
  clearRecentFiles: () => void;
};

const MAX_RECENT_FILES = 20;

export const useRecentFilesStore = create<RecentFilesState>((set) => ({
  recentFiles: [],
  addRecentFile: (file) => {
    set((state) => {
      const nextFile: RecentFile = {
        name: file.name,
        openedAt: file.openedAt ?? Date.now(),
        path: file.path,
      };

      return {
        recentFiles: [
          nextFile,
          ...state.recentFiles.filter(
            (recentFile) => recentFile.path !== file.path,
          ),
        ].slice(0, MAX_RECENT_FILES),
      };
    });
  },
  clearRecentFiles: () => {
    set({ recentFiles: [] });
  },
}));
