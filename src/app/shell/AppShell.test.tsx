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
import { saveRecoveryDraft } from '../../services/drafts/draftStore';
import { useWorkspaceStore } from '../../features/workspace/workspaceStore';
import { useReadingAppearanceStore } from '../../features/reading-appearance/readingAppearanceStore';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { useStartupStore } from '../../features/startup/startupStore';
import type { CommandError, CommandResult } from '../../services/tauri/invokeCommand';
import type {
  FileWatchChangeEvent,
  FileWatchClient,
} from '../../services/file-watch/fileWatchClient';
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
    delete window.__LUMAMARK_E2E_OPEN_REQUESTS__;
    installResizeObserverStub();
    workspaceCommandMocks.listWorkspaceChildren.mockReset();
    workspaceCommandMocks.openWorkspaceDirectory.mockReset();
    windowControlMocks.close.mockReset().mockResolvedValue(true);
    windowControlMocks.isMaximized.mockReset().mockResolvedValue(false);
    windowControlMocks.minimize.mockReset().mockResolvedValue(true);
    windowControlMocks.startDragging.mockReset().mockResolvedValue(true);
    windowControlMocks.toggleMaximize.mockReset().mockResolvedValue(true);
    useWorkspaceStore.getState().clearWorkspace();
    useReadingAppearanceStore.setState({
      fontZoomPercent: 100,
      pageWidth: 'standard',
      pageWidthPersistenceError: false,
    });
    useRecentFilesStore.setState({
      recentFiles: [],
      recentFilesPersistenceError: false,
    });
    useStartupStore.setState({
      lastSession: null,
      recentWorkspaces: [],
      startScreenOpen: false,
      startupBehavior: 'home',
      startupPersistenceError: false,
    });
    useAppStore.setState({
      copyImagesToAssets: false,
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

  it('shows the start screen while disabling editor-dependent commands', async () => {
    useStartupStore.setState({ startScreenOpen: true });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(screen.getByRole('main', { name: '开始' })).toBeInTheDocument();
    expect(screen.getByTestId('workspace-content')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('editor-host')).toBeInTheDocument();

    const fileMenu = screen.getByRole('menuitem', { name: '文件' });
    fileMenu.focus();
    fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
    expect(await screen.findByRole('menuitem', { name: /^保存/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: /^打开文件/ })).not.toHaveAttribute(
      'aria-disabled',
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.keyDown(window, { ctrlKey: true, key: 'k' });
    expect(await screen.findByRole('option', { name: '保存' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('option', { name: '打开文件' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('keeps a desktop open bridge failure localized and visible', async () => {
    useStartupStore.setState({ startScreenOpen: true });
    window.__LUMAMARK_E2E_OPEN_REQUESTS__ = {
      drain: vi.fn(async () => ({
        error: {
          code: 'desktop.open_request_queue_unavailable',
          message: 'backend detail',
          recoverable: true,
        },
        ok: false as const,
      })),
      listen: vi.fn(async () => () => undefined),
    };

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    expect(
      await screen.findByText('桌面文件打开功能暂不可用'),
    ).toBeVisible();
    expect(screen.getByRole('main', { name: '开始' })).toBeVisible();
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

  it('shows a localized, dismissible file error without changing the current document', async () => {
    useAppStore.setState({
      currentFile: { name: 'draft.md', path: 'E:/docs/draft.md' },
      dirty: true,
      lastFileError: {
        code: 'file.permission_denied',
        message: 'File access was denied.',
        recoverable: true,
      },
    });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('无法访问该文件');
    expect(alert).toHaveTextContent('当前文档内容未被更改。');
    expect(
      screen.getByRole('main').querySelector('.lm-editor-title'),
    ).toHaveTextContent('draft.md');

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(useAppStore.getState().lastFileError).toBeNull();
    expect(useAppStore.getState().currentFile).toEqual({
      name: 'draft.md',
      path: 'E:/docs/draft.md',
    });
    expect(screen.getByRole('status')).toHaveTextContent('未保存');
  });

  it('shows a localized choice when disk changes conflict with unsaved edits', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    const fileWatch: FileWatchClient = {
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
      replaceLocalImageTargets: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
      unwatchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
      watchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
    };
    window.__LUMAMARK_E2E_FILE_WATCH__ = fileWatch;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 8,
            path: 'E:/notes/opened.md',
            text: '# Opened',
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: 13,
            path: 'E:/notes/opened.md',
            text: '# From disk',
          },
        }),
      showOpenDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:/notes/opened.md',
      }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };

    try {
      render(
        <I18nProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </I18nProvider>,
      );

      const fileMenu = screen.getByRole('menuitem', { name: '文件' });
      fileMenu.focus();
      fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
      fireEvent.click(
        await screen.findByRole('menuitem', { name: /^打开文件/ }),
      );
      await waitFor(() => {
        expect(useAppStore.getState().currentFile?.path).toBe(
          'E:/notes/opened.md',
        );
      });

      act(() => {
        useAppStore.getState().setDirty(true);
      });
      await act(async () => {
        emitChange?.({
          fingerprint: 'sha256:external',
          kind: 'document',
          path: 'E:/notes/opened.md',
          revision: 9,
        });
        await Promise.resolve();
      });

      const dialog = await screen.findByRole('dialog', {
        name: '磁盘上的文件已更改',
      });
      expect(
        within(dialog).getByRole('button', { name: '从磁盘重新加载' }),
      ).toBeInTheDocument();
      fireEvent.click(
        within(dialog).getByRole('button', { name: '保留当前内容' }),
      );

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: '磁盘上的文件已更改' }),
        ).not.toBeInTheDocument();
      });
      expect(useAppStore.getState().dirty).toBe(true);
    } finally {
      delete window.__LUMAMARK_E2E_FILE_WATCH__;
      delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
    }
  });

  it('refreshes a local image widget from a file-watch event without changing its markdown source', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    const documentPath = 'E:/notes/opened.md';
    const imagePath = 'E:\\notes\\assets\\pic.png';
    const markdown = ['![Local](./assets/pic.png)', '', 'after'].join('\n');
    const replaceLocalImageTargets = vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    });
    window.__LUMAMARK_E2E_FILE_WATCH__ = {
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
      replaceLocalImageTargets,
      unwatchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
      watchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
    };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: markdown.length,
          path: documentPath,
          text: markdown,
        },
      }),
      showOpenDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: documentPath,
      }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };
    window.__LUMAMARK_E2E_ASSET_COMMANDS__ = {
      authorizeLocalImage: vi.fn().mockResolvedValue({
        ok: true,
        data: imagePath,
      }),
    };
    (
      window as Window & {
        __TAURI_INTERNALS__?: {
          convertFileSrc: (path: string) => string;
        };
      }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path) => `asset://localhost/${path}?size=full#preview`,
    };

    try {
      render(
        <I18nProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </I18nProvider>,
      );

      await openFileFromMenu();
      await waitFor(() => {
        expect(useAppStore.getState().currentFile?.path).toBe(documentPath);
      });
      await waitFor(() => {
        expect(
          screen
            .getByTestId('editor-host')
            .querySelector<HTMLImageElement>('.lm-image-preview img')
            ?.getAttribute('src'),
        ).toBe(`asset://localhost/${imagePath}?size=full#preview`);
      });
      expect(replaceLocalImageTargets).toHaveBeenLastCalledWith([imagePath]);

      await act(async () => {
        emitChange?.({
          fingerprint: 'sha256:image-7',
          kind: 'image',
          path: imagePath,
          revision: 7,
        });
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(
          screen
            .getByTestId('editor-host')
            .querySelector<HTMLImageElement>('.lm-image-preview img')
            ?.getAttribute('src'),
        ).toBe(`asset://localhost/${imagePath}?size=full&lmv=7#preview`);
      });

      fireEvent.keyDown(window, { ctrlKey: true, key: '/' });
      await waitFor(() => {
        expect(
          document.querySelector('.lm-editor-source-mode'),
        ).not.toBeNull();
      });
      expect(
        screen.getByTestId('editor-host').querySelector('.cm-content')
          ?.textContent,
      ).toContain('![Local](./assets/pic.png)');
    } finally {
      delete window.__LUMAMARK_E2E_ASSET_COMMANDS__;
      delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
      delete window.__LUMAMARK_E2E_FILE_WATCH__;
      delete (window as Window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__;
    }
  });

  it('opens an editor image in the shared media viewer and restores trigger focus', async () => {
    const documentPath = 'E:/notes/media.md';
    const markdown = ['![Pixel](data:image/png;base64,AA==)', '', 'after'].join('\n');
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          byteLength: markdown.length,
          path: documentPath,
          text: markdown,
        },
      }),
      showOpenDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: documentPath,
      }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };

    try {
      render(
        <I18nProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </I18nProvider>,
      );

      await openFileFromMenu();
      const image = await waitFor(() => {
        const candidate = screen
          .getByTestId('editor-host')
          .querySelector<HTMLImageElement>('.lm-image-preview img');
        expect(candidate).not.toBeNull();
        return candidate;
      });
      fireEvent.load(image as HTMLImageElement);
      const expand = screen.getByRole('button', { name: '展开查看' });
      expand.focus();
      fireEvent.click(expand);

      const dialog = await screen.findByRole('dialog', { name: '图片查看器' });
      expect(within(dialog).getByRole('img', { name: 'Pixel' })).toBeVisible();
      expect(within(dialog).getByRole('button', { name: '放大' })).toBeVisible();
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: '图片查看器' })).not
          .toBeInTheDocument();
      });
      expect(document.activeElement).toBe(expand);

      fireEvent.keyDown(window, { ctrlKey: true, key: '/' });
      await waitFor(() => {
        expect(document.querySelector('.lm-editor-source-mode')).not.toBeNull();
      });
      expect(
        screen.getByTestId('editor-host').querySelector('.cm-content'),
      ).toHaveTextContent('![Pixel](data:image/png;base64,AA==)');
      expect(
        screen.getByTestId('editor-host').querySelector('.cm-content'),
      ).toHaveTextContent('after');
    } finally {
      delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
    }
  });

  it('leaves the current image widget untouched when an image event arrives late from the previous document', async () => {
    let emitChange: ((event: FileWatchChangeEvent) => void) | undefined;
    const firstPath = 'E:/notes/first.md';
    const secondPath = 'E:/notes/second.md';
    const firstImagePath = 'E:\\notes\\first\\old.png';
    const secondImagePath = 'E:\\notes\\second\\current.png';
    const firstMarkdown = '![Old](./first/old.png)';
    const secondMarkdown = '![Current](./second/current.png)';
    const authorizeLocalImage = vi.fn(
      async ({ source }: { source: string }) => ({
        ok: true as const,
        data:
          source === './first/old.png' ? firstImagePath : secondImagePath,
      }),
    );
    window.__LUMAMARK_E2E_FILE_WATCH__ = {
      listen: vi.fn(async (listener) => {
        emitChange = listener;
        return () => undefined;
      }),
      replaceLocalImageTargets: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
      unwatchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
      watchDocument: vi.fn().mockResolvedValue({
        ok: true,
        data: undefined,
      }),
    };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: firstMarkdown.length,
            path: firstPath,
            text: firstMarkdown,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          data: {
            byteLength: secondMarkdown.length,
            path: secondPath,
            text: secondMarkdown,
          },
        }),
      showOpenDialog: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, data: firstPath })
        .mockResolvedValueOnce({ ok: true, data: secondPath }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };
    window.__LUMAMARK_E2E_ASSET_COMMANDS__ = { authorizeLocalImage };
    (
      window as Window & {
        __TAURI_INTERNALS__?: {
          convertFileSrc: (path: string) => string;
        };
      }
    ).__TAURI_INTERNALS__ = {
      convertFileSrc: (path) => `asset://localhost/${path}`,
    };

    try {
      render(
        <I18nProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </I18nProvider>,
      );

      await openFileFromMenu();
      await waitFor(() => {
        expect(
          screen
            .getByTestId('editor-host')
            .querySelector<HTMLImageElement>('.lm-image-preview img')
            ?.getAttribute('src'),
        ).toBe(`asset://localhost/${firstImagePath}`);
      });

      await openFileFromMenu();
      await waitFor(() => {
        expect(useAppStore.getState().currentFile?.path).toBe(secondPath);
      });
      await waitFor(() => {
        expect(
          screen
            .getByTestId('editor-host')
            .querySelector<HTMLImageElement>('.lm-image-preview img')
            ?.getAttribute('src'),
        ).toBe(`asset://localhost/${secondImagePath}`);
      });

      const currentImage = screen
        .getByTestId('editor-host')
        .querySelector<HTMLImageElement>('.lm-image-preview img');
      const authorizationCount = authorizeLocalImage.mock.calls.length;

      await act(async () => {
        emitChange?.({
          fingerprint: 'sha256:old-image',
          kind: 'image',
          path: firstImagePath,
          revision: 12,
        });
        await Promise.resolve();
      });

      expect(
        screen
          .getByTestId('editor-host')
          .querySelector<HTMLImageElement>('.lm-image-preview img'),
      ).toBe(currentImage);
      expect(currentImage?.getAttribute('src')).toBe(
        `asset://localhost/${secondImagePath}`,
      );
      expect(authorizeLocalImage).toHaveBeenCalledTimes(authorizationCount);
    } finally {
      delete window.__LUMAMARK_E2E_ASSET_COMMANDS__;
      delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
      delete window.__LUMAMARK_E2E_FILE_WATCH__;
      delete (window as Window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__;
    }
  });

  it('offers the user a localized choice to restore an unsaved recovery draft', async () => {
    const entries = new Map<string, string>();
    const storage: Storage = {
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: () => null,
      get length() {
        return entries.size;
      },
      removeItem: (key) => entries.delete(key),
      setItem: (key, value) => entries.set(key, value),
    };
    vi.stubGlobal('localStorage', storage);
    saveRecoveryDraft({ filePath: 'E:/notes/draft.md', text: '# Recovered' });

    try {
      render(
        <I18nProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </I18nProvider>,
      );

      const dialog = await screen.findByRole('dialog', { name: '恢复未保存的草稿？' });

      expect(dialog).toHaveTextContent('draft.md');
      expect(within(dialog).getByRole('button', { name: '恢复草稿' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: '丢弃草稿' })).toBeInTheDocument();
    } finally {
      storage.clear();
      vi.unstubAllGlobals();
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

  it('exposes shared creation shortcuts without context-only table actions', async () => {
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
    expect(within(dialog).getByText('代码块')).toBeInTheDocument();
    expect(within(dialog).getByText('图片')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl+T')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl+Shift+K')).toBeInTheDocument();
    expect(within(dialog).getByText('Ctrl+Shift+I')).toBeInTheDocument();
    expect(within(dialog).queryByText('复制表格')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('删除表格')).not.toBeInTheDocument();
  });

  it('shows the aligned table shortcut in its submenu and omits destructive table actions from Edit', async () => {
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
    const insertSubmenu = await screen.findByRole('menuitem', { name: '插入' });
    insertSubmenu.focus();
    fireEvent.keyDown(insertSubmenu, { key: 'ArrowRight' });
    expect(
      await screen.findByRole('menuitem', { name: /^表格Ctrl\+T$/ }),
    ).toHaveTextContent('Ctrl+T');

    fireEvent.keyDown(document, { key: 'Escape' });
    const editMenu = screen.getByRole('menuitem', { name: '编辑' });
    editMenu.focus();
    fireEvent.keyDown(editMenu, { key: 'ArrowDown' });

    expect(screen.queryByText('复制表格')).not.toBeInTheDocument();
    expect(screen.queryByText('删除表格')).not.toBeInTheDocument();
  });

  it('opens a workspace from the File menu through the workspace service boundary', async () => {
    workspaceCommandMocks.openWorkspaceDirectory.mockResolvedValue({
      ok: true,
      data: { name: 'Menu Notes', path: 'E:/menu-notes' },
    });
    workspaceCommandMocks.listWorkspaceChildren.mockResolvedValue({
      ok: true,
      data: [],
    });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const fileMenu = screen.getByRole('menuitem', { name: '文件' });
    fileMenu.focus();
    fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: '打开工作区' }),
    );

    await waitFor(() => {
      expect(workspaceCommandMocks.openWorkspaceDirectory).toHaveBeenCalledOnce();
      expect(useWorkspaceStore.getState().root).toEqual({
        name: 'Menu Notes',
        path: 'E:/menu-notes',
      });
    });
  });

  it('toggles the sidebar from the view menu and keyboard shortcut', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const viewMenu = screen.getByRole('menuitem', { name: '视图' });
    viewMenu.focus();
    fireEvent.keyDown(viewMenu, { key: 'ArrowDown' });
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: /^切换侧边栏/ }),
    );

    await waitFor(() => {
      expect(useAppStore.getState().sidebarOpen).toBe(false);
    });

    fireEvent.keyDown(window, { ctrlKey: true, key: '\\' });

    await waitFor(() => {
      expect(useAppStore.getState().sidebarOpen).toBe(true);
    });
  });

  it('keeps the view menu synchronized while Mod+/ toggles editor display mode', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(document.querySelector('.lm-editor-live-preview-mode')).not.toBeNull();
    });

    const viewMenu = screen.getByRole('menuitem', { name: '视图' });
    viewMenu.focus();
    fireEvent.keyDown(viewMenu, { key: 'ArrowDown' });
    expect(
      await screen.findByRole('menuitemradio', { name: /^源码模式/ }),
    ).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.keyDown(window, { ctrlKey: true, key: '/' });

    await waitFor(() => {
      expect(document.querySelector('.lm-editor-source-mode')).not.toBeNull();
    });
    viewMenu.focus();
    fireEvent.keyDown(viewMenu, { key: 'ArrowDown' });
    expect(
      await screen.findByRole('menuitemradio', { name: '实时预览' }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByRole('menuitemradio', { name: /^源码模式/ }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.keyDown(window, { ctrlKey: true, key: '/' });

    await waitFor(() => {
      expect(document.querySelector('.lm-editor-live-preview-mode')).not.toBeNull();
    });
    viewMenu.focus();
    fireEvent.keyDown(viewMenu, { key: 'ArrowDown' });
    expect(
      await screen.findByRole('menuitemradio', { name: /^源码模式/ }),
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('lets the user opt in to copying inserted local images to document assets', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const fileMenu = screen.getByRole('menuitem', { name: '文件' });
    fileMenu.focus();
    fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '设置' }));
    const imagesTab = await screen.findByRole('tab', { name: '图片' });
    fireEvent.mouseDown(imagesTab, { button: 0 });
    fireEvent.click(imagesTab);
    await waitFor(() => {
      expect(imagesTab).toHaveAttribute('data-state', 'active');
    });

    const checkbox = await screen.findByRole('checkbox', {
      name: '复制插入的本地图片到文档资源目录',
    });

    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(
      (useAppStore.getState() as unknown as Record<string, unknown>)
        .copyImagesToAssets,
    ).toBe(true);
  });

  it('applies the persisted page-width setting and session-only modified-wheel zoom', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const editorDom = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('.cm-editor');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(editorDom.style.getPropertyValue('--lm-editor-page-width')).toBe(
      '810px',
    );
    expect(editorDom.style.getPropertyValue('--lm-editor-font-scale')).toBe('1');

    const fileMenu = screen.getByRole('menuitem', { name: '文件' });
    fileMenu.focus();
    fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '设置' }));

    const widthGroup = await screen.findByRole('group', { name: '页面宽度' });
    fireEvent.click(within(widthGroup).getByRole('button', { name: '宽' }));

    await waitFor(() => {
      expect(useReadingAppearanceStore.getState().pageWidth).toBe('wide');
      expect(editorDom.style.getPropertyValue('--lm-editor-page-width')).toBe(
        '1040px',
      );
    });

    const contentDom = document.querySelector<HTMLElement>('.cm-content');
    expect(contentDom).not.toBeNull();
    fireEvent.wheel(contentDom!, { ctrlKey: true, deltaY: -100 });

    await waitFor(() => {
      expect(useReadingAppearanceStore.getState().fontZoomPercent).toBe(110);
      expect(editorDom.style.getPropertyValue('--lm-editor-font-scale')).toBe(
        '1.1',
      );
    });

    fireEvent.wheel(contentDom!, { deltaY: -100 });
    expect(useReadingAppearanceStore.getState().fontZoomPercent).toBe(110);
  });

  it('alerts the user when the page-width setting cannot be persisted', async () => {
    useReadingAppearanceStore.setState({ pageWidthPersistenceError: true });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const fileMenu = screen.getByRole('menuitem', { name: '文件' });
    fileMenu.focus();
    fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '设置' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '页面宽度已应用，但无法读取或保存设置；下次启动可能恢复默认值。',
    );
  });

  it('passes recent-file persistence errors through the settings model', async () => {
    useRecentFilesStore.setState({ recentFilesPersistenceError: true });

    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const fileMenu = screen.getByRole('menuitem', { name: '文件' });
    fileMenu.focus();
    fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '设置' }));
    const startupTab = await screen.findByRole('tab', { name: '启动' });
    startupTab.focus();
    fireEvent.keyDown(startupTab, { key: 'Enter' });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '无法读取或保存最近文件列表。当前列表可能仅在本次运行期间有效。',
    );
  });

  it('enters a distraction-free focus mode and provides an explicit exit control', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const viewMenu = screen.getByRole('menuitem', { name: '视图' });
    viewMenu.focus();
    fireEvent.keyDown(viewMenu, { key: 'ArrowDown' });
    fireEvent.click(
      await screen.findByRole('menuitemcheckbox', { name: /^专注模式/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toHaveClass('lm-focus-mode');
    });
    expect(screen.getByRole('button', { name: '退出专注模式' })).toBeInTheDocument();
    expect(document.querySelector('.lm-top-chrome')).toBeInTheDocument();
    expect(document.querySelector('.lm-status-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '退出专注模式' }));

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).not.toHaveClass('lm-focus-mode');
    });
  });

  it('opens About from Help without opening Settings', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    const helpMenu = screen.getByRole('menuitem', { name: '帮助' });
    helpMenu.focus();
    fireEvent.keyDown(helpMenu, { key: 'ArrowDown' });
    fireEvent.click(
      await screen.findByRole('menuitem', { name: '关于 LumaMark' }),
    );

    expect(
      await screen.findByRole('dialog', { name: '关于 LumaMark' }),
    ).toBeVisible();
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.getByText('高性能 Typora-like Markdown 编辑器')).toBeVisible();
  });

  it('shows destructive table actions only when the context target is a table', async () => {
    render(
      <I18nProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </I18nProvider>,
    );

    fireEvent.contextMenu(screen.getByTestId('editor-host'));

    expect(
      await screen.findByRole('menuitem', { name: /^表格\s*Ctrl\+T$/ }),
    ).toHaveTextContent('Ctrl+T');
    expect(screen.queryByRole('menuitem', { name: /^复制表格/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^删除表格/ })).not.toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    const table = document.createElement('div');
    table.className = 'tbl-table-widget';
    screen.getByTestId('editor-host').append(table);
    fireEvent.contextMenu(table);

    expect(
      await screen.findByRole('menuitem', { name: /^复制表格\s*Ctrl\+Alt\+C$/ }),
    ).toHaveTextContent('Ctrl+Alt+C');
    expect(
      screen.getByRole('menuitem', {
        name: /^删除表格\s*Ctrl\+Alt\+Backspace$/,
      }),
    ).toHaveTextContent('Ctrl+Alt+Backspace');
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

async function openFileFromMenu(): Promise<void> {
  const fileMenu = screen.getByRole('menuitem', { name: '文件' });
  fileMenu.focus();
  fireEvent.keyDown(fileMenu, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitem', { name: /^打开文件/ }));
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
