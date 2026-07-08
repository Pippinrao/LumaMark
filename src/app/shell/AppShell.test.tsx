import '@testing-library/jest-dom/vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../services/workspace/workspaceCommands';
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

const windowControlMocks = vi.hoisted(() => ({
  close: vi.fn(),
  isMaximized: vi.fn(),
  minimize: vi.fn(),
  startDragging: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock('../../services/workspace/workspaceCommands', () => ({
  listWorkspaceChildren: workspaceCommandMocks.listWorkspaceChildren,
  openWorkspaceDirectory: workspaceCommandMocks.openWorkspaceDirectory,
}));

vi.mock('../../services/window/windowControls', () => ({
  windowControls: windowControlMocks,
}));

describe('AppShell', () => {
  beforeEach(() => {
    installResizeObserverStub();
    workspaceCommandMocks.listWorkspaceChildren.mockReset();
    workspaceCommandMocks.openWorkspaceDirectory.mockReset();
    windowControlMocks.close.mockReset().mockResolvedValue(true);
    windowControlMocks.isMaximized.mockReset().mockResolvedValue(false);
    windowControlMocks.minimize.mockReset().mockResolvedValue(true);
    windowControlMocks.startDragging.mockReset().mockResolvedValue(true);
    windowControlMocks.toggleMaximize.mockReset().mockResolvedValue(true);
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
    const warnings = captureProcessWarnings();

    try {
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
      expect(screen.getByRole('tab', { name: '文件' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: '大纲' })).toBeInTheDocument();
      expect(document.querySelector('.lm-outline-panel')).toBeNull();

      const editor = screen.getByRole('main');
      expect(editor.querySelector('.lm-editor-title')).toHaveTextContent(
        '未命名',
      );

      expect(
        screen.getByRole('navigation', { name: '窗口控制' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '最小化窗口' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '最大化窗口' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '关闭窗口' })).toBeInTheDocument();
      expect(document.querySelector('.lm-command-bar')).toBeNull();
      expect(document.querySelector('.lm-title-group')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent('就绪');

      expect(screen.queryByRole('button', { name: 'Open File' })).not
        .toBeInTheDocument();
      expect(screen.queryByText('Untitled')).not.toBeInTheDocument();

      await expectNoNodeLocalStorageWarning(warnings);
    } finally {
      warnings.dispose();
    }
  });

  it('shows a restore control after maximizing the window', async () => {
    windowControlMocks.isMaximized
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(
      await screen.findByRole('button', { name: '最大化窗口' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '最大化窗口' }));

    await waitFor(() => {
      expect(windowControlMocks.toggleMaximize).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole('button', { name: '还原窗口' }),
      ).toBeInTheDocument();
    });
  });

  it('exposes table actions with shortcuts in the command palette', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    fireEvent.keyDown(window, {
      ctrlKey: true,
      key: 'k',
    });

    const dialog = await screen.findByRole('dialog', { name: '命令面板' });

    expect(within(dialog).getByText('表格')).toBeInTheDocument();
    expect(within(dialog).getByText('复制表格')).toBeInTheDocument();
    expect(within(dialog).getByText('删除表格')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl Alt T')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl Alt C')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl Alt Backspace')).toBeInTheDocument();
  });

  it('shows table shortcuts after table actions in the top menu', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const paragraphMenu = screen.getByRole('menuitem', { name: '段落' });
    paragraphMenu.focus();
    fireEvent.keyDown(paragraphMenu, { key: 'ArrowDown' });
    expect(
      await screen.findByRole('menuitem', { name: /^表格\s*Ctrl Alt T$/ }),
    ).toHaveTextContent('Ctrl Alt T');

    fireEvent.keyDown(document, { key: 'Escape' });
    const editMenu = screen.getByRole('menuitem', { name: '编辑' });
    editMenu.focus();
    fireEvent.keyDown(editMenu, { key: 'ArrowDown' });

    expect(
      await screen.findByRole('menuitem', {
        name: /^复制表格\s*Ctrl Alt C$/,
      }),
    ).toHaveTextContent('Ctrl Alt C');
    expect(
      screen.getByRole('menuitem', {
        name: /^删除表格\s*Ctrl Alt Backspace$/,
      }),
    ).toHaveTextContent('Ctrl Alt Backspace');
  });

  it('shows table actions and shortcuts in the editor context menu', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('editor-host'));

    expect(
      await screen.findByRole('menuitem', { name: /^表格\s*Ctrl Alt T$/ }),
    ).toHaveTextContent('Ctrl Alt T');
    expect(
      screen.getByRole('menuitem', { name: /^复制表格\s*Ctrl Alt C$/ }),
    ).toHaveTextContent('Ctrl Alt C');
    expect(
      screen.getByRole('menuitem', {
        name: /^删除表格\s*Ctrl Alt Backspace$/,
      }),
    ).toHaveTextContent('Ctrl Alt Backspace');
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

function captureProcessWarnings() {
  const messages: string[] = [];
  const onWarning = (warning: Error) => {
    messages.push(warning.message);
  };

  process.on('warning', onWarning);

  return {
    dispose: () => {
      process.off('warning', onWarning);
    },
    messages,
  };
}

async function expectNoNodeLocalStorageWarning({
  messages,
}: ReturnType<typeof captureProcessWarnings>) {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

  expect(messages).not.toContain(
    '`--localstorage-file` was provided without a valid path',
  );
}
