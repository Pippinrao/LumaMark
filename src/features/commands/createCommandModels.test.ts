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
import { createCommandShortcutLabels } from './commandShortcuts';

const shortcuts = createCommandShortcutLabels(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
);

describe('createCommandPaletteModels', () => {
  it('disables opening a file while another file is opening', () => {
    const commands = createCommandPaletteModels({
      editorAvailable: true,
      fileOpening: true,
      handlers: {} as CommandHandlerMap,
      shortcuts,
      t: (key) => key,
    });

    expect(commands.find((command) => command.id === 'open-file')).toMatchObject({
      disabled: true,
    });
  });

  it('shares Typora-aligned shortcuts and excludes table-only destructive actions', () => {
    const commands = createCommandPaletteModels({
      editorAvailable: true,
      fileOpening: false,
      handlers: {} as CommandHandlerMap,
      shortcuts,
      t: (key) => key,
    });

    expect(commands.find(({ id }) => id === 'insert-image')?.shortcut).toBe('Ctrl+Shift+I');
    expect(commands.find(({ id }) => id === 'insert-code-block')?.shortcut).toBe('Ctrl+Shift+K');
    expect(commands.find(({ id }) => id === 'insert-table')?.shortcut).toBe('Ctrl+T');
    expect(commands.some(({ id }) => id === 'copy-table')).toBe(false);
    expect(commands.some(({ id }) => id === 'delete-table')).toBe(false);
  });

  it('disables only editor-dependent commands when the editor is unavailable', () => {
    const commands = createCommandPaletteModels({
      editorAvailable: false,
      fileOpening: false,
      handlers: {} as CommandHandlerMap,
      shortcuts,
      t: (key) => key,
    });

    expect(
      commands.filter(({ disabled }) => disabled).map(({ id }) => id),
    ).toEqual([
      'save',
      'save-as',
      'find',
      'undo',
      'redo',
      'focus-editor',
      'toggle-focus-mode',
      'reset-zoom',
      'heading-1',
      'heading-2',
      'heading-3',
      'heading-4',
      'heading-5',
      'heading-6',
      'insert-horizontal-rule',
      'insert-image',
      'insert-code-block',
      'insert-table',
      'insert-ordered-list',
      'toggle-strikethrough',
    ]);
    expect(
      commands
        .filter(({ disabled }) => !disabled)
        .map(({ id }) => id),
    ).toEqual([
      'new-document',
      'open-file',
      'open-workspace',
      'toggle-theme',
      'toggle-language',
      'toggle-sidebar',
      'open-settings',
      'check-for-updates',
    ]);
  });
});

