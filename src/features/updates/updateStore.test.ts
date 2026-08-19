import { describe, expect, it, vi } from 'vitest';
import { createUpdateStore } from './updateStore';
import type { UpdateCheckOutcome } from '../../services/updater/updaterService';

function availableOutcome(overrides?: {
  download?: Extract<UpdateCheckOutcome, { kind: 'available' }>['download'];
  install?: Extract<UpdateCheckOutcome, { kind: 'available' }>['install'];
}): Extract<UpdateCheckOutcome, { kind: 'available' }> {
  return {
    kind: 'available',
    version: '0.2.17',
    notes: 'Notes',
    download: overrides?.download ?? vi.fn(async () => ({ kind: 'downloaded' as const })),
    install: overrides?.install ?? vi.fn(async () => ({ kind: 'installed' as const })),
  };
}

describe('update store', () => {
  it('opens the dialog when an update is available during automatic checks', async () => {
    const check = vi.fn(async (): Promise<UpdateCheckOutcome> => availableOutcome());
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

  it('downloads in the background and reopens progress without checking again', async () => {
    let reportProgress:
      | ((progress: { contentLength: number | null; downloaded: number }) => void)
      | undefined;
    let finishDownload: (() => void) | undefined;
    const download = vi.fn(async (onProgress) => {
      reportProgress = onProgress;
      await new Promise<void>((resolve) => {
        finishDownload = resolve;
      });
      return { kind: 'downloaded' as const };
    });
    const install = vi.fn(async () => ({ kind: 'installed' as const }));
    const check = vi.fn(async (): Promise<UpdateCheckOutcome> =>
      availableOutcome({ download, install }),
    );
    const store = createUpdateStore({
      check,
      currentVersion: '0.2.16',
    });

    await store.getState().checkForUpdates({ openDialog: true });
    const downloadPromise = store.getState().installAvailableUpdate();

    expect(store.getState()).toMatchObject({
      dialogOpen: true,
      status: 'downloading',
    });

    store.getState().closeDialog();
    reportProgress?.({ contentLength: 100, downloaded: 40 });

    expect(store.getState()).toMatchObject({
      dialogOpen: false,
      progress: { contentLength: 100, downloaded: 40 },
      status: 'downloading',
    });

    await store.getState().checkForUpdates({ openDialog: true });

    expect(check).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      dialogOpen: true,
      progress: { contentLength: 100, downloaded: 40 },
      status: 'downloading',
    });

    finishDownload?.();
    await downloadPromise;

    expect(install).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      dialogOpen: true,
      status: 'readyToInstall',
    });
  });

  it('installs only after the downloaded update is confirmed', async () => {
    const download = vi.fn(async (onProgress) => {
      onProgress({ contentLength: 50, downloaded: 50 });
      return { kind: 'downloaded' as const };
    });
    const install = vi.fn(async () => ({ kind: 'installed' as const }));
    const store = createUpdateStore({
      check: vi.fn(async (): Promise<UpdateCheckOutcome> =>
        availableOutcome({ download, install }),
      ),
      currentVersion: '0.2.16',
    });

    await store.getState().checkForUpdates({ openDialog: true });
    await store.getState().installAvailableUpdate();
    expect(install).not.toHaveBeenCalled();
    expect(store.getState().status).toBe('readyToInstall');

    store.getState().closeDialog();
    await store.getState().checkForUpdates({ openDialog: true });
    await store.getState().installAvailableUpdate();

    expect(install).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      dialogOpen: true,
      status: 'installing',
    });
  });
});
