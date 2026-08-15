import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandMenuInvocation } from '../../features/commands/commandTypes';

export function useCommandPaletteModel(
  runInvocation: (invocation: CommandMenuInvocation) => void,
) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingInvocationRef = useRef<CommandMenuInvocation | null>(null);

  const openPalette = useCallback(() => {
    if (open) {
      return;
    }

    const activeElement = globalThis.document.activeElement;
    openerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setOpen(true);
  }, [open]);

  const runAfterClose = useCallback((invocation: CommandMenuInvocation) => {
    pendingInvocationRef.current = invocation;
  }, []);

  useEffect(() => {
    if (open) {
      return;
    }

    const pendingInvocation = pendingInvocationRef.current;
    const opener = openerRef.current;
    pendingInvocationRef.current = null;
    openerRef.current = null;

    if (pendingInvocation) {
      runInvocation(pendingInvocation);
    }

    if (
      pendingInvocation?.focusManagement !== 'action' &&
      opener?.isConnected
    ) {
      opener.focus();
    }
  }, [open, runInvocation]);

  return { open, openPalette, runAfterClose, setOpen };
}
