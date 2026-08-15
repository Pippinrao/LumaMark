import type { useAppDocumentModel } from './useAppDocumentModel';
import type { useAppEditorCommands } from './useAppEditorCommands';
import { useAppCommandHandlers } from './useAppCommandHandlers';
import type { useReadingAppearanceModel } from './useReadingAppearanceModel';
import type { useSettingsModel } from './useSettingsModel';
import type { useStartupExperience } from './useStartupExperience';
import type { useUpdateModel } from './useUpdateModel';

type UseAppShellCommandHandlersOptions = {
  document: Pick<ReturnType<typeof useAppDocumentModel>, 'fileWorkflow'>;
  editor: Pick<
    ReturnType<typeof useAppEditorCommands>,
    | 'copy'
    | 'copyTable'
    | 'cut'
    | 'deleteImageReference'
    | 'deleteTable'
    | 'focusEditor'
    | 'getEditState'
    | 'insertLocalImages'
    | 'openSearch'
    | 'paste'
    | 'redo'
    | 'runFormat'
    | 'selectAll'
    | 'setDisplayMode'
    | 'toggleDisplayMode'
    | 'undo'
  >;
  editorAvailable: boolean;
  exitFocusMode: () => void;
  fileOpening: boolean;
  newDocument: () => void;
  openAbout: () => void;
  openCommandPalette: () => void;
  openSettings: () => void;
  readingAppearance: Pick<
    ReturnType<typeof useReadingAppearanceModel>,
    'resetZoom'
  >;
  settings: Pick<
    ReturnType<typeof useSettingsModel>,
    | 'setLanguage'
    | 'setTheme'
    | 'toggleLanguage'
    | 'toggleTheme'
  >;
  startup: Pick<
    ReturnType<typeof useStartupExperience>,
    'openFile' | 'openWorkspace'
  >;
  toggleFocusMode: () => void;
  toggleSidebar: () => void;
  updates: Pick<ReturnType<typeof useUpdateModel>, 'checkForUpdatesManually'>;
};

export function useAppShellCommandHandlers({
  document,
  editor,
  editorAvailable,
  exitFocusMode,
  fileOpening,
  newDocument,
  openAbout,
  openCommandPalette,
  openSettings,
  readingAppearance,
  settings,
  startup,
  toggleFocusMode,
  toggleSidebar,
  updates,
}: UseAppShellCommandHandlersOptions) {
  return useAppCommandHandlers({
    copy: editor.copy,
    copyTable: editor.copyTable,
    cut: editor.cut,
    deleteImageReference: editor.deleteImageReference,
    deleteTable: editor.deleteTable,
    editorAvailable,
    exitFocusMode,
    fileOpening,
    focusEditor: editor.focusEditor,
    getEditState: editor.getEditState,
    insertImage: () => {
      void editor.insertLocalImages();
    },
    newDocument,
    openAbout,
    checkForUpdates: updates.checkForUpdatesManually,
    openCommandPalette,
    openFile: () => {
      void startup.openFile();
    },
    openSearch: editor.openSearch,
    openSettings,
    openWorkspace: () => {
      void startup.openWorkspace();
    },
    paste: editor.paste,
    redo: editor.redo,
    resetZoom: readingAppearance.resetZoom,
    runFormat: editor.runFormat,
    save: () => {
      void document.fileWorkflow.save();
    },
    saveAs: () => {
      void document.fileWorkflow.saveAs();
    },
    selectAll: editor.selectAll,
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
}
