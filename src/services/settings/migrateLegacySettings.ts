import {
  browserPreferenceStorage,
  type PreferenceStorage,
} from '../preferences/browserPreferenceStorage';
import {
  createDefaultLumaMarkSettings,
  type LumaMarkSettings,
  type SettingsLanguage,
  type SettingsPageWidth,
  type SettingsStartupBehavior,
  type SettingsTheme,
} from './settingsTypes';
import { SETTINGS_MIGRATION_MARK_KEY } from './settingsClient';

const APP_PREFERENCES_STORAGE_KEY = 'lumamark.app-preferences.v1';
const READING_APPEARANCE_STORAGE_KEY = 'lumamark.reading-appearance.v1';
const STARTUP_STORAGE_KEY = 'lumamark.startup.v1';
const SIDEBAR_OPEN_STORAGE_KEY = 'lumamark.sidebar-open.v1';
export const LEGACY_UPDATE_PREFERENCES_STORAGE_KEY =
  'lumamark.update-preferences.v1';

export type LegacySettingsMigrationResult = {
  migrated: boolean;
  settings: LumaMarkSettings;
};

/**
 * Reads legacy localStorage preference keys into LumaMarkSettings.
 * This function intentionally does not write the marker or delete old keys.
 */
export function migrateLegacyLocalStorageSettings(
  storage: PreferenceStorage = browserPreferenceStorage,
  base: LumaMarkSettings = createDefaultLumaMarkSettings(),
): LegacySettingsMigrationResult {
  if (storage.getItem(SETTINGS_MIGRATION_MARK_KEY) === '1') {
    return { migrated: false, settings: base };
  }

  const settings = structuredClone(base);
  let changed = false;

  const appPreferences = readJson(storage, APP_PREFERENCES_STORAGE_KEY);

  if (appPreferences) {
    if (appPreferences.language === 'en' || appPreferences.language === 'zh-CN') {
      settings.general.language = appPreferences.language as SettingsLanguage;
      changed = true;
    }

    if (
      appPreferences.theme === 'light' ||
      appPreferences.theme === 'dark' ||
      appPreferences.theme === 'system'
    ) {
      settings.appearance.theme = appPreferences.theme as SettingsTheme;
      changed = true;
    }
  }

  const reading = readJson(storage, READING_APPEARANCE_STORAGE_KEY);
  const pageWidth = isRecord(reading?.state)
    ? reading.state.pageWidth
    : undefined;

  if (
    pageWidth === 'narrow' ||
    pageWidth === 'wide' ||
    pageWidth === 'fluid' ||
    pageWidth === 'adaptive'
  ) {
    settings.appearance.pageWidth = pageWidth as SettingsPageWidth;
    changed = true;
  }

  const startup = readJson(storage, STARTUP_STORAGE_KEY);

  if (
    startup?.startupBehavior === 'home' ||
    startup?.startupBehavior === 'restoreLastSession'
  ) {
    settings.general.startupBehavior =
      startup.startupBehavior as SettingsStartupBehavior;
    changed = true;
  }

  const sidebarOpen = storage.getItem(SIDEBAR_OPEN_STORAGE_KEY);

  if (sidebarOpen === 'true' || sidebarOpen === 'false') {
    settings.appearance.sidebarOpenOnStartup = sidebarOpen === 'true';
    changed = true;
  }

  const updatePreferences = readJson(
    storage,
    LEGACY_UPDATE_PREFERENCES_STORAGE_KEY,
  );

  if (typeof updatePreferences?.autoCheckOnStartup === 'boolean') {
    settings.updates.autoCheckOnStartup =
      updatePreferences.autoCheckOnStartup;
    changed = true;
  }

  return { migrated: changed, settings };
}

export function markLegacySettingsMigrationComplete(
  storage: PreferenceStorage = browserPreferenceStorage,
): void {
  storage.setItem(SETTINGS_MIGRATION_MARK_KEY, '1');
}

function readJson(
  storage: PreferenceStorage,
  key: string,
): Record<string, unknown> | null {
  const raw = storage.getItem(key);

  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
