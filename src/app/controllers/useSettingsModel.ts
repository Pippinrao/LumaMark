import { useState } from 'react';
import { useAppStore } from '../stores/appStore';

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

  return {
    copyImagesToAssets,
    language,
    setCopyImagesToAssets,
    setLanguage,
    setSettingsOpen,
    setTheme,
    settingsOpen,
    theme,
    toggleLanguage,
    toggleTheme,
  };
}
