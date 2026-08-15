import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BROWSER_RECENT_FILES_STORAGE_KEY,
  RECENT_FILES_CHANGED_EVENT,
  createRecentFilesClient,
  type RecentFilesSnapshot,
} from './recentFilesClient';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriMocks.listen,
}));

describe('recentFilesClient', () => {
  afterEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
  });

  it('maps get, add, clear, legacy import, and change events to the native atomic service', async () => {
    const snapshots: RecentFilesSnapshot[] = [
      { files: [], revision: 1 },
      {
        files: [
          {
            name: 'note.md',
            openedAt: 42,
            path: 'E:/notes/note.md',
          },
        ],
        revision: 2,
      },
      { files: [], revision: 3 },
      {
        files: [
          {
            name: 'legacy.md',
            openedAt: 1,
            path: 'E:/notes/legacy.md',
          },
        ],
        revision: 4,
      },
    ];
    tauriMocks.invoke
      .mockResolvedValueOnce(snapshots[0])
      .mockResolvedValueOnce(snapshots[1])
      .mockResolvedValueOnce(snapshots[2])
      .mockResolvedValueOnce(snapshots[3]);
    const unlisten = vi.fn();
    const onChange = vi.fn();
    tauriMocks.listen.mockImplementation(
      async (
        _eventName: string,
        listener: (event: { payload: RecentFilesSnapshot }) => void,
      ) => {
        listener({ payload: snapshots[1] });
        return unlisten;
      },
    );
    const client = createRecentFilesClient({ preferBrowserStorage: false });

    await expect(client.get()).resolves.toEqual({
      data: snapshots[0],
      ok: true,
    });
    await expect(
      client.add({ name: 'note.md', openedAt: 42, path: 'E:/notes/note.md' }),
    ).resolves.toEqual({ data: snapshots[1], ok: true });
    await expect(client.clear()).resolves.toEqual({
      data: snapshots[2],
      ok: true,
    });
    await expect(
      client.importLegacy(snapshots[3].files),
    ).resolves.toEqual({ data: snapshots[3], ok: true });
    const stopListening = await client.listen(onChange);

    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      1,
      'recent_files_get',
      undefined,
    );
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'recent_files_add', {
      file: { name: 'note.md', openedAt: 42, path: 'E:/notes/note.md' },
    });
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      3,
      'recent_files_clear',
      undefined,
    );
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      4,
      'recent_files_import_legacy',
      { files: snapshots[3].files },
    );
    expect(tauriMocks.listen).toHaveBeenCalledWith(
      RECENT_FILES_CHANGED_EVENT,
      expect.any(Function),
    );
    expect(onChange).toHaveBeenCalledWith(snapshots[1]);
    stopListening();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('keeps the browser fallback schema compatible and deduplicates Windows identities', async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const client = createRecentFilesClient({
      preferBrowserStorage: true,
      storage,
    });

    const first = await client.add({
      name: 'README.md',
      openedAt: 1,
      path: String.raw`\\Server\Share\README.md`,
    });
    const second = await client.add({
      name: 'readme.md',
      openedAt: 2,
      path: String.raw`\\server\share\readme.md`,
    });
    const restored = await createRecentFilesClient({
      preferBrowserStorage: true,
      storage,
    }).get();

    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual({
      data: {
        files: [
          {
            name: 'readme.md',
            openedAt: 2,
            path: String.raw`\\server\share\readme.md`,
          },
        ],
        revision: 2,
      },
      ok: true,
    });
    expect(restored).toEqual({
      data: {
        files: second.ok ? second.data.files : [],
        revision: 0,
      },
      ok: true,
    });
    expect(values.get(BROWSER_RECENT_FILES_STORAGE_KEY)).toContain(
      'readme.md',
    );
  });

  it('returns stable failures instead of silently falling back after native errors', async () => {
    tauriMocks.invoke.mockRejectedValue({
      code: 'recent_files.write_failed',
      message: 'disk full',
      recoverable: true,
    });
    const client = createRecentFilesClient({ preferBrowserStorage: false });

    await expect(
      client.add({ name: 'note.md', openedAt: 1, path: 'E:/note.md' }),
    ).resolves.toEqual({
      error: {
        code: 'recent_files.write_failed',
        message: 'disk full',
        recoverable: true,
      },
      ok: false,
    });
  });

  it('fails closed for malformed native snapshots and ignores malformed change events', async () => {
    tauriMocks.invoke.mockResolvedValue({
      files: [{ name: 'note.md', openedAt: Number.NaN, path: 'E:/note.md' }],
      revision: -1,
    });
    tauriMocks.listen.mockImplementation(
      async (
        _eventName: string,
        listener: (event: { payload: unknown }) => void,
      ) => {
        listener({ payload: { files: 'not-an-array', revision: 4 } });
        return () => undefined;
      },
    );
    const onChange = vi.fn();
    const client = createRecentFilesClient({ preferBrowserStorage: false });

    await expect(client.get()).resolves.toEqual({
      error: {
        code: 'recent_files.invalid_response',
        message: 'Recent files returned an invalid response.',
        recoverable: true,
      },
      ok: false,
    });
    await client.listen(onChange);

    expect(onChange).not.toHaveBeenCalled();
  });
});
