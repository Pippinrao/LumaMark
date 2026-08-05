import { useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { useStartupStore } from '../../features/startup/startupStore';

export function useSettingsModel() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const copyImagesToAssets = useAppStore((state) => state.copyImagesToAssets);
  const language = useAppStore((state) => state.language);
  const theme = useAppStore((state) => state.theme);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const setCopyImagesToAssets = useAppStore(
    (state) => state.setCopyImagesToAssets,
  );
  const setTheme = useAppStore((state) => state.setTheme);
  const toggleLanguage = useAppStore((state) => state.toggleLanguage);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
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
