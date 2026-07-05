import {
  lazy,
  type MouseEvent as ReactMouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Focus,
  Copy,
  FolderOpen,
  Languages,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Save,
  SaveAll,
  Settings,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Menubar from '@radix-ui/react-menubar';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  useDefaultLayout,
} from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import type { EditorApi } from '../../editor/core/editorApi';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from '../../editor/commands/markdownFormatCommands';
import {
  copyCurrentMarkdownTable,
  deleteCurrentMarkdownTable,
} from '../../editor/widgets/table/tableCommands';
import type { AppCommand } from '../../features/command-palette/CommandPalette';
import { createFileActions } from '../../features/file-actions/fileActions';
import { FileTree } from '../../features/file-tree/FileTree';
import { OutlinePanel } from '../../features/outline/OutlinePanel';
import type { OutlineHeading } from '../../features/outline/outlineParser';
import { useDebouncedOutline } from '../../features/outline/useDebouncedOutline';
import { useRecentFilesStore } from '../../features/recent-files/recentFilesStore';
import { resolveFileCommandClient } from '../../services/files/fileCommandClient';
import {
  listWorkspaceChildren,
  openWorkspaceDirectory,
} from '../../features/workspace/workspaceCommands';
import { windowControls } from '../../services/window/windowControls';
import { useWorkspaceStore } from '../../features/workspace/workspaceStore';
import { useAppStore } from '../stores/appStore';
import { StatusBar } from './StatusBar';

const DEFAULT_LAYOUT = {
  editor: 74,
  sidebar: 26,
};
type TopMenuAction =
  | 'copyTable'
  | 'deleteTable'
  | 'focusEditor'
  | 'openCommandPalette'
  | 'openFile'
  | 'openSettings'
  | 'openWorkspace'
  | 'save'
  | 'saveAs'
  | 'setLivePreviewMode'
  | 'setSourceMode'
  | 'toggleLanguage'
  | 'toggleTheme'
  | MarkdownFormatCommand;
type TopMenuItem = {
  action?: TopMenuAction;
  disabled?: boolean;
  label: string;
  shortcut?: string;
};
type TopMenuGroup = {
  items: TopMenuItem[];
  label: string;
};
type EditorContextMenuItem = {
  action: TopMenuAction;
  label: string;
  shortcut: string;
};

const LazyCommandPalette = lazy(() =>
  import('../../features/command-palette/CommandPalette').then((module) => ({
    default: module.CommandPalette,
  })),
);
const LazySettingsDialog = lazy(() =>
  import('../../features/settings/SettingsDialog').then((module) => ({
    default: module.SettingsDialog,
  })),
);
const LazyEditorViewHost = lazy(() =>
  import('../../editor/core/EditorViewHost').then((module) => ({
    default: module.EditorViewHost,
  })),
);
const fallbackPanelLayoutStorage = new Map<string, string>();
function isJsdomRuntime(): boolean {
  const userAgent = globalThis.navigator?.userAgent.toLowerCase() ?? '';

  return userAgent.includes('jsdom');
}

