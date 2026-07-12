import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGlobalCommandShortcuts } from './useGlobalCommandShortcuts';

function ShortcutHarness({
  handlers,
}: {
  handlers: Parameters<typeof useGlobalCommandShortcuts>[0];
}) {
  useGlobalCommandShortcuts(handlers);

  return null;
}

describe('useGlobalCommandShortcuts', () => {
  const originalUserAgent = Object.getOwnPropertyDescriptor(
    window.navigator,
    'userAgent',
  );

  afterEach(() => {
    cleanup();
    if (originalUserAgent) {
      Object.defineProperty(window.navigator, 'userAgent', originalUserAgent);
    }
  });

  it('uses Command instead of Control for the new-document shortcut on macOS', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const controlEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'n',
    });
    window.dispatchEvent(controlEvent);

    expect(handlers.newDocument).not.toHaveBeenCalled();
    expect(controlEvent.defaultPrevented).toBe(false);

    const commandEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'n',
      metaKey: true,
    });
    window.dispatchEvent(commandEvent);

    expect(handlers.newDocument).toHaveBeenCalledTimes(1);
    expect(commandEvent.defaultPrevented).toBe(true);
  });

  it('uses Control and prevents the browser shortcut when toggling the sidebar on Windows', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const controlEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: '\\',
    });
    window.dispatchEvent(controlEvent);

    expect(handlers.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(controlEvent.defaultPrevented).toBe(true);

    const commandEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '\\',
      metaKey: true,
    });
    window.dispatchEvent(commandEvent);

    expect(handlers.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(commandEvent.defaultPrevented).toBe(false);
  });

  it('uses Command instead of Control when toggling the sidebar on macOS', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const controlEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: '\\',
    });
    window.dispatchEvent(controlEvent);

    expect(handlers.toggleSidebar).not.toHaveBeenCalled();
    expect(controlEvent.defaultPrevented).toBe(false);

    const commandEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '\\',
      metaKey: true,
    });
    window.dispatchEvent(commandEvent);

    expect(handlers.toggleSidebar).toHaveBeenCalledTimes(1);
    expect(commandEvent.defaultPrevented).toBe(true);
  });

  it('toggles focus mode with the primary modifier, Shift, and F', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const focusModeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'f',
      shiftKey: true,
    });
    window.dispatchEvent(focusModeEvent);

    expect(handlers.toggleFocusMode).toHaveBeenCalledTimes(1);
    expect(focusModeEvent.defaultPrevented).toBe(true);
  });

  it('requests a focus-mode exit when Escape is pressed', () => {
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const escapeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    });
    window.dispatchEvent(escapeEvent);

    expect(handlers.exitFocusMode).toHaveBeenCalledTimes(1);
  });

  it('does not let Escape leave focus mode through an open dialog', () => {
    const handlers = createHandlers();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);

    try {
      render(<ShortcutHarness handlers={handlers} />);
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Escape',
        }),
      );

      expect(handlers.exitFocusMode).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });
});

function createHandlers() {
  return {
    copyTable: vi.fn(),
    deleteTable: vi.fn(),
    exitFocusMode: vi.fn(),
    newDocument: vi.fn(),
    openCommandPalette: vi.fn(),
    openFile: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    table: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}
