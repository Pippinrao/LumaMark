import { describe, expect, it } from 'vitest';
import { createCommandShortcutLabels } from './commandShortcuts';

describe('createCommandShortcutLabels', () => {
  it('describes every displayed Windows shortcut with the keys the app accepts', () => {
    expect(
      createCommandShortcutLabels(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      ),
    ).toEqual({
      bold: 'Ctrl+B',
      codeBlock: 'Ctrl+Shift+K',
      commandPalette: 'Ctrl+K',
      copyTable: 'Ctrl+Alt+C',
      deleteTable: 'Ctrl+Alt+Backspace',
      find: 'Ctrl+F',
      focusMode: 'Ctrl+Shift+F',
      heading1: 'Ctrl+1',
      heading2: 'Ctrl+2',
      heading3: 'Ctrl+3',
      heading4: 'Ctrl+4',
      heading5: 'Ctrl+5',
      heading6: 'Ctrl+6',
      image: 'Ctrl+Shift+I',
      italic: 'Ctrl+I',
      newDocument: 'Ctrl+N',
      normalParagraph: 'Ctrl+0',
      openFile: 'Ctrl+O',
      redo: 'Ctrl+Y',
      save: 'Ctrl+S',
      saveAs: 'Ctrl+Shift+S',
      sidebar: 'Ctrl+\\',
      sourceMode: 'Ctrl+/',
      table: 'Ctrl+T',
      undo: 'Ctrl+Z',
    });
  });

  it('uses Command labels for the same macOS bindings', () => {
    const shortcuts = createCommandShortcutLabels(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    );

    expect(shortcuts).toMatchObject({
      bold: 'Cmd+B',
      commandPalette: 'Cmd+K',
      copyTable: 'Cmd+Alt+C',
      deleteTable: 'Cmd+Alt+Backspace',
      focusMode: 'Cmd+Shift+F',
      newDocument: 'Cmd+N',
      redo: 'Cmd+Shift+Z',
      saveAs: 'Cmd+Shift+S',
      sourceMode: 'Cmd+/',
    });
  });
});
