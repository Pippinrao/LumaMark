import { useCallback, useRef } from 'react';

type UseMenuDialogFocusOptions = {
  setAboutOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
};

export function useMenuDialogFocus({
  setAboutOpen,
  setSettingsOpen,
}: UseMenuDialogFocusOptions) {
  const openerRef = useRef<HTMLElement | null>(null);
  const rememberOpener = useCallback(() => {
    const openMenuTrigger = globalThis.document.querySelector<HTMLElement>(
      '.lm-menu-trigger[data-state="open"]',
    );
    const activeElement = globalThis.document.activeElement;
    openerRef.current =
      openMenuTrigger ??
      (activeElement instanceof HTMLElement ? activeElement : null);
  }, []);
  const openAbout = useCallback(() => {
    rememberOpener();
    setAboutOpen(true);
  }, [rememberOpener, setAboutOpen]);
  const openSettings = useCallback(() => {
    rememberOpener();
    setSettingsOpen(true);
  }, [rememberOpener, setSettingsOpen]);
  const restoreDialogFocus = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    globalThis.requestAnimationFrame(() => {
      if (opener?.isConnected) {
        opener.focus();
      }
    });
  }, []);

  return { openAbout, openSettings, restoreDialogFocus };
}
