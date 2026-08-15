import {
  browserPreferenceStorage,
  type PreferenceStorage,
} from '../preferences/browserPreferenceStorage';
import {
  invokeCommand,
  type CommandError,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';
import {
  createDefaultLumaMarkSettings,
  normalizeLumaMarkSettings,
  type LumaMarkSettings,
  type SettingsLoadResult,
} from './settingsTypes';

export const BROWSER_SETTINGS_STORAGE_KEY = 'lumamark.settings.v1';
export const SETTINGS_MIGRATION_MARK_KEY = 'lumamark.settings.migrated-from-localStorage.v2';

export type SettingsClient = {
  getSettings: () => Promise<SettingsLoadResult>;
  setSettings: (settings: LumaMarkSettings) => Promise<void>;
};

export class SettingsClientError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly recoverable: boolean;

  constructor(error: CommandError) {
    super(error.message);
    this.name = 'SettingsClientError';
    this.code = error.code;
    this.details = error.details;
    this.recoverable = error.recoverable;
  }
}

export async function markSettingsAcceptanceCloseEntered(
  invokeFn?: InvokeCommandFunction,
): Promise<void> {
  if (!invokeFn && shouldPreferBrowserSettingsStorage()) {
    return;
  }
  const result = await invokeCommand<boolean>(
    'settings_acceptance_mark_close_entered',
    undefined,
    invokeFn,
  );
  if (!result.ok) {
    throw new SettingsClientError(result.error);
  }
}

function createBrowserSettingsError(
  code: 'settings.read_failed' | 'settings.write_failed',
  message: string,
): SettingsClientError {
  return new SettingsClientError({
    code,
    message,
    recoverable: true,
  });
}

type CreateSettingsClientOptions = {
  invokeFn?: InvokeCommandFunction;
  preferBrowserStorage?: boolean;
  storage?: PreferenceStorage;
};

export function createSettingsClient({
  invokeFn,
  preferBrowserStorage = shouldPreferBrowserSettingsStorage(),
  storage = browserPreferenceStorage,
}: CreateSettingsClientOptions = {}): SettingsClient {
  if (preferBrowserStorage) {
    return createBrowserSettingsClient(storage);
  }

  return createTauriSettingsClient(invokeFn);
}

function createTauriSettingsClient(
  invokeFn?: InvokeCommandFunction,
): SettingsClient {
  return {
    getSettings: async () => {
      const result = await invokeCommand<SettingsLoadResult>(
        'settings_get',
        undefined,
        invokeFn,
      );

      if (!result.ok) {
        throw new SettingsClientError(result.error);
      }

      const normalized = normalizeLumaMarkSettings(result.data.settings);

      return {
        corruptBackupPath: result.data.corruptBackupPath,
        hadInvalidFields:
          result.data.hadInvalidFields || normalized.hadInvalidFields,
        settings: normalized.settings,
        settingsFileExists: result.data.settingsFileExists,
        usedDefaultsDueToCorruption: result.data.usedDefaultsDueToCorruption,
      };
    },
    setSettings: async (settings) => {
      const normalized = normalizeLumaMarkSettings(settings).settings;
      const result = await invokeCommand<void>(
        'settings_set',
        { settings: normalized },
        invokeFn,
      );

      if (!result.ok) {
        throw new SettingsClientError(result.error);
      }
    },
  };
}

function createBrowserSettingsClient(storage: PreferenceStorage): SettingsClient {
  return {
    getSettings: async () => {
      let raw: string | null;

      try {
        raw = storage.getItem(BROWSER_SETTINGS_STORAGE_KEY);
      } catch {
        throw createBrowserSettingsError(
          'settings.read_failed',
          'Settings storage is unavailable.',
        );
      }

      if (raw === null) {
        return {
          corruptBackupPath: null,
          hadInvalidFields: false,
          settings: createDefaultLumaMarkSettings(),
          settingsFileExists: false,
          usedDefaultsDueToCorruption: false,
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          corruptBackupPath: null,
          hadInvalidFields: false,
          settings: createDefaultLumaMarkSettings(),
          settingsFileExists: true,
          usedDefaultsDueToCorruption: true,
        };
      }

      const normalized = normalizeLumaMarkSettings(parsed);
      return {
        corruptBackupPath: null,
        hadInvalidFields: normalized.hadInvalidFields,
        settings: normalized.settings,
        settingsFileExists: true,
        usedDefaultsDueToCorruption: false,
      };
    },
    setSettings: async (settings) => {
      const normalized = normalizeLumaMarkSettings(settings).settings;

      try {
        storage.setItem(
          BROWSER_SETTINGS_STORAGE_KEY,
          JSON.stringify(normalized),
        );
      } catch {
        throw createBrowserSettingsError(
          'settings.write_failed',
          'Failed to persist settings.',
        );
      }
    },
  };
}

function shouldPreferBrowserSettingsStorage(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  const userAgent = globalThis.navigator?.userAgent.toLowerCase() ?? '';

  if (userAgent.includes('jsdom')) {
    return true;
  }

  // Tauri injects internals; without them use browser persistence for web/E2E.
  return !('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export const settingsClient = createSettingsClient();
