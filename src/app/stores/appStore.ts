import { create } from 'zustand';
import {
  defaultLanguage,
  supportedLanguages,
  type AppLanguage,
} from '../../shared/i18n';
import type { FileMetadata } from '../../services/files/fileTypes';
import type { CommandError } from '../../services/tauri/invokeCommand';

export type ThemeMode = 'light' | 'dark';

export type StatusKey =
  | 'status.ready'
  | 'status.opening'
  | 'status.opened'
  | 'status.openFailed'
  | 'status.saved'
  | 'status.saveFailed'
  | 'status.unsaved'
  | 'status.workspaceOpened'
  | 'status.workspaceOpenFailed';

type AppState = {
  currentFile: FileMetadata | null;
  dirty: boolean;
  dirtyRevision: number;
  lastFileError: CommandError | null;
  language: AppLanguage;
  sidebarOpen: boolean;
  statusKey: StatusKey;
  theme: ThemeMode;
  setCurrentFile: (currentFile: FileMetadata | null) => void;
  setDirty: (dirty: boolean) => void;
  setLanguage: (language: AppLanguage) => void;
  setLastFileError: (lastFileError: CommandError | null) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
  setStatusKey: (statusKey: StatusKey) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleLanguage: () => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  currentFile: null,
  dirty: false,
  dirtyRevision: 0,
  lastFileError: null,
  language: defaultLanguage,
  sidebarOpen: true,
  statusKey: 'status.ready',
  theme: 'light',
  setCurrentFile: (currentFile) => {
    set({ currentFile });
  },
  setDirty: (dirty) => {
    set((state) => {
      const statusKey = dirty ? 'status.unsaved' : 'status.ready';

      if (dirty) {
        return {
          dirty: true,
          dirtyRevision: state.dirtyRevision + 1,
          statusKey,
        };
      }

      if (state.dirty === dirty && state.statusKey === statusKey) {
        return state;
      }

      return { dirty, statusKey };
    });
  },
  setLanguage: (language) => {
    set({ language });
  },
  setLastFileError: (lastFileError) => {
    set({
      lastFileError,
      statusKey: lastFileError ? 'status.saveFailed' : 'status.ready',
    });
  },
  setSidebarOpen: (sidebarOpen) => {
    set({ sidebarOpen });
  },
  setStatusKey: (statusKey) => {
    set({ statusKey });
  },
  setTheme: (theme) => {
    set({ theme });
  },
  toggleLanguage: () => {
    set((state) => ({
      language:
        state.language === supportedLanguages[0]
          ? supportedLanguages[1]
          : supportedLanguages[0],
    }));
  },
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },
  toggleTheme: () => {
    set((state) => ({ theme: state.theme === 'light' ? 'dark' : 'light' }));
  },
}));
