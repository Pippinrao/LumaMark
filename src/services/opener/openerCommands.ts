import {
  invokeCommand,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';
import { classifyLinkUrl } from './linkUrlClassification';

export type OpenExternalUrlResult = {
  opened: true;
};

export type RevealPathResult = {
  revealed: true;
};

type OpenerCommandOptions = {
  invokeFn?: InvokeCommandFunction;
};

export async function openExternalUrl(
  url: string,
  options: OpenerCommandOptions = {},
): Promise<CommandResult<OpenExternalUrlResult>> {
  const classification = classifyLinkUrl(url);
  if (classification.kind !== 'absoluteAllowed') {
    return {
      ok: false,
      error: {
        code:
          classification.kind === 'rejected'
            ? classification.code
            : 'link.protocol_rejected',
        message: 'URL protocol is not allowed.',
        recoverable: true,
      },
    };
  }

  return invokeCommand<OpenExternalUrlResult>(
    'opener_open_url',
    { url },
    options.invokeFn,
  );
}

export async function revealPathInOs(
  path: string,
  context: {
    documentPath?: string | null;
    workspaceRoot?: string | null;
  } = {},
  options: OpenerCommandOptions = {},
): Promise<CommandResult<RevealPathResult>> {
  const trimmed = path.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: {
        code: 'file.invalid_path',
        message: 'File path is invalid or unavailable.',
        recoverable: true,
      },
    };
  }

  return invokeCommand<RevealPathResult>(
    'opener_reveal_path',
    {
      documentPath: context.documentPath ?? null,
      path: trimmed,
      workspaceRoot: context.workspaceRoot ?? null,
    },
    options.invokeFn,
  );
}
