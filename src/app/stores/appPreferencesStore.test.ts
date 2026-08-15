import { describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../../services/preferences/browserPreferenceStorage';
import { createAppPreferencesStore } from './appPreferencesStore';

function createMemoryStorage(
  initialValue: string | null = null,
): PreferenceStorage {
  let value = initialValue;

  return {
    getItem: () => value,
    removeItem: () => {
      value = null;
    },
    setItem: (_name, nextValue) => {
      value = nextValue;
    },
  };
}

describe('appPreferencesStore', () => {
  it('hydrates the language and theme selected in a previous session', () => {
    const storage = createMemoryStorage();
    const firstSession = createAppPreferencesStore(storage);

    firstSession.getState().setLanguage('en');
    firstSession.getState().setTheme('dark');

    const nextSession = createAppPreferencesStore(storage);

    expect(nextSession.getState()).toMatchObject({
      language: 'en',
      preferencesPersistenceError: false,
      theme: 'dark',
    });
  });

  it('persists the system theme preference across sessions', () => {
    const storage = createMemoryStorage();
    const firstSession = createAppPreferencesStore(storage);

    firstSession.getState().setTheme('system' as never);

    expect(createAppPreferencesStore(storage).getState().theme).toBe('system');
  });

  it('persists direct and toggled language and theme changes', () => {
    const storage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    const store = createAppPreferencesStore(storage);

    store.getState().setLanguage('en');
    store.getState().setTheme('dark');
    store.getState().toggleLanguage();
    store.getState().toggleTheme();

    expect(storage.setItem).toHaveBeenCalledTimes(4);
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1])).toEqual({
      language: 'zh-CN',
      theme: 'light',
      version: 1,
    });
  });

  it('uses safe defaults and reports malformed or unsupported persisted data', () => {
    for (const initialValue of [
      '{not valid json',
      JSON.stringify({ language: 'fr', theme: 'sepia', version: 1 }),
    ]) {
      const storage = createMemoryStorage(initialValue);
      const firstRecoverySession = createAppPreferencesStore(storage);
      const nextSession = createAppPreferencesStore(storage);

      expect(firstRecoverySession.getState()).toMatchObject({
        language: 'zh-CN',
        preferencesPersistenceError: true,
        theme: 'light',
      });
      expect(nextSession.getState()).toMatchObject({
        language: 'zh-CN',
        preferencesPersistenceError: false,
        theme: 'light',
      });
    }
  });

  it('does not erase persisted data when reading storage fails', () => {
    const removeItem = vi.fn();
    const store = createAppPreferencesStore({
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem,
      setItem: vi.fn(),
    });

    expect(store.getState()).toMatchObject({
      language: 'zh-CN',
      preferencesPersistenceError: true,
      theme: 'light',
    });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('reports a cleanup failure after reading invalid persisted data', () => {
    const removeItem = vi.fn(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const store = createAppPreferencesStore({
      getItem: () => '{not valid json',
      removeItem,
      setItem: vi.fn(),
    });

    expect(store.getState()).toMatchObject({
      language: 'zh-CN',
      preferencesPersistenceError: true,
      theme: 'light',
    });
    expect(removeItem).toHaveBeenCalledWith('lumamark.app-preferences.v1');
  });

  it('keeps the selected values visible and reports failed writes', () => {
    const store = createAppPreferencesStore({
      getItem: () => null,
      removeItem: vi.fn(),
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
    });

    store.getState().setLanguage('en');
    store.getState().setTheme('dark');

    expect(store.getState()).toMatchObject({
      language: 'en',
      preferencesPersistenceError: true,
      theme: 'dark',
    });
  });
});
