import { describe, expect, it } from 'vitest';

import type { PreferenceStorage } from '../services/preferences/browserPreferenceStorage';
import { i18n } from '../shared/i18n';
import { bootstrapApp } from './bootstrapApp';
import { createAppPreferencesStore } from './stores/appPreferencesStore';

function createMemoryStorage(): PreferenceStorage {
  const values = new Map<string, string>();

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

describe('bootstrapApp', () => {
  it('applies persisted language and theme before the first render', async () => {
    const storage = createMemoryStorage();
    const previousSession = createAppPreferencesStore(storage);
    previousSession.getState().setLanguage('en');
    previousSession.getState().setTheme('dark');
    const restartedSession = createAppPreferencesStore(storage);

    await i18n.changeLanguage('zh-CN');
    document.documentElement.lang = 'zh-CN';
    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.colorScheme = 'light';

    let renderSnapshot: Record<string, string | undefined> | undefined;
    await bootstrapApp(
      () => {
        renderSnapshot = {
          colorScheme: document.documentElement.style.colorScheme,
          i18nLanguage: i18n.resolvedLanguage,
          language: document.documentElement.lang,
          theme: document.documentElement.dataset.theme,
        };
      },
      restartedSession.getState(),
    );

    expect(renderSnapshot).toEqual({
      colorScheme: 'dark',
      i18nLanguage: 'en',
      language: 'en',
      theme: 'dark',
    });
  });
});