function getPanelLayoutBrowserStorage(): Storage | null {
  if (isJsdomRuntime()) {
    return null;
  }

  try {
    return globalThis.document?.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

const panelLayoutStorage = {
  getItem(key: string) {
    try {
      const storage = getPanelLayoutBrowserStorage();

      if (storage && typeof storage.getItem === 'function') {
        return storage.getItem(key);
      }
    } catch {
      return fallbackPanelLayoutStorage.get(key) ?? null;
    }

    return fallbackPanelLayoutStorage.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    try {
      const storage = getPanelLayoutBrowserStorage();

      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(key, value);
        return;
      }
    } catch {
      fallbackPanelLayoutStorage.set(key, value);
      return;
    }

    fallbackPanelLayoutStorage.set(key, value);
  },
};

export function AppShell() {
  const { t } = useTranslation();
  const editorRef = useRef<EditorApi | null>(null);
  const dirtyRevisionRef = useRef(0);
  const workspaceLoadSessionRef = useRef(0);
  const workspaceLoadGenerationsRef = useRef(new Map<string, number>());
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [editorDisplayMode, setEditorDisplayMode] =
    useState<EditorDisplayMode>('livePreview');
  const [fileOpening, setFileOpening] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const currentFile = useAppStore((state) => state.currentFile);
  const dirty = useAppStore((state) => state.dirty);
  const language = useAppStore((state) => state.language);
  const statusKey = useAppStore((state) => state.statusKey);
  const theme = useAppStore((state) => state.theme);
  const setDirty = useAppStore((state) => state.setDirty);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const setStatusKey = useAppStore((state) => state.setStatusKey);
  const setTheme = useAppStore((state) => state.setTheme);
  const toggleLanguage = useAppStore((state) => state.toggleLanguage);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const workspaceRoot = useWorkspaceStore((state) => state.root);
  const workspaceTree = useWorkspaceStore((state) => state.tree);
  const workspaceLoadingPaths = useWorkspaceStore((state) => state.loadingPaths);
  const finishWorkspaceLoading = useWorkspaceStore((state) => state.finishLoading);
  const setWorkspaceChildren = useWorkspaceStore((state) => state.setChildren);
  const setWorkspaceError = useWorkspaceStore((state) => state.setError);
  const setWorkspaceRoot = useWorkspaceStore((state) => state.setRoot);
  const startWorkspaceLoading = useWorkspaceStore((state) => state.startLoading);
  const layout = useDefaultLayout({
    id: 'lumamark-v1-main-panels',
    onlySaveAfterUserInteractions: true,
    panelIds: ['sidebar', 'editor'],
    storage: panelLayoutStorage,
  });
  const documentTitle = currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = dirty ? `${documentTitle} *` : documentTitle;
  const tableShortcuts = useMemo(
    () => ({
      copy: t('shortcut.table.copy'),
      delete: t('shortcut.table.delete'),
      insert: t('shortcut.table.insert'),
    }),
    [t],
  );
  const setFileDirty = useCallback(
    (nextDirty: boolean) => {
      if (nextDirty) {
        dirtyRevisionRef.current += 1;
      }

      setDirty(nextDirty);
    },
    [setDirty],
  );
  const markDocumentDirty = useCallback(() => {
    dirtyRevisionRef.current += 1;
    const state = useAppStore.getState();

    if (!state.dirty || state.statusKey !== 'status.unsaved') {
      setDirty(true);
    }
  }, [setDirty]);
  const fileActionState = useMemo(
    () => ({
      getState: () => {
        const state = useAppStore.getState();

        return {
          currentFile: state.currentFile,
          dirty: state.dirty,
          dirtyRevision: dirtyRevisionRef.current,
          lastFileError: state.lastFileError,
        };
      },
      setCurrentFile: useAppStore.getState().setCurrentFile,
      setDirty: setFileDirty,
      setLastFileError: useAppStore.getState().setLastFileError,
    }),
    [setFileDirty],
  );
  const recentFiles = useMemo(
    () => ({
      addRecentFile: useRecentFilesStore.getState().addRecentFile,
    }),
    [],
  );
  const createActions = useCallback(() => {
    if (!editorRef.current) {
      return null;
    }

    return createFileActions({
      commands: resolveFileCommandClient(),
      editor: editorRef.current,
      recentFiles,
      state: fileActionState,
    });
  }, [fileActionState, recentFiles]);

  const handleOpenFile = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    setFileOpening(true);
    setStatusKey('status.opening');
    try {
      const result = await actions.openFileFromDialog();

      if (result.ok && result.data) {
        setStatusKey('status.opened');
      } else if (!result.ok) {
        setStatusKey('status.openFailed');
      } else {
        setStatusKey('status.ready');
      }
    } finally {
      setFileOpening(false);
    }
  }, [createActions, setStatusKey]);

  const handleSave = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    const result = useAppStore.getState().currentFile
      ? await actions.saveCurrentFile()
      : await actions.saveFileAs();

    if (result.ok && result.data && !useAppStore.getState().dirty) {
      setStatusKey('status.saved');
    }
  }, [createActions, setStatusKey]);

  const handleSaveAs = useCallback(async () => {
    const actions = createActions();

    if (!actions) {
      return;
    }

    const result = await actions.saveFileAs();

    if (result.ok && result.data && !useAppStore.getState().dirty) {
      setStatusKey('status.saved');
    }
  }, [createActions, setStatusKey]);

  const handleLoadWorkspaceChildren = useCallback(
    async (path: string, session = workspaceLoadSessionRef.current) => {
      if (session !== workspaceLoadSessionRef.current) {
        return;
      }

      if (useWorkspaceStore.getState().loadingPaths[path]) {
        return;
      }

      const generation =
        (workspaceLoadGenerationsRef.current.get(path) ?? 0) + 1;
      workspaceLoadGenerationsRef.current.set(path, generation);
      startWorkspaceLoading(path);
      const result = await listWorkspaceChildren(path);

      if (
        session !== workspaceLoadSessionRef.current ||
        workspaceLoadGenerationsRef.current.get(path) !== generation
      ) {
        return;
      }

      if (result.ok) {
        setWorkspaceChildren(path, result.data);
        setWorkspaceError(null);
      } else {
        setWorkspaceError(result.error);
      }

      finishWorkspaceLoading(path);
    },
    [
      finishWorkspaceLoading,
      setWorkspaceChildren,
      setWorkspaceError,
      startWorkspaceLoading,
    ],
  );

  const handleOpenWorkspace = useCallback(async () => {
    const result = await openWorkspaceDirectory();

    if (!result.ok) {
      setWorkspaceError(result.error);
      setStatusKey('status.workspaceOpenFailed');
      return;
    }

    if (!result.data) {
      return;
    }

    workspaceLoadSessionRef.current += 1;
    workspaceLoadGenerationsRef.current.clear();
    const workspaceLoadSession = workspaceLoadSessionRef.current;
    setWorkspaceRoot(result.data);
    setStatusKey('status.workspaceOpened');
    await handleLoadWorkspaceChildren(result.data.path, workspaceLoadSession);
  }, [
    handleLoadWorkspaceChildren,
    setStatusKey,
    setWorkspaceError,
    setWorkspaceRoot,
  ]);

  const handleOpenWorkspaceFile = useCallback(
    async (path: string) => {
      const actions = createActions();

      if (!actions) {
        return;
      }

      setFileOpening(true);
      setStatusKey('status.opening');
      try {
        const result = await actions.openFile(path);

        if (result.ok) {
          setStatusKey('status.opened');
        } else {
          setStatusKey('status.openFailed');
        }
      } finally {
        setFileOpening(false);
      }
    },
    [createActions, setStatusKey],
  );

  const getDocumentText = useCallback(() => {
    return editorRef.current?.getDocumentText() ?? '';
  }, []);
  const { headings, scheduleRefresh: scheduleOutlineRefresh } =
    useDebouncedOutline({
      getDocumentText,
    });

  const handleSelectHeading = useCallback((heading: OutlineHeading) => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    editor.view.dispatch({
      scrollIntoView: true,
      selection: {
        anchor: heading.from,
      },
    });
    editor.focus();
  }, []);
  const applyFormatCommand = useCallback((command: MarkdownFormatCommand) => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    applyMarkdownFormatCommand(editor.view, command);
  }, []);
  const copyTable = useCallback(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    void copyCurrentMarkdownTable(editor.view);
  }, []);
  const deleteTable = useCallback(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    if (deleteCurrentMarkdownTable(editor.view)) {
      editor.focus();
    }
  }, []);
  const runTopMenuAction = useCallback(
    (action: TopMenuAction) => {
      switch (action) {
        case 'copyTable':
          copyTable();
          break;
        case 'deleteTable':
          deleteTable();
          break;
        case 'openFile':
          void handleOpenFile();
          break;
        case 'openWorkspace':
          void handleOpenWorkspace();
          break;
        case 'save':
          void handleSave();
          break;
        case 'saveAs':
          void handleSaveAs();
          break;
        case 'setLivePreviewMode':
          editorRef.current?.setDisplayMode('livePreview');
          setEditorDisplayMode('livePreview');
          break;
        case 'setSourceMode':
          editorRef.current?.setDisplayMode('source');
          setEditorDisplayMode('source');
          break;
        case 'openCommandPalette':
          setCommandPaletteOpen(true);
          break;
        case 'focusEditor':
          editorRef.current?.focus();
          break;
        case 'openSettings':
          setSettingsOpen(true);
          break;
        case 'toggleTheme':
          toggleTheme();
          break;
        case 'toggleLanguage':
          toggleLanguage();
          break;
        default:
          applyFormatCommand(action);
      }
    },
    [
      applyFormatCommand,
      copyTable,
      deleteTable,
      handleOpenFile,
      handleOpenWorkspace,
      handleSave,
      handleSaveAs,
      toggleLanguage,
      toggleTheme,
    ],
  );

  const commands = useMemo<readonly AppCommand[]>(
    () => [
      {
        icon: FolderOpen,
        id: 'open-file',
        keywords: [t('command.openFile')],
        label: t('command.openFile'),
        run: handleOpenFile,
      },
      {
        icon: FolderOpen,
        id: 'open-workspace',
        keywords: [t('workspace.open')],
        label: t('workspace.open'),
        run: handleOpenWorkspace,
      },
      {
        icon: Save,
        id: 'save',
        keywords: [t('command.save')],
        label: t('command.save'),
        run: handleSave,
      },
      {
        icon: SaveAll,
        id: 'save-as',
        keywords: [t('command.saveAs')],
        label: t('command.saveAs'),
        run: handleSaveAs,
      },
      {
        icon: Moon,
        id: 'toggle-theme',
        keywords: [t('command.toggleTheme')],
        label: t('command.toggleTheme'),
        run: toggleTheme,
      },
      {
        icon: Languages,
        id: 'toggle-language',
        keywords: [t('command.toggleLanguage')],
        label: t('command.toggleLanguage'),
        run: toggleLanguage,
      },
      {
        icon: Focus,
        id: 'focus-editor',
        keywords: [t('command.focusEditor')],
        label: t('command.focusEditor'),
        run: () => editorRef.current?.focus(),
      },
      {
        icon: Settings,
        id: 'open-settings',
        keywords: [t('settings.title')],
        label: t('settings.title'),
        run: () => {
          setSettingsOpen(true);
        },
      },
      {
        icon: Table2,
        id: 'insert-table',
        keywords: [t('menu.table')],
        label: t('menu.table'),
        run: () => {
          const editor = editorRef.current;

          if (!editor) {
            return;
          }

          applyMarkdownFormatCommand(editor.view, 'table');
        },
        shortcut: tableShortcuts.insert,
      },
      {
        icon: Copy,
        id: 'copy-table',
        keywords: [t('table.copyTable')],
        label: t('table.copyTable'),
        run: () => {
          const editor = editorRef.current;

          if (!editor) {
            return;
          }

          void copyCurrentMarkdownTable(editor.view);
        },
        shortcut: tableShortcuts.copy,
      },
      {
        icon: Trash2,
        id: 'delete-table',
        keywords: [t('table.deleteTable')],
        label: t('table.deleteTable'),
        run: () => {
          const editor = editorRef.current;

          if (!editor) {
            return;
          }

          if (deleteCurrentMarkdownTable(editor.view)) {
            editor.focus();
          }
        },
        shortcut: tableShortcuts.delete,
      },
    ],
    [
      handleOpenFile,
      handleOpenWorkspace,
      handleSave,
      handleSaveAs,
      tableShortcuts,
      t,
      toggleLanguage,
      toggleTheme,
    ],
  );
  const topMenuGroups = useMemo<TopMenuGroup[]>(
    () => [
      {
        label: t('menu.file'),
        items: [
          {
            action: 'openFile' as const,
            disabled: fileOpening,
            label: t('command.openFile'),
          },
          {
            action: 'openWorkspace' as const,
            disabled: fileOpening,
            label: t('workspace.open'),
          },
          { action: 'save' as const, label: t('command.save') },
          { action: 'saveAs' as const, label: t('command.saveAs') },
        ],
      },
      {
        label: t('menu.edit'),
        items: [
          { disabled: true, label: t('menu.undo') },
          { disabled: true, label: t('menu.redo') },
          {
            action: 'copyTable' as const,
            label: t('table.copyTable'),
            shortcut: tableShortcuts.copy,
          },
          {
            action: 'deleteTable' as const,
            label: t('table.deleteTable'),
            shortcut: tableShortcuts.delete,
          },
          {
            action: 'openCommandPalette' as const,
            label: t('commandPalette.open'),
          },
        ],
      },
      {
        label: t('menu.paragraph'),
        items: [
          { action: 'heading1' as const, label: t('menu.heading1') },
          { action: 'heading2' as const, label: t('menu.heading2') },
          { action: 'unorderedList' as const, label: t('menu.unorderedList') },
          { action: 'taskList' as const, label: t('menu.taskList') },
          {
            action: 'table' as const,
            label: t('menu.table'),
            shortcut: tableShortcuts.insert,
          },
          { action: 'quote' as const, label: t('menu.quote') },
          { action: 'codeBlock' as const, label: t('menu.codeBlock') },
        ],
      },
      {
        label: t('menu.format'),
        items: [
          { action: 'bold' as const, label: t('menu.bold') },
          { action: 'italic' as const, label: t('menu.italic') },
          { action: 'inlineCode' as const, label: t('menu.inlineCode') },
          { action: 'link' as const, label: t('menu.link') },
        ],
      },
      {
        label: t('menu.view'),
        items: [
          { action: 'focusEditor' as const, label: t('command.focusEditor') },
          editorDisplayMode === 'source'
            ? {
                action: 'setLivePreviewMode' as const,
                label: t('menu.livePreviewMode'),
              }
            : {
                action: 'setSourceMode' as const,
                label: t('menu.sourceMode'),
              },
          { action: 'openSettings' as const, label: t('settings.title') },
        ],
      },
      {
        label: t('menu.theme'),
        items: [
          { action: 'toggleTheme' as const, label: t('command.toggleTheme') },
          {
            action: 'toggleLanguage' as const,
            label: t('command.toggleLanguage'),
          },
        ],
      },
      {
        label: t('menu.help'),
        items: [{ action: 'openSettings' as const, label: t('menu.about') }],
      },
    ],
    [editorDisplayMode, fileOpening, tableShortcuts, t],
  );
  const editorContextMenuItems = useMemo<EditorContextMenuItem[]>(
    () => [
      {
        action: 'table',
        label: t('menu.table'),
        shortcut: tableShortcuts.insert,
      },
      {
        action: 'copyTable',
        label: t('table.copyTable'),
        shortcut: tableShortcuts.copy,
      },
      {
        action: 'deleteTable',
        label: t('table.deleteTable'),
        shortcut: tableShortcuts.delete,
      },
    ],
    [tableShortcuts, t],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || !event.altKey) {
        return;
      }

      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        applyFormatCommand('table');
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copyTable();
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        deleteTable();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [applyFormatCommand, copyTable, deleteTable]);

  useEffect(() => {
    let canceled = false;

    void windowControls.isMaximized().then((maximized) => {
      if (!canceled && maximized !== null) {
        setWindowMaximized(maximized);
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  const handleChromeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('[data-lm-window-interactive="true"]')
      ) {
        return;
      }

      void windowControls.startDragging();
    },
    [],
  );

  const handleWindowControl = useCallback(
    (action: 'close' | 'minimize' | 'toggleMaximize') => {
      if (action !== 'toggleMaximize') {
        void windowControls[action]();
        return;
      }

      void windowControls.toggleMaximize().then(async (toggled) => {
        if (!toggled) {
          return;
        }

        const maximized = await windowControls.isMaximized();
        setWindowMaximized((current) => maximized ?? !current);
      });
    },
    [],
  );

  return (
    <div className="lm-app-shell" data-testid="app-shell">
      <header
        className="lm-top-chrome"
        data-tauri-drag-region
        onMouseDown={handleChromeMouseDown}
      >
        <h1 className="lm-app-heading">{t('app.name')}</h1>

        <Menubar.Root
          className="lm-menu-bar"
          data-lm-window-interactive="true"
        >
          {topMenuGroups.map((group) => (
            <Menubar.Menu key={group.label}>
              <Menubar.Trigger className="lm-menu-trigger">
                {group.label}
              </Menubar.Trigger>
              <Menubar.Portal>
                <Menubar.Content
                  className="lm-menu-content"
                  align="start"
                  sideOffset={12}
                >
                  {group.items.map((item) => (
                    <Menubar.Item
                      className="lm-menu-item"
                      disabled={item.disabled}
                      key={item.label}
                      onSelect={() => {
                        if (item.action) {
                          runTopMenuAction(item.action);
                        }
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut ? (
                        <kbd className="lm-menu-shortcut">{item.shortcut}</kbd>
                      ) : null}
                    </Menubar.Item>
                  ))}
                </Menubar.Content>
              </Menubar.Portal>
            </Menubar.Menu>
          ))}
        </Menubar.Root>

        <nav
          className="lm-window-controls"
          aria-label={t('window.controls')}
          data-lm-window-interactive="true"
        >
          <button
            className="lm-window-control"
            type="button"
            aria-label={t('window.minimize')}
            onClick={() => {
              handleWindowControl('minimize');
            }}
          >
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            className="lm-window-control"
            type="button"
            aria-label={
              windowMaximized ? t('window.restore') : t('window.maximize')
            }
            onClick={() => {
              handleWindowControl('toggleMaximize');
            }}
          >
            {windowMaximized ? (
              <Minimize2 size={13} aria-hidden="true" />
            ) : (
              <Maximize2 size={13} aria-hidden="true" />
            )}
          </button>
          <button
            className="lm-window-control lm-window-control-close"
            type="button"
            aria-label={t('window.close')}
            onClick={() => {
              handleWindowControl('close');
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </nav>
      </header>

      <PanelGroup
        className="lm-workspace-shell"
        defaultLayout={layout.defaultLayout ?? DEFAULT_LAYOUT}
        id="lumamark-v1-main-panels"
        onLayoutChanged={layout.onLayoutChanged}
        orientation="horizontal"
      >
        <Panel
          className="lm-sidebar-panel"
          collapsible
          collapsedSize="0%"
          defaultSize="22%"
          id="sidebar"
          minSize="220px"
        >
          <aside className="lm-sidebar" aria-label={t('app.sidebarLabel')}>
            <Tabs.Root className="lm-sidebar-tabs" defaultValue="files">
              <Tabs.List className="lm-sidebar-tabs-list" aria-label={t('app.sidebarLabel')}>
                <Tabs.Trigger className="lm-sidebar-tab" value="files">
                  {t('sidebar.files')}
                </Tabs.Trigger>
                <Tabs.Trigger className="lm-sidebar-tab" value="outline">
                  {t('outline.title')}
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content className="lm-sidebar-tab-panel" value="files">
                <FileTree
                  loadingPaths={workspaceLoadingPaths}
                  onLoadChildren={handleLoadWorkspaceChildren}
                  onOpenFile={handleOpenWorkspaceFile}
                  onOpenWorkspace={handleOpenWorkspace}
                  root={workspaceRoot}
                  selectedPath={currentFile?.path}
                  tree={workspaceTree}
                />
              </Tabs.Content>
              <Tabs.Content className="lm-sidebar-tab-panel" value="outline">
                <OutlinePanel
                  headings={headings}
                  onSelectHeading={handleSelectHeading}
                />
              </Tabs.Content>
            </Tabs.Root>
          </aside>
        </Panel>
        <PanelResizeHandle className="lm-resize-handle" />
        <Panel className="lm-editor-panel" defaultSize="74%" id="editor" minSize="360px">
          <ContextMenu.Root>
            <ContextMenu.Trigger asChild>
              <main
                className="lm-editor-pane"
                data-testid="editor-host"
                aria-label={t('app.editorLabel')}
              >
                <div className="lm-editor-header">
                  <span className="lm-editor-title">{visibleDocumentTitle}</span>
                </div>
                <div className="lm-editor-scroll">
                  <div className="lm-editor-paper">
                    <Suspense fallback={null}>
                      <LazyEditorViewHost
                        accessibleTitle={documentTitle}
                        ariaLabel={t('app.editorLabel')}
                        onDocumentChanged={() => {
                          markDocumentDirty();
                          scheduleOutlineRefresh();
                        }}
                        onEditorReady={(editor) => {
                          editorRef.current = editor;
                          setEditorDisplayMode(editor.getDisplayMode());
                          scheduleOutlineRefresh();
                        }}
                      />
                    </Suspense>
                  </div>
                </div>
              </main>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="lm-menu-content lm-context-menu-content">
                {editorContextMenuItems.map((item) => (
                  <ContextMenu.Item
                    className="lm-menu-item lm-context-menu-item"
                    key={item.label}
                    onSelect={() => {
                      runTopMenuAction(item.action);
                    }}
                  >
                    <span>{item.label}</span>
                    <kbd className="lm-menu-shortcut">{item.shortcut}</kbd>
                  </ContextMenu.Item>
                ))}
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        </Panel>
      </PanelGroup>

      <StatusBar
        currentFileName={currentFile?.name}
        dirty={dirty}
        statusKey={statusKey}
        workspaceName={workspaceRoot?.name}
      />

      <Suspense fallback={null}>
        {commandPaletteOpen ? (
          <LazyCommandPalette
            commands={commands}
            onOpenChange={setCommandPaletteOpen}
            open={commandPaletteOpen}
          />
        ) : null}
        {settingsOpen ? (
          <LazySettingsDialog
            language={language}
            onLanguageChange={setLanguage}
            onOpenChange={setSettingsOpen}
            onThemeChange={setTheme}
            open={settingsOpen}
            theme={theme}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
