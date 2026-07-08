import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorApi } from '../../editor/core/editorApi';
import { useWorkspaceWorkflow } from '../../features/workspace/useWorkspaceWorkflow';
import { useAppCommandModels } from './useAppCommandModels';
import { useAppDocumentModel } from './useAppDocumentModel';
import { useAppEditorCommands } from './useAppEditorCommands';
import { useSettingsModel } from './useSettingsModel';
import { useWindowControlsModel } from './useWindowControlsModel';

export function useAppShellModel() {
  const { t } = useTranslation();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const editor = useAppEditorCommands();
  const document = useAppDocumentModel(editor.documentPortRef);
  const settings = useSettingsModel();
  const windowControls = useWindowControlsModel();
  const workspace = useWorkspaceWorkflow({
    openDocumentPath: document.fileWorkflow.openPath,
    status: document.status,
  });
  const documentTitle = document.currentFile?.name ?? t('app.emptyTitle');
  const visibleDocumentTitle = document.dirty
    ? `${documentTitle} *`
    : documentTitle;
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
  const openSettings = useCallback(() => {
    settings.setSettingsOpen(true);
  }, [settings]);
  const commandModels = useAppCommandModels({
    copyTable: editor.copyTable,
    deleteTable: editor.deleteTable,
    editorDisplayMode: editor.editorDisplayMode,
    fileOpening: document.fileWorkflow.fileOpening,
    focusEditor: editor.focusEditor,
    openCommandPalette: () => {
      setCommandPaletteOpen(true);
    },
    openFile: () => {
      void document.fileWorkflow.openFromDialog();
    },
    openSettings,
    openWorkspace: () => {
      void workspace.openWorkspace();
    },
    runFormat: editor.runFormat,
    save: () => {
      void document.fileWorkflow.save();
    },
    saveAs: () => {
      void document.fileWorkflow.saveAs();
    },
    setLivePreviewMode: () => {
      editor.setDisplayMode('livePreview');
    },
    setSourceMode: () => {
      editor.setDisplayMode('source');
    },
    shortcuts,
    t,
    toggleLanguage: settings.toggleLanguage,
    toggleTheme: settings.toggleTheme,
  });

  return {
    commandPaletteOpen,
    commands: commandModels.commands,
    currentFile: document.currentFile,
    dirty: document.dirty,
    documentTitle,
    editor: {
      contextMenuItems: commandModels.editorContextMenuItems,
      markDocumentDirty: document.fileWorkflow.markDocumentDirty,
      onReady: onEditorReady,
      selectHeading: (heading: { from: number }) => {
        editor.selectPosition(heading.from);
      },
    },
    headings: document.headings,
    labels: {
      editor: t('app.editorLabel'),
      sidebar: {
        files: t('sidebar.files'),
        outline: t('outline.title'),
        sidebar: t('app.sidebarLabel'),
      },
      status: {
        dirtyIndicator: t('status.dirtyIndicator'),
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
    runAction: commandModels.runAction,
    scheduleOutlineRefresh: document.scheduleOutlineRefresh,
    setCommandPaletteOpen,
    setLanguage: settings.setLanguage,
    setSettingsOpen: settings.setSettingsOpen,
    setTheme: settings.setTheme,
    settingsOpen: settings.settingsOpen,
    theme: settings.theme,
    topMenuGroups: commandModels.topMenuGroups,
    visibleDocumentTitle,
    windowControls,
    workspace,
  };
}
