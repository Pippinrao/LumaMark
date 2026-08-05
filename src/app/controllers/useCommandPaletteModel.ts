import { useCallback, useEffect, useRef, useState } from 'react';

type DeferredCommand = () => void | Promise<void>;

export function useCommandPaletteModel() {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingCommandRef = useRef<DeferredCommand | null>(null);

  const openPalette = useCallback(() => {
    if (open) {
      return;
    }

    const activeElement = globalThis.document.activeElement;
    openerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setOpen(true);
  }, [open]);

  const runAfterClose = useCallback((run: DeferredCommand) => {
    pendingCommandRef.current = run;
  }, []);

  useEffect(() => {
    if (open) {
      return;
    }

    const pendingCommand = pendingCommandRef.current;
    const opener = openerRef.current;
    pendingCommandRef.current = null;
    openerRef.current = null;

    if (pendingCommand) {
      void pendingCommand();
      return;
    }

    if (opener?.isConnected) {
      opener.focus();
    }
  }, [open]);

  return { open, openPalette, runAfterClose, setOpen };
}
