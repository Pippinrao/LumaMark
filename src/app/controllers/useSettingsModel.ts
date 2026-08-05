import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { useStartupStore } from '../../features/startup/startupStore';

export function useSettingsModel() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const copyImagesToAssets = useAppStore((state) => state.copyImagesToAssets);
  const language = useAppPreferencesStore((state) => state.language);
  const preferencesPersistenceError = useAppPreferencesStore(
    (state) => state.preferencesPersistenceError,
  );
  const theme = useAppPreferencesStore((state) => state.theme);
  const setLanguage = useAppPreferencesStore((state) => state.setLanguage);
  const setCopyImagesToAssets = useAppStore(
    (state) => state.setCopyImagesToAssets,
  );
  const setTheme = useAppPreferencesStore((state) => state.setTheme);
  const toggleLanguage = useAppPreferencesStore(
    (state) => state.toggleLanguage,
  );
  const toggleTheme = useAppPreferencesStore((state) => state.toggleTheme);
  const recentFilesPersistenceError = useRecentFilesStore(
    (state) => state.recentFilesPersistenceError,
  );
  const startupBehavior = useStartupStore((state) => state.startupBehavior);
  const startupPersistenceError = useStartupStore(
    (state) => state.startupPersistenceError,
  );
  const setStartupBehavior = useStartupStore((state) => state.setStartupBehavior);

  return {
    copyImagesToAssets,
    language,
    preferencesPersistenceError,
    recentFilesPersistenceError,
    setCopyImagesToAssets,
    setLanguage,
    setSettingsOpen,
    setTheme,
    settingsOpen,
    setStartupBehavior,
    startupBehavior,
    startupPersistenceError,
    theme,
    toggleLanguage,
    toggleTheme,
  };
}
