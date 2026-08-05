import { describe, expect, it, vi } from 'vitest';
import { createStartupStore } from './startupStore';

describe('startup store', () => {
  it('persists the startup behavior and last session without document text', () => {
    let persistedValue: string | null = null;
    const storage = {
      getItem: vi.fn(() => persistedValue),
      setItem: vi.fn((_: string, value: string) => {
        persistedValue = value;
      }),
    };
    const store = createStartupStore(storage);

    store.getState().setStartupBehavior('restoreLastSession');
    store.getState().setLastSession({
      kind: 'workspace',
      path: 'E:/notes',
      documentPath: 'E:/notes/today.md',
    });

    const restoredStore = createStartupStore(storage);
    expect(restoredStore.getState().startupBehavior).toBe('restoreLastSession');
    expect(restoredStore.getState().lastSession).toEqual({
      kind: 'workspace',
      path: 'E:/notes',
      documentPath: 'E:/notes/today.md',
    });
    expect(persistedValue).not.toContain('documentText');
  });

  it('deduplicates recent workspaces by path, keeps newest first, and caps at 20', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    const store = createStartupStore(storage);

    for (let index = 0; index < 21; index += 1) {
      store.getState().addRecentWorkspace({
        name: `Workspace ${index}`,
        openedAt: index,
        path: `E:/workspace-${index}`,
      });
    }
    store.getState().addRecentWorkspace({
      name: 'Renamed workspace',
      openedAt: 99,
      path: 'E:/workspace-10',
    });

    const recentWorkspaces = store.getState().recentWorkspaces;
    expect(recentWorkspaces).toHaveLength(20);
    expect(recentWorkspaces[0]).toEqual({
      name: 'Renamed workspace',
      openedAt: 99,
      path: 'E:/workspace-10',
    });
    expect(recentWorkspaces.filter(({ path }) => path === 'E:/workspace-10')).toHaveLength(1);
  });

  it('falls back to the home screen when persisted data is malformed', () => {
    const store = createStartupStore({
      getItem: () => '{not-json',
      setItem: vi.fn(),
    });

    expect(store.getState().startupBehavior).toBe('home');
    expect(store.getState().lastSession).toBeNull();
    expect(store.getState().recentWorkspaces).toEqual([]);
    expect(store.getState().startupPersistenceError).toBe(true);
  });

  it.each([
    [
      'schema',
      JSON.stringify({
        lastSession: null,
        recentWorkspaces: [],
        startupBehavior: 'unsupported',
        version: 1,
      }),
    ],
    [
      'version',
      JSON.stringify({
        lastSession: null,
        recentWorkspaces: [],
        startupBehavior: 'home',
        version: 2,
      }),
    ],
  ])('exposes a persistence error for valid JSON with an invalid %s', (_, value) => {
    const store = createStartupStore({
      getItem: () => value,
      setItem: vi.fn(),
    });

    expect(store.getState().startupBehavior).toBe('home');
    expect(store.getState().startupPersistenceError).toBe(true);
  });

  it('exposes a read error when default browser storage is unavailable', () => {
    const store = createStartupStore();

    expect(store.getState().startupPersistenceError).toBe(true);
  });

  it('keeps current state and exposes a write error when default browser storage is unavailable', () => {
    const store = createStartupStore();

    store.getState().setStartupBehavior('restoreLastSession');

    expect(store.getState().startupBehavior).toBe('restoreLastSession');
    expect(store.getState().startupPersistenceError).toBe(true);
  });

  it('exposes a persistence error when startup state cannot be read', () => {
    const store = createStartupStore({
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: vi.fn(),
    });

    expect(store.getState().startupBehavior).toBe('home');
    expect(store.getState().startupPersistenceError).toBe(true);
  });

  it('keeps current startup state after a write failure and clears the error after a successful write', () => {
    let shouldFail = true;
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        if (shouldFail) {
          throw new Error('storage unavailable');
        }
      }),
    };
    const store = createStartupStore(storage);

    store.getState().setStartupBehavior('restoreLastSession');

    expect(store.getState().startupBehavior).toBe('restoreLastSession');
    expect(store.getState().startupPersistenceError).toBe(true);

    shouldFail = false;
    store.getState().setStartupBehavior('home');

    expect(store.getState().startupBehavior).toBe('home');
    expect(store.getState().startupPersistenceError).toBe(false);
  });
});
