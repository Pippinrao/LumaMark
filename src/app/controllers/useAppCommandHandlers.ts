import { useMemo } from 'react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { CommandHandlerMap } from '../../features/commands/commandTypes';
import type { AppLanguage } from '../../shared/i18n';
import type { ThemeMode } from '../stores/appStore';

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
  exitFocusMode: () => void;
  focusEditor: () => void;
  insertImage: () => void;
  newDocument: () => void;
  openAbout: () => void;
  openCommandPalette: () => void;
  openFile: () => void;
  openSearch: () => void;
  openSettings: () => void;
  openWorkspace: () => void;
  redo: () => void;
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
  exitFocusMode,
  focusEditor,
  insertImage,
  newDocument,
  openAbout,
  openCommandPalette,
  openFile,
  openSearch,
  openSettings,
  openWorkspace,
  redo,
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
        () => {
          runFormat(command);
        },
      ]),
    ) as Record<MarkdownFormatCommand, () => void>;

    return {
      ...formatHandlers,
      copyTable,
      deleteTable,
      exitFocusMode,
      focusEditor,
      image: insertImage,
      newDocument,
      openAbout,
      openCommandPalette,
      openFile,
      openSearch,
      openSettings,
      openWorkspace,
      redo,
      save,
      saveAs,
      setChineseLanguage: () => setLanguage('zh-CN'),
      setDarkTheme: () => setTheme('dark'),
      setEnglishLanguage: () => setLanguage('en'),
      setLightTheme: () => setTheme('light'),
      setLivePreviewMode,
      setSourceMode,
      toggleDisplayMode,
      toggleLanguage,
      toggleFocusMode,
      toggleSidebar,
      toggleTheme,
      undo,
    };
  }, [
    copyTable,
    deleteTable,
    exitFocusMode,
    focusEditor,
    insertImage,
    newDocument,
    openAbout,
    openCommandPalette,
    openFile,
    openSearch,
    openSettings,
    openWorkspace,
    redo,
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
