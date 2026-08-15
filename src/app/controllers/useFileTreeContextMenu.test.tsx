import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  useFileTreeContextMenu,
  type FileTreeContextPayloadHandlers,
} from './useFileTreeContextMenu';
import { useAppStore } from '../stores/appStore';
import type { CommandMenuNode } from '../../features/commands/commandTypes';
import type { WorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../services/opener/openerCommands', () => ({
  revealPathInOs: vi.fn().mockResolvedValue({ ok: true, data: { revealed: true } }),
}));

function createWorkspaceMock(
  overrides: Partial<WorkspaceWorkflow> = {},
): WorkspaceWorkflow {
  return {
    createDirectory: vi.fn(),
    createFile: vi.fn(),
    deleteEntry: vi.fn(),
    dismissError: vi.fn(),
    error: null,
    loadChildren: vi.fn(),
    loadingPaths: {},
    openFile: vi.fn(),
    openPath: vi.fn(),
    openWorkspace: vi.fn(),
    renameEntry: vi.fn(),
    root: { name: 'Notes', path: 'E:/notes' },
    tree: [],
    ...overrides,
  };
}

describe('useFileTreeContextMenu', () => {
  beforeEach(() => {
    useAppStore.setState({ lastFileError: null });
    installClipboard(undefined);
  });

  it.each([
    { clipboard: undefined, condition: 'the Clipboard API is absent' },
    { clipboard: {}, condition: 'clipboard.writeText is unavailable' },
  ])(
    'does not throw and reports a localized error when $condition',
    async ({ clipboard }) => {
      installClipboard(clipboard);
      const { result } = renderHook(() =>
        useFileTreeContextMenu({
          markOpenDocumentRemoved: vi.fn(),
          retargetOpenDocument: vi.fn(),
          workspace: createWorkspaceMock(),
        }),
      );
      const copyPath = result.current
        .getContextMenuNodes({
          kind: 'file',
          name: 'note.md',
          path: 'E:/notes/note.md',
        })
        .find((node) => node.id === 'file-tree-copy-path');

      expect(() => {
        act(() =>
          invokeFileTreePayload(result.current.payloadHandlers, copyPath),
        );
      }).not.toThrow();
      await waitFor(() => {
        expect(useAppStore.getState().lastFileError).toEqual({
          code: 'workspace.copy_path_failed',
          message: 'fileTreeError.copyPathFailed',
          recoverable: true,
        });
      });
    },
  );

  it('does not throw and reports a localized error when clipboard.writeText throws synchronously', async () => {
    installClipboard({
      writeText: vi.fn(() => {
        throw new Error('denied');
      }),
    });
    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock(),
      }),
    );
    const copyPath = result.current
      .getContextMenuNodes({
        kind: 'file',
        name: 'note.md',
        path: 'E:/notes/note.md',
      })
      .find((node) => node.id === 'file-tree-copy-path');

    expect(() => {
      act(() =>
        invokeFileTreePayload(result.current.payloadHandlers, copyPath),
      );
    }).not.toThrow();
    await waitFor(() => {
      expect(useAppStore.getState().lastFileError).toEqual({
        code: 'workspace.copy_path_failed',
        message: 'fileTreeError.copyPathFailed',
        recoverable: true,
      });
    });
  });

  it('copies the path when clipboard.writeText succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard({ writeText });
    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock(),
      }),
    );
    const copyPath = result.current
      .getContextMenuNodes({
        kind: 'file',
        name: 'note.md',
        path: 'E:/notes/note.md',
      })
      .find((node) => node.id === 'file-tree-copy-path');

    act(() => invokeFileTreePayload(result.current.payloadHandlers, copyPath));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('E:/notes/note.md');
    });
    expect(useAppStore.getState().lastFileError).toBeNull();
  });

  it('builds distinct item sets for root, directory, and file targets', () => {
    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock(),
      }),
    );

    const ids = (kind: 'workspaceRoot' | 'directory' | 'file') =>
      result.current
        .getContextMenuNodes({
          kind,
          name: kind === 'file' ? 'note.md' : 'Notes',
          path:
            kind === 'file'
              ? 'E:/notes/note.md'
              : kind === 'directory'
                ? 'E:/notes/Drafts'
                : 'E:/notes',
        })
        .filter((node) => node.type === 'item')
        .map((node) => node.id);

    expect(ids('workspaceRoot')).not.toContain('file-tree-delete');
    expect(ids('directory')).toContain('file-tree-delete');
    expect(ids('file')).toEqual([
      'file-tree-rename',
      'file-tree-reveal',
      'file-tree-copy-path',
      'file-tree-delete',
    ]);
  });

  it('retargets the open document after a successful rename', async () => {
    const retargetOpenDocument = vi.fn();
    const renameEntry = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        kind: 'markdownFile',
        name: 'renamed.md',
        path: 'E:/notes/renamed.md',
      },
    });
    useAppStore.getState().setCurrentFile({
      name: 'old.md',
      path: 'E:/notes/old.md',
    });

    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument,
        workspace: createWorkspaceMock({ renameEntry }),
      }),
    );

    const nodes = result.current.getContextMenuNodes({
      kind: 'file',
      name: 'old.md',
      path: 'E:/notes/old.md',
    });
    const rename = nodes.find((node) => node.id === 'file-tree-rename');
    expect(rename?.type).toBe('item');
    const runRename = () =>
      invokeFileTreePayload(result.current.payloadHandlers, rename);

    await act(async () => {
      runRename();
    });

    expect(renameEntry).not.toHaveBeenCalled();
    expect(result.current.mutationDialog.request).toEqual({
      defaultValue: 'old.md',
      entryKind: 'file',
      mode: 'rename',
      path: 'E:/notes/old.md',
    });

    await act(async () => {
      await result.current.mutationDialog.confirm('renamed.md');
    });

    expect(renameEntry).toHaveBeenCalledWith('E:/notes/old.md', 'renamed.md');
    expect(retargetOpenDocument).toHaveBeenCalledWith('E:/notes/renamed.md');
  });

  it('retargets an open descendant when its directory is renamed', async () => {
    const retargetOpenDocument = vi.fn();
    const renameEntry = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        kind: 'directory',
        name: 'Archive',
        path: 'E:/notes/Archive',
      },
    });
    useAppStore.getState().setCurrentFile({
      name: 'note.md',
      path: 'e:\\NOTES\\Drafts\\deep\\note.md',
    });

    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument,
        workspace: createWorkspaceMock({ renameEntry }),
      }),
    );
    const rename = result.current
      .getContextMenuNodes({
        kind: 'directory',
        name: 'Drafts',
        path: 'E:/notes/Drafts',
      })
      .find((node) => node.id === 'file-tree-rename');
    const runRename = () =>
      invokeFileTreePayload(result.current.payloadHandlers, rename);

    act(() => runRename());
    await act(async () => {
      await result.current.mutationDialog.confirm('Archive');
    });

    expect(retargetOpenDocument).toHaveBeenCalledWith(
      'E:/notes/Archive/deep/note.md',
    );
  });

  it('marks the open document missing after delete without clearing editor content here', async () => {
    const markOpenDocumentRemoved = vi.fn();
    const deleteEntry = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    useAppStore.getState().setCurrentFile({
      name: 'open.md',
      path: 'E:/notes/open.md',
    });
    useAppStore.getState().setDirty(false);

    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved,
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock({ deleteEntry }),
      }),
    );

    const nodes = result.current.getContextMenuNodes({
      kind: 'file',
      name: 'open.md',
      path: 'E:/notes/open.md',
    });
    const deleteNode = nodes.find((node) => node.id === 'file-tree-delete');
    const runDelete = () =>
      invokeFileTreePayload(result.current.payloadHandlers, deleteNode);

    await act(async () => {
      runDelete();
    });

    expect(deleteEntry).not.toHaveBeenCalled();
    expect(result.current.mutationDialog.request).toEqual({
      entryKind: 'file',
      mode: 'delete',
      name: 'open.md',
      path: 'E:/notes/open.md',
    });

    await act(async () => {
      await result.current.mutationDialog.confirm(undefined);
    });

    expect(deleteEntry).toHaveBeenCalledWith('E:/notes/open.md');
    expect(markOpenDocumentRemoved).toHaveBeenCalledWith('E:/notes/open.md');
    expect(useAppStore.getState().currentFile?.path).toBe('E:/notes/open.md');
  });

  it('marks an open descendant missing when its directory is deleted', async () => {
    const markOpenDocumentRemoved = vi.fn();
    const deleteEntry = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    useAppStore.getState().setCurrentFile({
      name: 'note.md',
      path: 'E:/notes/Drafts/deep/note.md',
    });

    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved,
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock({ deleteEntry }),
      }),
    );
    const deleteNode = result.current
      .getContextMenuNodes({
        kind: 'directory',
        name: 'Drafts',
        path: 'E:/notes/Drafts',
      })
      .find((node) => node.id === 'file-tree-delete');
    const runDelete = () =>
      invokeFileTreePayload(result.current.payloadHandlers, deleteNode);

    act(() => runDelete());
    await act(async () => {
      await result.current.mutationDialog.confirm(undefined);
    });

    expect(markOpenDocumentRemoved).toHaveBeenCalledWith(
      'E:/notes/Drafts/deep/note.md',
    );
  });

  it('returns focus to the surviving parent after a confirmed delete', async () => {
    const deleteEntry = vi.fn().mockResolvedValue({ ok: true, data: undefined });
    const parent = document.createElement('div');
    parent.dataset.fileTreePath = 'E:/notes/Drafts';
    parent.tabIndex = 0;
    document.body.append(parent);

    try {
      const { result } = renderHook(() =>
        useFileTreeContextMenu({
          markOpenDocumentRemoved: vi.fn(),
          retargetOpenDocument: vi.fn(),
          workspace: createWorkspaceMock({ deleteEntry }),
        }),
      );
      const nodes = result.current.getContextMenuNodes({
        kind: 'file',
        name: 'old.md',
        path: 'E:/notes/Drafts/old.md',
      });
      const deleteNode = nodes.find((node) => node.id === 'file-tree-delete');
      act(() =>
        invokeFileTreePayload(result.current.payloadHandlers, deleteNode),
      );
      await act(async () => {
        await result.current.mutationDialog.confirm(undefined);
      });
      act(() => result.current.mutationDialog.returnFocus());

      expect(document.activeElement).toBe(parent);
    } finally {
      parent.remove();
    }
  });

  it('opens an accessible name request instead of calling window.prompt', () => {
    const prompt = vi.spyOn(window, 'prompt');
    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock(),
      }),
    );

    const nodes = result.current.getContextMenuNodes({
      kind: 'workspaceRoot',
      name: 'Notes',
      path: 'E:/notes',
    });
    const createFile = nodes.find((node) => node.id === 'file-tree-new-file');
    act(() =>
      invokeFileTreePayload(result.current.payloadHandlers, createFile),
    );

    expect(prompt).not.toHaveBeenCalled();
    expect(result.current.mutationDialog.request).toEqual({
      defaultValue: 'contextMenu.defaultFileName',
      mode: 'createFile',
      parentPath: 'E:/notes',
    });
  });

  it('keeps a failed mutation request open so the user can retry', async () => {
    const createDirectory = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'file.already_exists',
        message: 'exists',
        recoverable: true,
      },
    });
    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock({ createDirectory }),
      }),
    );

    const nodes = result.current.getContextMenuNodes({
      kind: 'workspaceRoot',
      name: 'Notes',
      path: 'E:/notes',
    });
    const createFolder = nodes.find(
      (node) => node.id === 'file-tree-new-folder',
    );
    act(() =>
      invokeFileTreePayload(result.current.payloadHandlers, createFolder),
    );
    await act(async () => {
      await result.current.mutationDialog.confirm('Drafts');
    });

    expect(result.current.mutationDialog.request?.mode).toBe('createDirectory');
    expect(result.current.mutationDialog.busy).toBe(false);
    expect(useAppStore.getState().lastFileError?.code).toBe(
      'file.already_exists',
    );
  });

  it('guards an in-flight mutation from duplicate confirmation', async () => {
    type CreateFileResult = Awaited<
      ReturnType<WorkspaceWorkflow['createFile']>
    >;
    let finishCreate: ((value: CreateFileResult) => void) | undefined;
    const createFile = vi.fn(
      (_parentPath: string, _name: string) =>
        new Promise<CreateFileResult>((resolve) => {
          void _parentPath;
          void _name;
          finishCreate = resolve;
        }),
    );
    const openFile = vi.fn();
    const { result } = renderHook(() =>
      useFileTreeContextMenu({
        markOpenDocumentRemoved: vi.fn(),
        retargetOpenDocument: vi.fn(),
        workspace: createWorkspaceMock({ createFile, openFile }),
      }),
    );
    const nodes = result.current.getContextMenuNodes({
      kind: 'workspaceRoot',
      name: 'Notes',
      path: 'E:/notes',
    });
    const create = nodes.find((node) => node.id === 'file-tree-new-file');
    act(() => invokeFileTreePayload(result.current.payloadHandlers, create));
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.mutationDialog.confirm('once.md');
      second = result.current.mutationDialog.confirm('twice.md');
    });

    expect(createFile).toHaveBeenCalledTimes(1);
    expect(createFile).toHaveBeenCalledWith('E:/notes', 'once.md');

    await act(async () => {
      finishCreate?.({
        ok: true,
        data: {
          kind: 'markdownFile',
          name: 'once.md',
          path: 'E:/notes/once.md',
        },
      });
      await first;
      await second;
    });

    expect(openFile).toHaveBeenCalledWith('E:/notes/once.md');
    expect(result.current.mutationDialog.request).toBeNull();
  });
});

function invokeFileTreePayload(
  handlers: FileTreeContextPayloadHandlers,
  node: CommandMenuNode | undefined,
): void {
  const invocation = node?.type === 'item' ? node.invocation : null;
  if (invocation?.kind !== 'payloadAction') {
    throw new Error('file-tree payload action missing');
  }

  switch (invocation.action) {
    case 'fileTreeCopyPath':
      handlers.fileTreeCopyPath(invocation.payload);
      return;
    case 'fileTreeCreateDirectory':
      handlers.fileTreeCreateDirectory(invocation.payload);
      return;
    case 'fileTreeCreateFile':
      handlers.fileTreeCreateFile(invocation.payload);
      return;
    case 'fileTreeDelete':
      handlers.fileTreeDelete(invocation.payload);
      return;
    case 'fileTreeRename':
      handlers.fileTreeRename(invocation.payload);
      return;
    case 'fileTreeReveal':
      handlers.fileTreeReveal(invocation.payload);
      return;
    default:
      throw new Error(`unexpected file-tree action: ${invocation.action}`);
  }
}

function installClipboard(
  clipboard: Partial<Pick<Clipboard, 'writeText'>> | undefined,
): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
}
