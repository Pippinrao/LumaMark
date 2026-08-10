import { useMemo } from 'react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { CommandHandlerMap } from '../../features/commands/commandTypes';
import type { AppLanguage } from '../../shared/i18n';
import type { ThemeMode } from '../stores/appPreferencesStore';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';
import { guardEditorCommand } from './editorCommandGuard';

const markdownCommands: readonly MarkdownFormatCommand[] = [
  'bold',
  'codeBlock',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'horizontalRule',
  'image',
  'inlineCode',
  'italic',
  'link',
  'orderedList',
  'paragraph',
  'quote',
  'strikethrough',
  'table',
  'taskList',
  'unorderedList',
];

type UseAppCommandHandlersOptions = {
  copyTable: () => void;
  deleteTable: () => void;
  editorAvailable: boolean;
  exitFocusMode: () => void;
  focusEditor: () => void;
  insertImage: () => void;
  newDocument: () => void;
  openAbout: () => void;
  checkForUpdates: () => void;
  openCommandPalette: () => void;
  openFile: () => void;
  openSearch: () => void;
  openSettings: () => void;
  openWorkspace: () => void;
  redo: () => void;
  resetZoom: () => void;
  runFormat: (command: MarkdownFormatCommand) => void;
  save: () => void;
  saveAs: () => void;
  setLanguage: (language: AppLanguage) => void;
  setLivePreviewMode: () => void;
  setSourceMode: () => void;
  setTheme: (theme: ThemeMode) => void;
  toggleDisplayMode: () => void;
  toggleLanguage: () => void;
  toggleFocusMode: () => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
  undo: () => void;
};

export function useAppCommandHandlers({
  copyTable,
  deleteTable,
  editorAvailable,
  exitFocusMode,
  focusEditor,
  insertImage,
  newDocument,
  openAbout,
  checkForUpdates,
  openCommandPalette,
  openFile,
  openSearch,
  openSettings,
  openWorkspace,
  redo,
  resetZoom,
  runFormat,
  save,
  saveAs,
  setLanguage,
  setLivePreviewMode,
  setSourceMode,
  setTheme,
  toggleDisplayMode,
  toggleLanguage,
  toggleFocusMode,
  toggleSidebar,
  toggleTheme,
  undo,
}: UseAppCommandHandlersOptions): CommandHandlerMap {
  return useMemo(() => {
    const formatHandlers = Object.fromEntries(
      markdownCommands.map((command) => [
        command,
        guardEditorCommand(editorAvailable, () => {
          runFormat(command);
        }),
      ]),
    ) as Record<MarkdownFormatCommand, () => void>;

    return {
      ...formatHandlers,
      copyTable: guardEditorCommand(editorAvailable, copyTable),
      deleteTable: guardEditorCommand(editorAvailable, deleteTable),
      exitFocusMode: guardEditorCommand(editorAvailable, exitFocusMode),
      focusEditor: guardEditorCommand(editorAvailable, focusEditor),
      image: guardEditorCommand(editorAvailable, insertImage),
      newDocument,
      openAbout: () => {
        logMenuInteraction('handler openAbout()');
        openAbout();
      },
      checkForUpdates: () => {
        logMenuInteraction('handler checkForUpdates()');
        checkForUpdates();
      },
      openCommandPalette,
      openFile,
      openSearch: guardEditorCommand(editorAvailable, openSearch),
      openSettings,
      openWorkspace,
      redo: guardEditorCommand(editorAvailable, redo),
      resetZoom: guardEditorCommand(editorAvailable, resetZoom),
      save: guardEditorCommand(editorAvailable, save),
      saveAs: guardEditorCommand(editorAvailable, saveAs),
      setChineseLanguage: () => {
        logMenuInteraction('handler setLanguage(zh-CN)');
        setLanguage('zh-CN');
      },
      setDarkTheme: () => {
        logMenuInteraction('handler setTheme(dark)');
        setTheme('dark');
      },
      setEnglishLanguage: () => {
        logMenuInteraction('handler setLanguage(en)');
        setLanguage('en');
      },
      setLightTheme: () => {
        logMenuInteraction('handler setTheme(light)');
        setTheme('light');
      },
      setLivePreviewMode: guardEditorCommand(editorAvailable, setLivePreviewMode),
      setSourceMode: guardEditorCommand(editorAvailable, setSourceMode),
      toggleDisplayMode: guardEditorCommand(editorAvailable, toggleDisplayMode),
      toggleLanguage,
      toggleFocusMode: guardEditorCommand(editorAvailable, toggleFocusMode),
      toggleSidebar,
      toggleTheme,
      undo: guardEditorCommand(editorAvailable, undo),
    };
  }, [
    copyTable,
    deleteTable,
    editorAvailable,
    exitFocusMode,
    focusEditor,
    insertImage,
    newDocument,
    openAbout,
    checkForUpdates,
    openCommandPalette,
    openFile,
    openSearch,
    openSettings,
    openWorkspace,
    redo,
    resetZoom,
    runFormat,
    save,
    saveAs,
    setLanguage,
    setLivePreviewMode,
    setSourceMode,
    setTheme,
    toggleDisplayMode,
    toggleLanguage,
    toggleFocusMode,
    toggleSidebar,
    toggleTheme,
    undo,
  ]);
}
