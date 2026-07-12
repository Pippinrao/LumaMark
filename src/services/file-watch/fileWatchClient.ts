import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  invokeCommand,
  type CommandResult,
} from '../tauri/invokeCommand';

export const FILE_WATCH_CHANGED_EVENT = 'file-watch://changed';

export type FileWatchChangeEvent = {
  fingerprint?: string | null;
  kind: 'document' | 'error' | 'image' | 'removed';
  path: string;
  revision: number;
};

export type FileWatchBaseline = {
  fingerprint: string | null;
};

export type FileWatchClient = {
  listen: (
    listener: (event: FileWatchChangeEvent) => void,
  ) => Promise<() => void>;
  replaceLocalImageTargets: (
    paths: readonly string[],
  ) => Promise<CommandResult<void>>;
  unwatchDocument: () => Promise<CommandResult<void>>;
  watchDocument: (
    path: string,
  ) => Promise<CommandResult<FileWatchBaseline | undefined>>;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_FILE_WATCH__?: FileWatchClient;
  }
}

const successfulNoop = async (): Promise<CommandResult<void>> => ({
  ok: true,
  data: undefined,
});

const successfulWatchNoop = async (): Promise<
  CommandResult<FileWatchBaseline | undefined>
> => ({
  ok: true,
  data: undefined,
});

const noopFileWatchClient: FileWatchClient = {
  listen: async () => () => undefined,
  replaceLocalImageTargets: successfulNoop,
  unwatchDocument: successfulNoop,
  watchDocument: successfulWatchNoop,
};

const tauriFileWatchClient: FileWatchClient = {
  async listen(listener) {
    return listen<FileWatchChangeEvent>(FILE_WATCH_CHANGED_EVENT, (event) => {
      listener(event.payload);
    });
  },
  replaceLocalImageTargets(paths) {
    return invokeCommand<void>('replace_local_image_targets', {
      paths: [...paths],
    });
  },
  unwatchDocument() {
    return invokeCommand<void>('unwatch_document');
  },
  watchDocument(path) {
    return invokeCommand<FileWatchBaseline>('watch_document', { path });
  },
};

type ResolveFileWatchClientOptions = {
  allowBrowserClient?: boolean;
};

export function resolveFileWatchClient({
  allowBrowserClient = import.meta.env.DEV || import.meta.env.MODE === 'test',
}: ResolveFileWatchClientOptions = {}): FileWatchClient {
  if (
    allowBrowserClient &&
    typeof window !== 'undefined' &&
    window.__LUMAMARK_E2E_FILE_WATCH__
  ) {
    return window.__LUMAMARK_E2E_FILE_WATCH__;
  }

  if (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window
  ) {
    return tauriFileWatchClient;
  }

  return noopFileWatchClient;
}

export function listenForFileWatchChanges(
  listener: (event: FileWatchChangeEvent) => void,
): Promise<UnlistenFn> {
  return resolveFileWatchClient().listen(listener);
}

export function replaceLocalImageTargets(
  paths: readonly string[],
): Promise<CommandResult<void>> {
  return resolveFileWatchClient().replaceLocalImageTargets(paths);
}

export function unwatchDocument(): Promise<CommandResult<void>> {
  return resolveFileWatchClient().unwatchDocument();
}

export function watchDocument(
  path: string,
): Promise<CommandResult<FileWatchBaseline | undefined>> {
  return resolveFileWatchClient().watchDocument(path);
}
