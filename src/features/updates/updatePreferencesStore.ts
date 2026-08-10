import { create } from 'zustand';
import {
  browserPreferenceStorage,
  type KeyValueStorage,
} from '../../services/preferences/browserPreferenceStorage';

export type UpdatePreferencesState = {
  autoCheckOnStartup: boolean;
  setAutoCheckOnStartup: (autoCheckOnStartup: boolean) => void;
  updatePersistenceError: boolean;
};

type PersistedUpdatePreferences = {
  autoCheckOnStartup: boolean;
  version: 1;
};

const UPDATE_PREFERENCES_STORAGE_KEY = 'lumamark.update-preferences.v1';

const DEFAULT_PERSISTED_STATE: PersistedUpdatePreferences = {
  autoCheckOnStartup: true,
  version: 1,
};

export function createUpdatePreferencesStore(
  storage: KeyValueStorage = browserPreferenceStorage,
) {
  const initialState = readPersistedState(storage);

  return create<UpdatePreferencesState>((set, get) => {
    const persist = (next: Partial<PersistedUpdatePreferences>) =>
      writePersistedState(storage, {
        autoCheckOnStartup:
          next.autoCheckOnStartup ?? get().autoCheckOnStartup,
        version: 1,
      });

    return {
      ...initialState,
      setAutoCheckOnStartup: (autoCheckOnStartup) => {
        const updatePersistenceError = !persist({ autoCheckOnStartup });
        set({ autoCheckOnStartup, updatePersistenceError });
      },
    };
  });
}

function readPersistedState(
  storage: KeyValueStorage,
): Pick<UpdatePreferencesState, 'autoCheckOnStartup' | 'updatePersistenceError'> {
  try {
    const value = storage.getItem(UPDATE_PREFERENCES_STORAGE_KEY);
    if (!value) {
      return {
        autoCheckOnStartup: DEFAULT_PERSISTED_STATE.autoCheckOnStartup,
        updatePersistenceError: false,
      };
    }

    const parsed: unknown = JSON.parse(value);
    if (!isPersistedUpdatePreferences(parsed)) {
      throw new Error('Persisted update preferences are invalid.');
    }

    return {
      autoCheckOnStartup: parsed.autoCheckOnStartup,
      updatePersistenceError: false,
    };
  } catch {
    return {
      autoCheckOnStartup: DEFAULT_PERSISTED_STATE.autoCheckOnStartup,
      updatePersistenceError: true,
    };
  }
}

function writePersistedState(
  storage: KeyValueStorage,
  state: PersistedUpdatePreferences,
): boolean {
  try {
    storage.setItem(UPDATE_PREFERENCES_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function isPersistedUpdatePreferences(
  value: unknown,
): value is PersistedUpdatePreferences {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const preferences = value as Record<string, unknown>;
  return (
    preferences.version === 1 &&
    typeof preferences.autoCheckOnStartup === 'boolean'
  );
}

export const useUpdatePreferencesStore = createUpdatePreferencesStore();
