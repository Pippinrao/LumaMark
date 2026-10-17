import type { CommandResult } from '../tauri/invokeCommand';
import {
  extractPackage,
  openPackage,
  showExtractPackageDialog,
} from './packageCommands';
import type {
  PackageExtractResult,
  PackageOpenResult,
} from './packageTypes';

export type PackageCommandClient = {
  extract: (
    path: string,
    parentDirectory: string,
  ) => Promise<CommandResult<PackageExtractResult>>;
  open: (path: string) => Promise<CommandResult<PackageOpenResult>>;
  showExtractDialog: () => Promise<CommandResult<string | null>>;
};

export type E2EPackageCommandClient = {
  extract?: (
    path: string,
    parentDirectory: string,
  ) => Promise<CommandResult<PackageExtractResult>>;
  open?: (path: string) => Promise<CommandResult<PackageOpenResult>>;
  showExtractDialog?: () => Promise<CommandResult<string | null>>;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_PACKAGE_COMMANDS__?: E2EPackageCommandClient;
  }
}

export const defaultPackageCommandClient: PackageCommandClient = {
  extract: extractPackage,
  open: openPackage,
  showExtractDialog: showExtractPackageDialog,
};

export function resolvePackageCommandClient():
  | PackageCommandClient
  | undefined {
  if (
    !(import.meta.env.DEV || import.meta.env.MODE === 'test') ||
    typeof window === 'undefined'
  ) {
    return undefined;
  }

  const client = window.__LUMAMARK_E2E_PACKAGE_COMMANDS__;
  if (!client) {
    return undefined;
  }

  return {
    extract: (path, parentDirectory) =>
      client.extract
        ? client.extract(path, parentDirectory)
        : extractPackage(path, parentDirectory),
    open: (path) => (client.open ? client.open(path) : openPackage(path)),
    showExtractDialog: () =>
      client.showExtractDialog
        ? client.showExtractDialog()
        : showExtractPackageDialog(),
  };
}
