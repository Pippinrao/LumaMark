import { useEffect } from 'react';
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
  | 'toggleFocusMode'
  | 'toggleSidebar'
>;

export function useGlobalCommandShortcuts(handlers: GlobalShortcutHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (globalThis.document.querySelector('[role="dialog"]')) {
          return;
        }

        handlers.exitFocusMode();
        return;
      }

      if (
        isPrimaryModifierPressed(event) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        handlers.toggleFocusMode();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        handlers.openCommandPalette();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        handlers.newDocument();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        handlers.openFile();
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (event.shiftKey) {
          handlers.saveAs();
        } else {
          handlers.save();
        }
        return;
      }

      if (isPrimaryModifierPressed(event) && event.key === '\\') {
        event.preventDefault();
        handlers.toggleSidebar();
        return;
      }

      if (!isPrimaryModifierPressed(event) || !event.altKey) {
        return;
      }

      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        handlers.table();
        return;
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        handlers.copyTable();
        return;
      }

      if (event.key === 'Backspace') {
        event.preventDefault();
        handlers.deleteTable();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [handlers]);
}

function isPrimaryModifierPressed(event: KeyboardEvent): boolean {
  return /Mac/i.test(navigator.userAgent) ? event.metaKey : event.ctrlKey;
}
