import { useMemo } from 'react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import {
  createCommandPaletteModels,
  createEditorContextMenuModels,
  createTopMenuModels,
  runCommandAction,
} from '../../features/commands/createCommandModels';
import type {
  CommandActionId,
  CommandHandlerMap,
} from '../../features/commands/commandTypes';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import { useGlobalCommandShortcuts } from './useGlobalCommandShortcuts';

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
  'quote',
  'strikethrough',
  'table',
  'taskList',
  'unorderedList',
];

type UseAppCommandModelsOptions = {
  copyTable: () => void;
  deleteTable: () => void;
  editorDisplayMode: EditorDisplayMode;
  exitFocusMode: () => void;
  focusMode: boolean;
  fileOpening: boolean;
  focusEditor: () => void;
  newDocument: () => void;
  openCommandPalette: () => void;
  openFile: () => void;
  openSearch: () => void;
  openSettings: () => void;
  openWorkspace: () => void;
  redo: () => void;
  runFormat: (command: MarkdownFormatCommand) => void;
  save: () => void;
  saveAs: () => void;
  setLivePreviewMode: () => void;
  setSourceMode: () => void;
  shortcuts: {
    copy: string;
    delete: string;
    insert: string;
  };
  t: (key: string) => string;
  toggleLanguage: () => void;
  toggleFocusMode: () => void;
  toggleSidebar: () => void;
  toggleTheme: () => void;
  undo: () => void;
};

export function useAppCommandModels({
  copyTable,
  deleteTable,
  editorDisplayMode,
  exitFocusMode,
  focusMode,
  fileOpening,
  focusEditor,
  newDocument,
  openCommandPalette,
  openFile,
  openSearch,
  openSettings,
  openWorkspace,
  redo,
  runFormat,
  save,
  saveAs,
  setLivePreviewMode,
  setSourceMode,
  shortcuts,
  t,
  toggleLanguage,
  toggleFocusMode,
  toggleSidebar,
  toggleTheme,
  undo,
}: UseAppCommandModelsOptions) {
  const handlers = useMemo<CommandHandlerMap>(() => {
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
      newDocument,
      openCommandPalette,
      openFile,
      openSearch,
      openSettings,
      openWorkspace,
      redo,
      save,
      saveAs,
      setLivePreviewMode,
      setSourceMode,
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
    newDocument,
    openCommandPalette,
    openFile,
    openSearch,
    openSettings,
    openWorkspace,
    redo,
    runFormat,
    save,
    saveAs,
    setLivePreviewMode,
    setSourceMode,
    toggleLanguage,
    toggleFocusMode,
    toggleSidebar,
    toggleTheme,
    undo,
  ]);

  const commands = useMemo(
    () =>
      createCommandPaletteModels({
        fileOpening,
        focusMode,
        handlers,
        shortcuts,
        t,
      }),
    [fileOpening, focusMode, handlers, shortcuts, t],
  );
  const topMenuGroups = useMemo(
    () =>
      createTopMenuModels({
        editorDisplayMode,
        fileOpening,
        focusMode,
        shortcuts,
        t,
      }),
    [editorDisplayMode, fileOpening, focusMode, shortcuts, t],
  );
  const editorContextMenuItems = useMemo(
    () =>
      createEditorContextMenuModels({
        shortcuts,
        t,
      }),
    [shortcuts, t],
  );
  const runAction = useMemo(
    () => (action: CommandActionId | string) => {
      runCommandAction(handlers, action as CommandActionId);
    },
    [handlers],
  );

  useGlobalCommandShortcuts(handlers);

  return {
    commands,
    editorContextMenuItems,
    runAction,
    topMenuGroups,
  };
}
