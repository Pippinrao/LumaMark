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
  });

  it('starts with an empty list when storage is unavailable or malformed', () => {
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
    expect(malformedStore.getState().recentFiles).toEqual([]);
  });
});
