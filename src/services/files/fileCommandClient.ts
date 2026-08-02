import type {
  ReadTextFileResult,
  WriteTextFileResult,
} from './fileCommands';
import type { CommandResult } from '../tauri/invokeCommand';

export type FileCommandClient = {
  readText: (path: string) => Promise<CommandResult<ReadTextFileResult>>;
  showOpenDialog: () => Promise<CommandResult<string | null>>;
  showOpenImageDialog?: () => Promise<CommandResult<string[] | null>>;
  showSaveDialog: () => Promise<CommandResult<string | null>>;
  writeText: (
    path: string,
    text: string,
  ) => Promise<CommandResult<WriteTextFileResult>>;
};

export type E2EFileCommandState = {
  files: Record<string, string>;
  lastWrite: null | {
    path: string;
    text: string;
  };
};

declare global {
  interface Window {
    __LUMAMARK_E2E_FILE_COMMANDS__?: FileCommandClient;
    __LUMAMARK_E2E_STATE__?: E2EFileCommandState;
  }
}

type ResolveFileCommandClientOptions = {
  allowBrowserClient?: boolean;
};

export function resolveFileCommandClient({
  allowBrowserClient = isBrowserTestClientAllowed(),
}: ResolveFileCommandClientOptions = {}): FileCommandClient | undefined {
  if (!allowBrowserClient) {
    return undefined;
  }

  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.__LUMAMARK_E2E_FILE_COMMANDS__;
}

function isBrowserTestClientAllowed(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'test';
}
