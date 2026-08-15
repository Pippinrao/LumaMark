import { useMemo } from 'react';
import { isCommandActionDisabled } from '../../features/commands/commandAvailability';
import type { CommandPayloadHandlerMap } from '../../features/commands/commandTypes';
import type { EditorContextPayloadHandlers } from './useEditorContextMenu';
import type { FileTreeContextPayloadHandlers } from './useFileTreeContextMenu';

export function useAppCommandPayloadHandlers(
  editor: EditorContextPayloadHandlers,
  fileTree: FileTreeContextPayloadHandlers,
  openRecentFile: (path: string) => void | Promise<unknown>,
  fileOpening: boolean,
): CommandPayloadHandlerMap {
  return useMemo(
    () => ({
      ...editor,
      ...fileTree,
      openRecentFile: ({ path }) => {
        if (!isCommandActionDisabled('openRecentFile', { fileOpening })) {
          void openRecentFile(path);
        }
      },
    }),
    [editor, fileOpening, fileTree, openRecentFile],
  );
}
