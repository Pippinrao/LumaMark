import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceWorkflow, type WorkspaceWorkflow } from './useWorkspaceWorkflow';
import { useWorkspaceStore } from './workspaceStore';

const commandMocks = vi.hoisted(() => ({
  createWorkspaceDirectory: vi.fn(),
  createWorkspaceFile: vi.fn(),
  deleteWorkspaceEntry: vi.fn(),
  listWorkspaceChildren: vi.fn(),
  openWorkspaceDirectory: vi.fn(),
  openWorkspacePath: vi.fn(),
  renameWorkspaceEntry: vi.fn(),
}));

vi.mock('../../services/workspace/workspaceCommands', () => commandMocks);

function Harness({ onWorkflow }: { onWorkflow: (workflow: WorkspaceWorkflow) => void }) {
  onWorkflow(useWorkspaceWorkflow({
    openDocumentPath: vi.fn().mockResolvedValue({ status: 'opened' }),
    status: { setStatusKey: vi.fn() },
  }));
  return null;
}

describe('useWorkspaceWorkflow', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().clearWorkspace();
    commandMocks.createWorkspaceDirectory.mockReset();
    commandMocks.createWorkspaceFile.mockReset();
    commandMocks.deleteWorkspaceEntry.mockReset();
    commandMocks.listWorkspaceChildren.mockReset().mockResolvedValue({ ok: true, data: [] });
    commandMocks.openWorkspaceDirectory.mockReset();
    commandMocks.openWorkspacePath.mockReset();
    commandMocks.renameWorkspaceEntry.mockReset();
  });

  afterEach(cleanup);

  it('returns the selected workspace after opening and loading it', async () => {
    const workspace = { name: 'Notes', path: 'E:/notes' };
    commandMocks.openWorkspaceDirectory.mockResolvedValue({ ok: true, data: workspace });
    let workflow: WorkspaceWorkflow | undefined;
    render(<Harness onWorkflow={(value) => { workflow = value; }} />);

    let outcome: Awaited<ReturnType<WorkspaceWorkflow['openWorkspace']>> | undefined;
    await act(async () => {
      outcome = await workflow?.openWorkspace();
    });

    expect(outcome).toEqual({ status: 'opened', workspace });
    expect(useWorkspaceStore.getState().root).toEqual(workspace);
  });

  it('restores a workspace from a path without showing the picker', async () => {
    const workspace = { name: 'Archive', path: 'E:/archive' };
    commandMocks.openWorkspacePath.mockResolvedValue({ ok: true, data: workspace });
    let workflow: WorkspaceWorkflow | undefined;
    render(<Harness onWorkflow={(value) => { workflow = value; }} />);

    await act(async () => {
      await workflow?.openPath('E:/archive');
    });

    expect(commandMocks.openWorkspacePath).toHaveBeenCalledWith('E:/archive');
    expect(commandMocks.openWorkspaceDirectory).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().root).toEqual(workspace);
  });

  it('creates a file then refreshes the parent tree listing', async () => {
    const workspace = { name: 'Notes', path: 'E:/notes' };
    commandMocks.openWorkspacePath.mockResolvedValue({ ok: true, data: workspace });
    commandMocks.createWorkspaceFile.mockResolvedValue({
      ok: true,
      data: {
        kind: 'markdownFile',
        name: 'untitled.md',
        path: 'E:/notes/untitled.md',
      },
    });
    commandMocks.listWorkspaceChildren
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            kind: 'markdownFile',
            name: 'untitled.md',
            path: 'E:/notes/untitled.md',
          },
        ],
      });

    let workflow: WorkspaceWorkflow | undefined;
    render(<Harness onWorkflow={(value) => { workflow = value; }} />);

    await act(async () => {
      await workflow?.openPath('E:/notes');
    });
    await act(async () => {
      await workflow?.createFile('E:/notes', 'untitled.md');
    });

    expect(commandMocks.createWorkspaceFile).toHaveBeenCalledWith({
      name: 'untitled.md',
      parentPath: 'E:/notes',
      workspaceRoot: 'E:/notes',
    });
    expect(useWorkspaceStore.getState().tree.map((node) => node.path)).toEqual([
      'E:/notes/untitled.md',
    ]);
  });

  it('renames an entry and refreshes the parent without dropping siblings', async () => {
    const workspace = { name: 'Notes', path: 'E:/notes' };
    commandMocks.openWorkspacePath.mockResolvedValue({ ok: true, data: workspace });
    commandMocks.renameWorkspaceEntry.mockResolvedValue({
      ok: true,
      data: {
        kind: 'markdownFile',
        name: 'renamed.md',
        path: 'E:/notes/renamed.md',
      },
    });
    commandMocks.listWorkspaceChildren
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            kind: 'markdownFile',
            name: 'old.md',
            path: 'E:/notes/old.md',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            kind: 'markdownFile',
            name: 'renamed.md',
            path: 'E:/notes/renamed.md',
          },
        ],
      });

    let workflow: WorkspaceWorkflow | undefined;
    render(<Harness onWorkflow={(value) => { workflow = value; }} />);

    await act(async () => {
      await workflow?.openPath('E:/notes');
    });
    await act(async () => {
      await workflow?.renameEntry('E:/notes/old.md', 'renamed.md');
    });

    expect(useWorkspaceStore.getState().tree.map((node) => node.path)).toEqual([
      'E:/notes/renamed.md',
    ]);
  });
});
