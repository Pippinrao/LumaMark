import { create } from 'zustand';

import {
  createSettingsClient,
  type SettingsClient,
} from '../../services/settings/settingsClient';
import {
  markLegacySettingsMigrationComplete,
  migrateLegacyLocalStorageSettings,
} from '../../services/settings/migrateLegacySettings';
import {
  createDefaultLumaMarkSettings,
  normalizeLumaMarkSettings,
  type LumaMarkSettings,
} from '../../services/settings/settingsTypes';
import {
  browserPreferenceStorage,
  type PreferenceStorage,
} from '../../services/preferences/browserPreferenceStorage';

const SETTINGS_WRITE_DEBOUNCE_MS = 400;

export type SettingsLoadState =
  | { status: 'idle' | 'hydrating' | 'ready' }
  | { code: string; status: 'readFailed' | 'unsupportedVersion' };

export type SettingsRecoveryState =
  | { kind: 'none' }
  | { kind: 'invalidFields' }
  | { backupPath: string | null; kind: 'corruption' };

export type SettingsWriteState =
  | { status: 'idle' | 'pending' | 'saving' }
  | { code: string; status: 'failed' };

export type SettingsStoreState = {
  clearRecentFilesRequestId: number;
  flushPendingWrites: () => Promise<void>;
  hydrateFromClient: () => Promise<void>;
  loadState: SettingsLoadState;
  recoveryState: SettingsRecoveryState;
  retryPendingWrites: () => Promise<void>;
  settings: LumaMarkSettings;
  updateSettings: (
    updater: (current: LumaMarkSettings) => LumaMarkSettings,
  ) => LumaMarkSettings;
  writeState: SettingsWriteState;
};

type CreateSettingsStoreOptions = {
  client?: SettingsClient;
  debounceMs?: number;
  legacyStorage?: PreferenceStorage;
  migrateLegacy?: boolean;
};

export function createSettingsStore({
  client = createSettingsClient(),
  debounceMs = SETTINGS_WRITE_DEBOUNCE_MS,
  legacyStorage = browserPreferenceStorage,
  migrateLegacy = true,
}: CreateSettingsStoreOptions = {}) {
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSettings: LumaMarkSettings | null = null;
  let persistenceBlocked = false;
  let drainPromise: Promise<void> | null = null;

  const discardPendingWrite = () => {
    if (writeTimer !== null) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    pendingSettings = null;
  };

  const flushPending = (
    set: (partial: Partial<SettingsStoreState>) => void,
  ): Promise<void> => {
    if (persistenceBlocked) {
      discardPendingWrite();
      return Promise.resolve();
    }

    if (writeTimer !== null) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }

    if (drainPromise) {
      return drainPromise;
    }

    drainPromise = (async () => {
      while (pendingSettings) {
        const toWrite = pendingSettings;
        pendingSettings = null;
        set({ writeState: { status: 'saving' } });

        try {
          await client.setSettings(toWrite);
        } catch (error) {
          pendingSettings ??= toWrite;
          set({
            writeState: {
              code: settingsErrorCode(error, 'settings.write_failed'),
              status: 'failed',
            },
          });
          throw error;
        }
      }

      if (!persistenceBlocked) {
        set({ writeState: { status: 'idle' } });
      }
    })().finally(() => {
      drainPromise = null;
    });

    return drainPromise;
  };

  const scheduleWrite = (
    settings: LumaMarkSettings,
    set: (partial: Partial<SettingsStoreState>) => void,
  ) => {
    pendingSettings = settings;
    set({ writeState: { status: 'pending' } });

    if (writeTimer !== null) {
      clearTimeout(writeTimer);
    }

    writeTimer = setTimeout(() => {
      writeTimer = null;
      void flushPending(set).catch(() => undefined);
    }, debounceMs);
  };

  return create<SettingsStoreState>((set, get) => ({
    clearRecentFilesRequestId: 0,
    flushPendingWrites: () => flushPending(set),
    loadState: { status: 'idle' },
    recoveryState: { kind: 'none' },
    retryPendingWrites: () => {
      pendingSettings ??= get().settings;
      return flushPending(set);
    },
    settings: createDefaultLumaMarkSettings(),
    writeState: { status: 'idle' },
    hydrateFromClient: async () => {
      set({ loadState: { status: 'hydrating' } });
      let loaded: Awaited<ReturnType<SettingsClient['getSettings']>>;
      try {
        loaded = await client.getSettings();
        persistenceBlocked = false;
      } catch (error) {
        persistenceBlocked = true;
        discardPendingWrite();
        const code = settingsErrorCode(error, 'settings.read_failed');
        set({
          loadState: {
            code,
            status:
              code === 'settings.unsupported_version'
                ? 'unsupportedVersion'
                : 'readFailed',
          },
        });
        throw error;
      }
      let settings = loaded.settings;
      let writeFailed = false;

      if (
        loaded.settingsFileExists &&
        (loaded.hadInvalidFields || loaded.usedDefaultsDueToCorruption)
      ) {
        try {
          await client.setSettings(settings);
        } catch (error) {
          pendingSettings = settings;
          writeFailed = true;
          set({
            writeState: {
              code: settingsErrorCode(error, 'settings.write_failed'),
              status: 'failed',
            },
          });
        }
      }

      if (migrateLegacy && !loaded.settingsFileExists) {
        try {
          const migration = migrateLegacyLocalStorageSettings(
            legacyStorage,
            settings,
          );

          if (migration.migrated) {
            settings = migration.settings;

            try {
              await client.setSettings(settings);
              markLegacySettingsMigrationComplete(legacyStorage);
            } catch (error) {
              pendingSettings = settings;
              writeFailed = true;
              set({
                writeState: {
                  code: settingsErrorCode(error, 'settings.write_failed'),
                  status: 'failed',
                },
              });
            }
          }
        } catch {
          persistenceBlocked = true;
          discardPendingWrite();
          writeFailed = true;
          set({
            writeState: {
              code: 'settings.legacy_migration_failed',
              status: 'failed',
            },
          });
        }
      }

      set({
        loadState: { status: 'ready' },
        recoveryState: loaded.usedDefaultsDueToCorruption
          ? {
              backupPath: loaded.corruptBackupPath,
              kind: 'corruption',
            }
          : loaded.hadInvalidFields
            ? { kind: 'invalidFields' }
            : { kind: 'none' },
        settings,
        writeState: writeFailed
          ? get().writeState
          : { status: 'idle' },
      });
    },
    updateSettings: (updater) => {
      const current = get().settings;
      const normalized = normalizeLumaMarkSettings(updater(current));
      set({
        recoveryState:
          normalized.hadInvalidFields && get().recoveryState.kind === 'none'
            ? { kind: 'invalidFields' }
            : get().recoveryState,
        settings: normalized.settings,
      });
      if (!persistenceBlocked) {
        scheduleWrite(normalized.settings, set);
      }
      return normalized.settings;
    },
  }));
}

export const useSettingsStore = createSettingsStore();

function settingsErrorCode(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }

  return fallback;
}
