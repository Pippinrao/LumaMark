import { useMemo } from 'react';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import type { EditorEditState } from '../../editor/commands/editorCommandPort';
import {
  createCommandPaletteModels,
  createTopMenuModels,
} from '../../features/commands/createCommandModels';
import {
  runCommandAction,
  runCommandMenuInvocation,
} from '../../features/commands/commandInvocation';
import type {
  CommandActionId,
  CommandHandlerMap,
  CommandMenuInvocation,
  CommandPayloadHandlerMap,
  CommandShortcutLabels,
} from '../../features/commands/commandTypes';
import type { AppLanguage } from '../../shared/i18n';
import type { ThemeMode } from '../stores/appPreferencesStore';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';
import { useGlobalCommandShortcuts } from './useGlobalCommandShortcuts';

type UseAppCommandModelsOptions = {
  editorDisplayMode: EditorDisplayMode;
  editorAvailable: boolean;
  editorState: EditorEditState;
  fileOpening: boolean;
  focusMode: boolean;
  handlers: CommandHandlerMap;
  language: AppLanguage;
  payloadHandlers: CommandPayloadHandlerMap;
  recentFiles: readonly { name: string; path: string }[];
  shortcuts: CommandShortcutLabels;
  sidebarOpen: boolean;
  t: (key: string) => string;
  theme: ThemeMode;
};

export function useAppCommandModels({
  editorDisplayMode,
  editorAvailable,
  editorState,
  fileOpening,
  focusMode,
  handlers,
  language,
  payloadHandlers,
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
        editorState,
        fileOpening,
        focusMode,
        shortcuts,
        t,
      }),
    [editorAvailable, editorState, fileOpening, focusMode, shortcuts, t],
  );
  const topMenuGroups = useMemo(
    () =>
      createTopMenuModels({
        editorDisplayMode,
        editorAvailable,
        editorState,
        fileOpening,
        focusMode,
        language,
        recentFiles,
        sidebarOpen,
        shortcuts,
        t,
        theme,
      }),
    [
      editorDisplayMode,
      editorAvailable,
      editorState,
      fileOpening,
      focusMode,
      language,
      recentFiles,
      shortcuts,
      sidebarOpen,
      t,
      theme,
    ],
  );
  const runAction = useMemo(
    () => (action: CommandActionId) => {
      runCommandAction(handlers, action);
    },
    [handlers],
  );
  const handlerMaps = useMemo(
    () => ({ actions: handlers, payloadActions: payloadHandlers }),
    [handlers, payloadHandlers],
  );
  const runMenuInvocation = useMemo(
    () => (invocation: CommandMenuInvocation) => {
      if (invocation.kind === 'rangeAction') {
        logMenuInteraction(
          `runMenuInvocation rangeAction=${invocation.action} from=${invocation.range.from} to=${invocation.range.to}`,
        );
      } else {
        logMenuInteraction(
          `runMenuInvocation ${invocation.kind}=${invocation.action}`,
        );
      }
      runCommandMenuInvocation(handlerMaps, invocation);
    },
    [handlerMaps],
  );

  useGlobalCommandShortcuts(handlers);

  return {
    commands,
    runAction,
    runMenuInvocation,
    topMenuGroups,
  };
}
