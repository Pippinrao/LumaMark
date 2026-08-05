import { useCallback, useMemo } from 'react';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import {
  createCommandPaletteModels,
  createEditorContextMenuModels,
  createTopMenuModels,
  runCommandAction,
} from '../../features/commands/createCommandModels';
import type {
  CommandActionId,
  CommandHandlerMap,
  CommandMenuInvocation,
  CommandShortcutLabels,
} from '../../features/commands/commandTypes';
import type { AppLanguage } from '../../shared/i18n';
import type { ThemeMode } from '../stores/appPreferencesStore';
import { useGlobalCommandShortcuts } from './useGlobalCommandShortcuts';

type UseAppCommandModelsOptions = {
  editorDisplayMode: EditorDisplayMode;
  editorAvailable: boolean;
  fileOpening: boolean;
  focusMode: boolean;
  handlers: CommandHandlerMap;
  language: AppLanguage;
  openRecentFile: (path: string) => void;
  recentFiles: readonly { name: string; path: string }[];
  shortcuts: CommandShortcutLabels;
  sidebarOpen: boolean;
  t: (key: string) => string;
  theme: ThemeMode;
};

export function useAppCommandModels({
  editorDisplayMode,
  editorAvailable,
  fileOpening,
  focusMode,
  handlers,
  language,
  openRecentFile,
  recentFiles,
  shortcuts,
  sidebarOpen,
  t,
  theme,
}: UseAppCommandModelsOptions) {
  const commands = useMemo(
    () =>
      createCommandPaletteModels({
        editorAvailable,
        fileOpening,
        focusMode,
        handlers,
        shortcuts,
        t,
      }),
    [editorAvailable, fileOpening, focusMode, handlers, shortcuts, t],
  );
  const topMenuGroups = useMemo(
    () =>
      createTopMenuModels({
        editorDisplayMode,
        editorAvailable,
        fileOpening,
        focusMode,
        language,
        openRecentFile,
        recentFiles,
        sidebarOpen,
        shortcuts,
        t,
        theme,
      }),
    [
      editorDisplayMode,
      editorAvailable,
      fileOpening,
      focusMode,
      language,
      openRecentFile,
      recentFiles,
      shortcuts,
      sidebarOpen,
      t,
      theme,
    ],
  );
  const getEditorContextMenuItems = useCallback(
    (tableContext: boolean) =>
      createEditorContextMenuModels({
        shortcuts,
        tableContext,
        t,
      }),
    [shortcuts, t],
  );
  const runAction = useMemo(
    () => (action: CommandActionId) => {
      runCommandAction(handlers, action);
    },
    [handlers],
  );
  const runMenuInvocation = useMemo(
    () => (invocation: CommandMenuInvocation) => {
      if (invocation.kind === 'callback') {
        invocation.run();
        return;
      }

      runCommandAction(handlers, invocation.action);
    },
    [handlers],
  );

  useGlobalCommandShortcuts(handlers);

  return {
    commands,
    getEditorContextMenuItems,
    runAction,
    runMenuInvocation,
    topMenuGroups,
  };
}
