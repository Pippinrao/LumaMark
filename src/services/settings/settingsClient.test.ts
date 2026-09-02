import { describe, expect, it, vi } from 'vitest';

import {
  createSettingsClient,
  BROWSER_SETTINGS_STORAGE_KEY,
  markSettingsAcceptanceCloseEntered,
  SETTINGS_MIGRATION_MARK_KEY,
} from './settingsClient';
import { migrateLegacyLocalStorageSettings } from './migrateLegacySettings';
import {
  createDefaultLumaMarkSettings,
  normalizeLumaMarkSettings,
} from './settingsTypes';
import type { PreferenceStorage } from '../preferences/browserPreferenceStorage';

function createMemoryStorage(initial: Record<string, string> = {}): PreferenceStorage {
  const values = new Map(Object.entries(initial));

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

describe('normalizeLumaMarkSettings', () => {
  it('recovers invalid font zoom and unknown enums to defaults', () => {
    const result = normalizeLumaMarkSettings({
      appearance: {
        fontZoomPercent: 0,
        pageWidth: 'huge',
        sidebarOpenOnStartup: true,
        theme: 'sepia',
      },
      editor: {
        defaultDisplayMode: 'livePreview',
        focusModeOnStartup: false,
      },
      general: {
        language: 'zh-CN',
        startupBehavior: 'home',
      },
      images: {
        copyImagesToAssets: false,
      },
      version: 1,
    });

    expect(result.hadInvalidFields).toBe(true);
    expect(result.settings.appearance.fontZoomPercent).toBe(100);
    expect(result.settings.appearance.pageWidth).toBe('fluid');
    expect(result.settings.appearance.theme).toBe('light');
  });
});

describe('settingsClient', () => {
  it('routes the acceptance close-entered signal through its dedicated command', async () => {
    const invokeFn = vi.fn().mockResolvedValue(true);

    await markSettingsAcceptanceCloseEntered(invokeFn);

    expect(invokeFn).toHaveBeenCalledWith(
      'settings_acceptance_mark_close_entered',
      undefined,
    );
  });

  it('fails closed when the acceptance close-entered command rejects', async () => {
    await expect(
      markSettingsAcceptanceCloseEntered(async () => {
        throw {
          code: 'settings.acceptance_write_barrier_failed',
          message: 'barrier unavailable',
          recoverable: false,
        };
      }),
    ).rejects.toMatchObject({
      code: 'settings.acceptance_write_barrier_failed',
      recoverable: false,
    });
  });

  it.each([
    ['getItem', 'settings.read_failed'],
    ['setItem', 'settings.write_failed'],
  ] as const)(
    'gives browser %s failures the stable code %s',
    async (operation, code) => {
      const storage = createMemoryStorage();
      storage[operation] = () => {
        throw new Error('browser storage denied');
      };
      const client = createSettingsClient({
        preferBrowserStorage: true,
        storage,
      });

      const result =
        operation === 'getItem'
          ? client.getSettings()
          : client.setSettings(createDefaultLumaMarkSettings());

      await expect(result).rejects.toMatchObject({ code, recoverable: true });
    },
  );

  it('throws a clear error when invoke fails instead of falling back to defaults', async () => {
    const client = createSettingsClient({
      preferBrowserStorage: false,
      invokeFn: async () => {
        throw { code: 'settings.failed', message: 'disk full', recoverable: true };
      },
    });

    await expect(client.getSettings()).rejects.toThrow('disk full');
    await expect(client.getSettings()).rejects.toMatchObject({
      code: 'settings.failed',
      recoverable: true,
    });
  });

  it('preserves a future browser document and reports unsupported version', async () => {
    const settings = createDefaultLumaMarkSettings() as unknown as Record<
      string,
      unknown
    >;
    settings.version = 99;
    const raw = JSON.stringify(settings);
    const storage = createMemoryStorage({
      [BROWSER_SETTINGS_STORAGE_KEY]: raw,
    });
    const client = createSettingsClient({
      preferBrowserStorage: true,
      storage,
    });

    await expect(client.getSettings()).rejects.toMatchObject({
      code: 'settings.unsupported_version',
    });
    expect(storage.getItem(BROWSER_SETTINGS_STORAGE_KEY)).toBe(raw);
  });

  it('persists through browser storage when Tauri is unavailable', async () => {
    const storage = createMemoryStorage();
    const client = createSettingsClient({
      preferBrowserStorage: true,
      storage,
    });
    const settings = createDefaultLumaMarkSettings();
    settings.images.copyImagesToAssets = true;
    settings.appearance.fontZoomPercent = 120;

    await client.setSettings(settings);
    const loaded = await client.getSettings();

    expect(loaded.settings.images.copyImagesToAssets).toBe(true);
    expect(loaded.settings.appearance.fontZoomPercent).toBe(120);
    expect(storage.getItem(BROWSER_SETTINGS_STORAGE_KEY)).toContain(
      'copyImagesToAssets',
    );
  });
});

describe('migrateLegacyLocalStorageSettings', () => {
  it('maps legacy keys and leaves session fields untouched in storage', () => {
    const storage = createMemoryStorage({
      'lumamark.app-preferences.v1': JSON.stringify({
        language: 'en',
        theme: 'dark',
        version: 1,
      }),
      'lumamark.reading-appearance.v1': JSON.stringify({
        state: { pageWidth: 'wide' },
        version: 1,
      }),
      'lumamark.startup.v1': JSON.stringify({
        lastSession: { kind: 'file', path: 'C:/notes/a.md' },
        recentWorkspaces: [{ name: 'ws', openedAt: 1, path: 'C:/ws' }],
        startupBehavior: 'restoreLastSession',
        version: 1,
      }),
      'lumamark.sidebar-open.v1': 'false',
    });

    const result = migrateLegacyLocalStorageSettings(
      storage,
      createDefaultLumaMarkSettings(),
    );

    expect(result.migrated).toBe(true);
    expect(result.settings.general.language).toBe('en');
    expect(result.settings.appearance.theme).toBe('dark');
    expect(result.settings.appearance.pageWidth).toBe('wide');
    expect(result.settings.general.startupBehavior).toBe('restoreLastSession');
    expect(result.settings.appearance.sidebarOpenOnStartup).toBe(false);

    const startupRaw = storage.getItem('lumamark.startup.v1');
    expect(startupRaw).toContain('lastSession');
    expect(startupRaw).toContain('recentWorkspaces');
    expect(storage.getItem(SETTINGS_MIGRATION_MARK_KEY)).toBeNull();
  });

  it('is idempotent once the migration mark exists', () => {
    const storage = createMemoryStorage({
      [SETTINGS_MIGRATION_MARK_KEY]: '1',
      'lumamark.app-preferences.v1': JSON.stringify({
        language: 'en',
        theme: 'dark',
        version: 1,
      }),
    });
    const base = createDefaultLumaMarkSettings();
    base.general.language = 'zh-CN';

    const result = migrateLegacyLocalStorageSettings(storage, base);

    expect(result.migrated).toBe(false);
    expect(result.settings.general.language).toBe('zh-CN');
    expect(storage.getItem('lumamark.app-preferences.v1')).toContain('en');
  });

  it('keeps all legacy preference keys after a successful migration', () => {
    const storage = createMemoryStorage({
      'lumamark.app-preferences.v1': JSON.stringify({
        language: 'en',
        theme: 'dark',
        version: 1,
      }),
      'lumamark.reading-appearance.v1': JSON.stringify({
        state: { pageWidth: 'narrow' },
        version: 1,
      }),
      'lumamark.startup.v1': JSON.stringify({
        lastSession: null,
        recentWorkspaces: [],
        startupBehavior: 'home',
        version: 1,
      }),
      'lumamark.sidebar-open.v1': 'true',
    });

    migrateLegacyLocalStorageSettings(storage, createDefaultLumaMarkSettings());

    expect(storage.getItem('lumamark.app-preferences.v1')).not.toBeNull();
    expect(storage.getItem('lumamark.reading-appearance.v1')).not.toBeNull();
    expect(storage.getItem('lumamark.startup.v1')).not.toBeNull();
    expect(storage.getItem('lumamark.sidebar-open.v1')).toBe('true');
    expect(storage.getItem(SETTINGS_MIGRATION_MARK_KEY)).toBeNull();
  });
});

describe('settingsStore invalid values', () => {
  it('surfaces corruption recovery when hydrate restored defaults', async () => {
    const { createSettingsStore } = await import(
      '../../features/settings/settingsStore'
    );
    const store = createSettingsStore({
      client: {
        getSettings: async () => ({
          corruptBackupPath: null,
          hadInvalidFields: false,
          settings: createDefaultLumaMarkSettings(),
          settingsFileExists: true,
          usedDefaultsDueToCorruption: true,
        }),
        setSettings: async () => undefined,
      },
      migrateLegacy: false,
    });

    await store.getState().hydrateFromClient();

    expect(store.getState().recoveryState).toEqual({
      backupPath: null,
      kind: 'corruption',
    });
  });

  it('marks field recovery separately when an update contains invalid fields', async () => {
    const { createSettingsStore } = await import(
      '../../features/settings/settingsStore'
    );
    const store = createSettingsStore({
      client: {
        getSettings: async () => ({
          corruptBackupPath: null,
          hadInvalidFields: false,
          settings: createDefaultLumaMarkSettings(),
          settingsFileExists: true,
          usedDefaultsDueToCorruption: false,
        }),
        setSettings: async () => undefined,
      },
      debounceMs: 10,
      migrateLegacy: false,
    });

    store.getState().updateSettings((current) => ({
      ...current,
      appearance: {
        ...current.appearance,
        fontZoomPercent: 0,
        pageWidth: 'poster' as never,
      },
    }));

    expect(store.getState().recoveryState).toEqual({ kind: 'invalidFields' });
    expect(store.getState().settings.appearance.fontZoomPercent).toBe(100);
    expect(store.getState().settings.appearance.pageWidth).toBe('fluid');
  });
});

describe('settingsStore debounce', () => {
  it('writes once for burst updates inside the debounce window', async () => {
    vi.useFakeTimers();
    const setSettings = vi.fn<(settings: ReturnType<typeof createDefaultLumaMarkSettings>) => Promise<void>>(
      async () => undefined,
    );
    const getSettings = vi.fn(async () => ({
      corruptBackupPath: null,
      hadInvalidFields: false,
      settings: createDefaultLumaMarkSettings(),
      settingsFileExists: true,
      usedDefaultsDueToCorruption: false,
    }));
    const { createSettingsStore } = await import(
      '../../features/settings/settingsStore'
    );
    const store = createSettingsStore({
      client: { getSettings, setSettings },
      debounceMs: 400,
      migrateLegacy: false,
    });

    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 110 },
    }));
    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 120 },
    }));
    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 130 },
    }));

    expect(setSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(setSettings).toHaveBeenCalledTimes(1);
    const written = setSettings.mock.calls[0]?.[0];
    expect(written?.appearance.fontZoomPercent).toBe(130);
    vi.useRealTimers();
  });
});
