import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Focus,
  FolderOpen,
  Languages,
  Moon,
  Save,
  SaveAll,
  Settings,
} from 'lucide-react';
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
  useDefaultLayout,
} from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { EditorViewHost } from '../../editor/core/EditorViewHost';
import type { EditorApi } from '../../editor/core/editorApi';
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
import { useWorkspaceStore } from '../../features/workspace/workspaceStore';
import { useAppStore } from '../stores/appStore';
import { StatusBar } from './StatusBar';

const DEFAULT_LAYOUT = {
  editor: 58,
  outline: 20,
  sidebar: 22,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    id: 'lumamark-main-panels',
    onlySaveAfterUserInteractions: true,
    panelIds: ['sidebar', 'editor', 'outline'],
    storage: panelLayoutStorage,
  });
  const documentTitle = currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = dirty ? `${documentTitle} *` : documentTitle;
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

    const result = await actions.openFileFromDialog();

    if (result.ok && result.data) {
      setStatusKey('status.opened');
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

      const result = await actions.openFile(path);

      if (result.ok) {
        setStatusKey('status.opened');
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
    ],
    [
      handleOpenFile,
      handleOpenWorkspace,
      handleSave,
      handleSaveAs,
      t,
      toggleLanguage,
      toggleTheme,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="lm-app-shell" data-testid="app-shell">
      <header className="lm-shell-header">
        <div className="lm-title-group">
          <h1>{t('app.name')}</h1>
          <span className="lm-document-title">{visibleDocumentTitle}</span>
        </div>

        <nav className="lm-command-bar" aria-label={t('app.toolbarLabel')}>
          <button type="button" onClick={handleOpenFile}>
            <FolderOpen size={15} aria-hidden="true" />
            {t('command.openFile')}
          </button>
          <button type="button" onClick={handleSave}>
            <Save size={15} aria-hidden="true" />
            {t('command.save')}
          </button>
          <button type="button" onClick={handleSaveAs}>
            <SaveAll size={15} aria-hidden="true" />
            {t('command.saveAs')}
          </button>
          <button
            type="button"
            onClick={() => {
              setCommandPaletteOpen(true);
            }}
          >
            <Focus size={15} aria-hidden="true" />
            {t('commandPalette.open')}
          </button>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(true);
            }}
          >
            <Settings size={15} aria-hidden="true" />
            {t('settings.title')}
          </button>
        </nav>
      </header>

      <PanelGroup
        className="lm-shell-body"
        defaultLayout={layout.defaultLayout ?? DEFAULT_LAYOUT}
        id="lumamark-main-panels"
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
            <FileTree
              loadingPaths={workspaceLoadingPaths}
              onLoadChildren={handleLoadWorkspaceChildren}
              onOpenFile={handleOpenWorkspaceFile}
              onOpenWorkspace={handleOpenWorkspace}
              root={workspaceRoot}
              selectedPath={currentFile?.path}
              tree={workspaceTree}
            />
          </aside>
        </Panel>
        <PanelResizeHandle className="lm-resize-handle" />
        <Panel className="lm-editor-panel" defaultSize="58%" id="editor" minSize="360px">
          <main
            className="lm-editor-surface"
            data-testid="editor-host"
            aria-label={t('app.editorLabel')}
          >
            <EditorViewHost
              accessibleTitle={documentTitle}
              ariaLabel={t('app.editorLabel')}
              onDocumentChanged={() => {
                markDocumentDirty();
                scheduleOutlineRefresh();
              }}
              onEditorReady={(editor) => {
                editorRef.current = editor;
                scheduleOutlineRefresh();
              }}
            />
          </main>
        </Panel>
        <PanelResizeHandle className="lm-resize-handle" />
        <Panel className="lm-outline-panel" defaultSize="20%" id="outline" minSize="200px">
          <OutlinePanel
            headings={headings}
            onSelectHeading={handleSelectHeading}
          />
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
