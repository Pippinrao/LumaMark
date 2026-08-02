import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorApi } from '../../editor/core/editorApi';
import { useWorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { createAppShellLabels, createTableShortcutLabels } from './createAppShellLabels';
import { useAppCommandHandlers } from './useAppCommandHandlers';
import { useAppCommandModels } from './useAppCommandModels';
import { useAppDocumentModel } from './useAppDocumentModel';
import { useAppEditorCommands } from './useAppEditorCommands';
import { useFocusMode } from './useFocusMode';
import { useMenuDialogFocus } from './useMenuDialogFocus';
import { useNewDocumentConfirmation } from './useNewDocumentConfirmation';
import { useSettingsModel } from './useSettingsModel';
import { useWindowControlsModel } from './useWindowControlsModel';
import { useAppStore } from '../stores/appStore';
type DeferredCommand = () => void | Promise<void>;
export function useAppShellModel() {
  const { t } = useTranslation();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
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
  const { openAbout, openSettings, restoreDialogFocus } = useMenuDialogFocus({
    setAboutOpen,
    setSettingsOpen: settings.setSettingsOpen,
  });
  const windowControls = useWindowControlsModel();
  const workspace = useWorkspaceWorkflow({
    openDocumentPath: document.fileWorkflow.openPath,
    status: document.status,
  });
  const documentTitle = document.currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = document.dirty ? `${documentTitle} *` : documentTitle;
  const newDocumentConfirmation = useNewDocumentConfirmation({
    createNewDocument: document.fileWorkflow.createNewDocument,
    dirty: document.dirty,
    focusEditor: editor.focusEditor,
  });
  const shortcuts = useMemo(() => createTableShortcutLabels(t), [t]);
  const onEditorReady = useCallback(
    (editorApi: EditorApi) => {
      editor.onEditorReady(editorApi);
      document.scheduleOutlineRefresh();
    },
    [document, editor],
  );
  const { exitFocusMode, focusMode, toggleFocusMode } = useFocusMode({
    focusEditor: editor.focusEditor,
    setSidebarOpen,
    sidebarOpen,
  });
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
  const commandHandlers = useAppCommandHandlers({
    copyTable: editor.copyTable,
    deleteTable: editor.deleteTable,
    exitFocusMode,
    focusEditor: editor.focusEditor,
    insertImage: () => {
      void editor.insertLocalImages();
    },
    newDocument: newDocumentConfirmation.requestNewDocument,
    openAbout,
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
    setLanguage: settings.setLanguage,
    setLivePreviewMode: () => editor.setDisplayMode('livePreview'),
    setSourceMode: () => editor.setDisplayMode('source'),
    setTheme: settings.setTheme,
    toggleDisplayMode: editor.toggleDisplayMode,
    toggleLanguage: settings.toggleLanguage,
    toggleFocusMode,
    toggleSidebar,
    toggleTheme: settings.toggleTheme,
    undo: editor.undo,
  });
  const commandModels = useAppCommandModels({
    editorDisplayMode: editor.editorDisplayMode,
    fileOpening: document.fileWorkflow.fileOpening,
    focusMode,
    handlers: commandHandlers,
    language: settings.language,
    openRecentFile: (path) => {
      void document.fileWorkflow.openPath(path);
    },
    recentFiles: document.recentFiles,
    shortcuts,
    sidebarOpen,
    t,
    theme: settings.theme,
  });

  return {
    aboutOpen,
    commandPaletteOpen,
    commands: commandModels.commands,
    currentFile: document.currentFile,
    dismissFileError: document.dismissFileError,
    dirty: document.dirty,
    documentStatistics: document.documentStatistics,
    documentTitle,
    focusMode,
    editor: {
      getContextMenuItems: commandModels.getEditorContextMenuItems,
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
    labels: createAppShellLabels({
      documentStatistics: document.documentStatistics.statistics,
      statusKey: document.statusKey,
      t,
    }),
    language: settings.language,
    copyImagesToAssets: settings.copyImagesToAssets,
    lastFileError: document.lastFileError,
    newDocumentConfirmOpen: newDocumentConfirmation.open,
    recentFiles: document.recentFiles,
    recoveryDraft: document.recoveryDraft,
    runAction: commandModels.runAction,
    runMenuInvocation: commandModels.runMenuInvocation,
    runCommandAfterPaletteClose,
    restoreDialogFocus,
    restoreNewDocumentFocus: newDocumentConfirmation.restoreFocus,
    scheduleOutlineRefresh: document.scheduleOutlineRefresh,
    setCommandPaletteOpen,
    setLanguage: settings.setLanguage,
    setAboutOpen,
    setCopyImagesToAssets: settings.setCopyImagesToAssets,
    setNewDocumentConfirmOpen: newDocumentConfirmation.setOpen,
    setSettingsOpen: settings.setSettingsOpen,
    setSidebarOpen,
    setTheme: settings.setTheme,
    settingsOpen: settings.settingsOpen,
    sidebarOpen,
    toggleFocusMode,
    confirmNewDocument: newDocumentConfirmation.confirmNewDocument,
    theme: settings.theme,
    topMenuGroups: commandModels.topMenuGroups,
    visibleDocumentTitle,
    windowControls,
    workspace,
  };
}
