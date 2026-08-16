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

  it.each([
    ['n', false, 'newDocument'],
    ['o', false, 'openFile'],
    ['k', false, 'openCommandPalette'],
    ['s', false, 'save'],
    ['s', true, 'saveAs'],
    ['\\', false, 'toggleSidebar'],
    ['f', true, 'toggleFocusMode'],
  ] as const)(
    'routes Ctrl+%s to the advertised application command',
    (key, shiftKey, handler) => {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      const handlers = createHandlers();

      render(<ShortcutHarness handlers={handlers} />);
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key,
        shiftKey,
      });
      window.dispatchEvent(event);

      expect(handlers[handler]).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    },
  );

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

  it.each([
    ['x', false, false, 'cut'],
    ['c', false, false, 'copy'],
    ['v', false, false, 'paste'],
    ['a', false, false, 'selectAll'],
    ['i', true, false, 'image'],
    ['k', true, false, 'codeBlock'],
    ['m', true, false, 'math'],
    ['t', false, false, 'table'],
    ['t', false, true, 'table'],
    ['c', false, true, 'copyTable'],
    ['Backspace', false, true, 'deleteTable'],
  ] as const)(
    'runs the Typora-aligned %s shortcut through its shared command handler',
    (key, shiftKey, altKey, handler) => {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      const handlers = createHandlers();
      const editor = document.createElement('div');
      editor.className = 'cm-content';
      document.body.append(editor);

      render(<ShortcutHarness handlers={handlers} />);
      const event = new KeyboardEvent('keydown', {
        altKey,
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key,
        shiftKey,
      });
      editor.dispatchEvent(event);

      expect(handlers[handler]).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
      editor.remove();
    },
  );

  it('uses the physical letter key for Cmd+Option+C on macOS', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    });
    const handlers = createHandlers();
    const editor = document.createElement('div');
    editor.className = 'cm-content';
    document.body.append(editor);

    try {
      render(<ShortcutHarness handlers={handlers} />);
      const event = new KeyboardEvent('keydown', {
        altKey: true,
        bubbles: true,
        cancelable: true,
        code: 'KeyC',
        key: 'ç',
        metaKey: true,
      });
      editor.dispatchEvent(event);

      expect(handlers.copyTable).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    } finally {
      editor.remove();
    }
  });

  it('uses the logical letter key for shortcuts on Dvorak-style layouts', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();

    render(<ShortcutHarness handlers={handlers} />);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyL',
      ctrlKey: true,
      key: 'n',
    });
    window.dispatchEvent(event);

    expect(handlers.newDocument).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['Ctrl+Shift+N', 'n', true, false, false, 'newDocument'],
    ['Ctrl+Alt+O', 'o', false, true, false, 'openFile'],
    ['Ctrl+Alt+S', 's', false, true, false, 'save'],
    ['Ctrl+Shift+Alt+T', 't', true, true, false, 'table'],
    ['AltGr+C', 'c', false, true, true, 'copyTable'],
  ] as const)(
    'ignores undeclared %s shortcut modifiers',
    (_label, key, shiftKey, altKey, altGraph, handler) => {
      Object.defineProperty(window.navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      });
      const handlers = createHandlers();
      const editor = document.createElement('div');
      editor.className = 'cm-content';
      document.body.append(editor);

      try {
        render(<ShortcutHarness handlers={handlers} />);
        const event = new KeyboardEvent('keydown', {
          altKey,
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key,
          shiftKey,
        });
        if (altGraph) {
          Object.defineProperty(event, 'getModifierState', {
            value: (modifier: string) => modifier === 'AltGraph',
          });
        }
        editor.dispatchEvent(event);

        expect(handlers[handler]).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
      } finally {
        editor.remove();
      }
    },
  );

  it('does not run editor shortcuts from dialogs or auxiliary inputs', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const handlers = createHandlers();
    const dialog = document.createElement('div');
    const dialogInput = document.createElement('input');
    const auxiliaryInput = document.createElement('input');
    dialog.setAttribute('role', 'dialog');
    dialog.append(dialogInput);
    document.body.append(dialog, auxiliaryInput);

    try {
      render(<ShortcutHarness handlers={handlers} />);

      for (const target of [dialogInput, auxiliaryInput]) {
        for (const [key, shiftKey] of [
          ['x', false],
          ['c', false],
          ['v', false],
          ['a', false],
          ['i', true],
          ['k', true],
          ['t', false],
        ] as const) {
          const event = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key,
            shiftKey,
          });
          target.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
        }
      }

      expect(handlers.image).not.toHaveBeenCalled();
      expect(handlers.codeBlock).not.toHaveBeenCalled();
      expect(handlers.table).not.toHaveBeenCalled();
      expect(handlers.cut).not.toHaveBeenCalled();
      expect(handlers.copy).not.toHaveBeenCalled();
      expect(handlers.paste).not.toHaveBeenCalled();
      expect(handlers.selectAll).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
      auxiliaryInput.remove();
    }
  });

  it('leaves standard edit shortcuts untouched during IME composition', () => {
    const handlers = createHandlers();
    const editor = document.createElement('div');
    editor.className = 'cm-content';
    document.body.append(editor);

    try {
      render(<ShortcutHarness handlers={handlers} />);
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        isComposing: true,
        key: 'x',
      });
      editor.dispatchEvent(event);

      expect(handlers.cut).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    } finally {
      editor.remove();
    }
  });

  it('leaves standard edit shortcuts to a nested CodeMirror table-cell editor', () => {
    const handlers = createHandlers();
    const nestedHost = document.createElement('div');
    nestedHost.className = 'tbl-cell-editor';
    const nestedEditor = document.createElement('div');
    nestedEditor.className = 'cm-editor';
    const nestedContent = document.createElement('div');
    nestedContent.className = 'cm-content';
    nestedEditor.append(nestedContent);
    nestedHost.append(nestedEditor);
    document.body.append(nestedHost);

    try {
      render(<ShortcutHarness handlers={handlers} />);
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'c',
      });
      nestedContent.dispatchEvent(event);

      expect(handlers.copy).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    } finally {
      nestedHost.remove();
    }
  });

  it('routes table-level shortcuts from a nested cell through the outer command port', () => {
    const handlers = createHandlers();
    const nestedHost = document.createElement('div');
    nestedHost.className = 'tbl-cell-editor';
    const nestedContent = document.createElement('div');
    nestedContent.className = 'cm-content';
    nestedHost.append(nestedContent);
    document.body.append(nestedHost);

    try {
      render(<ShortcutHarness handlers={handlers} />);
      const copyTableEvent = new KeyboardEvent('keydown', {
        altKey: true,
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'c',
      });
      const deleteTableEvent = new KeyboardEvent('keydown', {
        altKey: true,
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'Backspace',
      });

      nestedContent.dispatchEvent(copyTableEvent);
      nestedContent.dispatchEvent(deleteTableEvent);

      expect(handlers.copyTable).toHaveBeenCalledOnce();
      expect(handlers.deleteTable).toHaveBeenCalledOnce();
      expect(copyTableEvent.defaultPrevented).toBe(true);
      expect(deleteTableEvent.defaultPrevented).toBe(true);
      expect(handlers.copy).not.toHaveBeenCalled();
    } finally {
      nestedHost.remove();
    }
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

  it.each([
    ['Control', true, false, false, false, false],
    ['Shift', false, true, false, false, false],
    ['Alt', false, false, true, false, false],
    ['Meta', false, false, false, true, false],
    ['AltGraph', true, false, true, false, true],
  ] as const)(
    'does not treat %s+Escape as the plain focus-mode exit command',
    (_modifier, ctrlKey, shiftKey, altKey, metaKey, altGraph) => {
      const handlers = createHandlers();

      render(<ShortcutHarness handlers={handlers} />);
      const event = new KeyboardEvent('keydown', {
        altKey,
        bubbles: true,
        cancelable: true,
        ctrlKey,
        key: 'Escape',
        metaKey,
        shiftKey,
      });
      if (altGraph) {
        Object.defineProperty(event, 'getModifierState', {
          value: (modifier: string) => modifier === 'AltGraph',
        });
      }
      window.dispatchEvent(event);

      expect(handlers.exitFocusMode).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    },
  );

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
    codeBlock: vi.fn(),
    copy: vi.fn(),
    copyTable: vi.fn(),
    cut: vi.fn(),
    deleteTable: vi.fn(),
    exitFocusMode: vi.fn(),
    image: vi.fn(),
    math: vi.fn(),
    newDocument: vi.fn(),
    openCommandPalette: vi.fn(),
    openFile: vi.fn(),
    paste: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    selectAll: vi.fn(),
    table: vi.fn(),
    toggleDisplayMode: vi.fn(),
    toggleFocusMode: vi.fn(),
    toggleSidebar: vi.fn(),
  };
}
