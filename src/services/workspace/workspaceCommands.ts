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

export type WorkspaceCommandClient = {
  createDirectory: (input: {
    name: string;
    parentPath: string;
    workspaceRoot: string;
  }) => Promise<CommandResult<WorkspaceEntry>>;
  createFile: (input: {
    name: string;
    parentPath: string;
    workspaceRoot: string;
  }) => Promise<CommandResult<WorkspaceEntry>>;
  deleteEntry: (input: {
    path: string;
    workspaceRoot: string;
  }) => Promise<CommandResult<void>>;
  listChildren: (path: string) => Promise<CommandResult<WorkspaceEntry[]>>;
  openDirectory: () => Promise<CommandResult<WorkspaceDirectory | null>>;
  openPath: (path: string) => Promise<CommandResult<WorkspaceDirectory>>;
  renameEntry: (input: {
    newName: string;
    path: string;
    workspaceRoot: string;
  }) => Promise<CommandResult<WorkspaceEntry>>;
};

type WorkspaceCommandOptions = {
  invokeFn?: InvokeCommandFunction;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_WORKSPACE__?: WorkspaceCommandClient;
  }
}

function resolveE2EWorkspaceClient(): WorkspaceCommandClient | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__LUMAMARK_E2E_WORKSPACE__ ?? null;
}

export async function openWorkspaceDirectory(
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<WorkspaceDirectory | null>> {
  const e2e = resolveE2EWorkspaceClient();
  if (e2e) {
    return e2e.openDirectory();
  }

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
  const e2e = resolveE2EWorkspaceClient();
  if (e2e) {
    return e2e.openPath(path);
  }

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
  const e2e = resolveE2EWorkspaceClient();
  if (e2e) {
    return e2e.listChildren(path);
  }

  return invokeCommand<WorkspaceEntry[]>(
    'workspace_list_children',
    { path },
    options.invokeFn,
  );
}

export async function createWorkspaceFile(
  input: {
    name: string;
    parentPath: string;
    workspaceRoot: string;
  },
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<WorkspaceEntry>> {
  const e2e = resolveE2EWorkspaceClient();
  if (e2e) {
    return e2e.createFile(input);
  }

  return invokeCommand<WorkspaceEntry>(
    'workspace_create_file',
    {
      name: input.name,
      parentPath: input.parentPath,
      workspaceRoot: input.workspaceRoot,
    },
    options.invokeFn,
  );
}

export async function createWorkspaceDirectory(
  input: {
    name: string;
    parentPath: string;
    workspaceRoot: string;
  },
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<WorkspaceEntry>> {
  const e2e = resolveE2EWorkspaceClient();
  if (e2e) {
    return e2e.createDirectory(input);
  }

  return invokeCommand<WorkspaceEntry>(
    'workspace_create_directory',
    {
      name: input.name,
      parentPath: input.parentPath,
      workspaceRoot: input.workspaceRoot,
    },
    options.invokeFn,
  );
}

export async function renameWorkspaceEntry(
  input: {
    newName: string;
    path: string;
    workspaceRoot: string;
  },
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<WorkspaceEntry>> {
  const e2e = resolveE2EWorkspaceClient();
  if (e2e) {
    return e2e.renameEntry(input);
  }

  return invokeCommand<WorkspaceEntry>(
    'workspace_rename_entry',
    {
      newName: input.newName,
      path: input.path,
      workspaceRoot: input.workspaceRoot,
    },
    options.invokeFn,
  );
}

export async function deleteWorkspaceEntry(
  input: {
    path: string;
    workspaceRoot: string;
  },
  options: WorkspaceCommandOptions = {},
): Promise<CommandResult<void>> {
  const e2e = resolveE2EWorkspaceClient();
  if (e2e) {
    return e2e.deleteEntry(input);
  }

  return invokeCommand<void>(
    'workspace_delete_entry',
    {
      path: input.path,
      workspaceRoot: input.workspaceRoot,
    },
    options.invokeFn,
  );
}
