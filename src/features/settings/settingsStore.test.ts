import { describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../../services/preferences/browserPreferenceStorage';
import {
  BROWSER_SETTINGS_STORAGE_KEY,
  createSettingsClient,
  SETTINGS_MIGRATION_MARK_KEY,
  type SettingsClient,
} from '../../services/settings/settingsClient';
import {
  createDefaultLumaMarkSettings,
  type LumaMarkSettings,
} from '../../services/settings/settingsTypes';
import { createSettingsStore } from './settingsStore';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const events: string[] = [];
  const storage: PreferenceStorage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      events.push(`storage:${key}`);
      values.set(key, value);
    },
  };
  return { events, storage, values };
}

function createLoadResult(settingsFileExists: boolean) {
  return {
    corruptBackupPath: null,
    hadInvalidFields: false,
    settings: createDefaultLumaMarkSettings(),
    settingsFileExists,
    usedDefaultsDueToCorruption: false,
  };
}

describe('settings migration orchestration', () => {
  it('does not create settings or a marker when no config and no legacy values exist', async () => {
    const { storage } = createMemoryStorage();
    const setSettings = vi.fn<SettingsClient['setSettings']>(
      async () => undefined,
    );
    const store = createSettingsStore({
      client: {
        getSettings: async () => createLoadResult(false),
        setSettings,
      },
      legacyStorage: storage,
    });

    await store.getState().hydrateFromClient();

    expect(setSettings).not.toHaveBeenCalled();
    expect(storage.getItem(SETTINGS_MIGRATION_MARK_KEY)).toBeNull();
  });

  it('never lets legacy localStorage overwrite an existing settings file', async () => {
    const { storage } = createMemoryStorage({
      'lumamark.app-preferences.v1': JSON.stringify({
        language: 'en',
        theme: 'dark',
        version: 1,
      }),
    });
    const setSettings = vi.fn(async () => undefined);
    const store = createSettingsStore({
      client: {
        getSettings: async () => createLoadResult(true),
        setSettings,
      },
      legacyStorage: storage,
    });

    await store.getState().hydrateFromClient();

    expect(store.getState().settings.appearance.theme).toBe('light');
    expect(setSettings).not.toHaveBeenCalled();
    expect(storage.getItem(SETTINGS_MIGRATION_MARK_KEY)).toBeNull();
  });

  it('marks migration only after the migrated settings have persisted', async () => {
    const { events, storage } = createMemoryStorage({
      'lumamark.update-preferences.v1': JSON.stringify({
        autoCheckOnStartup: false,
        version: 1,
      }),
    });
    const client: SettingsClient = {
      getSettings: async () => createLoadResult(false),
      setSettings: async (settings) => {
        events.push(`client:${settings.updates.autoCheckOnStartup}`);
      },
    };
    const store = createSettingsStore({ client, legacyStorage: storage });

    await store.getState().hydrateFromClient();

    expect(events).toEqual([
      'client:false',
      `storage:${SETTINGS_MIGRATION_MARK_KEY}`,
    ]);
  });

  it('leaves the marker absent after persistence failure so migration can retry', async () => {
    const { storage } = createMemoryStorage({
      'lumamark.update-preferences.v1': JSON.stringify({
        autoCheckOnStartup: false,
        version: 1,
      }),
    });
    const store = createSettingsStore({
      client: {
        getSettings: async () => createLoadResult(false),
        setSettings: async () => {
          throw new Error('disk full');
        },
      },
      legacyStorage: storage,
    });

    await store.getState().hydrateFromClient();

    expect(store.getState().writeState).toEqual({
      code: 'settings.write_failed',
      status: 'failed',
    });
    expect(storage.getItem(SETTINGS_MIGRATION_MARK_KEY)).toBeNull();
  });

  it('surfaces legacy storage access failures with a stable migration code', async () => {
    const storage: PreferenceStorage = {
      getItem: () => {
        throw new DOMException('Storage access denied', 'SecurityError');
      },
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    const store = createSettingsStore({
      client: {
        getSettings: async () => createLoadResult(false),
        setSettings: vi.fn().mockResolvedValue(undefined),
      },
      legacyStorage: storage,
    });

    await store.getState().hydrateFromClient();

    expect(store.getState().loadState).toEqual({ status: 'ready' });
    expect(store.getState().writeState).toEqual({
      code: 'settings.legacy_migration_failed',
      status: 'failed',
    });
  });

  it('blocks canonical writes after a legacy read failure so restart can still migrate', async () => {
    const { storage: backingStorage, values } = createMemoryStorage({
      'lumamark.app-preferences.v1': JSON.stringify({
        language: 'en',
        theme: 'dark',
        version: 1,
      }),
    });
    let legacyReadsBlocked = true;
    const legacyStorage: PreferenceStorage = {
      getItem: (key) => {
        if (legacyReadsBlocked) {
          throw new DOMException('Storage access denied', 'SecurityError');
        }
        return backingStorage.getItem(key);
      },
      removeItem: backingStorage.removeItem,
      setItem: backingStorage.setItem,
    };
    let canonicalSettings: LumaMarkSettings | null = null;
    const setSettings = vi.fn<SettingsClient['setSettings']>(async (settings) => {
      canonicalSettings = structuredClone(settings);
    });
    const client: SettingsClient = {
      getSettings: async () =>
        canonicalSettings === null
          ? createLoadResult(false)
          : {
              ...createLoadResult(true),
              settings: structuredClone(canonicalSettings),
            },
      setSettings,
    };
    const firstRun = createSettingsStore({
      client,
      debounceMs: 1_000,
      legacyStorage,
    });

    await firstRun.getState().hydrateFromClient();
    firstRun.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 120 },
    }));
    await firstRun.getState().flushPendingWrites();

    expect(firstRun.getState().writeState).toEqual({
      code: 'settings.legacy_migration_failed',
      status: 'failed',
    });
    expect(setSettings).not.toHaveBeenCalled();
    expect(canonicalSettings).toBeNull();
    expect(values.get(SETTINGS_MIGRATION_MARK_KEY)).toBeUndefined();

    legacyReadsBlocked = false;
    const restarted = createSettingsStore({ client, legacyStorage });
    await restarted.getState().hydrateFromClient();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]).toMatchObject({
      appearance: { theme: 'dark' },
      general: { language: 'en' },
    });
    expect(restarted.getState().writeState).toEqual({ status: 'idle' });
    expect(values.get(SETTINGS_MIGRATION_MARK_KEY)).toBe('1');
  });
});

