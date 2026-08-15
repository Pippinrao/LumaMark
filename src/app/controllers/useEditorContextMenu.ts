import { useCallback, useMemo } from 'react';
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
  openExternalUrl,
  revealPathInOs,
} from '../../services/opener/openerCommands';
import { classifyLinkUrl } from '../../services/opener/linkUrlClassification';
import { resolveRelativeLinkPath } from '../../services/opener/resolveRelativeLinkPath';
import { useAppStore } from '../stores/appStore';

type UseEditorContextMenuOptions = {
  editorAvailable: boolean;
  getEditState: () => EditorEditState;
  openDocumentPath: (path: string) => void | Promise<unknown>;
  shortcuts: CommandShortcutLabels;
};

export type EditorContextPayloadHandlers = Pick<
  CommandPayloadHandlerMap,
  | 'copyImagePath'
  | 'copyLinkAddress'
  | 'openLink'
  | 'revealImage'
>;

function linkErrorMessage(code: string, t: (key: string) => string): string {
  switch (code) {
    case 'link.empty':
      return t('linkError.empty');
    case 'link.protocol_javascript':
      return t('linkError.protocolJavascript');
    case 'link.protocol_data':
      return t('linkError.protocolData');
    case 'link.protocol_file':
      return t('linkError.protocolFile');
    case 'link.open_failed':
      return t('linkError.openFailed');
    case 'link.relativeUnavailable':
      return t('linkError.relativeUnavailable');
    default:
      return t('linkError.protocolRejected');
  }
}

async function writeContextClipboardText(
  text: string,
  onFailure: () => void,
): Promise<void> {
  try {
    await writeClipboardText(text);
  } catch {
    onFailure();
  }
}

export function useEditorContextMenu({
  editorAvailable,
  getEditState,
  openDocumentPath,
  shortcuts,
}: UseEditorContextMenuOptions) {
  const { t } = useTranslation();

  const onCopyLinkAddress = useCallback(
    (href: string) => {
      void writeContextClipboardText(href, () => {
        useAppStore.getState().setLastFileError({
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
      const classification = classifyLinkUrl(href);

      if (classification.kind === 'absoluteAllowed') {
        void openExternalUrl(href).then((result) => {
          if (!result.ok) {
            useAppStore.getState().setLastFileError({
              code: result.error.code,
              message: linkErrorMessage(result.error.code, t),
              recoverable: true,
            });
          }
        });
        return;
      }

      if (classification.kind === 'rejected') {
        useAppStore.getState().setLastFileError({
          code: classification.code,
          message: linkErrorMessage(classification.code, t),
          recoverable: true,
        });
        return;
      }

      const currentPath = useAppStore.getState().currentFile?.path ?? null;
      const resolved = resolveRelativeLinkPath(href, currentPath);
      if (!resolved) {
        useAppStore.getState().setLastFileError({
          code: 'link.relativeUnavailable',
          message: linkErrorMessage('link.relativeUnavailable', t),
          recoverable: true,
        });
        return;
      }

      void openDocumentPath(resolved);
    },
    [openDocumentPath, t],
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
      void writeContextClipboardText(text, () => {
        useAppStore.getState().setLastFileError({
          code: 'image.copy_path_failed',
          message: t('imageError.copyPathFailed'),
          recoverable: true,
        });
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
