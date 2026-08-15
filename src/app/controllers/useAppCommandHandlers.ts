import { useMemo } from 'react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { EditorEditState } from '../../editor/commands/editorCommandPort';
import type { EditorInteractionRange } from '../../editor/interaction';
import { isCommandActionDisabled } from '../../features/commands/commandAvailability';
import type {
  CommandActionId,
  CommandHandlerMap,
} from '../../features/commands/commandTypes';
import type { AppLanguage } from '../../shared/i18n';
import type { ThemeMode } from '../stores/appPreferencesStore';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';

type UseAppCommandHandlersOptions = {
  copy: () => Promise<boolean>;
  copyTable: (range?: EditorInteractionRange) => Promise<boolean>;
  cut: () => Promise<boolean>;
  deleteImageReference: (range?: EditorInteractionRange) => void;
  deleteTable: (range?: EditorInteractionRange) => boolean;
  editorAvailable: boolean;
  exitFocusMode: () => void;
  fileOpening: boolean;
  focusEditor: () => void;
  getEditState: () => EditorEditState;
  insertImage: () => void;
  newDocument: () => void;
  openAbout: () => void;
  checkForUpdates: () => void;
  openCommandPalette: () => void;
  openFile: () => void;
  openSearch: () => void;
  openSettings: () => void;
  openWorkspace: () => void;
  paste: () => Promise<boolean>;
  redo: () => void;
  resetZoom: () => void;
  runFormat: (command: MarkdownFormatCommand) => void;
  save: () => void;
  saveAs: () => void;
  selectAll: () => boolean;
  setLanguage: (language: AppLanguage) => void;
  setLivePreviewMode: () => void;
  setReadingMode: () => void;
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
  copy,
  copyTable,
  cut,
  deleteImageReference,
  deleteTable,
  editorAvailable,
  exitFocusMode,
  fileOpening,
  focusEditor,
  getEditState,
  insertImage,
  newDocument,
  openAbout,
  checkForUpdates,
  openCommandPalette,
  openFile,
  openSearch,
  openSettings,
  openWorkspace,
  paste,
  redo,
  resetZoom,
  runFormat,
  save,
  saveAs,
  selectAll,
  setLanguage,
  setLivePreviewMode,
  setReadingMode,
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
    const guardAction = <TArgs extends unknown[]>(
      action: CommandActionId,
      command: (...args: TArgs) => void,
    ) =>
      (...args: TArgs) => {
        if (
          !isCommandActionDisabled(action, {
            editorAvailable,
            editorState: getEditState(),
            fileOpening,
          })
        ) {
          command(...args);
        }
      };
    const formatHandler = (command: MarkdownFormatCommand) =>
      guardAction(command, () => runFormat(command));
    const formatHandlers = {
      bold: formatHandler('bold'),
      codeBlock: formatHandler('codeBlock'),
      heading1: formatHandler('heading1'),
      heading2: formatHandler('heading2'),
      heading3: formatHandler('heading3'),
      heading4: formatHandler('heading4'),
      heading5: formatHandler('heading5'),
      heading6: formatHandler('heading6'),
      horizontalRule: formatHandler('horizontalRule'),
      image: guardAction('image', insertImage),
      inlineCode: formatHandler('inlineCode'),
      italic: formatHandler('italic'),
      link: formatHandler('link'),
      orderedList: formatHandler('orderedList'),
      paragraph: formatHandler('paragraph'),
      quote: formatHandler('quote'),
      strikethrough: formatHandler('strikethrough'),
      table: formatHandler('table'),
      taskList: formatHandler('taskList'),
      unorderedList: formatHandler('unorderedList'),
    } satisfies Record<MarkdownFormatCommand, () => void>;

    return {
      ...formatHandlers,
      copy: guardAction('copy', () => {
        void copy();
      }),
      copyTable: guardAction('copyTable', (range?: EditorInteractionRange) => {
        void copyTable(range);
      }),
      cut: guardAction('cut', () => {
        void cut();
      }),
      deleteImageReference: guardAction(
        'deleteImageReference',
        deleteImageReference,
      ),
      deleteTable: guardAction('deleteTable', deleteTable),
      exitFocusMode: guardAction('exitFocusMode', exitFocusMode),
      focusEditor: guardAction('focusEditor', focusEditor),
      newDocument: guardAction('newDocument', newDocument),
      openAbout: guardAction('openAbout', () => {
        logMenuInteraction('handler openAbout()');
        openAbout();
      }),
      checkForUpdates: guardAction('checkForUpdates', () => {
        logMenuInteraction('handler checkForUpdates()');
        checkForUpdates();
      }),
      openCommandPalette: guardAction('openCommandPalette', openCommandPalette),
      openFile: guardAction('openFile', openFile),
      openSearch: guardAction('openSearch', openSearch),
      openSettings: guardAction('openSettings', openSettings),
      openWorkspace: guardAction('openWorkspace', openWorkspace),
      paste: guardAction('paste', () => {
        void paste();
      }),
      redo: guardAction('redo', redo),
      resetZoom: guardAction('resetZoom', resetZoom),
      save: guardAction('save', save),
      saveAs: guardAction('saveAs', saveAs),
      selectAll: guardAction('selectAll', selectAll),
      setChineseLanguage: guardAction('setChineseLanguage', () => {
        logMenuInteraction('handler setLanguage(zh-CN)');
        setLanguage('zh-CN');
      }),
      setDarkTheme: guardAction('setDarkTheme', () => {
        logMenuInteraction('handler setTheme(dark)');
        setTheme('dark');
      }),
      setEnglishLanguage: guardAction('setEnglishLanguage', () => {
        logMenuInteraction('handler setLanguage(en)');
        setLanguage('en');
      }),
      setLightTheme: guardAction('setLightTheme', () => {
        logMenuInteraction('handler setTheme(light)');
        setTheme('light');
      }),
      setSystemTheme: guardAction('setSystemTheme', () => {
        logMenuInteraction('handler setTheme(system)');
        setTheme('system');
      }),
      setLivePreviewMode: guardAction('setLivePreviewMode', setLivePreviewMode),
      setReadingMode: guardAction('setReadingMode', setReadingMode),
      setSourceMode: guardAction('setSourceMode', setSourceMode),
      toggleDisplayMode: guardAction('toggleDisplayMode', toggleDisplayMode),
      toggleLanguage: guardAction('toggleLanguage', toggleLanguage),
      toggleFocusMode: guardAction('toggleFocusMode', toggleFocusMode),
      toggleSidebar: guardAction('toggleSidebar', toggleSidebar),
      toggleTheme: guardAction('toggleTheme', toggleTheme),
      undo: guardAction('undo', undo),
    };
  }, [
    copy,
    copyTable,
    cut,
    deleteImageReference,
    deleteTable,
    editorAvailable,
    exitFocusMode,
    fileOpening,
    focusEditor,
    getEditState,
    insertImage,
    newDocument,
    openAbout,
    checkForUpdates,
    openCommandPalette,
    openFile,
    openSearch,
    openSettings,
    openWorkspace,
    paste,
    redo,
    resetZoom,
    runFormat,
    save,
    saveAs,
    selectAll,
    setLanguage,
    setLivePreviewMode,
    setReadingMode,
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
