import { describe, expect, it, vi } from 'vitest';
import {
  resolveFileCommandClient,
  type FileCommandClient,
} from './fileCommandClient';

describe('resolveFileCommandClient', () => {
  it('uses the default Tauri file client when no test client is installed', () => {
    expect(resolveFileCommandClient()).toBeUndefined();
  });

  it('ignores browser test clients when the caller does not explicitly allow them', () => {
    const testClient = createTestFileCommandClient();

    globalThis.window = Object.assign(globalThis.window ?? {}, {
      __LUMAMARK_E2E_FILE_COMMANDS__: testClient,
    });

    expect(resolveFileCommandClient({ allowBrowserClient: false })).toBeUndefined();

    delete globalThis.window.__LUMAMARK_E2E_FILE_COMMANDS__;
  });

  it('uses an explicitly installed browser test client for E2E workflows', async () => {
    const testClient = createTestFileCommandClient();

    globalThis.window = Object.assign(globalThis.window ?? {}, {
      __LUMAMARK_E2E_FILE_COMMANDS__: testClient,
    });

    expect(resolveFileCommandClient({ allowBrowserClient: true })).toBe(testClient);
    expect(
      await resolveFileCommandClient({
        allowBrowserClient: true,
      })?.showOpenDialog(),
    ).toEqual({
      ok: true,
      data: 'E:/notes/demo.md',
    });

    delete globalThis.window.__LUMAMARK_E2E_FILE_COMMANDS__;
  });
});

function createTestFileCommandClient(): FileCommandClient {
  return {
    readText: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        byteLength: 7,
        path: 'E:/notes/demo.md',
        text: '# Demo',
      },
    }),
    showOpenDialog: vi.fn().mockResolvedValue({
      ok: true,
      data: 'E:/notes/demo.md',
    }),
    showSaveDialog: vi.fn().mockResolvedValue({
      ok: true,
      data: 'E:/notes/demo.md',
    }),
    writeText: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        byteLength: 7,
        path: 'E:/notes/demo.md',
      },
    }),
  };
}
