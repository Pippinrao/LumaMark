import { create } from 'zustand';

import {
  browserPreferenceStorage,
  type PreferenceStorage,
} from '../../services/preferences/browserPreferenceStorage';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';
import {
  defaultLanguage,
  supportedLanguages,
  type AppLanguage,
} from '../../shared/i18n';

export type ThemeMode = 'light' | 'dark';

export type AppPreferencesState = {
  language: AppLanguage;
  preferencesPersistenceError: boolean;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: ThemeMode) => void;
  theme: ThemeMode;
  toggleLanguage: () => void;
  toggleTheme: () => void;
};

type PersistedAppPreferences = {
  language: AppLanguage;
  theme: ThemeMode;
  version: 1;
};

const APP_PREFERENCES_STORAGE_KEY = 'lumamark.app-preferences.v1';
const DEFAULT_APP_PREFERENCES: PersistedAppPreferences = {
  language: defaultLanguage,
  theme: 'light',
  version: 1,
};

export function createAppPreferencesStore(
  storage: PreferenceStorage = browserPreferenceStorage,
) {
  const initialState = readPersistedPreferences(storage);

  return create<AppPreferencesState>((set, get) => {
    const updatePreferences = (
      next: Partial<Pick<PersistedAppPreferences, 'language' | 'theme'>>,
    ) => {
      const current = get();
      const preferences: PersistedAppPreferences = {
        language: next.language ?? current.language,
        theme: next.theme ?? current.theme,
        version: 1,
      };
      const preferencesPersistenceError = !writePersistedPreferences(
        storage,
        preferences,
      );

      set({
        ...next,
        preferencesPersistenceError,
      });
    };

    return {
      ...initialState,
      setLanguage: (language) => {
        logMenuInteraction(`store.setLanguage(${language})`);
        updatePreferences({ language });
      },
      setTheme: (theme) => {
        logMenuInteraction(`store.setTheme(${theme})`);
        updatePreferences({ theme });
      },
      toggleLanguage: () => {
        updatePreferences({
          language:
            get().language === supportedLanguages[0]
              ? supportedLanguages[1]
              : supportedLanguages[0],
        });
      },
      toggleTheme: () => {
        updatePreferences({
          theme: get().theme === 'light' ? 'dark' : 'light',
        });
      },
    };
  });
}

function readPersistedPreferences(
  storage: PreferenceStorage,
): Pick<
  AppPreferencesState,
  'language' | 'preferencesPersistenceError' | 'theme'
> {
  let value: string | null;

  try {
    value = storage.getItem(APP_PREFERENCES_STORAGE_KEY);
  } catch {
    return defaultPreferencesState(true);
  }

  if (value === null) {
    return defaultPreferencesState(false);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return recoverInvalidPreferences(storage);
  }

  if (!isPersistedAppPreferences(parsed)) {
    return recoverInvalidPreferences(storage);
  }

  return {
    language: parsed.language,
    preferencesPersistenceError: false,
    theme: parsed.theme,
  };
}

function recoverInvalidPreferences(
  storage: PreferenceStorage,
): Pick<
  AppPreferencesState,
  'language' | 'preferencesPersistenceError' | 'theme'
> {
  try {
    storage.removeItem(APP_PREFERENCES_STORAGE_KEY);
  } catch {
    return defaultPreferencesState(true);
  }

  return defaultPreferencesState(true);
}

function defaultPreferencesState(
  preferencesPersistenceError: boolean,
): Pick<
  AppPreferencesState,
  'language' | 'preferencesPersistenceError' | 'theme'
> {
  return {
    language: DEFAULT_APP_PREFERENCES.language,
    preferencesPersistenceError,
    theme: DEFAULT_APP_PREFERENCES.theme,
  };
}

function writePersistedPreferences(
  storage: PreferenceStorage,
  preferences: PersistedAppPreferences,
): boolean {
  try {
    storage.setItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

function isPersistedAppPreferences(
  value: unknown,
): value is PersistedAppPreferences {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const preferences = value as Record<string, unknown>;
  return (
    preferences.version === 1 &&
    supportedLanguages.some((language) => language === preferences.language) &&
    (preferences.theme === 'light' || preferences.theme === 'dark')
  );
}

export const useAppPreferencesStore = createAppPreferencesStore();