describe('settings write lifecycle', () => {
  it('distinguishes invalid-field recovery from corruption recovery', async () => {
    const invalidStore = createSettingsStore({
      client: {
        getSettings: async () => ({
          ...createLoadResult(true),
          hadInvalidFields: true,
        }),
        setSettings: async () => undefined,
      },
      migrateLegacy: false,
    });
    const corruptStore = createSettingsStore({
      client: {
        getSettings: async () => ({
          ...createLoadResult(true),
          corruptBackupPath: 'C:/LumaMark/settings.corrupt-1.json',
          usedDefaultsDueToCorruption: true,
        }),
        setSettings: async () => undefined,
      },
      migrateLegacy: false,
    });

    await invalidStore.getState().hydrateFromClient();
    await corruptStore.getState().hydrateFromClient();

    expect(invalidStore.getState().loadState).toEqual({ status: 'ready' });
    expect(invalidStore.getState().recoveryState).toEqual({
      kind: 'invalidFields',
    });
    expect(corruptStore.getState().loadState).toEqual({ status: 'ready' });
    expect(corruptStore.getState().recoveryState).toEqual({
      backupPath: 'C:/LumaMark/settings.corrupt-1.json',
      kind: 'corruption',
    });
    expect(corruptStore.getState().writeState).toEqual({ status: 'idle' });
  });

  it.each([
    ['settings.read_failed', 'readFailed'],
    ['settings.unsupported_version', 'unsupportedVersion'],
  ] as const)(
    'records hydration failure %s without replacing it with a generic boolean',
    async (code, status) => {
      const store = createSettingsStore({
        client: {
          getSettings: async () => {
            throw Object.assign(new Error(code), { code });
          },
          setSettings: async () => undefined,
        },
        migrateLegacy: false,
      });

      await expect(store.getState().hydrateFromClient()).rejects.toThrow(code);

      expect(store.getState().loadState).toEqual({ code, status });
    },
  );

  it('blocks later writes when hydration cannot safely read the existing settings file', async () => {
    const setSettings = vi.fn<SettingsClient['setSettings']>(
      async () => undefined,
    );
    const store = createSettingsStore({
      client: {
        getSettings: async () => {
          throw Object.assign(new Error('future settings version'), {
            code: 'settings.unsupported_version',
          });
        },
        setSettings,
      },
      debounceMs: 1_000,
      migrateLegacy: false,
    });

    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, theme: 'dark' },
    }));

    await expect(store.getState().hydrateFromClient()).rejects.toThrow(
      'future settings version',
    );

    store.getState().updateSettings((current) => ({
      ...current,
      general: { ...current.general, language: 'en' },
    }));
    await store.getState().flushPendingWrites();

    expect(store.getState().loadState).toEqual({
      code: 'settings.unsupported_version',
      status: 'unsupportedVersion',
    });
    expect(setSettings).not.toHaveBeenCalled();
  });

  it('preserves an overflowing future browser document and blocks later writes', async () => {
    const raw = '{"version":1e400,"future":"preserve exactly"}';
    const { events, storage } = createMemoryStorage({
      [BROWSER_SETTINGS_STORAGE_KEY]: raw,
    });
    const store = createSettingsStore({
      client: createSettingsClient({
        preferBrowserStorage: true,
        storage,
      }),
      debounceMs: 1,
      migrateLegacy: false,
    });

    await expect(store.getState().hydrateFromClient()).rejects.toMatchObject({
      code: 'settings.unsupported_version',
    });

    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, theme: 'dark' },
    }));
    await store.getState().flushPendingWrites();

    expect(store.getState().loadState).toEqual({
      code: 'settings.unsupported_version',
      status: 'unsupportedVersion',
    });
    expect(events).toEqual([]);
    expect(storage.getItem(BROWSER_SETTINGS_STORAGE_KEY)).toBe(raw);
  });

  it('flushes the latest debounced value immediately', async () => {
    vi.useFakeTimers();
    const setSettings = vi.fn<SettingsClient['setSettings']>(
      async () => undefined,
    );
    const store = createSettingsStore({
      client: {
        getSettings: async () => createLoadResult(true),
        setSettings,
      },
      debounceMs: 400,
      migrateLegacy: false,
    });

    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 120 },
    }));
    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 130 },
    }));

    await store.getState().flushPendingWrites();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]?.appearance.fontZoomPercent).toBe(130);
    await vi.advanceTimersByTimeAsync(400);
    expect(setSettings).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('serializes a write queued while the previous write is still pending', async () => {
    let resolveFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const values: number[] = [];
    const setSettings = vi.fn(async (settings) => {
      values.push(settings.appearance.fontZoomPercent);
      if (values.length === 1) {
        await first;
      }
    });
    const store = createSettingsStore({
      client: {
        getSettings: async () => createLoadResult(true),
        setSettings,
      },
      debounceMs: 1_000,
      migrateLegacy: false,
    });

    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 110 },
    }));
    const firstFlush = store.getState().flushPendingWrites();
    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 120 },
    }));
    const secondFlush = store.getState().flushPendingWrites();
    resolveFirst?.();

    await Promise.all([firstFlush, secondFlush]);

    expect(values).toEqual([110, 120]);
  });

  it('surfaces a flush failure and keeps the canonical in-memory value', async () => {
    let shouldFail = true;
    const written: number[] = [];
    const store = createSettingsStore({
      client: {
        getSettings: async () => createLoadResult(true),
        setSettings: async (settings) => {
          written.push(settings.appearance.fontZoomPercent);
          if (shouldFail) {
            throw Object.assign(new Error('disk full'), {
              code: 'settings.write_failed',
            });
          }
        },
      },
      debounceMs: 1_000,
      migrateLegacy: false,
    });
    store.getState().updateSettings((current) => ({
      ...current,
      appearance: { ...current.appearance, fontZoomPercent: 140 },
    }));

    await expect(store.getState().flushPendingWrites()).rejects.toThrow(
      'disk full',
    );

    expect(store.getState().writeState).toEqual({
      code: 'settings.write_failed',
      status: 'failed',
    });
    expect(store.getState().settings.appearance.fontZoomPercent).toBe(140);

    shouldFail = false;
    await store.getState().retryPendingWrites();

    expect(written).toEqual([140, 140]);
    expect(store.getState().writeState).toEqual({ status: 'idle' });
  });
});
