import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReadingAppearanceStore } from '../../features/reading-appearance/readingAppearanceStore';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { useStartupStore } from '../../features/startup/startupStore';
import { createDefaultLumaMarkSettings } from '../../services/settings/settingsTypes';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { useAppStore } from '../stores/appStore';
import { applySettingsToLegacyStores, patchSettings } from './applySettings';

afterEach(() => {
  vi.useRealTimers();
});

describe('applySettingsToLegacyStores', () => {
  it('rehydrates copyImagesToAssets and fontZoomPercent into legacy stores', () => {
    useAppStore.getState().setCopyImagesToAssets(false);
    useReadingAppearanceStore.setState({ fontZoomPercent: 100 });
    useAppPreferencesStore.setState({ theme: 'light' });

    const settings = createDefaultLumaMarkSettings();
    settings.images.copyImagesToAssets = true;
    settings.appearance.fontZoomPercent = 140;
    settings.appearance.theme = 'dark';
    settings.appearance.pageWidth = 'wide';

    applySettingsToLegacyStores(settings);

    expect(useAppStore.getState().copyImagesToAssets).toBe(true);
    expect(useReadingAppearanceStore.getState().fontZoomPercent).toBe(140);
    expect(useReadingAppearanceStore.getState().pageWidth).toBe('wide');
    expect(useAppPreferencesStore.getState().theme).toBe('dark');
  });

  it('preserves startup local-storage errors while projecting startup behavior', () => {
    useStartupStore.setState({
      startupBehavior: 'restoreLastSession',
      startupPersistenceError: true,
    });
    const settings = createDefaultLumaMarkSettings();

    applySettingsToLegacyStores(settings);

    expect(useStartupStore.getState().startupBehavior).toBe('home');
    expect(useStartupStore.getState().startupPersistenceError).toBe(true);
  });

  it('projects the canonical normalized value instead of the raw patch', () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settings: createDefaultLumaMarkSettings() });
    useReadingAppearanceStore.setState({ fontZoomPercent: 170 });
    useStartupStore.setState({ startupPersistenceError: true });

    patchSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 55 },
    }));

    expect(useSettingsStore.getState().settings.appearance.fontZoomPercent).toBe(
      100,
    );
    expect(useReadingAppearanceStore.getState().fontZoomPercent).toBe(100);
    expect(useStartupStore.getState().startupPersistenceError).toBe(true);
  });
});
