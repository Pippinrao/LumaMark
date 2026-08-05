import { useEffect, useRef } from 'react';
import { isMacUserAgent } from '../../features/commands/commandShortcuts';
import type { CommandHandlerMap } from '../../features/commands/commandTypes';

type GlobalShortcutHandlers = Pick<
  CommandHandlerMap,
  | 'codeBlock'
  | 'copyTable'
  | 'deleteTable'
  | 'exitFocusMode'
  | 'image'
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
      const editorCommandTarget = isEditorCommandTarget(event.target);

      if (isPlainEscape(event)) {
        if (globalThis.document.querySelector('[role="dialog"]')) {
          return;
        }

        currentHandlers.exitFocusMode();
        return;
      }

      if (
        editorCommandTarget &&
        matchesShortcut(event, 'i', { shiftKey: true })
      ) {
        event.preventDefault();
        currentHandlers.image();
        return;
      }

      if (
        editorCommandTarget &&
        matchesShortcut(event, 'k', { shiftKey: true })
      ) {
        event.preventDefault();
        currentHandlers.codeBlock();
        return;
      }

      if (matchesShortcut(event, 'f', { shiftKey: true })) {
        event.preventDefault();
        currentHandlers.toggleFocusMode();
        return;
      }

      if (matchesShortcut(event, 'k')) {
        event.preventDefault();
        currentHandlers.openCommandPalette();
        return;
      }

      if (matchesShortcut(event, 'n')) {
        event.preventDefault();
        currentHandlers.newDocument();
        return;
      }

      if (matchesShortcut(event, 'o')) {
        event.preventDefault();
        currentHandlers.openFile();
        return;
      }

      if (matchesShortcut(event, 's', { shiftKey: true })) {
        event.preventDefault();
        currentHandlers.saveAs();
        return;
      }

      if (matchesShortcut(event, 's')) {
        event.preventDefault();
        currentHandlers.save();
        return;
      }

      if (matchesShortcut(event, '\\')) {
        event.preventDefault();
        currentHandlers.toggleSidebar();
        return;
      }

      if (
        matchesShortcut(event, '/')
      ) {
        if (shouldIgnoreDisplayModeShortcut(event.target)) {
          return;
        }

        event.preventDefault();
        currentHandlers.toggleDisplayMode();
        return;
      }

      if (
        editorCommandTarget &&
        (matchesShortcut(event, 't') ||
          matchesShortcut(event, 't', { altKey: true }))
      ) {
        event.preventDefault();
        currentHandlers.table();
        return;
      }

      if (!editorCommandTarget) {
        return;
      }

      if (matchesShortcut(event, 'c', { altKey: true })) {
        event.preventDefault();
        currentHandlers.copyTable();
        return;
      }

      if (matchesShortcut(event, 'Backspace', { altKey: true })) {
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

function isPlainEscape(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.getModifierState('AltGraph')
  );
}

function matchesShortcut(
  event: KeyboardEvent,
  key: string,
  {
    altKey = false,
    shiftKey = false,
  }: { altKey?: boolean; shiftKey?: boolean } = {},
): boolean {
  if (event.getModifierState('AltGraph')) {
    return false;
  }

  const isMac = isMacUserAgent(navigator.userAgent);
  const primaryModifierMatches = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;

  return (
    primaryModifierMatches &&
    event.altKey === altKey &&
    event.shiftKey === shiftKey &&
    matchesShortcutKey(event, key)
  );
}

function matchesShortcutKey(event: KeyboardEvent, key: string): boolean {
  const normalizedKey = key.toLowerCase();

  if (event.key.toLowerCase() === normalizedKey) {
    return true;
  }

  return (
    event.altKey &&
    /^[a-z]$/.test(normalizedKey) &&
    event.code === `Key${normalizedKey.toUpperCase()}`
  );
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

function isEditorCommandTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('.cm-content'));
}
