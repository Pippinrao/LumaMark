import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorApi } from '../../editor/core/editorApi';
import { createCommandShortcutLabels } from '../../features/commands/commandShortcuts';
import { useMediaViewer } from '../../features/media-viewer/useMediaViewer';
import { useWorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { createAppShellLabels } from './createAppShellLabels';
import { useAppCommandHandlers } from './useAppCommandHandlers';
import { useAppCommandModels } from './useAppCommandModels';
import { useAppDocumentModel } from './useAppDocumentModel';
import { useAppEditorCommands } from './useAppEditorCommands';
import { useCommandPaletteModel } from './useCommandPaletteModel';
import { useFocusMode } from './useFocusMode';
import { useMenuDialogFocus } from './useMenuDialogFocus';
import { useNewDocumentConfirmation } from './useNewDocumentConfirmation';
import { useReadingAppearanceModel } from './useReadingAppearanceModel';
import { useSettingsModel } from './useSettingsModel';
import { useWindowControlsModel } from './useWindowControlsModel';
import { useStartupExperience } from './useStartupExperience';
import { useDesktopOpenRequests } from './useDesktopOpenRequests';
import { useUpdateModel } from './useUpdateModel';
import { useStartupStore } from '../../features/startup/startupStore';
import { useAppStore } from '../stores/appStore';
export function useAppShellModel() {
  const { t } = useTranslation();
  const [aboutOpen, setAboutOpen] = useState(false);
  const updates = useUpdateModel();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const commandPalette = useCommandPaletteModel();
  const editor = useAppEditorCommands();
  const mediaViewer = useMediaViewer(editor.focusEditor);
  const document = useAppDocumentModel(editor.documentPortRef, editor.editorReady, editor.refreshLocalImage);
  const settings = useSettingsModel();
  const readingAppearance = useReadingAppearanceModel(editor.focusEditor);
  const { openAbout, openSettings, restoreDialogFocus } = useMenuDialogFocus({
    setAboutOpen,
    setSettingsOpen: settings.setSettingsOpen,
  });
  const windowControls = useWindowControlsModel();
  const workspace = useWorkspaceWorkflow({
    openDocumentPath: document.fileWorkflow.openPath,
    status: document.status,
  });
  const desktopOpenRequests = useDesktopOpenRequests({
    dirty: document.dirty,
    editorReady: editor.editorReady,
    onOpened: (path) => {
      useStartupStore.getState().setLastSession({ kind: 'file', path });
      useStartupStore.getState().setStartScreenOpen(false);
    },
    openPath: document.fileWorkflow.openPath,
    recoveryChecked: document.recoveryDraft.recoveryChecked,
    recoveryPending: Boolean(document.recoveryDraft.pendingRecoveryDraft),
  });
  const startup = useStartupExperience({
    currentFilePath: document.currentFile?.path ?? null,
    dirty: document.dirty,
    desktopOpenRequests,
    editorReady: editor.editorReady,
    fileWorkflow: document.fileWorkflow,
    recoveryDraft: document.recoveryDraft,
    workspace,
  });
  const documentTitle = document.currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = document.dirty ? `${documentTitle} *` : documentTitle;
  const newDocumentConfirmation = useNewDocumentConfirmation({
    createNewDocument: document.fileWorkflow.createNewDocument,
    dirty: document.dirty,
    focusEditor: editor.focusEditor,
  });
  const shortcuts = useMemo(() => createCommandShortcutLabels(globalThis.navigator.userAgent), []);
  const onEditorReady = useCallback((editorApi: EditorApi) => {
    editor.onEditorReady(editorApi);
    document.scheduleOutlineRefresh();
  }, [document, editor]);
  const { exitFocusMode, focusMode, toggleFocusMode } = useFocusMode({
    focusEditor: editor.focusEditor,
    setSidebarOpen,
    sidebarOpen,
  });
  const commandHandlers = useAppCommandHandlers({
    copyTable: editor.copyTable,
    deleteTable: editor.deleteTable,
    editorAvailable: !startup.visible,
    exitFocusMode,
    focusEditor: editor.focusEditor,
    insertImage: () => {
      void editor.insertLocalImages();
    },
    newDocument: startup.visible ? startup.newDocument : newDocumentConfirmation.requestNewDocument,
    openAbout,
    checkForUpdates: updates.checkForUpdatesManually,
    openCommandPalette: commandPalette.openPalette,
    openFile: () => {
      void startup.openFile();
    },
    openSearch: editor.openSearch,
    openSettings,
    openWorkspace: () => {
      void startup.openWorkspace();
    },
    redo: editor.redo,
    resetZoom: readingAppearance.resetZoom,
    runFormat: editor.runFormat,
    save: () => {
      void document.fileWorkflow.save();
    },
    saveAs: () => {
      void document.fileWorkflow.saveAs();
    },
    setLanguage: settings.setLanguage,
    setLivePreviewMode: () => editor.setDisplayMode('livePreview'),
    setReadingMode: () => editor.setDisplayMode('reading'),
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
    editorAvailable: !startup.visible,
    fileOpening: document.fileWorkflow.fileOpening,
    focusMode,
    handlers: commandHandlers,
    language: settings.language,
    openRecentFile: (path) => {
      void startup.openRecentFile(path);
    },
    recentFiles: document.recentFiles,
    shortcuts,
    sidebarOpen,
    t,
    theme: settings.theme,
  });
  return {
    aboutOpen,
    commandPaletteOpen: commandPalette.open,
    commands: commandModels.commands,
    currentFile: document.currentFile,
    dismissFileError: document.dismissFileError,
    dirty: document.dirty,
    desktopOpenRequests,
    documentStatistics: document.documentStatistics,
    documentTitle,
    focusMode,
    editor: {
      appearance: readingAppearance.appearance, editorDisplayMode: editor.editorDisplayMode,
      getContextMenuItems: commandModels.getEditorContextMenuItems,
      focusEditor: editor.focusEditor,
      imageAssetResolver: editor.imageAssetResolver,
      imageImportErrorHandler: editor.imageImportErrorHandler,
      imageImportHandler: editor.imageImportHandler,
      markDocumentDirty: document.fileWorkflow.markDocumentDirty,
      onReady: onEditorReady,
      onZoomRequested: readingAppearance.onZoomRequested,
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
    mediaViewer,
    newDocumentConfirmOpen: newDocumentConfirmation.open,
    recentFiles: document.recentFiles,
    recentFilesPersistenceError: settings.recentFilesPersistenceError,
    preferencesPersistenceError: settings.preferencesPersistenceError,
    recoveryDraft: document.recoveryDraft,
    runAction: commandModels.runAction,
    runMenuInvocation: commandModels.runMenuInvocation,
    runCommandAfterPaletteClose: commandPalette.runAfterClose,
    restoreDialogFocus,
    restoreNewDocumentFocus: newDocumentConfirmation.restoreFocus,
    scheduleOutlineRefresh: document.scheduleOutlineRefresh,
    setCommandPaletteOpen: commandPalette.setOpen,
    setLanguage: settings.setLanguage,
    setPageWidth: readingAppearance.setPageWidth,
    setAboutOpen,
    setCopyImagesToAssets: settings.setCopyImagesToAssets,
    setNewDocumentConfirmOpen: newDocumentConfirmation.setOpen,
    setSettingsOpen: settings.setSettingsOpen,
    setSidebarOpen,
    setStartupBehavior: settings.setStartupBehavior,
    setTheme: settings.setTheme,
    settingsOpen: settings.settingsOpen,
    pageWidth: readingAppearance.pageWidth,
    pageWidthPersistenceError: readingAppearance.pageWidthPersistenceError,
    sidebarOpen,
    toggleFocusMode,
    confirmNewDocument: newDocumentConfirmation.confirmNewDocument,
    theme: settings.theme,
    updateDialog: updates,
    startup,
    startupBehavior: settings.startupBehavior,
    startupPersistenceError: settings.startupPersistenceError,
    topMenuGroups: commandModels.topMenuGroups,
    visibleDocumentTitle,
    windowControls,
    workspace,
  };
}
