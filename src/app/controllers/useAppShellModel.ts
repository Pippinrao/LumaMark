import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createCommandShortcutLabels } from '../../features/commands/commandShortcuts';
import { useMediaViewer } from '../../features/media-viewer/useMediaViewer';
import { useWorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { createAppShellLabels } from './createAppShellLabels';
import { useAppCommandModels } from './useAppCommandModels';
import { useAppCommandPayloadHandlers } from './useAppCommandPayloadHandlers';
import { useAppDocumentModel } from './useAppDocumentModel';
import { useAppEditorCommands } from './useAppEditorCommands';
import { useCommandPaletteModel } from './useCommandPaletteModel';
import { useEditorContextMenu } from './useEditorContextMenu';
import { useFileTreeContextMenu } from './useFileTreeContextMenu';
import { useFocusMode } from './useFocusMode';
import { useMenuDialogFocus } from './useMenuDialogFocus';
import { useNewDocumentConfirmation } from './useNewDocumentConfirmation';
import { useReadingAppearanceModel } from './useReadingAppearanceModel';
import { useSettingsModel } from './useSettingsModel';
import { useAppWindowControls } from './useAppWindowControls';
import { useStartupExperience } from './useStartupExperience';
import { useDesktopOpenRequests } from './useDesktopOpenRequests';
import { useUpdateModel } from './useUpdateModel';
import { useAppShellCommandHandlers } from './useAppShellCommandHandlers';
import { useAppEditorNavigation } from './useAppEditorNavigation';
import { useDocumentCloseController } from '../../features/file-actions/useDocumentCloseController';
import { useStartupStore } from '../../features/startup/startupStore';
import { useAppStore } from '../stores/appStore';
export function useAppShellModel() {
  const { t } = useTranslation();
  const [aboutOpen, setAboutOpen] = useState(false);
  const updates = useUpdateModel();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const commandPalette = useCommandPaletteModel(runPaletteInvocation);
  const openPalette = commandPalette.openPalette;
  const editor = useAppEditorCommands();
  const [editorEditState, setEditorEditState] = useState(() =>
    editor.getEditState(),
  );
  const refreshEditorEditState = useCallback(() => {
    setEditorEditState(editor.getEditState());
  }, [editor]);
  const openCommandPalette = useCallback(() => {
    refreshEditorEditState();
    openPalette();
  }, [openPalette, refreshEditorEditState]);
  const mediaViewer = useMediaViewer(editor.focusEditor);
  const settings = useSettingsModel();
  const setEditorDisplayMode = editor.setDisplayMode;
  const applyDefaultDisplayMode = useCallback(() => {
    setEditorDisplayMode(settings.defaultDisplayMode);
  }, [setEditorDisplayMode, settings.defaultDisplayMode]);
  const document = useAppDocumentModel(
    editor.documentPortRef,
    editor.editorReady,
    editor.refreshLocalImage,
    applyDefaultDisplayMode,
  );
  const navigation = useAppEditorNavigation(document, editor);
  const readingAppearance = useReadingAppearanceModel(editor.focusEditor);
  const { openAbout, openSettings, restoreDialogFocus } = useMenuDialogFocus({
    setAboutOpen,
    setSettingsOpen: settings.setSettingsOpen,
  });
  const documentClose = useDocumentCloseController({
    currentFilePath: document.currentFile?.path ?? null,
    flushAutosave: document.autosave.flush,
    getSession: () => {
      const state = useAppStore.getState();
      return {
        dirty: state.dirty,
        hasPersistedPath: state.currentFile !== null,
        revision: state.dirtyRevision,
      };
    },
    readDocumentText: () => editor.documentPortRef.current?.getText() ?? '',
    save: document.fileWorkflow.save,
  });
  const windowControls = useAppWindowControls(
    settings.flushPendingWrites,
    settings.setSettingsOpen,
    undefined,
    documentClose.prepareClose,
  );
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
    openPathAfterDiscard: document.fileWorkflow.openPathAfterDiscard,
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
  const { exitFocusMode, focusMode, toggleFocusMode } = useFocusMode({
    focusEditor: editor.focusEditor,
    initialFocusMode: settings.focusModeOnStartup,
    setSidebarOpen,
    sidebarOpen,
  });
  const commandHandlers = useAppShellCommandHandlers({
    document,
    editor,
    editorAvailable: !startup.visible,
    exitFocusMode,
    fileOpening: document.fileWorkflow.fileOpening,
    newDocument: startup.visible ? startup.newDocument : newDocumentConfirmation.requestNewDocument,
    openAbout,
    openCommandPalette,
    openSettings,
    readingAppearance,
    settings,
    startup,
    toggleFocusMode,
    toggleSidebar,
    updates,
  });
  const editorContextMenu = useEditorContextMenu({
    editorAvailable: !startup.visible,
    getEditState: editor.getEditState,
    navigateLinkHref: navigation.navigateLinkHref,
    shortcuts,
  });
  const fileTreeContextMenu = useFileTreeContextMenu({
    markOpenDocumentRemoved: document.fileWorkflow.markOpenDocumentRemoved,
    retargetOpenDocument: document.fileWorkflow.retargetOpenDocument,
    workspace,
  });
  const payloadHandlers = useAppCommandPayloadHandlers(editorContextMenu.payloadHandlers, fileTreeContextMenu.payloadHandlers, startup.openRecentFile, document.fileWorkflow.fileOpening);
  const commandModels = useAppCommandModels({
    editorDisplayMode: editor.editorDisplayMode,
    editorAvailable: !startup.visible,
    editorState: editorEditState,
    fileOpening: document.fileWorkflow.fileOpening,
    focusMode,
    handlers: commandHandlers,
    language: settings.language,
    payloadHandlers,
    recentFiles: document.recentFiles,
    shortcuts,
    sidebarOpen,
    t,
    theme: settings.theme,
  });
  function runPaletteInvocation(invocation: Parameters<typeof commandModels.runMenuInvocation>[0]) { commandModels.runMenuInvocation(invocation); }
  return {
    ...settings,
    aboutOpen,
    commandPaletteOpen: commandPalette.open,
    commands: commandModels.commands,
    confirmNewDocument: newDocumentConfirmation.confirmNewDocument,
    currentFile: document.currentFile,
    desktopOpenRequests,
    dismissFileError: document.dismissFileError,
    dirty: document.dirty,
    documentClose,
    documentStatistics: document.documentStatistics,
    documentTitle,
    editor: {
      appearance: readingAppearance.appearance,
      closeContextMenu: editor.closeContextMenu,
      editorDisplayMode: editor.editorDisplayMode,
      focusEditor: editor.focusEditor,
      getContextMenuNodes: editorContextMenu.getContextMenuNodes,
      imageAssetResolver: editor.imageAssetResolver,
      imageImportErrorHandler: editor.imageImportErrorHandler,
      imageImportHandler: editor.imageImportHandler,
      markDocumentDirty: document.fileWorkflow.markDocumentDirty,
      onLinkNavigationRequest: navigation.onLinkNavigationRequest,
      onReady: navigation.onEditorReady,
      onZoomRequested: readingAppearance.onZoomRequested,
      prepareContextMenu: editor.prepareContextMenu,
      selectHeading: navigation.selectHeading,
    },
    externalFileConflict: {
      conflict: document.fileWorkflow.externalConflict,
      keepCurrentContent: document.fileWorkflow.keepCurrentContent,
      reloadFromDisk: document.fileWorkflow.reloadFromDisk,
    },
    fileTree: {
      getContextMenuNodes: fileTreeContextMenu.getContextMenuNodes,
      mutationDialog: fileTreeContextMenu.mutationDialog,
    },
    focusMode,
    headings: document.headings,
    labels: createAppShellLabels({
      documentStatistics: document.documentStatistics.statistics,
      statusKey: document.statusKey,
      t,
    }),
    lastFileError: document.lastFileError,
    loadUnsavedSnapshot: document.loadUnsavedSnapshot,
    mediaViewer,
    newDocumentConfirmOpen: newDocumentConfirmation.open,
    pageWidth: settings.pageWidth ?? readingAppearance.pageWidth,
    recentFiles: document.recentFiles,
    recoveryDraft: document.recoveryDraft,
    restoreDialogFocus,
    restoreNewDocumentFocus: newDocumentConfirmation.restoreFocus,
    refreshEditorEditState,
    runAction: commandModels.runAction,
    runCommandAfterPaletteClose: commandPalette.runAfterClose,
    runMenuInvocation: commandModels.runMenuInvocation,
    scheduleOutlineRefresh: document.scheduleOutlineRefresh,
    setAboutOpen,
    setCommandPaletteOpen: commandPalette.setOpen,
    setNewDocumentConfirmOpen: newDocumentConfirmation.setOpen,
    setSidebarOpen,
    sidebarOpen,
    updateDialog: updates,
    startup,
    toggleFocusMode,
    topMenuGroups: commandModels.topMenuGroups,
    visibleDocumentTitle,
    windowControls,
    workspace,
  };
}
