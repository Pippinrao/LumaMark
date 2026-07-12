import { invoke } from '@tauri-apps/api/core';

export type CommandError = {
  code: string;
  message: string;
  recoverable: boolean;
  details?: unknown;
};

export type CommandResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CommandError };

export type InvokeCommandFunction = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
export type InvokeBinaryCommandFunction = <T>(
  command: string,
  body: Uint8Array,
) => Promise<T>;

const defaultInvoke: InvokeCommandFunction = <T>(
  command: string,
  args?: Record<string, unknown>,
) => invoke<T>(command, args);
const defaultBinaryInvoke: InvokeBinaryCommandFunction = <T>(
  command: string,
  body: Uint8Array,
) => invoke<T>(command, body);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeCommandError(error: unknown): CommandError {
  if (isRecord(error)) {
    return {
      code: typeof error.code === 'string' ? error.code : 'command.failed',
      details: error.details,
      message:
        typeof error.message === 'string'
          ? error.message
          : 'Command failed.',
      recoverable:
        typeof error.recoverable === 'boolean' ? error.recoverable : true,
    };
  }

  if (typeof error === 'string') {
    try {
      return normalizeCommandError(JSON.parse(error) as unknown);
    } catch {
      return {
        code: 'command.failed',
        message: error,
        recoverable: true,
      };
    }
  }

  return {
    code: 'command.failed',
    message: 'Command failed.',
    recoverable: true,
  };
}

export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
  invokeFn: InvokeCommandFunction = defaultInvoke,
): Promise<CommandResult<T>> {
  try {
    const data = await invokeFn<T>(command, args);

    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: normalizeCommandError(error) };
  }
}

export async function invokeBinaryCommand<T>(
  command: string,
  body: Uint8Array,
  invokeFn: InvokeBinaryCommandFunction = defaultBinaryInvoke,
): Promise<CommandResult<T>> {
  try {
    const data = await invokeFn<T>(command, body);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: normalizeCommandError(error) };
  }
}
