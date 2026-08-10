import { isTauri } from '@tauri-apps/api/core';
import {
  check as defaultCheck,
  type DownloadEvent,
  type Update,
} from '@tauri-apps/plugin-updater';

export type UpdateDownloadProgress = {
  contentLength: number | null;
  downloaded: number;
};

export type UpdateInstallOutcome =
  | { kind: 'installed' }
  | { kind: 'failed'; code: string; message: string };

export type UpdateCheckOutcome =
  | { kind: 'unsupported' }
  | { kind: 'upToDate' }
  | {
      kind: 'available';
      version: string;
      notes?: string;
      date?: string;
      install: (
        onProgress: (progress: UpdateDownloadProgress) => void,
      ) => Promise<UpdateInstallOutcome>;
    }
  | { kind: 'failed'; code: string; message: string };

export type CheckForUpdateFunction = () => Promise<Update | null>;

export type UpdaterServiceDependencies = {
  check?: CheckForUpdateFunction;
  isDesktopRuntime?: () => boolean;
};

export async function checkForUpdate(
  dependencies: UpdaterServiceDependencies = {},
): Promise<UpdateCheckOutcome> {
  const isDesktopRuntime = dependencies.isDesktopRuntime ?? isTauri;
  if (!isDesktopRuntime()) {
    return { kind: 'unsupported' };
  }

  const check = dependencies.check ?? defaultCheck;

  try {
    const update = await check();
    if (!update) {
      return { kind: 'upToDate' };
    }

    return {
      kind: 'available',
      version: update.version,
      notes: update.body ?? undefined,
      date: update.date ?? undefined,
      install: (onProgress) => installUpdate(update, onProgress),
    };
  } catch (error) {
    return {
      kind: 'failed',
      code: 'update.checkFailed',
      message: normalizeErrorMessage(error, 'Failed to check for updates.'),
    };
  }
}

async function installUpdate(
  update: Update,
  onProgress: (progress: UpdateDownloadProgress) => void,
): Promise<UpdateInstallOutcome> {
  let downloaded = 0;
  let contentLength: number | null = null;

  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? null;
          downloaded = 0;
          onProgress({ contentLength, downloaded });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress({ contentLength, downloaded });
          break;
        case 'Finished':
          onProgress({ contentLength, downloaded });
          break;
        default:
          break;
      }
    });
    return { kind: 'installed' };
  } catch (error) {
    return {
      kind: 'failed',
      code: 'update.downloadFailed',
      message: normalizeErrorMessage(
        error,
        'Failed to download or install the update. Portable builds and unsigned installs may not support in-app updates.',
      ),
    };
  }
}

function normalizeErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
  }

  return fallback;
}
