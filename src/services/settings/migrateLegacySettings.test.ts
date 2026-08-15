import { describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../preferences/browserPreferenceStorage';
import { SETTINGS_MIGRATION_MARK_KEY } from './settingsClient';
import {
  markLegacySettingsMigrationComplete,
  migrateLegacyLocalStorageSettings,
} from './migrateLegacySettings';
import { createDefaultLumaMarkSettings } from './settingsTypes';

const UPDATE_PREFERENCES_STORAGE_KEY = 'lumamark.update-preferences.v1';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  const storage: PreferenceStorage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: vi.fn((key, value) => {
      writes.push(key);
      values.set(key, value);
    }),
  };

  return { storage, values, writes };
}

describe('legacy settings migration', () => {
  it('is read-only and does not mark a fresh profile with no legacy values', () => {
    const { storage, writes } = createMemoryStorage();

    const result = migrateLegacyLocalStorageSettings(
      storage,
      createDefaultLumaMarkSettings(),
    );

    expect(result.migrated).toBe(false);
    expect(writes).toEqual([]);
    expect(storage.getItem(SETTINGS_MIGRATION_MARK_KEY)).toBeNull();
  });

  it('migrates the legacy updater preference without deleting old keys', () => {
    const { storage, writes } = createMemoryStorage({
      [UPDATE_PREFERENCES_STORAGE_KEY]: JSON.stringify({
        autoCheckOnStartup: false,
        version: 1,
      }),
    });

    const result = migrateLegacyLocalStorageSettings(
      storage,
      createDefaultLumaMarkSettings(),
    );

    expect(result.migrated).toBe(true);
    expect(result.settings.updates.autoCheckOnStartup).toBe(false);
    expect(writes).toEqual([]);
    expect(storage.getItem(UPDATE_PREFERENCES_STORAGE_KEY)).not.toBeNull();
  });

  it('writes the marker only through the explicit completion operation', () => {
    const { storage } = createMemoryStorage();

    markLegacySettingsMigrationComplete(storage);

    expect(storage.getItem(SETTINGS_MIGRATION_MARK_KEY)).toBe('1');
  });
});
