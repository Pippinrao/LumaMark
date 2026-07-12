import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveFileWatchClient,
  type FileWatchClient,
} from './fileWatchClient';

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

describe('resolveFileWatchClient', () => {
  afterEach(() => {
    delete (window as Window & {
      __LUMAMARK_E2E_FILE_WATCH__?: FileWatchClient;
    }).__LUMAMARK_E2E_FILE_WATCH__;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
  });

  it('uses an explicitly installed browser client in test workflows', () => {
    const client = createClient();
    (window as Window & {
      __LUMAMARK_E2E_FILE_WATCH__?: FileWatchClient;
    }).__LUMAMARK_E2E_FILE_WATCH__ = client;

    expect(resolveFileWatchClient({ allowBrowserClient: true })).toBe(client);
  });

  it('maps the typed client to the stable Tauri commands and change event', async () => {
    const unlisten = vi.fn();
    const onChange = vi.fn();
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    tauriMocks.invoke.mockResolvedValue(undefined);
    tauriMocks.listen.mockImplementation(
      async (_eventName: string, listener: (event: { payload: unknown }) => void) => {
        listener({
          payload: {
            fingerprint: 'sha256:abc',
            kind: 'document',
            path: 'E:/notes/demo.md',
            revision: 4,
          },
        });
        return unlisten;
      },
    );
    const client = resolveFileWatchClient({ allowBrowserClient: false });

    await client.watchDocument('E:/notes/demo.md');
    await client.replaceLocalImageTargets([
      'E:/notes/assets/first.png',
      'E:/notes/assets/second.png',
    ]);
    await client.unwatchDocument();
    const stopListening = await client.listen(onChange);

    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, 'watch_document', {
      path: 'E:/notes/demo.md',
    });
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      2,
      'replace_local_image_targets',
      {
        paths: [
          'E:/notes/assets/first.png',
          'E:/notes/assets/second.png',
        ],
      },
    );
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(3, 'unwatch_document', undefined);
    expect(tauriMocks.listen).toHaveBeenCalledWith(
      'file-watch://changed',
      expect.any(Function),
    );
    expect(onChange).toHaveBeenCalledWith({
      fingerprint: 'sha256:abc',
      kind: 'document',
      path: 'E:/notes/demo.md',
      revision: 4,
    });

    stopListening();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

function createClient(): FileWatchClient {
  return {
    listen: vi.fn().mockResolvedValue(() => undefined),
    replaceLocalImageTargets: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    unwatchDocument: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
    watchDocument: vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    }),
  };
}
