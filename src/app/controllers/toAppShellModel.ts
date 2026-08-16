import type { TFunction } from 'i18next';
import type { useDocumentCloseController } from '../../features/file-actions/useDocumentCloseController';
import type { useMediaViewer } from '../../features/media-viewer/useMediaViewer';
import type { useWorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { createAppShellLabels } from './createAppShellLabels';
import type { useAppCommandModels } from './useAppCommandModels';
import type { useAppDocumentModel } from './useAppDocumentModel';
import type { useAppEditorCommands } from './useAppEditorCommands';
import type { useAppEditorNavigation } from './useAppEditorNavigation';
import type { useAppWindowControls } from './useAppWindowControls';
import type { useCommandPaletteModel } from './useCommandPaletteModel';
import type { useDesktopOpenRequests } from './useDesktopOpenRequests';
import type { useEditorContextMenu } from './useEditorContextMenu';
import type { useFileTreeContextMenu } from './useFileTreeContextMenu';
import type { useFocusMode } from './useFocusMode';
import type { useNewDocumentConfirmation } from './useNewDocumentConfirmation';
import type { useReadingAppearanceModel } from './useReadingAppearanceModel';
import type { useSettingsModel } from './useSettingsModel';
import type { useStartupExperience } from './useStartupExperience';
import type { useUpdateModel } from './useUpdateModel';

type AppShellModelParts = {
  aboutOpen: boolean;
  commandModels: ReturnType<typeof useAppCommandModels>;
  commandPalette: ReturnType<typeof useCommandPaletteModel>;
  desktopOpenRequests: ReturnType<typeof useDesktopOpenRequests>;
  document: ReturnType<typeof useAppDocumentModel>;
  documentClose: ReturnType<typeof useDocumentCloseController>;
  editor: ReturnType<typeof useAppEditorCommands>;
  editorContextMenu: ReturnType<typeof useEditorContextMenu>;
  fileTreeContextMenu: ReturnType<typeof useFileTreeContextMenu>;
  focusMode: ReturnType<typeof useFocusMode>['focusMode'];
  mediaViewer: ReturnType<typeof useMediaViewer>;
  navigation: ReturnType<typeof useAppEditorNavigation>;
  newDocumentConfirmation: ReturnType<typeof useNewDocumentConfirmation>;
  readingAppearance: ReturnType<typeof useReadingAppearanceModel>;
  refreshEditorEditState: () => void;
  restoreDialogFocus: () => void;
  setAboutOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  settings: ReturnType<typeof useSettingsModel>;
  sidebarOpen: boolean;
  startup: ReturnType<typeof useStartupExperience>;
  t: TFunction;
  toggleFocusMode: () => void;
  updates: ReturnType<typeof useUpdateModel>;
  windowControls: ReturnType<typeof useAppWindowControls>;
  workspace: ReturnType<typeof useWorkspaceWorkflow>;
};

export function toAppShellModel({
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
}: AppShellModelParts) {
  const documentTitle = document.currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = document.dirty
    ? `${documentTitle} *`
    : documentTitle;

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
    requestUnsavedAction: newDocumentConfirmation.requestAction,
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
