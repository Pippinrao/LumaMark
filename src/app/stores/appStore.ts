import { create } from 'zustand';
import {
  defaultLanguage,
  supportedLanguages,
  type AppLanguage,
} from '../../shared/i18n';

export type ThemeMode = 'light' | 'dark';

type StatusKey = 'status.ready';

type AppState = {
  language: AppLanguage;
  sidebarOpen: boolean;
  statusKey: StatusKey;
  theme: ThemeMode;
  setLanguage: (language: AppLanguage) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
  setStatusKey: (statusKey: StatusKey) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleLanguage: () => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  language: defaultLanguage,
  sidebarOpen: true,
  statusKey: 'status.ready',
  theme: 'light',
  setLanguage: (language) => {
    set({ language });
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
