import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../features/workspace/workspaceCommands';
import { useWorkspaceStore } from '../../features/workspace/workspaceStore';
import type { CommandError, CommandResult } from '../../services/tauri/invokeCommand';
import { installResizeObserverStub } from '../../test/resizeObserverStub';
import { I18nProvider } from '../providers/I18nProvider';
import { ThemeProvider } from '../providers/ThemeProvider';
import { useAppStore } from '../stores/appStore';
import { AppShell } from './AppShell';

const workspaceCommandMocks = vi.hoisted(() => ({
  listWorkspaceChildren: vi.fn(),
  openWorkspaceDirectory: vi.fn(),
}));

vi.mock('../../features/workspace/workspaceCommands', () => ({
  listWorkspaceChildren: workspaceCommandMocks.listWorkspaceChildren,
  openWorkspaceDirectory: workspaceCommandMocks.openWorkspaceDirectory,
}));

describe('AppShell', () => {
  beforeEach(() => {
    installResizeObserverStub();
    workspaceCommandMocks.listWorkspaceChildren.mockReset();
    workspaceCommandMocks.openWorkspaceDirectory.mockReset();
    useWorkspaceStore.getState().clearWorkspace();
    useAppStore.setState({
      currentFile: null,
      dirty: false,
      dirtyRevision: 0,
      lastFileError: null,
      language: 'zh-CN',
      sidebarOpen: true,
      statusKey: 'status.ready',
      theme: 'light',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the localized Typora-like shell structure without hardcoded English UI', async () => {
    useAppStore.setState({
      language: 'zh-CN',
      sidebarOpen: true,
      statusKey: 'status.ready',
      theme: 'light',
    });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(
      screen.getByRole('heading', { name: 'LumaMark' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();

    const editor = screen.getByRole('main');
    expect(
      within(editor).getByRole('heading', { name: '未命名' }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: '打开文件' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('就绪');

    expect(screen.queryByRole('button', { name: 'Open File' })).not
      .toBeInTheDocument();
    expect(screen.queryByText('Untitled')).not.toBeInTheDocument();
  });

  it('ignores stale workspace child load errors after switching roots', async () => {
    const staleLoad = createDeferred<CommandResult<WorkspaceEntry[]>>();
    const staleError: CommandError = {
      code: 'workspace.stale',
      message: 'Old workspace request failed.',
      recoverable: true,
    };
    workspaceCommandMocks.openWorkspaceDirectory
      .mockResolvedValueOnce({
        ok: true,
        data: { name: 'Old Notes', path: 'E:/old-notes' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { name: 'New Notes', path: 'E:/new-notes' },
      });
    workspaceCommandMocks.listWorkspaceChildren
      .mockReturnValueOnce(staleLoad.promise)
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            kind: 'markdownFile',
            name: 'index.md',
            path: 'E:/new-notes/index.md',
          },
        ],
      });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const openWorkspaceButton = screen.getByRole('button', {
      name: '打开工作区',
    });
    fireEvent.click(openWorkspaceButton);
    await waitFor(() => {
      expect(useWorkspaceStore.getState().root?.path).toBe('E:/old-notes');
    });

    fireEvent.click(openWorkspaceButton);
    await waitFor(() => {
      expect(useWorkspaceStore.getState().root?.path).toBe('E:/new-notes');
    });

    await act(async () => {
      staleLoad.resolve({
        ok: false,
        error: staleError,
      });
      await staleLoad.promise;
      await Promise.resolve();
    });

    expect(useWorkspaceStore.getState().error).toBeNull();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}
