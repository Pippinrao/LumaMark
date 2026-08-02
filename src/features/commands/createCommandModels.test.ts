import { describe, expect, it, vi } from 'vitest';
import type {
  CommandHandlerMap,
  CommandMenuNode,
} from './commandTypes';
import {
  createCommandPaletteModels,
  createEditorContextMenuModels,
  createTopMenuModels,
} from './createCommandModels';

describe('createCommandPaletteModels', () => {
  it('disables opening a file while another file is opening', () => {
    const commands = createCommandPaletteModels({
      fileOpening: true,
      handlers: {} as CommandHandlerMap,
      t: (key) => key,
    });

    expect(commands.find((command) => command.id === 'open-file')).toMatchObject({
      disabled: true,
    });
  });

  it('shares Typora-aligned shortcuts and excludes table-only destructive actions', () => {
    const commands = createCommandPaletteModels({
      fileOpening: false,
      handlers: {} as CommandHandlerMap,
      t: (key) => key,
    });

    expect(commands.find(({ id }) => id === 'insert-image')?.shortcut).toBe('Ctrl+Shift+I');
    expect(commands.find(({ id }) => id === 'insert-code-block')?.shortcut).toBe('Ctrl+Shift+K');
    expect(commands.find(({ id }) => id === 'insert-table')?.shortcut).toBe('Ctrl+T');
    expect(commands.some(({ id }) => id === 'copy-table')).toBe(false);
    expect(commands.some(({ id }) => id === 'delete-table')).toBe(false);
  });
});

describe('createEditorContextMenuModels', () => {
  const createModels = (tableContext: boolean) =>
    createEditorContextMenuModels({
      shortcuts: {
        copy: 'Ctrl Alt C',
        delete: 'Ctrl Alt Backspace',
      },
      tableContext,
      t: (key) => key,
    });

  it('keeps destructive actions hidden outside a rendered table', () => {
    expect(createModels(false).map(({ action }) => action)).toEqual(['table']);
    expect(createModels(false)[0]?.shortcut).toBe('Ctrl+T');
  });

  it('exposes copy and delete only for a rendered table target', () => {
    expect(createModels(true).map(({ action }) => action)).toEqual([
      'table',
      'copyTable',
      'deleteTable',
    ]);
  });
});

describe('createTopMenuModels', () => {
  const createModels = (overrides: Record<string, unknown> = {}) =>
    createTopMenuModels({
      editorDisplayMode: 'source',
      fileOpening: false,
      focusMode: true,
      language: 'zh-CN',
      openRecentFile: vi.fn(),
      recentFiles: [],
      shortcuts: {
        copy: 'Ctrl Alt C',
        delete: 'Ctrl Alt Backspace',
      },
      sidebarOpen: true,
      t: (key) => key,
      theme: 'dark',
      ...overrides,
    });

  it('builds the approved eight-group information architecture', () => {
    expect(createModels().map((group) => group.id)).toEqual([
      'file',
      'edit',
      'paragraph',
      'format',
      'view',
      'theme',
      'language',
      'help',
    ]);
  });

  it('keeps destructive table actions out of the persistent Edit menu', () => {
    const edit = createModels().find((group) => group.id === 'edit');

    expect(edit?.items.map((item) => item.id)).toEqual([
      'undo',
      'redo',
      'edit-history-separator',
      'find',
      'command-palette',
    ]);
    expect(JSON.stringify(edit)).not.toContain('deleteTable');
    expect(JSON.stringify(edit)).not.toContain('copyTable');
  });

  it('projects nested paragraph commands and Typora-aligned shortcuts', () => {
    const paragraph = createModels().find((group) => group.id === 'paragraph');

    expect(findNode(paragraph?.items ?? [], 'heading-1')).toMatchObject({
      shortcut: 'Ctrl+1',
      type: 'item',
    });
    expect(findNode(paragraph?.items ?? [], 'code-block')).toMatchObject({
      shortcut: 'Ctrl+Shift+K',
      type: 'item',
    });
    expect(findNode(paragraph?.items ?? [], 'insert-table')).toMatchObject({
      shortcut: 'Ctrl+T',
      type: 'item',
    });
    expect(findNode(paragraph?.items ?? [], 'lists')).toMatchObject({
      type: 'submenu',
    });
  });

  it('projects display, sidebar, focus, theme, and language state', () => {
    const groups = createModels();

    expect(findNode(groups.flatMap((group) => group.items), 'source-mode')).toMatchObject({
      checked: true,
      shortcut: 'Ctrl+/',
      type: 'radio',
    });
    expect(findNode(groups.flatMap((group) => group.items), 'sidebar')).toMatchObject({
      checked: true,
      type: 'checkbox',
    });
    expect(findNode(groups.flatMap((group) => group.items), 'focus-mode')).toMatchObject({
      checked: true,
      type: 'checkbox',
    });
    expect(findNode(groups.flatMap((group) => group.items), 'theme-dark')).toMatchObject({
      checked: true,
      type: 'radio',
    });
    expect(findNode(groups.flatMap((group) => group.items), 'language-zh')).toMatchObject({
      checked: true,
      type: 'radio',
    });
  });

  it('disables file actions while a file dialog operation is active', () => {
    const file = createModels({ fileOpening: true }).find(
      (group) => group.id === 'file',
    );

    expect(findNode(file?.items ?? [], 'open-file')).toMatchObject({ disabled: true });
    expect(findNode(file?.items ?? [], 'save')).toMatchObject({ disabled: true });
    expect(findNode(file?.items ?? [], 'save-as')).toMatchObject({ disabled: true });
  });

  it('lets the new-document action preserve the editor focus it establishes', () => {
    const file = createModels().find((group) => group.id === 'file');

    expect(findNode(file?.items ?? [], 'new-document')).toMatchObject({
      invocation: {
        action: 'newDocument',
        focusManagement: 'action',
        kind: 'action',
      },
    });
  });

  it('creates parameterized recent-file callbacks without string action IDs', () => {
    const openRecentFile = vi.fn();
    const file = createModels({
      openRecentFile,
      recentFiles: [
        { name: 'one.md', path: 'E:/notes/one.md' },
        { name: '二.md', path: 'E:/notes/二.md' },
      ],
    }).find((group) => group.id === 'file');
    const recent = findNode(file?.items ?? [], 'recent-files');

    expect(recent).toMatchObject({ type: 'submenu' });
    if (recent?.type !== 'submenu') {
      throw new Error('recent files submenu should exist');
    }

    const second = recent.items[1];
    expect(second).toMatchObject({ label: '二.md', type: 'item' });
    if (second?.type !== 'item' || second.invocation.kind !== 'callback') {
      throw new Error('recent file should use a callback invocation');
    }

    second.invocation.run();
    expect(openRecentFile).toHaveBeenCalledOnce();
    expect(openRecentFile).toHaveBeenCalledWith('E:/notes/二.md');
  });

  it('shows a truthful empty state when there are no recent files', () => {
    const file = createModels().find((group) => group.id === 'file');

    expect(findNode(file?.items ?? [], 'recent-files-empty')).toMatchObject({
      disabled: true,
      label: 'recentFiles.empty',
      type: 'item',
    });
  });
});

function findNode(
  nodes: readonly CommandMenuNode[],
  id: string,
): CommandMenuNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }

    if (node.type === 'submenu') {
      const match = findNode(node.items, id);

      if (match) {
        return match;
      }
    }
  }

  return undefined;
}
