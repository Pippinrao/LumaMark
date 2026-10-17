import type { InvokeCommandFunction } from '../tauri/invokeCommand';
import { invokeCommand, type CommandResult } from '../tauri/invokeCommand';
import type {
  PackageExtractResult,
  PackageOpenResult,
} from './packageTypes';

type PackageCommandOptions = {
  invokeFn?: InvokeCommandFunction;
};

export async function openPackage(
  path: string,
  options: PackageCommandOptions = {},
): Promise<CommandResult<PackageOpenResult>> {
  return invokeCommand<PackageOpenResult>(
    'package_open',
    { path },
    options.invokeFn,
  );
}

export async function extractPackage(
  path: string,
  parentDirectory: string,
  options: PackageCommandOptions = {},
): Promise<CommandResult<PackageExtractResult>> {
  return invokeCommand<PackageExtractResult>(
    'package_extract',
    { parentDirectory, path },
    options.invokeFn,
  );
}

export async function showExtractPackageDialog(
  options: PackageCommandOptions = {},
): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>(
    'package_show_extract_dialog',
    undefined,
    options.invokeFn,
  );
}
