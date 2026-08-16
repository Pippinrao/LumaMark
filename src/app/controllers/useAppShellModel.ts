import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createCommandShortcutLabels } from '../../features/commands/commandShortcuts';
import { useMediaViewer } from '../../features/media-viewer/useMediaViewer';
import { useWorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { toAppShellModel } from './toAppShellModel';
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
  const newDocumentConfirmation = useNewDocumentConfirmation({
    createNewDocument: document.fileWorkflow.createNewDocument,
    dirty: document.dirty,
    focusEditor: editor.focusEditor,
    openFile: startup.openFile,
    openFileAfterDiscard: startup.openFileAfterDiscard,
    openRecentFile: startup.openRecentFile,
    openRecentFileAfterDiscard: startup.openRecentFileAfterDiscard,
    startupVisible: startup.visible,
  });
  const shortcuts = useMemo(
    () => createCommandShortcutLabels(globalThis.navigator.userAgent),
    [],
  );
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
    newDocument: startup.visible
      ? startup.newDocument
      : newDocumentConfirmation.requestNewDocument,
    openAbout,
    openCommandPalette,
    openFile: newDocumentConfirmation.requestOpenFile,
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
  const payloadHandlers = useAppCommandPayloadHandlers(
    editorContextMenu.payloadHandlers,
    fileTreeContextMenu.payloadHandlers,
    newDocumentConfirmation.requestOpenRecentFile,
    document.fileWorkflow.fileOpening,
  );
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
  function runPaletteInvocation(
    invocation: Parameters<typeof commandModels.runMenuInvocation>[0],
  ) {
    commandModels.runMenuInvocation(invocation);
  }

  return toAppShellModel({
    aboutOpen,
    commandModels,
    commandPalette,
    desktopOpenRequests,
    document,
    documentClose,
    editor,
    editorContextMenu,
    fileTreeContextMenu,
    focusMode,
    mediaViewer,
    navigation,
    newDocumentConfirmation,
    readingAppearance,
    refreshEditorEditState,
    restoreDialogFocus,
    setAboutOpen,
    setSidebarOpen,
    settings,
    sidebarOpen,
    startup,
    t,
    toggleFocusMode,
    updates,
    windowControls,
    workspace,
  });
}
