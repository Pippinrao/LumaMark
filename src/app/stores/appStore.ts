import { create } from 'zustand';
import type { FileMetadata } from '../../services/files/fileTypes';
import type { CommandError } from '../../services/tauri/invokeCommand';

export type StatusKey =
  | 'status.ready'
  | 'status.opening'
  | 'status.opened'
  | 'status.openFailed'
  | 'status.externalReloaded'
  | 'status.saved'
  | 'status.saveFailed'
  | 'status.unsaved'
  | 'status.workspaceOpened'
  | 'status.workspaceOpenFailed';

type AppState = {
  copyImagesToAssets: boolean;
  currentFile: FileMetadata | null;
  dirty: boolean;
  dirtyRevision: number;
  lastFileError: CommandError | null;
  sidebarOpen: boolean;
  statusKey: StatusKey;
  setCopyImagesToAssets: (copyImagesToAssets: boolean) => void;
  setCurrentFile: (currentFile: FileMetadata | null) => void;
  setDirty: (dirty: boolean) => void;
  setLastFileError: (lastFileError: CommandError | null) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
  setStatusKey: (statusKey: StatusKey) => void;
  toggleSidebar: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  copyImagesToAssets: false,
  currentFile: null,
  dirty: false,
  dirtyRevision: 0,
  lastFileError: null,
  sidebarOpen: true,
  statusKey: 'status.ready',
  setCopyImagesToAssets: (copyImagesToAssets) => {
    set({ copyImagesToAssets });
  },
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
  setLastFileError: (lastFileError) => {
    set((state) => ({
      lastFileError,
      statusKey: lastFileError
        ? 'status.saveFailed'
        : state.dirty
          ? 'status.unsaved'
          : 'status.ready',
    }));
  },
  setSidebarOpen: (sidebarOpen) => {
    set({ sidebarOpen });
  },
  setStatusKey: (statusKey) => {
    set({ statusKey });
  },
  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },
}));
