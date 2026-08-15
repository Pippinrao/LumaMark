import { useCallback, useMemo } from 'react';
import type { EditorApi } from '../../editor/core/editorApi';
import { createOutlineNavigationHandler } from './outlineNavigationHandler';
import type { useAppDocumentModel } from './useAppDocumentModel';
import type { useAppEditorCommands } from './useAppEditorCommands';
import { useAppLinkNavigation } from './useAppLinkNavigation';

type DocumentNavigationModel = Pick<
  ReturnType<typeof useAppDocumentModel>,
  | 'awaitCurrentOutlineSnapshot'
  | 'fileWorkflow'
  | 'isCurrentOutlineHeading'
  | 'isOutlineCurrent'
  | 'scheduleOutlineRefresh'
>;

type EditorNavigationCommands = Pick<
  ReturnType<typeof useAppEditorCommands>,
  'onEditorReady' | 'revealPosition'
>;

export function useAppEditorNavigation(
  document: DocumentNavigationModel,
  editor: EditorNavigationCommands,
) {
  const {
    awaitCurrentOutlineSnapshot,
    fileWorkflow,
    isCurrentOutlineHeading,
    isOutlineCurrent,
    scheduleOutlineRefresh,
  } = document;
  const { onEditorReady: bindEditor, revealPosition } = editor;
  const navigateLinkHref = useAppLinkNavigation({
    awaitCurrentOutlineSnapshot,
    isOutlineCurrent,
    openDocumentPath: fileWorkflow.openPath,
    revealPosition,
    supersedePendingDocumentOpen: fileWorkflow.supersedePendingOpen,
  });
  const onLinkNavigationRequest = useCallback(
    (href: string) => {
      void navigateLinkHref(href);
    },
    [navigateLinkHref],
  );
  const selectHeading = useMemo(
    () =>
      createOutlineNavigationHandler({
        isCurrentHeading: isCurrentOutlineHeading,
        revealPosition,
      }),
    [isCurrentOutlineHeading, revealPosition],
  );
  const onEditorReady = useCallback(
    (editorApi: EditorApi) => {
      bindEditor(editorApi);
      scheduleOutlineRefresh();
    },
    [bindEditor, scheduleOutlineRefresh],
  );

  return {
    navigateLinkHref,
    onEditorReady,
    onLinkNavigationRequest,
    selectHeading,
  };
}
