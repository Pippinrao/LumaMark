import {
  invokeCommand,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';

export type ReadTextFileResult = {
  byteLength: number;
  fingerprint?: string;
  path: string;
  text: string;
};

export type WriteTextFileResult = {
  byteLength: number;
  fingerprint?: string;
  path: string;
};

type FileCommandOptions = {
  invokeFn?: InvokeCommandFunction;
};

export async function readTextFile(
  path: string,
  options: FileCommandOptions = {},
): Promise<CommandResult<ReadTextFileResult>> {
  return invokeCommand<ReadTextFileResult>(
    'files_read_text',
    { path },
    options.invokeFn,
  );
}

export async function writeTextFile(
  path: string,
  text: string,
  options: FileCommandOptions = {},
): Promise<CommandResult<WriteTextFileResult>> {
  return invokeCommand<WriteTextFileResult>(
    'files_write_text',
    { path, text },
    options.invokeFn,
  );
}

export async function showOpenFileDialog(
  options: FileCommandOptions = {},
): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>(
    'files_show_open_file_dialog',
    undefined,
    options.invokeFn,
  );
}

export async function showOpenImageDialog(
  filterLabel: string,
  options: FileCommandOptions = {},
): Promise<CommandResult<string[] | null>> {
  return invokeCommand<string[] | null>(
    'files_show_open_image_dialog',
    { filterLabel },
    options.invokeFn,
  );
}

export async function showSaveFileDialog(
  options: FileCommandOptions = {},
): Promise<CommandResult<string | null>> {
  return invokeCommand<string | null>(
    'files_show_save_file_dialog',
    undefined,
    options.invokeFn,
  );
}
