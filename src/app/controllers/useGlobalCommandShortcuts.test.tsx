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
    vi.restoreAllMocks();
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

  it('toggles display mode with Control+/ during capture on Windows', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();
    const target = document.createElement('button');
    const defaultPreventedAtBubble = vi.fn();
    target.addEventListener('keydown', (event) => {
      defaultPreventedAtBubble(event.defaultPrevented);
    });
    document.body.append(target);

    render(<ShortcutHarness handlers={handlers} />);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: '/',
    });
    target.dispatchEvent(event);

    expect(handlers.toggleDisplayMode).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(defaultPreventedAtBubble).toHaveBeenCalledWith(true);
    target.remove();
  });

  it('toggles display mode with Command+/ but not Control+/ on macOS', () => {
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
      key: '/',
    });
    window.dispatchEvent(controlEvent);
    const commandEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '/',
      metaKey: true,
    });
    window.dispatchEvent(commandEvent);

    expect(handlers.toggleDisplayMode).toHaveBeenCalledTimes(1);
    expect(controlEvent.defaultPrevented).toBe(false);
    expect(commandEvent.defaultPrevented).toBe(true);
  });

  it('toggles display mode with Control+/ but not Command+/ on Linux', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (X11; Linux x86_64)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const commandEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: '/',
      metaKey: true,
    });
    window.dispatchEvent(commandEvent);
    const controlEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: '/',
    });
    window.dispatchEvent(controlEvent);

    expect(handlers.toggleDisplayMode).toHaveBeenCalledTimes(1);
    expect(commandEvent.defaultPrevented).toBe(false);
    expect(controlEvent.defaultPrevented).toBe(true);
  });

  it('ignores display-mode shortcuts during composition', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const composingEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      isComposing: true,
      key: '/',
    });
    window.dispatchEvent(composingEvent);
    const legacyCompositionEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: '/',
    });
    Object.defineProperty(legacyCompositionEvent, 'keyCode', { value: 229 });
    window.dispatchEvent(legacyCompositionEvent);

    expect(handlers.toggleDisplayMode).not.toHaveBeenCalled();
    expect(composingEvent.defaultPrevented).toBe(false);
    expect(legacyCompositionEvent.defaultPrevented).toBe(false);
  });

  it('does not toggle display mode from dialogs or auxiliary text inputs', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();
    const dialog = document.createElement('div');
    const dialogButton = document.createElement('button');
    const searchInput = document.createElement('input');
    dialog.setAttribute('role', 'dialog');
    dialog.append(dialogButton);
    document.body.append(dialog, searchInput);

    try {
      render(<ShortcutHarness handlers={handlers} />);

      for (const target of [dialogButton, searchInput]) {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: '/',
        });
        target.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }

      expect(handlers.toggleDisplayMode).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
      searchInput.remove();
    }
  });

  it('does not mistake shifted, unmodified, or other keys for Mod+/', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);

    const events = [
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: '/',
        shiftKey: true,
      }),
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: '/',
      }),
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: '.',
      }),
    ];
    for (const event of events) {
      window.dispatchEvent(event);
    }

    expect(handlers.toggleDisplayMode).not.toHaveBeenCalled();
    expect(events.every((event) => !event.defaultPrevented)).toBe(true);
  });

  it('keeps one global listener while using the latest handlers after rerender', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const initialHandlers = createHandlers();
    const latestHandlers = createHandlers();
    const { rerender, unmount } = render(
      <ShortcutHarness handlers={initialHandlers} />,
    );

    rerender(<ShortcutHarness handlers={latestHandlers} />);
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: '/',
      }),
    );

    expect(
      addEventListener.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(1);
    expect(initialHandlers.toggleDisplayMode).not.toHaveBeenCalled();
    expect(latestHandlers.toggleDisplayMode).toHaveBeenCalledTimes(1);

    unmount();
    expect(
      removeEventListener.mock.calls.filter(([type]) => type === 'keydown'),
    ).toHaveLength(1);
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
    toggleDisplayMode: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}
