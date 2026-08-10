import { describe, expect, it, vi } from 'vitest';
import { createUpdateStore } from './updateStore';
import type { UpdateCheckOutcome } from '../../services/updater/updaterService';

describe('update store', () => {
  it('opens the dialog when an update is available during automatic checks', async () => {
    const install = vi.fn(async () => ({ kind: 'installed' as const }));
    const check = vi.fn(async (): Promise<UpdateCheckOutcome> => ({
      kind: 'available',
      version: '0.2.17',
      notes: 'Notes',
      install,
    }));
    const store = createUpdateStore({
      check,
      currentVersion: '0.2.16',
    });

    await store.getState().checkForUpdates();

    expect(store.getState()).toMatchObject({
      dialogOpen: true,
      notes: 'Notes',
      status: 'available',
      version: '0.2.17',
    });
  });

  it('keeps automatic check failures silent until a manual check opens the dialog', async () => {
    const check = vi.fn(async (): Promise<UpdateCheckOutcome> => ({
      kind: 'failed',
      code: 'update.checkFailed',
      message: 'offline',
    }));
    const store = createUpdateStore({
      check,
      currentVersion: '0.2.16',
    });

    await store.getState().checkForUpdates();
    expect(store.getState()).toMatchObject({
      dialogOpen: false,
      status: 'idle',
      errorCode: 'update.checkFailed',
    });

    await store.getState().checkForUpdates({ openDialog: true });
    expect(store.getState()).toMatchObject({
      dialogOpen: true,
      status: 'error',
      errorCode: 'update.checkFailed',
      errorMessage: 'offline',
    });
  });

  it('tracks download progress while installing an available update', async () => {
    const install = vi.fn(async (onProgress) => {
      onProgress({ contentLength: 50, downloaded: 25 });
      return { kind: 'installed' as const };
    });
    const store = createUpdateStore({
      check: vi.fn(async (): Promise<UpdateCheckOutcome> => ({
        kind: 'available',
        version: '0.2.17',
        install,
      })),
      currentVersion: '0.2.16',
    });

    await store.getState().checkForUpdates({ openDialog: true });
    await store.getState().installAvailableUpdate();

    expect(install).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      status: 'installing',
      progress: { contentLength: 50, downloaded: 25 },
    });
  });
});
