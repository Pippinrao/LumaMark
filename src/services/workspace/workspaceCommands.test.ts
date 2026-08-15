import { describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceChildren,
  openWorkspaceDirectory,
  openWorkspacePath,
  renameWorkspaceEntry,
} from './workspaceCommands';

describe('workspace command clients', () => {
  it('opens a workspace directory through the Rust command boundary', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      name: 'Notes',
      path: 'E:/docs/Notes',
    });

    const result = await openWorkspaceDirectory({ invokeFn });

    expect(invokeFn).toHaveBeenCalledWith(
      'workspace_open_directory',
      undefined,
    );
    expect(result).toEqual({
      ok: true,
      data: {
        name: 'Notes',
        path: 'E:/docs/Notes',
      },
    });
  });

  it('lists Markdown workspace children without exposing platform APIs to UI', async () => {
    const invokeFn = vi.fn().mockResolvedValue([
      {
        kind: 'directory',
        name: 'Drafts',
        path: 'E:/docs/Notes/Drafts',
      },
      {
        kind: 'markdownFile',
        name: 'README.md',
        path: 'E:/docs/Notes/README.md',
      },
    ]);

    const result = await listWorkspaceChildren('E:/docs/Notes', { invokeFn });

    expect(invokeFn).toHaveBeenCalledWith('workspace_list_children', {
      path: 'E:/docs/Notes',
    });
    expect(result).toEqual({
      ok: true,
      data: [
        {
          kind: 'directory',
          name: 'Drafts',
          path: 'E:/docs/Notes/Drafts',
        },
        {
          kind: 'markdownFile',
          name: 'README.md',
          path: 'E:/docs/Notes/README.md',
        },
      ],
    });
  });

  it('restores a workspace through a typed path command', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      name: 'Notes',
      path: 'E:/docs/Notes',
    });

    const result = await openWorkspacePath('E:/docs/Notes', { invokeFn });

    expect(invokeFn).toHaveBeenCalledWith('workspace_open_path', {
      path: 'E:/docs/Notes',
    });
    expect(result).toEqual({
      ok: true,
      data: { name: 'Notes', path: 'E:/docs/Notes' },
    });
  });

  it('creates files through the workspace mutation command boundary', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      kind: 'markdownFile',
      name: 'note.md',
      path: 'E:/docs/Notes/note.md',
    });

    const result = await createWorkspaceFile(
      {
        name: 'note.md',
        parentPath: 'E:/docs/Notes',
        workspaceRoot: 'E:/docs/Notes',
      },
      { invokeFn },
    );

    expect(invokeFn).toHaveBeenCalledWith('workspace_create_file', {
      name: 'note.md',
      parentPath: 'E:/docs/Notes',
      workspaceRoot: 'E:/docs/Notes',
    });
    expect(result.ok).toBe(true);
  });

  it('creates directories, renames, and deletes through typed clients', async () => {
    const invokeFn = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'directory',
        name: 'Drafts',
        path: 'E:/docs/Notes/Drafts',
      })
      .mockResolvedValueOnce({
        kind: 'markdownFile',
        name: 'renamed.md',
        path: 'E:/docs/Notes/renamed.md',
      })
      .mockResolvedValueOnce(undefined);

    await createWorkspaceDirectory(
      {
        name: 'Drafts',
        parentPath: 'E:/docs/Notes',
        workspaceRoot: 'E:/docs/Notes',
      },
      { invokeFn },
    );
    await renameWorkspaceEntry(
      {
        newName: 'renamed.md',
        path: 'E:/docs/Notes/old.md',
        workspaceRoot: 'E:/docs/Notes',
      },
      { invokeFn },
    );
    await deleteWorkspaceEntry(
      {
        path: 'E:/docs/Notes/renamed.md',
        workspaceRoot: 'E:/docs/Notes',
      },
      { invokeFn },
    );

    expect(invokeFn).toHaveBeenNthCalledWith(1, 'workspace_create_directory', {
      name: 'Drafts',
      parentPath: 'E:/docs/Notes',
      workspaceRoot: 'E:/docs/Notes',
    });
    expect(invokeFn).toHaveBeenNthCalledWith(2, 'workspace_rename_entry', {
      newName: 'renamed.md',
      path: 'E:/docs/Notes/old.md',
      workspaceRoot: 'E:/docs/Notes',
    });
    expect(invokeFn).toHaveBeenNthCalledWith(3, 'workspace_delete_entry', {
      path: 'E:/docs/Notes/renamed.md',
      workspaceRoot: 'E:/docs/Notes',
    });
  });
});
