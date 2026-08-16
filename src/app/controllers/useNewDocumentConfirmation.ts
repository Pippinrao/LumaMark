import { useCallback, useRef, useState } from 'react';

type PendingUnsavedAction = () => void;

type UseNewDocumentConfirmationOptions = {
  createNewDocument: () => Promise<boolean>;
  dirty: boolean;
  focusEditor: () => void;
  openFile: () => Promise<unknown> | unknown;
  openFileAfterDiscard: () => Promise<unknown> | unknown;
  openRecentFile: (path: string) => Promise<unknown> | unknown;
  openRecentFileAfterDiscard: (path: string) => Promise<unknown> | unknown;
  startupVisible: boolean;
};

export function useNewDocumentConfirmation({
  createNewDocument,
  dirty,
  focusEditor,
  openFile,
  openFileAfterDiscard,
  openRecentFile,
  openRecentFileAfterDiscard,
  startupVisible,
}: UseNewDocumentConfirmationOptions) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingActionRef = useRef<PendingUnsavedAction | null>(null);

  const rememberOpener = () => {
    const openMenuTrigger = globalThis.document.querySelector<HTMLElement>(
      '.lm-menu-trigger[data-state="open"]',
    );
    const activeElement = globalThis.document.activeElement;
    openerRef.current =
      openMenuTrigger ??
      (activeElement instanceof HTMLElement ? activeElement : null);
  };

  const requestAction = useCallback(
    (action: PendingUnsavedAction) => {
      if (!dirty) {
        action();
        return;
      }

      rememberOpener();
      pendingActionRef.current = action;
      setOpen(true);
    },
    [dirty],
  );

  const requestNewDocument = useCallback(() => {
    requestAction(() => {
      void createNewDocument();
    });
  }, [createNewDocument, requestAction]);

  const requestOpenFile = useCallback(() => {
    if (startupVisible) {
      void openFile();
      return;
    }
    requestAction(() => {
      void openFileAfterDiscard();
    });
  }, [openFile, openFileAfterDiscard, requestAction, startupVisible]);

  const requestOpenRecentFile = useCallback((path: string) => {
    if (startupVisible) {
      void openRecentFile(path);
      return;
    }
    requestAction(() => {
      void openRecentFileAfterDiscard(path);
    });
  }, [
    openRecentFile,
    openRecentFileAfterDiscard,
    requestAction,
    startupVisible,
  ]);

  const confirmNewDocument = useCallback(() => {
    const pendingAction = pendingActionRef.current;
    pendingActionRef.current = null;
    openerRef.current = null;
    setOpen(false);
    pendingAction?.();
    globalThis.requestAnimationFrame(focusEditor);
  }, [focusEditor]);

  const restoreFocus = useCallback(() => {
    pendingActionRef.current = null;
    const opener = openerRef.current;
    openerRef.current = null;
    globalThis.requestAnimationFrame(() => {
      if (opener?.isConnected) {
        opener.focus();
      }
    });
  }, []);

  return {
    confirmNewDocument,
    open,
    requestAction,
    requestNewDocument,
    requestOpenFile,
    requestOpenRecentFile,
    restoreFocus,
    setOpen,
  };
}
