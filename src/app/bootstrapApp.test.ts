import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReadingAppearanceStore } from '../features/reading-appearance/readingAppearanceStore';
import { useRecentFilesStore } from '../features/recent-files/recentFilesStore';
import { useSettingsStore } from '../features/settings/settingsStore';
import { useStartupStore } from '../features/startup/startupStore';
import {
  browserPreferenceStorage,
  type PreferenceStorage,
} from '../services/preferences/browserPreferenceStorage';
import { BROWSER_SETTINGS_STORAGE_KEY } from '../services/settings/settingsClient';
import { createDefaultLumaMarkSettings } from '../services/settings/settingsTypes';
import { i18n } from '../shared/i18n';
import { bootstrapApp } from './bootstrapApp';
import { useAppStore } from './stores/appStore';
import {
  createAppPreferencesStore,
  useAppPreferencesStore,
} from './stores/appPreferencesStore';

function createMemoryStorage(): PreferenceStorage {
  const values = new Map<string, string>();

  return {
    getItem: (name) => values.get(name) ?? null,
    removeItem: (name) => {
      values.delete(name);
    },
    setItem: (name, value) => {
      values.set(name, value);
    },
  };
}

describe('bootstrapApp', () => {
  afterEach(() => {
    browserPreferenceStorage.removeItem(BROWSER_SETTINGS_STORAGE_KEY);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('applies persisted language and theme before the first render', async () => {
    const storage = createMemoryStorage();
    const previousSession = createAppPreferencesStore(storage);
    previousSession.getState().setLanguage('en');
    previousSession.getState().setTheme('dark');
    const restartedSession = createAppPreferencesStore(storage);

    await i18n.changeLanguage('zh-CN');
    document.documentElement.lang = 'zh-CN';
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';

    let renderSnapshot: Record<string, string | undefined> | undefined;
    await bootstrapApp(
      () => {
        renderSnapshot = {
          colorScheme: document.documentElement.style.colorScheme,
          i18nLanguage: i18n.resolvedLanguage,
          language: document.documentElement.lang,
          theme: document.documentElement.dataset.theme,
        };
      },
      restartedSession.getState(),
    );

    expect(renderSnapshot).toEqual({
      colorScheme: 'dark',
      i18nLanguage: 'en',
      language: 'en',
      theme: 'dark',
    });
  });

  it('hydrates recent files before the first render', async () => {
    const order: string[] = [];
    vi.spyOn(
      useRecentFilesStore.getState(),
      'hydrateFromClient',
    ).mockImplementation(async () => {
      order.push('recent-files');
    });

    await bootstrapApp(
      () => {
        order.push('render');
      },
      { language: 'en', theme: 'light' },
    );

    expect(order).toEqual(['recent-files', 'render']);
  });

  it('resolves the system theme before the first render', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }) as MediaQueryList),
    );
    let renderedTheme: string | undefined;

    await bootstrapApp(
      () => {
        renderedTheme = document.documentElement.dataset.theme;
      },
      { language: 'en', theme: 'system' as never },
    );

    expect(renderedTheme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('projects safe in-memory settings before rendering when hydration rejects a future version', async () => {
    const safeSettings = createDefaultLumaMarkSettings();
    const futureSettingsDocument = JSON.stringify({ version: 3 });
    browserPreferenceStorage.setItem(
      BROWSER_SETTINGS_STORAGE_KEY,
      futureSettingsDocument,
    );
    useSettingsStore.setState({
      loadState: { status: 'idle' },
      settings: safeSettings,
      writeState: { status: 'idle' },
    });
    useAppPreferencesStore.setState({ language: 'en', theme: 'dark' });
    useReadingAppearanceStore.setState({
      fontZoomPercent: 140,
      pageWidth: 'wide',
    });
    useAppStore.setState({ copyImagesToAssets: true, sidebarOpen: false });
    useStartupStore.setState({ startupBehavior: 'restoreLastSession' });

    let renderSnapshot: Record<string, unknown> | undefined;
    await bootstrapApp(() => {
      renderSnapshot = {
        copyImagesToAssets: useAppStore.getState().copyImagesToAssets,
        fontZoomPercent:
          useReadingAppearanceStore.getState().fontZoomPercent,
        language: useAppPreferencesStore.getState().language,
        pageWidth: useReadingAppearanceStore.getState().pageWidth,
        sidebarOpen: useAppStore.getState().sidebarOpen,
        startupBehavior: useStartupStore.getState().startupBehavior,
        theme: useAppPreferencesStore.getState().theme,
      };
    });

    expect(renderSnapshot).toEqual({
      copyImagesToAssets: safeSettings.images.copyImagesToAssets,
      fontZoomPercent: safeSettings.appearance.fontZoomPercent,
      language: safeSettings.general.language,
      pageWidth: safeSettings.appearance.pageWidth,
      sidebarOpen: safeSettings.appearance.sidebarOpenOnStartup,
      startupBehavior: safeSettings.general.startupBehavior,
      theme: safeSettings.appearance.theme,
    });
    expect(useSettingsStore.getState().loadState).toEqual({
      code: 'settings.unsupported_version',
      status: 'unsupportedVersion',
    });
    expect(useSettingsStore.getState().writeState).toEqual({ status: 'idle' });

    useSettingsStore.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, theme: 'dark' },
    }));
    await useSettingsStore.getState().flushPendingWrites();

    expect(browserPreferenceStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY)).toBe(
      futureSettingsDocument,
    );
  });
});
