import { useEffect, useMemo } from 'react';
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

const markdownCommands: readonly MarkdownFormatCommand[] = [
  'bold',
  'codeBlock',
  'heading1',
  'heading2',
  'inlineCode',
  'italic',
  'link',
  'quote',
  'table',
  'taskList',
  'unorderedList',
];

type UseAppCommandModelsOptions = {
  copyTable: () => void;
  deleteTable: () => void;
  editorDisplayMode: EditorDisplayMode;
  fileOpening: boolean;
  focusEditor: () => void;
  openCommandPalette: () => void;
  openFile: () => void;
  openSettings: () => void;
  openWorkspace: () => void;
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
  toggleTheme: () => void;
};

export function useAppCommandModels({
  copyTable,
  deleteTable,
  editorDisplayMode,
  fileOpening,
  focusEditor,
  openCommandPalette,
  openFile,
  openSettings,
  openWorkspace,
  runFormat,
  save,
  saveAs,
  setLivePreviewMode,
  setSourceMode,
  shortcuts,
  t,
  toggleLanguage,
  toggleTheme,
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
      focusEditor,
      openCommandPalette,
      openFile,
      openSettings,
      openWorkspace,
      save,
      saveAs,
      setLivePreviewMode,
      setSourceMode,
      toggleLanguage,
      toggleTheme,
    };
  }, [
    copyTable,
    deleteTable,
    focusEditor,
    openCommandPalette,
    openFile,
    openSettings,
    openWorkspace,
    runFormat,
    save,
    saveAs,
    setLivePreviewMode,
    setSourceMode,
    toggleLanguage,
    toggleTheme,
  ]);

  const commands = useMemo(
    () =>
      createCommandPaletteModels({
        handlers,
        shortcuts,
        t,
      }),
    [handlers, shortcuts, t],
  );
  const topMenuGroups = useMemo(
    () =>
      createTopMenuModels({
        editorDisplayMode,
        fileOpening,
        shortcuts,
        t,
      }),
    [editorDisplayMode, fileOpening, shortcuts, t],
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        handlers.openCommandPalette();
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || !event.altKey) {
        return;
      }

      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        handlers.table();
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        handlers.copyTable();
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        handlers.deleteTable();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handlers]);

  return {
    commands,
    editorContextMenuItems,
    runAction,
    topMenuGroups,
  };
}
