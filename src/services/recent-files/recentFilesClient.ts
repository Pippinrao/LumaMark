import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';

import { areFilePathsEqual } from '../files/filePathIdentity';
import {
  strictBrowserPreferenceStorage,
  type KeyValueStorage,
} from '../preferences/browserPreferenceStorage';
import {
  invokeCommand,
  type CommandError,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';

export const BROWSER_RECENT_FILES_STORAGE_KEY = 'lumamark.recent-files.v1';
export const RECENT_FILES_CHANGED_EVENT = 'recent-files://changed';

const MAX_RECENT_FILES = 20;

export type RecentFile = {
  name: string;
  openedAt: number;
  path: string;
};

export type RecentFileInput = {
  name: string;
  openedAt?: number;
  path: string;
};

export type RecentFilesSnapshot = {
  files: RecentFile[];
  revision: number;
};

export type RecentFilesClient = {
  add: (file: RecentFileInput) => Promise<CommandResult<RecentFilesSnapshot>>;
  clear: () => Promise<CommandResult<RecentFilesSnapshot>>;
  get: () => Promise<CommandResult<RecentFilesSnapshot>>;
  importLegacy: (
    files: RecentFile[],
  ) => Promise<CommandResult<RecentFilesSnapshot>>;
  listen: (
    listener: (snapshot: RecentFilesSnapshot) => void,
  ) => Promise<UnlistenFn>;
  ownsLegacyStorage: boolean;
};

type ListenFunction = <T>(
  event: string,
  handler: (event: Event<T>) => void,
) => Promise<UnlistenFn>;

type CreateRecentFilesClientOptions = {
  invokeFn?: InvokeCommandFunction;
  listenFn?: ListenFunction;
  preferBrowserStorage?: boolean;
  storage?: KeyValueStorage;
};

export function createRecentFilesClient({
  invokeFn,
  listenFn = listen,
  preferBrowserStorage = shouldPreferBrowserStorage(),
  storage = strictBrowserPreferenceStorage,
}: CreateRecentFilesClientOptions = {}): RecentFilesClient {
  if (preferBrowserStorage) {
    return createBrowserRecentFilesClient(storage);
  }

  return {
    add: (file) =>
      invokeRecentFilesSnapshot(
        'recent_files_add',
        {
          file: {
            ...file,
            openedAt: file.openedAt ?? Date.now(),
          },
        },
        invokeFn,
      ),
    clear: () =>
      invokeRecentFilesSnapshot(
        'recent_files_clear',
        undefined,
        invokeFn,
      ),
    get: () =>
      invokeRecentFilesSnapshot(
        'recent_files_get',
        undefined,
        invokeFn,
      ),
    importLegacy: (files) =>
      invokeRecentFilesSnapshot(
        'recent_files_import_legacy',
        { files },
        invokeFn,
      ),
    listen: (listener) =>
      listenFn<unknown>(RECENT_FILES_CHANGED_EVENT, (event) => {
        if (isRecentFilesSnapshot(event.payload)) {
          listener(event.payload);
        }
      }),
    ownsLegacyStorage: false,
  };
}

async function invokeRecentFilesSnapshot(
  command: string,
  args: Record<string, unknown> | undefined,
  invokeFn: InvokeCommandFunction | undefined,
): Promise<CommandResult<RecentFilesSnapshot>> {
  const result = await invokeCommand<unknown>(command, args, invokeFn);
  if (!result.ok) {
    return result;
  }
  if (!isRecentFilesSnapshot(result.data)) {
    return failure(
      'recent_files.invalid_response',
      'Recent files returned an invalid response.',
    );
  }
  return { data: result.data, ok: true };
}

function createBrowserRecentFilesClient(
  storage: KeyValueStorage,
): RecentFilesClient {
  let revision = 0;

  const read = (): CommandResult<RecentFilesSnapshot> => {
    try {
      return {
        data: {
          files: parseRecentFiles(
            storage.getItem(BROWSER_RECENT_FILES_STORAGE_KEY),
          ),
          revision,
        },
        ok: true,
      };
    } catch {
      return failure(
        'recent_files.read_failed',
        'Recent files could not be read.',
      );
    }
  };

  const write = (
    files: RecentFile[],
  ): CommandResult<RecentFilesSnapshot> => {
    try {
      storage.setItem(
        BROWSER_RECENT_FILES_STORAGE_KEY,
        JSON.stringify(files),
      );
      revision += 1;
      return { data: { files, revision }, ok: true };
    } catch {
      return failure(
        'recent_files.write_failed',
        'Recent files could not be written.',
      );
    }
  };

  return {
    async add(file) {
      const current = read();
      if (!current.ok) {
        return current;
      }
      const next: RecentFile = {
        name: file.name,
        openedAt: file.openedAt ?? Date.now(),
        path: file.path,
      };
      const files = [
        next,
        ...current.data.files.filter(
          (recentFile) => !areFilePathsEqual(recentFile.path, next.path),
        ),
      ].slice(0, MAX_RECENT_FILES);
      return write(files);
    },
    async clear() {
      return write([]);
    },
    async get() {
      return read();
    },
    async importLegacy(files) {
      const current = read();
      if (!current.ok) {
        return current;
      }
      let merged = current.data.files;
      for (const file of [...files].reverse()) {
        merged = [
          file,
          ...merged.filter(
            (recentFile) => !areFilePathsEqual(recentFile.path, file.path),
          ),
        ].slice(0, MAX_RECENT_FILES);
      }
      return write(merged);
    },
    async listen() {
      return () => undefined;
    },
    ownsLegacyStorage: true,
  };
}

function parseRecentFiles(value: string | null): RecentFile[] {
  if (value === null) {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isRecentFile)) {
    throw new Error('Invalid persisted recent files');
  }
  return parsed.slice(0, MAX_RECENT_FILES);
}

function isRecentFile(value: unknown): value is RecentFile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const file = value as Record<string, unknown>;
  return (
    typeof file.name === 'string' &&
    file.name.trim().length > 0 &&
    typeof file.openedAt === 'number' &&
    Number.isFinite(file.openedAt) &&
    typeof file.path === 'string' &&
    file.path.trim().length > 0
  );
}

function isRecentFilesSnapshot(value: unknown): value is RecentFilesSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  return (
    Array.isArray(snapshot.files) &&
    snapshot.files.length <= MAX_RECENT_FILES &&
    snapshot.files.every(isRecentFile) &&
    typeof snapshot.revision === 'number' &&
    Number.isSafeInteger(snapshot.revision) &&
    snapshot.revision >= 0
  );
}

function failure(
  code: string,
  message: string,
): { error: CommandError; ok: false } {
  return {
    error: { code, message, recoverable: true },
    ok: false,
  };
}

function shouldPreferBrowserStorage(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  const userAgent = globalThis.navigator?.userAgent.toLowerCase() ?? '';
  if (userAgent.includes('jsdom')) {
    return true;
  }
  return !('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export const recentFilesClient = createRecentFilesClient();
