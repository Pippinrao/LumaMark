import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorApi } from '../../editor/core/editorApi';
import { useWorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { useAppCommandModels } from './useAppCommandModels';
import { useAppDocumentModel } from './useAppDocumentModel';
import { useAppEditorCommands } from './useAppEditorCommands';
import { useFocusMode } from './useFocusMode';
import { useSettingsModel } from './useSettingsModel';
import { useWindowControlsModel } from './useWindowControlsModel';
import { useAppStore } from '../stores/appStore';
type DeferredCommand = () => void | Promise<void>;
export function useAppShellModel() {
  const { t } = useTranslation();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [newDocumentConfirmOpen, setNewDocumentConfirmOpen] = useState(false);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const commandPaletteOpenerRef = useRef<HTMLElement | null>(null);
  const pendingCommandRef = useRef<DeferredCommand | null>(null);
  const editor = useAppEditorCommands();
  const document = useAppDocumentModel(
    editor.documentPortRef,
    editor.editorReady,
    editor.refreshLocalImage,
  );
  const settings = useSettingsModel();
  const windowControls = useWindowControlsModel();
  const workspace = useWorkspaceWorkflow({
    openDocumentPath: document.fileWorkflow.openPath,
    status: document.status,
  });
  const documentTitle = document.currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = document.dirty ? `${documentTitle} *` : documentTitle;
  const shortcuts = useMemo(
    () => ({
      copy: t('shortcut.table.copy'),
      delete: t('shortcut.table.delete'),
      insert: t('shortcut.table.insert'),
    }),
    [t],
  );
  const onEditorReady = useCallback(
    (editorApi: EditorApi) => {
      editor.onEditorReady(editorApi);
      document.scheduleOutlineRefresh();
    },
    [document, editor],
  );
  const openSettings = useCallback(() => settings.setSettingsOpen(true), [settings]);
  const { exitFocusMode, focusMode, toggleFocusMode } = useFocusMode({
    focusEditor: editor.focusEditor,
    setSidebarOpen,
    sidebarOpen,
  });
  const requestNewDocument = useCallback(() => {
    if (document.dirty) {
      setNewDocumentConfirmOpen(true);
      return;
    }

    document.fileWorkflow.createNewDocument();
  }, [document]);
  const confirmNewDocument = useCallback(() => {
    document.fileWorkflow.createNewDocument();
    setNewDocumentConfirmOpen(false);
  }, [document]);
  const openCommandPalette = useCallback(() => {
    if (commandPaletteOpen) {
      return;
    }

    const activeElement = globalThis.document.activeElement;

    commandPaletteOpenerRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    setCommandPaletteOpen(true);
  }, [commandPaletteOpen]);
  const runCommandAfterPaletteClose = useCallback((run: DeferredCommand) => {
    pendingCommandRef.current = run;
  }, []);

  useEffect(() => {
    if (commandPaletteOpen) {
      return;
    }

    const pendingCommand = pendingCommandRef.current;
    const opener = commandPaletteOpenerRef.current;
    pendingCommandRef.current = null;
    commandPaletteOpenerRef.current = null;

    if (pendingCommand) {
      void pendingCommand();
      return;
    }

    if (opener?.isConnected) {
      opener.focus();
    }
  }, [commandPaletteOpen]);
  const commandModels = useAppCommandModels({
    copyTable: editor.copyTable,
    deleteTable: editor.deleteTable,
    editorDisplayMode: editor.editorDisplayMode,
    exitFocusMode,
    focusMode,
    fileOpening: document.fileWorkflow.fileOpening,
    focusEditor: editor.focusEditor,
    newDocument: requestNewDocument,
    openCommandPalette,
    openFile: () => {
      void document.fileWorkflow.openFromDialog();
    },
    openSearch: editor.openSearch,
    openSettings,
    openWorkspace: () => {
      void workspace.openWorkspace();
    },
    redo: editor.redo,
    runFormat: editor.runFormat,
    save: () => {
      void document.fileWorkflow.save();
    },
    saveAs: () => {
      void document.fileWorkflow.saveAs();
    },
    setLivePreviewMode: () => editor.setDisplayMode('livePreview'),
    setSourceMode: () => editor.setDisplayMode('source'),
    shortcuts,
    t,
    toggleDisplayMode: editor.toggleDisplayMode,
    toggleLanguage: settings.toggleLanguage,
    toggleFocusMode,
    toggleSidebar,
    toggleTheme: settings.toggleTheme,
    undo: editor.undo,
  });

  return {
    commandPaletteOpen,
    commands: commandModels.commands,
    currentFile: document.currentFile,
    dismissFileError: document.dismissFileError,
    dirty: document.dirty,
    documentStatistics: document.documentStatistics,
    documentTitle,
    focusMode,
    editor: {
      contextMenuItems: commandModels.editorContextMenuItems,
      focusEditor: editor.focusEditor,
      imageAssetResolver: editor.imageAssetResolver,
      imageImportErrorHandler: editor.imageImportErrorHandler,
      imageImportHandler: editor.imageImportHandler,
      markDocumentDirty: document.fileWorkflow.markDocumentDirty,
      onReady: onEditorReady,
      selectHeading: (heading: { from: number }) => editor.selectPosition(heading.from),
    },
    externalFileConflict: {
      conflict: document.fileWorkflow.externalConflict,
      keepCurrentContent: document.fileWorkflow.keepCurrentContent,
      reloadFromDisk: document.fileWorkflow.reloadFromDisk,
    },
    headings: document.headings,
    labels: {
      editor: t('app.editorLabel'),
      focusMode: {
        exit: t('command.exitFocusMode'),
      },
      sidebar: {
        files: t('sidebar.files'),
        outline: t('outline.title'),
        sidebar: t('app.sidebarLabel'),
      },
      status: {
        dirtyIndicator: t('status.dirtyIndicator'),
        statistics: t('status.documentStatistics', document.documentStatistics.statistics),
        status: t(document.statusKey),
      },
      topChrome: {
        appName: t('app.name'),
        close: t('window.close'),
        controls: t('window.controls'),
        maximize: t('window.maximize'),
        minimize: t('window.minimize'),
        restore: t('window.restore'),
      },
    },
    language: settings.language,
    copyImagesToAssets: settings.copyImagesToAssets,
    lastFileError: document.lastFileError,
    newDocumentConfirmOpen,
    recentFiles: document.recentFiles,
    recoveryDraft: document.recoveryDraft,
    runAction: commandModels.runAction,
    runCommandAfterPaletteClose,
    scheduleOutlineRefresh: document.scheduleOutlineRefresh,
    setCommandPaletteOpen,
    setLanguage: settings.setLanguage,
    setCopyImagesToAssets: settings.setCopyImagesToAssets,
    setNewDocumentConfirmOpen,
    setSettingsOpen: settings.setSettingsOpen,
    setSidebarOpen,
    setTheme: settings.setTheme,
    settingsOpen: settings.settingsOpen,
    sidebarOpen,
    toggleFocusMode,
    confirmNewDocument,
    theme: settings.theme,
    topMenuGroups: commandModels.topMenuGroups,
    visibleDocumentTitle,
    windowControls,
    workspace,
  };
}
