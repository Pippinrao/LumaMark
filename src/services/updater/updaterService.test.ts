import { describe, expect, it, vi } from 'vitest';
import { checkForUpdate } from './updaterService';
import type { Update } from '@tauri-apps/plugin-updater';

function createUpdate(overrides: Partial<Update> = {}): Update {
  return {
    version: '0.2.17',
    date: '2026-08-09T00:00:00Z',
    body: 'Bug fixes',
    download: vi.fn(),
    install: vi.fn(),
    downloadAndInstall: vi.fn(async (onEvent) => {
      onEvent?.({ event: 'Started', data: { contentLength: 100 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
      onEvent?.({ event: 'Progress', data: { chunkLength: 60 } });
      onEvent?.({ event: 'Finished' });
    }),
    close: vi.fn(),
    rid: 1,
    available: true,
    currentVersion: '0.2.16',
    rawJson: {},
    ...overrides,
  } as Update;
}

describe('updaterService', () => {
  it('returns unsupported outside the desktop runtime', async () => {
    const outcome = await checkForUpdate({
      isDesktopRuntime: () => false,
      check: vi.fn(),
    });

    expect(outcome).toEqual({ kind: 'unsupported' });
  });

  it('returns upToDate when the plugin finds no update', async () => {
    const outcome = await checkForUpdate({
      isDesktopRuntime: () => true,
      check: vi.fn(async () => null),
    });

    expect(outcome).toEqual({ kind: 'upToDate' });
  });

  it('returns available updates and reports download progress during install', async () => {
    const update = createUpdate();
    const outcome = await checkForUpdate({
      isDesktopRuntime: () => true,
      check: vi.fn(async () => update),
    });

    expect(outcome.kind).toBe('available');
    if (outcome.kind !== 'available') {
      return;
    }

    expect(outcome.version).toBe('0.2.17');
    expect(outcome.notes).toBe('Bug fixes');

    const progress: Array<{ contentLength: number | null; downloaded: number }> =
      [];
    const installOutcome = await outcome.install((event) => {
      progress.push(event);
    });

    expect(installOutcome).toEqual({ kind: 'installed' });
    expect(progress).toEqual([
      { contentLength: 100, downloaded: 0 },
      { contentLength: 100, downloaded: 40 },
      { contentLength: 100, downloaded: 100 },
      { contentLength: 100, downloaded: 100 },
    ]);
  });

  it('maps check failures to a stable failed outcome', async () => {
    const outcome = await checkForUpdate({
      isDesktopRuntime: () => true,
      check: vi.fn(async () => {
        throw new Error('network down');
      }),
    });

    expect(outcome).toEqual({
      kind: 'failed',
      code: 'update.checkFailed',
      message: 'network down',
    });
  });

  it('maps install failures to a stable failed outcome', async () => {
    const update = createUpdate({
      downloadAndInstall: vi.fn(async () => {
        throw new Error('signature mismatch');
      }),
    });
    const outcome = await checkForUpdate({
      isDesktopRuntime: () => true,
      check: vi.fn(async () => update),
    });

    expect(outcome.kind).toBe('available');
    if (outcome.kind !== 'available') {
      return;
    }

    await expect(outcome.install(vi.fn())).resolves.toEqual({
      kind: 'failed',
      code: 'update.downloadFailed',
      message: 'signature mismatch',
    });
  });
});
