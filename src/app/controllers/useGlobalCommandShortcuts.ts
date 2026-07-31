import { useEffect, useRef } from 'react';
import type { CommandHandlerMap } from '../../features/commands/commandTypes';

type GlobalShortcutHandlers = Pick<
  CommandHandlerMap,
  | 'copyTable'
  | 'deleteTable'
  | 'exitFocusMode'
  | 'newDocument'
  | 'openCommandPalette'
  | 'openFile'
  | 'save'
  | 'saveAs'
  | 'table'
  | 'toggleDisplayMode'
  | 'toggleFocusMode'
  | 'toggleSidebar'
>;

export function useGlobalCommandShortcuts(handlers: GlobalShortcutHandlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }

      const currentHandlers = handlersRef.current;

      if (event.key === 'Escape') {
        if (globalThis.document.querySelector('[role="dialog"]')) {
          return;
        }

        currentHandlers.exitFocusMode();
        return;
      }

      if (
        isPrimaryModifierPressed(event) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        currentHandlers.toggleFocusMode();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        currentHandlers.openCommandPalette();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        currentHandlers.newDocument();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        currentHandlers.openFile();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          currentHandlers.saveAs();
        } else {
          currentHandlers.save();
        }
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key === '\\') {
        event.preventDefault();
        currentHandlers.toggleSidebar();
        return;
      }

      if (
        isPrimaryModifierPressed(event) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === '/'
      ) {
        if (shouldIgnoreDisplayModeShortcut(event.target)) {
          return;
        }

        event.preventDefault();
        currentHandlers.toggleDisplayMode();
        return;
      }

      if (!isPrimaryModifierPressed(event) || !event.altKey) {
        return;
      }

      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        currentHandlers.table();
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        currentHandlers.copyTable();
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        currentHandlers.deleteTable();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);
}

function isPrimaryModifierPressed(event: KeyboardEvent): boolean {
  return /Mac/i.test(navigator.userAgent) ? event.metaKey : event.ctrlKey;
}

function shouldIgnoreDisplayModeShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (
    target.closest('[role="dialog"]') ||
    target.closest('input, textarea, select')
  ) {
    return true;
  }

  return target.isContentEditable && !target.closest('.cm-content');
}
