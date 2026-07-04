import { describe, expect, it, vi } from 'vitest';
import {
  listWorkspaceChildren,
  openWorkspaceDirectory,
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
});
