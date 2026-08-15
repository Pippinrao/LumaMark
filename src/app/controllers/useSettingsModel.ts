import { useCallback, useEffect, useState } from 'react';

import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { useStartupStore } from '../../features/startup/startupStore';
import { useReadingAppearanceStore } from '../../features/reading-appearance/readingAppearanceStore';
import { patchSettings } from './applySettings';
import { useSettingsStore } from '../../features/settings/settingsStore';
import type { AppLanguage } from '../../shared/i18n';
import type { EditorPageWidth } from '../../features/reading-appearance/readingAppearanceStore';
import type { StartupBehavior } from '../../features/startup/startupStore';
import type { ThemeMode } from '../stores/appPreferencesStore';

export function useSettingsModel() {
  const [settingsOpen, setSettingsOpenState] = useState(false);
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoadState = useSettingsStore((state) => state.loadState);
  const settingsRecoveryState = useSettingsStore(
    (state) => state.recoveryState,
  );
  const settingsWriteState = useSettingsStore((state) => state.writeState);
  const flushPendingWrites = useSettingsStore(
    (state) => state.flushPendingWrites,
  );
  const retryPendingWrites = useSettingsStore(
    (state) => state.retryPendingWrites,
  );
  const copyImagesToAssets = settings.images.copyImagesToAssets;
  const language = settings.general.language;
  const theme = settings.appearance.theme;
  const pageWidth = settings.appearance.pageWidth;
  const fontZoomPercent = settings.appearance.fontZoomPercent;
  const pageWidthPersistenceError = useReadingAppearanceStore(
    (state) => state.pageWidthPersistenceError,
  );
  const recentFilesPersistenceError = useRecentFilesStore(
    (state) => state.recentFilesPersistenceError,
  );
  const startupBehavior = settings.general.startupBehavior;
  const startupPersistenceError = useStartupStore(
    (state) => state.startupPersistenceError,
  );
  const clearRecentFiles = useRecentFilesStore(
    (state) => state.clearRecentFiles,
  );

  const setSettingsOpen = useCallback(
    (open: boolean) => {
      setSettingsOpenState(open);
      if (!open) {
        void flushPendingWrites().catch(() => undefined);
      }
    },
    [flushPendingWrites],
  );

  useEffect(
    () => () => {
      void flushPendingWrites().catch(() => undefined);
    },
    [flushPendingWrites],
  );

  const setLanguage = useCallback((next: AppLanguage) => {
    patchSettings((current) => ({
      ...current,
      general: { ...current.general, language: next },
    }));
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    patchSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, theme: next },
    }));
  }, []);

  const setCopyImagesToAssets = useCallback((next: boolean) => {
    patchSettings((current) => ({
      ...current,
      images: { ...current.images, copyImagesToAssets: next },
    }));
  }, []);

  const setStartupBehavior = useCallback((next: StartupBehavior) => {
    patchSettings((current) => ({
      ...current,
      general: { ...current.general, startupBehavior: next },
    }));
  }, []);

  const setPageWidth = useCallback((next: EditorPageWidth) => {
    patchSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, pageWidth: next },
    }));
  }, []);

  const setFontZoomPercent = useCallback((next: number) => {
    patchSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: next },
    }));
  }, []);

  const setSidebarOpenOnStartup = useCallback((next: boolean) => {
    patchSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, sidebarOpenOnStartup: next },
    }));
  }, []);

  const setDefaultDisplayMode = useCallback(
    (next: 'livePreview' | 'source') => {
      patchSettings((current) => ({
        ...current,
        editor: { ...current.editor, defaultDisplayMode: next },
      }));
    },
    [],
  );

  const setFocusModeOnStartup = useCallback((next: boolean) => {
    patchSettings((current) => ({
      ...current,
      editor: { ...current.editor, focusModeOnStartup: next },
    }));
  }, []);

  const setAutosaveEnabled = useCallback((next: boolean) => {
    patchSettings((current) => ({
      ...current,
      editor: { ...current.editor, autosaveEnabled: next },
    }));
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN');
  }, [language, setLanguage]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [setTheme, theme]);

  const retrySettingsWrite = useCallback(() => {
    void retryPendingWrites().catch(() => undefined);
  }, [retryPendingWrites]);

  return {
    clearRecentFiles,
    copyImagesToAssets,
    defaultDisplayMode: settings.editor.defaultDisplayMode,
    autosaveEnabled: settings.editor.autosaveEnabled,
    focusModeOnStartup: settings.editor.focusModeOnStartup,
    fontZoomPercent,
    flushPendingWrites,
    language,
    pageWidth,
    pageWidthPersistenceError,
    recentFilesPersistenceError,
    retrySettingsWrite,
    setAutosaveEnabled,
    setCopyImagesToAssets,
    setDefaultDisplayMode,
    setFocusModeOnStartup,
    setFontZoomPercent,
    setLanguage,
    setPageWidth,
    setSettingsOpen,
    setSidebarOpenOnStartup,
    setStartupBehavior,
    setTheme,
    settingsOpen,
    settingsLoadState,
    settingsRecoveryState,
    settingsWriteState,
    sidebarOpenOnStartup: settings.appearance.sidebarOpenOnStartup,
    startupBehavior,
    startupPersistenceError,
    theme,
    toggleLanguage,
    toggleTheme,
  };
}
