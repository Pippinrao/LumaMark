import { describe, expect, it, vi } from 'vitest';
import type {
  RecentFileInput,
  RecentFilesClient,
  RecentFilesSnapshot,
} from '../../services/recent-files/recentFilesClient';
import {
  BROWSER_RECENT_FILES_STORAGE_KEY,
  createRecentFilesClient,
} from '../../services/recent-files/recentFilesClient';
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

  it('subscribes before hydration and ignores an older get snapshot after a change event', async () => {
    const order: string[] = [];
    let notify: ((snapshot: RecentFilesSnapshot) => void) | undefined;
    const pendingGet = createDeferred<{
      data: RecentFilesSnapshot;
      ok: true;
    }>();
    const client = createClient({
      get: vi.fn(() => {
        order.push('get');
        return pendingGet.promise;
      }),
      listen: vi.fn(async (listener) => {
        order.push('listen');
        notify = listener;
        return () => undefined;
      }),
    });
    const store = createRecentFilesStore({ client });

    const hydration = store.getState().hydrateFromClient();
    await vi.waitFor(() => expect(order).toEqual(['listen', 'get']));
    notify?.({
      files: [
        { name: 'new.md', openedAt: 2, path: 'E:/notes/new.md' },
      ],
      revision: 2,
    });
    pendingGet.resolve({
      data: {
        files: [
          { name: 'old.md', openedAt: 1, path: 'E:/notes/old.md' },
        ],
        revision: 1,
      },
      ok: true,
    });
    await hydration;

    expect(store.getState().recentFiles).toEqual([
      { name: 'new.md', openedAt: 2, path: 'E:/notes/new.md' },
    ]);
    expect(store.getState().recentFilesPersistenceError).toBe(false);
  });

  it('keeps the newest canonical revision when concurrent adds resolve out of order', async () => {
    const first = createDeferred<{
      data: RecentFilesSnapshot;
      ok: true;
    }>();
    const second = createDeferred<{
      data: RecentFilesSnapshot;
      ok: true;
    }>();
    const client = createClient({
      add: vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    });
    const store = createRecentFilesStore({ client });

    const firstAdd = store.getState().addRecentFile({
      name: 'first.md',
      openedAt: 1,
      path: 'E:/notes/first.md',
    });
    const secondAdd = store.getState().addRecentFile({
      name: 'second.md',
      openedAt: 2,
      path: 'E:/notes/second.md',
    });
    second.resolve({
      data: {
        files: [
          { name: 'second.md', openedAt: 2, path: 'E:/notes/second.md' },
          { name: 'first.md', openedAt: 1, path: 'E:/notes/first.md' },
        ],
        revision: 2,
      },
      ok: true,
    });
    first.resolve({
      data: {
        files: [
          { name: 'first.md', openedAt: 1, path: 'E:/notes/first.md' },
        ],
        revision: 1,
      },
      ok: true,
    });
    await Promise.all([firstAdd, secondAdd]);

    expect(store.getState().recentFiles).toEqual([
      { name: 'second.md', openedAt: 2, path: 'E:/notes/second.md' },
      { name: 'first.md', openedAt: 1, path: 'E:/notes/first.md' },
    ]);
  });

  it('publishes a newer event after a stale successful add response settles', async () => {
    const added = {
      name: 'added.md',
      openedAt: 1,
      path: 'E:/notes/added.md',
    };
    const pendingAdd = createDeferred<
      Awaited<ReturnType<RecentFilesClient['add']>>
    >();
    let notify: ((snapshot: RecentFilesSnapshot) => void) | undefined;
    const client = createClient({
      add: vi.fn(() => pendingAdd.promise),
      listen: vi.fn(async (listener) => {
        notify = listener;
        return () => undefined;
      }),
    });
    const store = createRecentFilesStore({ client });
    await store.getState().hydrateFromClient();

    const adding = store.getState().addRecentFile(added);
    await vi.waitFor(() => expect(client.add).toHaveBeenCalledTimes(1));
    notify?.({ files: [], revision: 2 });
    expect(store.getState().recentFiles).toEqual([added]);

    pendingAdd.resolve({
      data: { files: [added], revision: 1 },
      ok: true,
    });
    await adding;

    expect(store.getState().recentFiles).toEqual([]);
    expect(store.getState().recentFilesPersistenceError).toBe(false);
  });

  it('keeps an optimistic recent item visible when the native write fails', async () => {
    const client = createClient({
      add: vi.fn(async () => ({
        error: {
          code: 'recent_files.write_failed',
          message: 'disk full',
          recoverable: true,
        },
        ok: false as const,
      })),
    });
    const store = createRecentFilesStore({ client });

    await store.getState().addRecentFile({
      name: 'draft.md',
      openedAt: 3,
      path: 'E:/notes/draft.md',
    });

    expect(store.getState().recentFiles).toEqual([
      { name: 'draft.md', openedAt: 3, path: 'E:/notes/draft.md' },
    ]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);
  });

  it('serializes local mutations so an older success cannot erase a newer failed optimistic add', async () => {
    const first = createDeferred<{
      data: RecentFilesSnapshot;
      ok: true;
    }>();
    const add = vi
      .fn<RecentFilesClient['add']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({
        error: {
          code: 'recent_files.write_failed',
          message: 'disk full',
          recoverable: true,
        },
        ok: false,
      });
    const store = createRecentFilesStore({ client: createClient({ add }) });

    const firstAdd = store.getState().addRecentFile({
      name: 'first.md',
      openedAt: 1,
      path: 'E:/notes/first.md',
    });
    const secondAdd = store.getState().addRecentFile({
      name: 'second.md',
      openedAt: 2,
      path: 'E:/notes/second.md',
    });

    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(store.getState().recentFiles).toEqual([
      { name: 'second.md', openedAt: 2, path: 'E:/notes/second.md' },
      { name: 'first.md', openedAt: 1, path: 'E:/notes/first.md' },
    ]);

    first.resolve({
      data: {
        files: [
          { name: 'first.md', openedAt: 1, path: 'E:/notes/first.md' },
        ],
        revision: 1,
      },
      ok: true,
    });
    await Promise.all([firstAdd, secondAdd]);

    expect(add).toHaveBeenCalledTimes(2);
    expect(store.getState().recentFiles).toEqual([
      { name: 'second.md', openedAt: 2, path: 'E:/notes/second.md' },
      { name: 'first.md', openedAt: 1, path: 'E:/notes/first.md' },
    ]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);
  });

  it('atomically imports the legacy browser list and finishes cleanup after a cold restart', async () => {
    const legacyFiles = [
      { name: 'new.md', openedAt: 2, path: 'E:/notes/new.md' },
      { name: 'old.md', openedAt: 1, path: 'E:/notes/old.md' },
    ];
    let legacyValue: string | null = JSON.stringify(legacyFiles);
    let removeShouldFail = true;
    const legacyStorage = {
      getItem: vi.fn(() => legacyValue),
      removeItem: vi.fn(() => {
        if (removeShouldFail) {
          throw new Error('simulated process exit before cleanup');
        }
        legacyValue = null;
      }),
      setItem: vi.fn(),
    };
    let canonical: RecentFilesSnapshot = { files: [], revision: 0 };
    const importLegacy = vi.fn(async (files: RecentFileInput[]) => {
      if (canonical.revision === 0) {
        canonical = { files: files as Required<RecentFileInput>[], revision: 1 };
      }
      return { data: canonical, ok: true as const };
    });
    const client = createClient({
      get: vi.fn(async () => ({ data: canonical, ok: true as const })),
      importLegacy,
    });
    const firstStore = createRecentFilesStore({ client, legacyStorage });

    await firstStore.getState().hydrateFromClient();

    expect(importLegacy).toHaveBeenCalledTimes(1);
    expect(importLegacy).toHaveBeenCalledWith(legacyFiles);
    expect(firstStore.getState().recentFiles).toEqual(legacyFiles);
    expect(legacyValue).not.toBeNull();
    expect(firstStore.getState().recentFilesPersistenceError).toBe(true);

    removeShouldFail = false;
    const restartedStore = createRecentFilesStore({
      client,
      legacyStorage,
    });
    await restartedStore.getState().hydrateFromClient();

    expect(importLegacy).toHaveBeenCalledTimes(2);
    expect(restartedStore.getState().recentFiles).toEqual(legacyFiles);
    expect(legacyStorage.removeItem).toHaveBeenCalledWith(
      'lumamark.recent-files.v1',
    );
  });

  it('does not migrate and delete the browser client own persisted recent list', async () => {
    const persistedFiles = [
      { name: 'browser.md', openedAt: 1, path: 'E:/notes/browser.md' },
    ];
    const values = new Map([
      [BROWSER_RECENT_FILES_STORAGE_KEY, JSON.stringify(persistedFiles)],
    ]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn((key: string) => values.delete(key)),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    const client = createRecentFilesClient({
      preferBrowserStorage: true,
      storage,
    });
    const store = createRecentFilesStore({ client, legacyStorage: storage });

    await store.getState().hydrateFromClient();

    expect(store.getState().recentFiles).toEqual(persistedFiles);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(values.get(BROWSER_RECENT_FILES_STORAGE_KEY)).toBe(
      JSON.stringify(persistedFiles),
    );
  });

  it('lets a successful add supersede a failed optimistic clear', async () => {
    const existing = {
      name: 'existing.md',
      openedAt: 1,
      path: 'E:/notes/existing.md',
    };
    const added = {
      name: 'added.md',
      openedAt: 2,
      path: 'E:/notes/added.md',
    };
    const client = createClient({
      add: vi.fn(async () => ({
        data: { files: [added, existing], revision: 2 },
        ok: true as const,
      })),
      clear: vi.fn(async () => ({
        error: {
          code: 'recent_files.write_failed',
          message: 'disk full',
          recoverable: true,
        },
        ok: false as const,
      })),
      get: vi.fn(async () => ({
        data: { files: [existing], revision: 1 },
        ok: true as const,
      })),
    });
    const store = createRecentFilesStore({ client });
    await store.getState().hydrateFromClient();

    await store.getState().clearRecentFiles();
    expect(store.getState().recentFiles).toEqual([]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);

    await store.getState().addRecentFile(added);

    expect(store.getState().recentFiles).toEqual([added, existing]);
    expect(store.getState().recentFilesPersistenceError).toBe(false);
  });

  it('rebases a queued add after an earlier in-flight clear fails', async () => {
    const existing = {
      name: 'existing.md',
      openedAt: 1,
      path: 'E:/notes/existing.md',
    };
    const added = {
      name: 'added.md',
      openedAt: 2,
      path: 'E:/notes/added.md',
    };
    const pendingClear = createDeferred<
      Awaited<ReturnType<RecentFilesClient['clear']>>
    >();
    const client = createClient({
      add: vi.fn(async () => ({
        data: { files: [added, existing], revision: 2 },
        ok: true as const,
      })),
      clear: vi.fn(() => pendingClear.promise),
      get: vi.fn(async () => ({
        data: { files: [existing], revision: 1 },
        ok: true as const,
      })),
    });
    const store = createRecentFilesStore({ client });
    await store.getState().hydrateFromClient();

    const clearing = store.getState().clearRecentFiles();
    const adding = store.getState().addRecentFile(added);
    pendingClear.resolve({
      error: {
        code: 'recent_files.write_failed',
        message: 'disk full',
        recoverable: true,
      },
      ok: false,
    });
    await Promise.all([clearing, adding]);

    expect(store.getState().recentFiles).toEqual([added, existing]);
    expect(store.getState().recentFilesPersistenceError).toBe(false);
  });

  it('preserves clear intent when the following add also fails', async () => {
    const existing = {
      name: 'existing.md',
      openedAt: 1,
      path: 'E:/notes/existing.md',
    };
    const added = {
      name: 'added.md',
      openedAt: 2,
      path: 'E:/notes/added.md',
    };
    const failure = {
      error: {
        code: 'recent_files.write_failed',
        message: 'disk full',
        recoverable: true,
      },
      ok: false as const,
    };
    const client = createClient({
      add: vi.fn(async () => failure),
      clear: vi.fn(async () => failure),
      get: vi.fn(async () => ({
        data: { files: [existing], revision: 1 },
        ok: true as const,
      })),
    });
    const store = createRecentFilesStore({ client });
    await store.getState().hydrateFromClient();

    await store.getState().clearRecentFiles();
    await store.getState().addRecentFile(added);

    expect(store.getState().recentFiles).toEqual([added]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);
  });

  it('drops an earlier failed same-path add after a queued replacement succeeds', async () => {
    const older = {
      name: 'old-name.md',
      openedAt: 1,
      path: 'E:/notes/same.md',
    };
    const newer = {
      name: 'new-name.md',
      openedAt: 2,
      path: 'E:/notes/same.md',
    };
    const pendingFirst = createDeferred<
      Awaited<ReturnType<RecentFilesClient['add']>>
    >();
    const add = vi
      .fn<RecentFilesClient['add']>()
      .mockReturnValueOnce(pendingFirst.promise)
      .mockResolvedValueOnce({
        data: { files: [newer], revision: 1 },
        ok: true,
      });
    const store = createRecentFilesStore({ client: createClient({ add }) });

    const first = store.getState().addRecentFile(older);
    const second = store.getState().addRecentFile(newer);
    pendingFirst.resolve({
      error: {
        code: 'recent_files.write_failed',
        message: 'disk full',
        recoverable: true,
      },
      ok: false,
    });
    await Promise.all([first, second]);

    expect(store.getState().recentFiles).toEqual([newer]);
    expect(store.getState().recentFilesPersistenceError).toBe(false);
  });

  it('keeps an older failed add behind a newer successful add', async () => {
    const older = {
      name: 'older.md',
      openedAt: 1,
      path: 'E:/notes/older.md',
    };
    const newer = {
      name: 'newer.md',
      openedAt: 2,
      path: 'E:/notes/newer.md',
    };
    const add = vi
      .fn<RecentFilesClient['add']>()
      .mockResolvedValueOnce({
        error: {
          code: 'recent_files.write_failed',
          message: 'disk full',
          recoverable: true,
        },
        ok: false,
      })
      .mockResolvedValueOnce({
        data: { files: [newer], revision: 1 },
        ok: true,
      });
    const store = createRecentFilesStore({ client: createClient({ add }) });

    await store.getState().addRecentFile(older);
    await store.getState().addRecentFile(newer);

    expect(store.getState().recentFiles).toEqual([newer, older]);
    expect(store.getState().recentFilesPersistenceError).toBe(true);
  });
});

function createClient(
  overrides: Partial<RecentFilesClient> = {},
): RecentFilesClient {
  return {
    add: vi.fn(async () => ({
      data: { files: [], revision: 1 },
      ok: true as const,
    })),
    clear: vi.fn(async () => ({
      data: { files: [], revision: 1 },
      ok: true as const,
    })),
    get: vi.fn(async () => ({
      data: { files: [], revision: 0 },
      ok: true as const,
    })),
    importLegacy: vi.fn(async () => ({
      data: { files: [], revision: 0 },
      ok: true as const,
    })),
    listen: vi.fn(async () => () => undefined),
    ownsLegacyStorage: false,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