describe('createEditorContextMenuModels', () => {
  const createModels = (tableContext: boolean) =>
    createEditorContextMenuModels({
      shortcuts,
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
      editorAvailable: true,
      fileOpening: false,
      focusMode: true,
      language: 'zh-CN',
      openRecentFile: vi.fn(),
      recentFiles: [],
      shortcuts,
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

  it('keeps every executable menu leaf wired to the expected action and shortcut', () => {
    const groups = createModels({
      recentFiles: [{ name: 'one.md', path: 'E:/notes/one.md' }],
    });

    expect(
      Object.fromEntries(
        groups.map((group) => [group.id, collectLeafContracts(group.items)]),
      ),
    ).toEqual({
      edit: [
        'undo:undo:Ctrl+Z',
        'redo:redo:Ctrl+Y',
        'find:openSearch:Ctrl+F',
        'command-palette:openCommandPalette:Ctrl+K',
      ],
      file: [
        'new-document:newDocument:Ctrl+N',
        'open-file:openFile:Ctrl+O',
        'recent-file-0:callback:',
        'open-workspace:openWorkspace:',
        'save:save:Ctrl+S',
        'save-as:saveAs:Ctrl+Shift+S',
        'settings:openSettings:',
      ],
      format: [
        'bold:bold:Ctrl+B',
        'italic:italic:Ctrl+I',
        'strikethrough:strikethrough:',
        'inline-code:inlineCode:',
        'link:link:',
        'image:image:Ctrl+Shift+I',
      ],
      help: ['check-for-updates:checkForUpdates:', 'about:openAbout:'],
      language: [
        'language-zh:setChineseLanguage:',
        'language-en:setEnglishLanguage:',
      ],
      paragraph: [
        'normal-paragraph:paragraph:Ctrl+0',
        'heading-1:heading1:Ctrl+1',
        'heading-2:heading2:Ctrl+2',
        'heading-3:heading3:Ctrl+3',
        'heading-4:heading4:Ctrl+4',
        'heading-5:heading5:Ctrl+5',
        'heading-6:heading6:Ctrl+6',
        'ordered-list:orderedList:',
        'unordered-list:unorderedList:',
        'task-list:taskList:',
        'quote:quote:',
        'code-block:codeBlock:Ctrl+Shift+K',
        'insert-table:table:Ctrl+T',
        'horizontal-rule:horizontalRule:',
      ],
      theme: ['theme-light:setLightTheme:', 'theme-dark:setDarkTheme:'],
      view: [
        'live-preview-mode:setLivePreviewMode:Ctrl+/',
        'source-mode:setSourceMode:',
        'reading-mode:setReadingMode:',
        'sidebar:toggleSidebar:Ctrl+\\',
        'focus-mode:toggleFocusMode:Ctrl+Shift+F',
        'reset-zoom:resetZoom:',
        'focus-editor:focusEditor:',
      ],
    });
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

    expect(findNode(groups.flatMap((group) => group.items), 'live-preview-mode')).toMatchObject({
      checked: false,
      shortcut: 'Ctrl+/',
      type: 'radio',
    });
    expect(findNode(groups.flatMap((group) => group.items), 'source-mode')).toMatchObject({
      checked: true,
      type: 'radio',
    });
    expect(findNode(groups.flatMap((group) => group.items), 'reading-mode')).toMatchObject({
      checked: false,
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

  it('disables editor-dependent leaves while preserving startup actions', () => {
    const groups = createModels({ editorAvailable: false });
    const actionNodes = collectActionNodes(
      groups.flatMap((group) => group.items),
    );

    expect(
      actionNodes.filter((node) => node.disabled).map((node) => node.id),
    ).toEqual([
      'save',
      'save-as',
      'undo',
      'redo',
      'find',
      'normal-paragraph',
      'heading-1',
      'heading-2',
      'heading-3',
      'heading-4',
      'heading-5',
      'heading-6',
      'ordered-list',
      'unordered-list',
      'task-list',
      'quote',
      'code-block',
      'insert-table',
      'horizontal-rule',
      'bold',
      'italic',
      'strikethrough',
      'inline-code',
      'link',
      'image',
      'live-preview-mode',
      'source-mode',
      'reading-mode',
      'focus-mode',
      'reset-zoom',
      'focus-editor',
    ]);
    expect(
      actionNodes.filter((node) => !node.disabled).map((node) => node.id),
    ).toEqual([
      'new-document',
      'open-file',
      'open-workspace',
      'settings',
      'command-palette',
      'sidebar',
      'theme-light',
      'theme-dark',
      'language-zh',
      'language-en',
      'check-for-updates',
      'about',
    ]);
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

function collectLeafContracts(nodes: readonly CommandMenuNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type === 'separator') {
      return [];
    }

    if (node.type === 'submenu') {
      return collectLeafContracts(node.items);
    }

    const action =
      node.invocation.kind === 'action'
        ? node.invocation.action
        : 'callback';

    return [`${node.id}:${action}:${node.shortcut ?? ''}`];
  });
}

function collectActionNodes(
  nodes: readonly CommandMenuNode[],
): Extract<CommandMenuNode, { type: 'checkbox' | 'item' | 'radio' }>[] {
  return nodes.flatMap((node) => {
    if (node.type === 'separator') {
      return [];
    }

    if (node.type === 'submenu') {
      return collectActionNodes(node.items);
    }

    return node.invocation.kind === 'action' ? [node] : [];
  });
}
