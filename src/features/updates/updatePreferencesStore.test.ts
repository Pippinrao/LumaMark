import { describe, expect, it, vi } from 'vitest';
import { createUpdatePreferencesStore } from './updatePreferencesStore';

describe('update preferences store', () => {
  it('defaults auto-check on startup to true and persists changes', () => {
    let persistedValue: string | null = null;
    const storage = {
      getItem: vi.fn(() => persistedValue),
      setItem: vi.fn((_: string, value: string) => {
        persistedValue = value;
      }),
    };
    const store = createUpdatePreferencesStore(storage);

    expect(store.getState().autoCheckOnStartup).toBe(true);

    store.getState().setAutoCheckOnStartup(false);

    const restored = createUpdatePreferencesStore(storage);
    expect(restored.getState().autoCheckOnStartup).toBe(false);
    expect(restored.getState().updatePersistenceError).toBe(false);
  });

  it('falls back to defaults when persisted data is malformed', () => {
    const store = createUpdatePreferencesStore({
      getItem: () => '{not-json',
      setItem: vi.fn(),
    });

    expect(store.getState().autoCheckOnStartup).toBe(true);
    expect(store.getState().updatePersistenceError).toBe(true);
  });

  it('exposes a write error when storage cannot persist', () => {
    const store = createUpdatePreferencesStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('storage unavailable');
      },
    });

    store.getState().setAutoCheckOnStartup(false);

    expect(store.getState().autoCheckOnStartup).toBe(false);
    expect(store.getState().updatePersistenceError).toBe(true);
  });
});
