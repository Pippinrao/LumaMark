import { useCallback, useRef, useState } from 'react';

type UseNewDocumentConfirmationOptions = {
  createNewDocument: () => void;
  dirty: boolean;
  focusEditor: () => void;
};

export function useNewDocumentConfirmation({
  createNewDocument,
  dirty,
  focusEditor,
}: UseNewDocumentConfirmationOptions) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const requestNewDocument = useCallback(() => {
    if (!dirty) {
      createNewDocument();
      return;
    }

    const openMenuTrigger = globalThis.document.querySelector<HTMLElement>(
      '.lm-menu-trigger[data-state="open"]',
    );
    const activeElement = globalThis.document.activeElement;
    openerRef.current =
      openMenuTrigger ??
      (activeElement instanceof HTMLElement ? activeElement : null);
    setOpen(true);
  }, [createNewDocument, dirty]);

  const confirmNewDocument = useCallback(() => {
    openerRef.current = null;
    createNewDocument();
    setOpen(false);
    globalThis.requestAnimationFrame(focusEditor);
  }, [createNewDocument, focusEditor]);

  const restoreFocus = useCallback(() => {
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
    requestNewDocument,
    restoreFocus,
    setOpen,
  };
}
