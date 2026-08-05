import { describe, expect, it, vi } from 'vitest';
import { createRecentFilesStore } from './recentFilesStore';

describe('recent files store', () => {
  it('restores persisted recent files when the store is recreated', () => {
    let persistedValue: string | null = null;
    const storage = {
      getItem: vi.fn(() => persistedValue),
      setItem: vi.fn((_: string, value: string) => {
        persistedValue = value;
      }),
    };
    const firstStore = createRecentFilesStore(storage);

    firstStore.getState().addRecentFile({
      name: 'journal.md',
      openedAt: 42,
      path: 'E:/notes/journal.md',
    });

    const restoredStore = createRecentFilesStore(storage);

    expect(restoredStore.getState().recentFiles).toEqual([
      {
        name: 'journal.md',
        openedAt: 42,
        path: 'E:/notes/journal.md',
      },
    ]);
    expect(restoredStore.getState().recentFilesPersistenceError).toBe(false);
  });

  it('starts with an explicit error when storage is unavailable or malformed', () => {
    const unavailableStore = createRecentFilesStore({
      getItem: () => {
        throw new Error('Storage unavailable');
      },
      setItem: vi.fn(),
    });
    const malformedStore = createRecentFilesStore({
      getItem: () => '{not-json',
      setItem: vi.fn(),
    });

    expect(unavailableStore.getState().recentFiles).toEqual([]);
    expect(unavailableStore.getState().recentFilesPersistenceError).toBe(true);
    expect(malformedStore.getState().recentFiles).toEqual([]);
    expect(malformedStore.getState().recentFilesPersistenceError).toBe(true);
  });

  it('rejects valid JSON with an invalid recent-file schema', () => {
    const store = createRecentFilesStore({
      getItem: () => JSON.stringify([{ name: 'missing path', openedAt: 1 }]),
      setItem: vi.fn(),
    });

    expect(store.getState().recentFiles).toEqual([]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);
  });

  it('keeps added files in session after a write failure and clears the error after recovery', () => {
    let shouldFail = true;
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        if (shouldFail) {
          throw new Error('Storage unavailable');
        }
      }),
    };
    const store = createRecentFilesStore(storage);

    expect(() =>
      store.getState().addRecentFile({
        name: 'first.md',
        openedAt: 1,
        path: 'E:/notes/first.md',
      }),
    ).not.toThrow();
    expect(store.getState().recentFiles).toEqual([
      { name: 'first.md', openedAt: 1, path: 'E:/notes/first.md' },
    ]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);

    shouldFail = false;
    store.getState().addRecentFile({
      name: 'second.md',
      openedAt: 2,
      path: 'E:/notes/second.md',
    });

    expect(store.getState().recentFiles).toHaveLength(2);
    expect(store.getState().recentFilesPersistenceError).toBe(false);
  });

  it('clears files in session after a write failure and clears the error after recovery', () => {
    let shouldFail = false;
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        if (shouldFail) {
          throw new Error('Storage unavailable');
        }
      }),
    };
    const store = createRecentFilesStore(storage);
    store.getState().addRecentFile({
      name: 'note.md',
      openedAt: 1,
      path: 'E:/notes/note.md',
    });
    shouldFail = true;

    expect(() => store.getState().clearRecentFiles()).not.toThrow();
    expect(store.getState().recentFiles).toEqual([]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);

    shouldFail = false;
    store.getState().clearRecentFiles();

    expect(store.getState().recentFiles).toEqual([]);
    expect(store.getState().recentFilesPersistenceError).toBe(false);
  });
});
