import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveImageFilesystemPath } from '../../editor/capabilities/image/imagePathResolver';
import type { EditorEditState } from '../../editor/commands/editorCommandPort';
import type { EditorContextTarget } from '../../editor/interaction';
import { createEditorContextMenuModels } from '../../features/commands/createCommandModels';
import type {
  CommandMenuNode,
  CommandPayloadHandlerMap,
  CommandShortcutLabels,
} from '../../features/commands/commandTypes';
import { useWorkspaceStore } from '../../features/workspace/workspaceStore';
import { writeClipboardText } from '../../services/clipboard/clipboardTextClient';
import {
  revealPathInOs,
} from '../../services/opener/openerCommands';
import { useAppStore } from '../stores/appStore';

type UseEditorContextMenuOptions = {
  editorAvailable: boolean;
  getEditState: () => EditorEditState;
  navigateLinkHref: (href: string) => void | Promise<unknown>;
  shortcuts: CommandShortcutLabels;
};

export type EditorContextPayloadHandlers = Pick<
  CommandPayloadHandlerMap,
  | 'copyImagePath'
  | 'copyLinkAddress'
  | 'openLink'
  | 'revealImage'
>;

async function writeContextClipboardText(
  text: string,
): Promise<boolean> {
  try {
    await writeClipboardText(text);
    return true;
  } catch {
    return false;
  }
}

export function useEditorContextMenu({
  editorAvailable,
  getEditState,
  navigateLinkHref,
  shortcuts,
}: UseEditorContextMenuOptions) {
  const { t } = useTranslation();
  const linkCopyGenerationRef = useRef(0);

  const onCopyLinkAddress = useCallback(
    (href: string) => {
      const generation = ++linkCopyGenerationRef.current;
      void writeContextClipboardText(href).then((copied) => {
        if (generation !== linkCopyGenerationRef.current) {
          return;
        }

        const store = useAppStore.getState();
        if (copied) {
          if (store.lastFileError?.code === 'link.copy_failed') {
            store.setLastFileError(null);
          }
          return;
        }

        store.setLastFileError({
          code: 'link.copy_failed',
          message: t('linkError.copyFailed'),
          recoverable: true,
        });
      });
    },
    [t],
  );

  const onOpenLink = useCallback(
    (href: string) => {
      void navigateLinkHref(href);
    },
    [navigateLinkHref],
  );

  const onCopyImagePath = useCallback(
    (src: string) => {
      const documentPath = useAppStore.getState().currentFile?.path ?? null;
      const resolved = resolveImageFilesystemPath({ documentPath, source: src });

      if (resolved.kind === 'unavailable') {
        useAppStore.getState().setLastFileError({
          code: 'image.path_unavailable',
          message: t('imageError.pathUnavailable'),
          recoverable: true,
        });
        return;
      }

      const text = resolved.kind === 'remote' ? resolved.url : resolved.path;
      void writeContextClipboardText(text).then((copied) => {
        if (!copied) {
          useAppStore.getState().setLastFileError({
            code: 'image.copy_path_failed',
            message: t('imageError.copyPathFailed'),
            recoverable: true,
          });
        }
      });
    },
    [t],
  );

  const onRevealImage = useCallback(
    (src: string) => {
      const documentPath = useAppStore.getState().currentFile?.path ?? null;
      const workspaceRoot = useWorkspaceStore.getState().root?.path ?? null;
      const resolved = resolveImageFilesystemPath({ documentPath, source: src });

      if (resolved.kind !== 'local') {
        useAppStore.getState().setLastFileError({
          code: 'image.path_unavailable',
          message: t('imageError.pathUnavailable'),
          recoverable: true,
        });
        return;
      }

      void revealPathInOs(resolved.path, {
        documentPath,
        workspaceRoot,
      }).then((result) => {
        if (!result.ok) {
          useAppStore.getState().setLastFileError({
            code: result.error.code,
            message: t('imageError.revealFailed'),
            recoverable: true,
          });
        }
      });
    },
    [t],
  );
  const payloadHandlers = useMemo<EditorContextPayloadHandlers>(
    () => ({
      copyImagePath: ({ src }) => onCopyImagePath(src),
      copyLinkAddress: ({ href }) => onCopyLinkAddress(href),
      openLink: ({ href }) => onOpenLink(href),
      revealImage: ({ src }) => onRevealImage(src),
    }),
    [onCopyImagePath, onCopyLinkAddress, onOpenLink, onRevealImage],
  );
  const getContextMenuNodes = useCallback(
    (target: EditorContextTarget): CommandMenuNode[] =>
      createEditorContextMenuModels({
        editorAvailable,
        editorState: getEditState(),
        shortcuts,
        t,
        target,
      }),
    [
      editorAvailable,
      getEditState,
      shortcuts,
      t,
    ],
  );

  return {
    getContextMenuNodes,
    payloadHandlers,
  };
}
