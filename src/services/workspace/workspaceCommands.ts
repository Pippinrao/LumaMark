import {
  invokeCommand,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';

export type WorkspaceDirectory = {
  name: string;
  path: string;
};

export type WorkspaceEntryKind = 'directory' | 'markdownFile';

export type WorkspaceEntry = {
  kind: WorkspaceEntryKind;
  name: string;
  path: string;
};

type WorkspaceCommandOptions = {
  invokeFn?: InvokeCommandFunction;
};

export async function openWorkspaceDirectory(
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<WorkspaceDirectory | null>> {
  return invokeCommand<WorkspaceDirectory | null>(
    'workspace_open_directory',
    undefined,
    options.invokeFn,
  );
}

export async function openWorkspacePath(
  path: string,
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<WorkspaceDirectory>> {
  return invokeCommand<WorkspaceDirectory>(
    'workspace_open_path',
    { path },
    options.invokeFn,
  );
}

export async function listWorkspaceChildren(
  path: string,
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<WorkspaceEntry[]>> {
  return invokeCommand<WorkspaceEntry[]>(
    'workspace_list_children',
    { path },
    options.invokeFn,
  );
}
