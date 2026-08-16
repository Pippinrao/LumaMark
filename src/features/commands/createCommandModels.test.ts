import { describe, expect, it, vi } from 'vitest';
import type {
  CommandActionId,
  CommandHandlerMap,
  CommandHandlerMaps,
  CommandMenuInvocation,
  CommandMenuNode,
  CommandPayloadHandlerMap,
} from './commandTypes';
import {
  createCommandPaletteModels,
  createEditorContextMenuModels,
  createFileTreeContextMenuModels,
  createTopMenuModels,
  runCommandAction,
  runCommandMenuInvocation,
} from './createCommandModels';
import { createCommandShortcutLabels } from './commandShortcuts';

const shortcuts = createCommandShortcutLabels(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
);

const editableSelection = {
  canFormat: true,
  canInsert: true,
  canRedo: true,
  canUndo: true,
  clipboardReadAvailable: true,
  clipboardWriteAvailable: true,
  composing: false,
  eligibleFindSelection: true,
  readOnly: false,
  selectionCount: 1,
  selectionEmpty: false,
  selectionLength: 4,
} as const;

describe('shared command contracts', () => {
  it('projects the same registry metadata and disabled state into palette and menu scenes', () => {
    const palette = createCommandPaletteModels({
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: true,
      shortcuts,
      t: (key) => key,
    });
    const menu = createTopMenuModels({
      editorDisplayMode: 'source',
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: true,
      language: 'en',
      recentFiles: [],
      shortcuts,
      sidebarOpen: true,
      t: (key) => key,
      theme: 'dark',
    });
    const menuNodes = menu.flatMap((group) => group.items);
    const sharedIds = [
      ['new-document', 'new-document'],
      ['open-file', 'open-file'],
      ['open-workspace', 'open-workspace'],
      ['save', 'save'],
      ['save-as', 'save-as'],
      ['find', 'find'],
      ['undo', 'undo'],
      ['redo', 'redo'],
      ['cut', 'cut'],
      ['copy', 'copy'],
      ['paste', 'paste'],
      ['select-all', 'select-all'],
      ['insert-image', 'image'],
      ['insert-code-block', 'code-block'],
      ['insert-table', 'insert-table'],
    ] as const;

    for (const [paletteId, menuId] of sharedIds) {
      const paletteCommand = palette.find(({ id }) => id === paletteId);
      const menuNode = findNode(menuNodes, menuId);

      expect(paletteCommand, paletteId).toBeDefined();
      expect(menuNode, menuId).toMatchObject({ type: 'item' });
      if (!paletteCommand || menuNode?.type !== 'item') {
        continue;
      }

      expect(
        {
          disabled: Boolean(paletteCommand.disabled),
          icon: paletteCommand.icon,
          label: paletteCommand.label,
          shortcut: paletteCommand.shortcut,
        },
        paletteId,
      ).toEqual({
        disabled: Boolean(menuNode.disabled),
        icon: menuNode.icon,
        label: menuNode.label,
        shortcut: menuNode.shortcut,
      });
    }

    const editorMenu = createEditorContextMenuModels({
      editorAvailable: true,
      editorState: editableSelection,
      shortcuts,
      t: (key) => key,
      target: { at: 0, kind: 'plain' },
    });
    for (const [paletteId, menuId, editorId] of [
      ['cut', 'cut', 'context-cut'],
      ['copy', 'copy', 'context-copy'],
      ['paste', 'paste', 'context-paste'],
      ['select-all', 'select-all', 'context-select-all'],
      ['insert-table', 'insert-table', 'context-insert-table'],
    ] as const) {
      const paletteCommand = palette.find(({ id }) => id === paletteId)!;
      const menuNode = findNode(menuNodes, menuId);
      const editorNode = findNode(editorMenu, editorId);
      expect(menuNode, menuId).toMatchObject({ type: 'item' });
      if (menuNode?.type !== 'item') {
        continue;
      }
      expect(editorNode, editorId).toMatchObject({
        disabled: menuNode.disabled,
        icon: menuNode.icon,
        label: menuNode.label,
        shortcut: menuNode.shortcut,
        type: 'item',
      });
      expect(editorNode, editorId).toMatchObject({
        disabled: paletteCommand.disabled,
        icon: paletteCommand.icon,
        label: paletteCommand.label,
        shortcut: paletteCommand.shortcut,
      });
    }

    expect(findNode(menuNodes, 'focus-mode')).toMatchObject({
      icon: palette.find(({ id }) => id === 'toggle-focus-mode')?.icon,
      shortcut: palette.find(({ id }) => id === 'toggle-focus-mode')?.shortcut,
    });
    expect(palette.find(({ id }) => id === 'toggle-focus-mode')?.label).toBe(
      'command.enterFocusMode',
    );
    expect(findNode(menuNodes, 'focus-mode')).toMatchObject({
      label: 'menu.focusMode',
    });
  });

  it('fails fast with an explicit error for a forged runtime action', () => {
    expect(() =>
      runCommandAction(
        {} as CommandHandlerMap,
        'forged-command' as CommandActionId,
      ),
    ).toThrowError('Unknown command action: forged-command');
  });

  it('assigns Ctrl+/ only to the three-state toggle across palette and top menu', () => {
    const palette = createCommandPaletteModels({
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: false,
      shortcuts,
      t: (key) => key,
    });
    const topMenu = createTopMenuModels({
      editorDisplayMode: 'source',
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: false,
      language: 'en',
      recentFiles: [],
      shortcuts,
      sidebarOpen: true,
      t: (key) => key,
      theme: 'dark',
    });
    const topNodes = topMenu.flatMap((group) => group.items);

    const displayModeCommand = palette.find(({ id }) => id === 'toggle-display-mode');
    expect(displayModeCommand).toMatchObject({
      invocation: { action: 'toggleDisplayMode', kind: 'action' },
      shortcut: shortcuts.sourceMode,
    });
    expect(displayModeCommand?.invocation).not.toHaveProperty('focusManagement');
    for (const id of ['live-preview-mode', 'source-mode', 'reading-mode']) {
      expect(findNode(topNodes, id), id).toMatchObject({ shortcut: undefined });
    }
    expect(palette.find(({ id }) => id === 'open-settings')).toMatchObject({
      invocation: {
        action: 'openSettings',
        focusManagement: 'action',
        kind: 'action',
      },
    });
    expect(palette.find(({ id }) => id === 'save')?.invocation).not.toHaveProperty(
      'focusManagement',
    );
  });

  it('fails fast for missing handlers, forged invocation kinds, and invalid payloads', () => {
    expect(() =>
      runCommandAction({} as CommandHandlerMap, 'openSettings'),
    ).toThrowError('Missing command handler: openSettings');

    expect(() =>
      runCommandMenuInvocation({} as CommandHandlerMaps, {
        kind: 'forged-kind',
      } as unknown as CommandMenuInvocation),
    ).toThrowError(/Unknown command invocation/);

    expect(() =>
      runCommandMenuInvocation(
        {
          actions: {} as CommandHandlerMap,
          payloadActions: {
            openLink: vi.fn(),
          } as unknown as CommandPayloadHandlerMap,
        },
        {
          action: 'openLink',
          kind: 'payloadAction',
          payload: { href: 42 },
        } as unknown as CommandMenuInvocation,
      ),
    ).toThrowError('Invalid command payload: openLink');

    expect(() =>
      runCommandMenuInvocation(
        {
          actions: {} as CommandHandlerMap,
          payloadActions: {} as CommandPayloadHandlerMap,
        },
        {
          action: 'openLink',
          kind: 'payloadAction',
          payload: { href: 'https://example.com' },
        },
      ),
    ).toThrowError('Missing command handler: openLink');
  });

  it('represents parameterized menu work as serializable payload actions', () => {
    const topMenu = createTopMenuModels({
      editorDisplayMode: 'source',
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: false,
      language: 'en',
      recentFiles: [{ name: 'one.md', path: 'E:/notes/one.md' }],
      shortcuts,
      sidebarOpen: true,
      t: (key) => key,
      theme: 'dark',
    });
    const editorMenu = createEditorContextMenuModels({
      editorAvailable: true,
      editorState: editableSelection,
      shortcuts,
      t: (key) => key,
      target: {
        from: 0,
        kind: 'image',
        src: './cover.png',
        to: 14,
      },
    });
    const fileTreeMenu = createFileTreeContextMenuModels({
      t: (key) => key,
      target: {
        kind: 'directory',
        name: 'Drafts',
        path: 'E:/notes/Drafts',
      },
    });

    expect(
      findNode(topMenu.flatMap((group) => group.items), 'recent-file-0'),
    ).toMatchObject({
      invocation: {
        action: 'openRecentFile',
        kind: 'payloadAction',
        payload: { path: 'E:/notes/one.md' },
      },
    });
    expect(findNode(editorMenu, 'copy-image-path')).toMatchObject({
      invocation: {
        action: 'copyImagePath',
        kind: 'payloadAction',
        payload: { src: './cover.png' },
      },
    });
    expect(findNode(editorMenu, 'reveal-image')).toMatchObject({
      invocation: {
        action: 'revealImage',
        kind: 'payloadAction',
        payload: { src: './cover.png' },
      },
    });
    expect(findNode(fileTreeMenu, 'file-tree-new-file')).toMatchObject({
      invocation: {
        action: 'fileTreeCreateFile',
        kind: 'payloadAction',
        payload: { parentPath: 'E:/notes/Drafts' },
      },
    });
    expect(findNode(fileTreeMenu, 'file-tree-rename')).toMatchObject({
      invocation: {
        action: 'fileTreeRename',
        kind: 'payloadAction',
        payload: {
          entryKind: 'directory',
          name: 'Drafts',
          path: 'E:/notes/Drafts',
        },
      },
    });
    expect(findNode(fileTreeMenu, 'file-tree-delete')).toMatchObject({
      invocation: {
        action: 'fileTreeDelete',
        kind: 'payloadAction',
        payload: {
          entryKind: 'directory',
          name: 'Drafts',
          path: 'E:/notes/Drafts',
        },
      },
    });
  });

  it('exposes one dispatcher for action, range, and payload handler maps', () => {
    const openSettings = vi.fn();
    const deleteTable = vi.fn();
    const openRecentFile = vi.fn();
    const handlerMaps = {
      actions: { deleteTable, openSettings } as unknown as CommandHandlerMap,
      payloadActions: { openRecentFile },
    } as unknown as CommandHandlerMaps;

    runCommandMenuInvocation(handlerMaps, {
      action: 'openSettings',
      kind: 'action',
    });
    runCommandMenuInvocation(handlerMaps, {
      action: 'deleteTable',
      kind: 'rangeAction',
      range: { from: 3, to: 9 },
    });
    runCommandMenuInvocation(handlerMaps, {
      action: 'openRecentFile',
      kind: 'payloadAction',
      payload: { path: 'E:/notes/one.md' },
    });

    expect(openSettings).toHaveBeenCalledOnce();
    expect(deleteTable).toHaveBeenCalledWith({ from: 3, to: 9 });
    expect(openRecentFile).toHaveBeenCalledWith({ path: 'E:/notes/one.md' });
  });

  it('dispatches every contextual payload to its exhaustive typed handler', () => {
    const payloadActions: CommandPayloadHandlerMap = {
      copyImagePath: vi.fn(),
      copyLinkAddress: vi.fn(),
      fileTreeCopyPath: vi.fn(),
      fileTreeCreateDirectory: vi.fn(),
      fileTreeCreateFile: vi.fn(),
      fileTreeDelete: vi.fn(),
      fileTreeRename: vi.fn(),
      fileTreeReveal: vi.fn(),
      openLink: vi.fn(),
      openRecentFile: vi.fn(),
      revealImage: vi.fn(),
    };
    const handlerMaps: CommandHandlerMaps = {
      actions: {} as CommandHandlerMap,
      payloadActions,
    };
    const invocations: CommandMenuInvocation[] = [
      { action: 'copyImagePath', kind: 'payloadAction', payload: { src: 'cover.png' } },
      { action: 'copyLinkAddress', kind: 'payloadAction', payload: { href: 'https://example.com' } },
      { action: 'fileTreeCopyPath', kind: 'payloadAction', payload: { path: 'E:/notes/a.md' } },
      { action: 'fileTreeCreateDirectory', kind: 'payloadAction', payload: { parentPath: 'E:/notes' } },
      { action: 'fileTreeCreateFile', kind: 'payloadAction', payload: { parentPath: 'E:/notes' } },
      { action: 'fileTreeDelete', kind: 'payloadAction', payload: { entryKind: 'file', name: 'a.md', path: 'E:/notes/a.md' } },
      { action: 'fileTreeRename', kind: 'payloadAction', payload: { entryKind: 'directory', name: 'Drafts', path: 'E:/notes/Drafts' } },
      { action: 'fileTreeReveal', kind: 'payloadAction', payload: { path: 'E:/notes' } },
      { action: 'openLink', kind: 'payloadAction', payload: { href: 'https://example.com' } },
      { action: 'openRecentFile', kind: 'payloadAction', payload: { path: 'E:/notes/a.md' } },
      { action: 'revealImage', kind: 'payloadAction', payload: { src: 'cover.png' } },
    ];

    for (const invocation of invocations) {
      runCommandMenuInvocation(handlerMaps, invocation);
    }

    expect(payloadActions.copyImagePath).toHaveBeenCalledWith({ src: 'cover.png' });
    expect(payloadActions.copyLinkAddress).toHaveBeenCalledWith({ href: 'https://example.com' });
    expect(payloadActions.fileTreeCopyPath).toHaveBeenCalledWith({ path: 'E:/notes/a.md' });
    expect(payloadActions.fileTreeCreateDirectory).toHaveBeenCalledWith({ parentPath: 'E:/notes' });
    expect(payloadActions.fileTreeCreateFile).toHaveBeenCalledWith({ parentPath: 'E:/notes' });
    expect(payloadActions.fileTreeDelete).toHaveBeenCalledWith({ entryKind: 'file', name: 'a.md', path: 'E:/notes/a.md' });
    expect(payloadActions.fileTreeRename).toHaveBeenCalledWith({ entryKind: 'directory', name: 'Drafts', path: 'E:/notes/Drafts' });
    expect(payloadActions.fileTreeReveal).toHaveBeenCalledWith({ path: 'E:/notes' });
    expect(payloadActions.openLink).toHaveBeenCalledWith({ href: 'https://example.com' });
    expect(payloadActions.openRecentFile).toHaveBeenCalledWith({ path: 'E:/notes/a.md' });
    expect(payloadActions.revealImage).toHaveBeenCalledWith({ src: 'cover.png' });
  });
});

describe('createCommandPaletteModels', () => {
  it('disables opening a file while another file is opening', () => {
    const commands = createCommandPaletteModels({
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: true,
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
      editorState: editableSelection,
      fileOpening: false,
      shortcuts,
      t: (key) => key,
    });

    expect(commands.find(({ id }) => id === 'insert-image')?.shortcut).toBe('Ctrl+Shift+I');
    expect(commands.find(({ id }) => id === 'insert-code-block')?.shortcut).toBe('Ctrl+Shift+K');
    expect(commands.find(({ id }) => id === 'insert-table')?.shortcut).toBe('Ctrl+T');
    expect(commands.find(({ id }) => id === 'toggle-display-mode')).toMatchObject({
      invocation: { action: 'toggleDisplayMode', kind: 'action' },
      shortcut: 'Ctrl+/',
    });
    expect(commands.every((command) => !('run' in command))).toBe(true);
    expect(commands.some(({ id }) => id === 'copy-table')).toBe(false);
    expect(commands.some(({ id }) => id === 'delete-table')).toBe(false);
  });

  it('publishes ordinary edit actions with the same localized labels and shortcuts', () => {
    const commands = createCommandPaletteModels({
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: false,
      shortcuts,
      t: (key) => key,
    });

    expect(
      commands
        .filter(({ id }) => ['cut', 'copy', 'paste', 'select-all'].includes(id))
        .map(({ id, label, shortcut }) => `${id}:${label}:${shortcut}`),
    ).toEqual([
      'cut:menu.cut:Ctrl+X',
      'copy:menu.copy:Ctrl+C',
      'paste:menu.paste:Ctrl+V',
      'select-all:menu.selectAll:Ctrl+A',
    ]);
  });

  it('disables only editor-dependent commands when the editor is unavailable', () => {
    const commands = createCommandPaletteModels({
      editorAvailable: false,
      editorState: editableSelection,
      fileOpening: false,
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
      'cut',
      'copy',
      'paste',
      'select-all',
      'focus-editor',
      'toggle-display-mode',
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
      'insert-math-block',
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
  it('disables every document-writing action while preserving read-only commands', () => {
    const commands = createCommandPaletteModels({
      editorAvailable: true,
      editorState: { ...editableSelection, readOnly: true },
      fileOpening: false,
      shortcuts,
      t: (key) => key,
    });

    expect(
      commands.filter(({ disabled }) => disabled).map(({ id }) => id),
    ).toEqual([
      'undo',
      'redo',
      'cut',
      'paste',
      'heading-1',
      'heading-2',
      'heading-3',
      'heading-4',
      'heading-5',
      'heading-6',
      'insert-horizontal-rule',
      'insert-image',
      'insert-code-block',
      'insert-math-block',
      'insert-table',
      'insert-ordered-list',
      'toggle-strikethrough',
    ]);
    expect(commands.find(({ id }) => id === 'copy')).not.toMatchObject({
      disabled: true,
    });
    expect(commands.find(({ id }) => id === 'select-all')).not.toMatchObject({
      disabled: true,
    });
    expect(commands.find(({ id }) => id === 'find')).not.toMatchObject({
      disabled: true,
    });
  });
});

describe('createEditorContextMenuModels', () => {
  const createModels = (
    target: Parameters<typeof createEditorContextMenuModels>[0]['target'],
  ) =>
    createEditorContextMenuModels({
      editorAvailable: true,
      editorState: editableSelection,
      shortcuts,
      t: (key) => key,
      target,
    });

  const actionIds = (
    nodes: ReturnType<typeof createEditorContextMenuModels>,
  ) =>
    nodes.flatMap((node) =>
      node.type === 'item' ? [node.invocation.action] : [],
    );

  it('builds the complete editor topology in fixed groups with shared recursive command nodes', () => {
    const nodes = createModels({ at: 0, kind: 'plain' });
    expect(nodes.map(({ id }) => id)).toEqual([
      'context-undo',
      'context-redo',
      'context-history-separator',
      'context-cut',
      'context-copy',
      'context-paste',
      'context-delete-selection',
      'context-select-all',
      'context-clipboard-separator',
      'context-find-selection',
      'context-find-separator',
      'context-format',
      'context-paragraph',
      'context-insert',
    ]);
    expect(actionIds(nodes)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'deleteSelection',
      'selectAll',
      'openSearch',
    ]);
    expect(
      (findNode(nodes, 'context-format') as Extract<CommandMenuNode, { type: 'submenu' }>).items.map(
        ({ id }) => id,
      ),
    ).toEqual([
      'context-bold',
      'context-italic',
      'context-strikethrough',
      'context-inline-code',
      'context-link',
    ]);
    expect(
      (findNode(nodes, 'context-paragraph') as Extract<CommandMenuNode, { type: 'submenu' }>).items.map(
        ({ id }) => id,
      ),
    ).toEqual([
      'context-normal-paragraph',
      'context-heading-1',
      'context-heading-2',
      'context-heading-3',
      'context-heading-4',
      'context-heading-5',
      'context-heading-6',
      'context-quote',
      'context-ordered-list',
      'context-unordered-list',
      'context-task-list',
      'context-code-block',
    ]);
    expect(
      (findNode(nodes, 'context-insert') as Extract<CommandMenuNode, { type: 'submenu' }>).items.map(
        ({ id }) => id,
      ),
    ).toEqual([
      'context-insert-image',
      'context-insert-table',
      'context-horizontal-rule',
    ]);
    expect(findNode(nodes, 'context-insert-table')).toMatchObject({
      shortcut: 'Ctrl+T',
      type: 'item',
    });
    expect(findNode(nodes, 'context-delete-selection')).toMatchObject({
      danger: true,
      shortcut: 'Delete',
      type: 'item',
    });
  });

  it('appends copy and delete actions after the shared actions for a table target', () => {
    const nodes = createModels({ from: 4, kind: 'table', to: 18 });

    expect(actionIds(nodes)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'deleteSelection',
      'selectAll',
      'openSearch',
      'copyTable',
      'deleteTable',
    ]);
    expect(findNode(nodes, 'context-copy-table')).toMatchObject({
      invocation: {
        action: 'copyTable',
        kind: 'rangeAction',
        range: { from: 4, to: 18 },
      },
    });
    expect(findNode(nodes, 'context-delete-table')).toMatchObject({
      danger: true,
      invocation: {
        action: 'deleteTable',
        kind: 'rangeAction',
        range: { from: 4, to: 18 },
      },
    });
  });

  it('exposes open and copy link actions for a link target', () => {
    const nodes = createModels({
      from: 0,
      href: 'foo(bar).md',
      kind: 'link',
      rawHref: 'foo\\(bar\\).md',
      to: 8,
    });

    expect(actionIds(nodes)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'deleteSelection',
      'selectAll',
      'openSearch',
      'openLink',
      'copyLinkAddress',
    ]);
    expect(nodes.some((node) => node.type === 'separator')).toBe(true);

    const openNode = nodes.find((node) => node.id === 'open-link');
    const copyNode = nodes.find((node) => node.id === 'copy-link-address');
    expect(openNode).toMatchObject({
      invocation: {
        action: 'openLink',
        kind: 'payloadAction',
        payload: { href: 'foo(bar).md' },
      },
    });
    expect(copyNode).toMatchObject({
      invocation: {
        action: 'copyLinkAddress',
        kind: 'payloadAction',
        payload: { href: 'foo\\(bar\\).md' },
      },
    });
  });

  it('hides link actions for code targets', () => {
    expect(
      actionIds(createModels({ from: 0, kind: 'codeBlock', to: 4 })),
    ).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'deleteSelection',
      'selectAll',
      'openSearch',
    ]);
  });

  it('exposes copy path, reveal, and delete reference for a local image target', () => {
    const nodes = createEditorContextMenuModels({
      editorAvailable: true,
      editorState: editableSelection,
      shortcuts,
      t: (key) => key,
      target: {
        from: 0,
        kind: 'image',
        src: './a.png',
        to: 12,
      },
    });

    expect(actionIds(nodes)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'deleteSelection',
      'selectAll',
      'openSearch',
      'copyImagePath',
      'revealImage',
      'deleteImageReference',
    ]);

    const copyNode = nodes.find((node) => node.id === 'copy-image-path');
    const revealNode = nodes.find((node) => node.id === 'reveal-image');
    const deleteNode = nodes.find(
      (node) => node.id === 'delete-image-reference',
    );
    expect(deleteNode).toMatchObject({
      invocation: {
        action: 'deleteImageReference',
        focusManagement: 'action',
        kind: 'rangeAction',
        range: { from: 0, to: 12 },
      },
    });
    expect(copyNode).toMatchObject({
      invocation: {
        action: 'copyImagePath',
        kind: 'payloadAction',
        payload: { src: './a.png' },
      },
    });
    expect(revealNode).toMatchObject({
      invocation: {
        action: 'revealImage',
        kind: 'payloadAction',
        payload: { src: './a.png' },
      },
    });
  });

  it('hides reveal for remote image targets while keeping copy and delete', () => {
    const nodes = createEditorContextMenuModels({
      editorAvailable: true,
      editorState: editableSelection,
      shortcuts,
      t: (key) => key,
      target: {
        from: 0,
        kind: 'image',
        src: 'https://example.com/a.png',
        to: 30,
      },
    });

    expect(actionIds(nodes)).toEqual([
      'undo',
      'redo',
      'cut',
      'copy',
      'paste',
      'deleteSelection',
      'selectAll',
      'openSearch',
      'copyImagePath',
      'deleteImageReference',
    ]);
  });

  it('allows only copy, select-all, find, and exact contextual copy in read-only mode', () => {
    const nodes = createEditorContextMenuModels({
      editorAvailable: true,
      editorState: {
        ...editableSelection,
        canRedo: false,
        canUndo: false,
        clipboardReadAvailable: false,
        clipboardWriteAvailable: true,
        readOnly: true,
      },
      shortcuts,
      t: (key) => key,
      target: { from: 4, kind: 'table', to: 18 },
    });

    expect(
      collectInvokableNodes(nodes)
        .filter((node) => !node.disabled)
        .map(({ id }) => id),
    ).toEqual([
      'context-copy',
      'context-select-all',
      'context-find-selection',
      'context-copy-table',
    ]);
  });

  it('blocks composition-sensitive changes while keeping copy, select-all, find, and history available', () => {
    const nodes = createEditorContextMenuModels({
      editorAvailable: true,
      editorState: { ...editableSelection, composing: true },
      shortcuts,
      t: (key) => key,
      target: { at: 0, kind: 'plain' },
    });

    for (const id of [
      'context-cut',
      'context-paste',
      'context-delete-selection',
      'context-bold',
      'context-normal-paragraph',
      'context-insert-image',
    ]) {
      expect(findNode(nodes, id), id).toMatchObject({ disabled: true });
    }
    for (const id of [
      'context-undo',
      'context-redo',
      'context-copy',
      'context-select-all',
      'context-find-selection',
    ]) {
      expect(findNode(nodes, id), id).not.toMatchObject({ disabled: true });
    }
  });

  it('disables main-selection mutations for multiple selections but keeps exact table range actions available', () => {
    const nodes = createEditorContextMenuModels({
      editorAvailable: true,
      editorState: {
        ...editableSelection,
        eligibleFindSelection: false,
        selectionCount: 2,
        selectionLength: 8,
      },
      shortcuts,
      t: (key) => key,
      target: { from: 4, kind: 'table', to: 18 },
    });

    for (const id of [
      'context-cut',
      'context-paste',
      'context-delete-selection',
      'context-bold',
      'context-normal-paragraph',
      'context-insert-table',
    ]) {
      expect(findNode(nodes, id), id).toMatchObject({ disabled: true });
    }
    expect(findNode(nodes, 'context-copy')).not.toMatchObject({ disabled: true });
    expect(findNode(nodes, 'context-find')).not.toMatchObject({ disabled: true });
    expect(findNode(nodes, 'context-find-selection')).toBeUndefined();
    expect(findNode(nodes, 'context-copy-table')).not.toMatchObject({ disabled: true });
    expect(findNode(nodes, 'context-delete-table')).not.toMatchObject({ disabled: true });
  });

  it.each([
    { from: 0, kind: 'codeBlock' as const, to: 4 },
    { from: 0, kind: 'mermaid' as const, to: 4 },
    { from: 0, kind: 'image' as const, src: './a.png', to: 4 },
    { from: 0, kind: 'table' as const, to: 4 },
  ])('disables format and insert groups for unsafe $kind targets', (target) => {
    const nodes = createModels(target);

    expect(findNode(nodes, 'context-format')).toMatchObject({ disabled: true });
    expect(findNode(nodes, 'context-paragraph')).toMatchObject({ disabled: true });
    expect(findNode(nodes, 'context-insert')).toMatchObject({ disabled: true });
    expect(findNode(nodes, 'context-bold')).toMatchObject({ disabled: true });
    expect(findNode(nodes, 'context-insert-table')).toMatchObject({ disabled: true });
  });

  it('disables contextual copy and delete actions from the same live editor state', () => {
    const unavailableClipboard = {
      ...editableSelection,
      clipboardReadAvailable: true,
      clipboardWriteAvailable: false,
      readOnly: true,
    } as const;
    const createTargetModels = (
      target: Parameters<typeof createEditorContextMenuModels>[0]['target'],
    ) =>
      createEditorContextMenuModels({
        editorAvailable: true,
        editorState: unavailableClipboard,
        shortcuts,
        t: (key) => key,
        target,
      });
    const linkNodes = createTargetModels({
      from: 0,
      href: 'https://example.com',
      kind: 'link',
      rawHref: 'https://example.com',
      to: 8,
    });
    const imageNodes = createTargetModels({
      from: 0,
      kind: 'image',
      src: './a.png',
      to: 12,
    });
    const tableNodes = createTargetModels({ from: 4, kind: 'table', to: 18 });

    expect(findNode(linkNodes, 'copy-link-address')).toMatchObject({
      disabled: true,
    });
    expect(findNode(linkNodes, 'open-link')).toMatchObject({ disabled: true });
    expect(findNode(imageNodes, 'copy-image-path')).toMatchObject({
      disabled: true,
    });
    expect(findNode(imageNodes, 'delete-image-reference')).toMatchObject({
      disabled: true,
    });
    expect(findNode(imageNodes, 'reveal-image')).toMatchObject({ disabled: true });
    expect(findNode(tableNodes, 'context-copy-table')).toMatchObject({
      disabled: true,
    });
    expect(findNode(tableNodes, 'context-delete-table')).toMatchObject({
      disabled: true,
    });
  });

  it('keeps contextual copy enabled in read-only mode when clipboard write is available', () => {
    const readOnlyState = { ...editableSelection, readOnly: true } as const;
    const createTargetModels = (
      target: Parameters<typeof createEditorContextMenuModels>[0]['target'],
    ) =>
      createEditorContextMenuModels({
        editorAvailable: true,
        editorState: readOnlyState,
        shortcuts,
        t: (key) => key,
        target,
      });

    expect(
      findNode(
        createTargetModels({
          from: 0,
          href: 'https://example.com',
          kind: 'link',
          rawHref: 'https://example.com',
          to: 8,
        }),
        'copy-link-address',
      ),
    ).not.toMatchObject({ disabled: true });
    expect(
      findNode(
        createTargetModels({ from: 0, kind: 'image', src: './a.png', to: 12 }),
        'copy-image-path',
      ),
    ).not.toMatchObject({ disabled: true });
    expect(
      findNode(
        createTargetModels({ from: 4, kind: 'table', to: 18 }),
        'context-copy-table',
      ),
    ).not.toMatchObject({ disabled: true });
  });

  it('disables every editor action when there is no editor', () => {
    const nodes = createEditorContextMenuModels({
      editorAvailable: false,
      editorState: editableSelection,
      shortcuts,
      t: (key) => key,
      target: { at: 0, kind: 'plain' },
    });

    expect(
      nodes
        .filter((node) => node.type === 'item')
        .every((node) => node.disabled),
    ).toBe(true);
  });
});

describe('createTopMenuModels', () => {
  const createModels = (overrides: Record<string, unknown> = {}) =>
    createTopMenuModels({
      editorDisplayMode: 'source',
      editorAvailable: true,
      editorState: editableSelection,
      fileOpening: false,
      focusMode: true,
      language: 'zh-CN',
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
        'cut:cut:Ctrl+X',
        'copy:copy:Ctrl+C',
        'paste:paste:Ctrl+V',
        'select-all:selectAll:Ctrl+A',
        'find:openSearch:Ctrl+F',
        'command-palette:openCommandPalette:Ctrl+K',
      ],
      file: [
        'new-document:newDocument:Ctrl+N',
        'open-file:openFile:Ctrl+O',
        'recent-file-0:openRecentFile:',
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
        'insert-math-block:math:Ctrl+Shift+M',
        'insert-table:table:Ctrl+T',
        'horizontal-rule:horizontalRule:',
      ],
      theme: [
        'theme-light:setLightTheme:',
        'theme-dark:setDarkTheme:',
        'theme-system:setSystemTheme:',
      ],
      view: [
        'live-preview-mode:setLivePreviewMode:',
        'source-mode:setSourceMode:',
        'reading-mode:setReadingMode:',
        'sidebar:toggleSidebar:Ctrl+\\',
        'focus-mode:toggleFocusMode:Ctrl+Shift+F',
        'reset-zoom:resetZoom:',
        'focus-editor:focusEditor:',
      ],
    });
  });

  it('shares ordinary edit actions while keeping destructive table actions contextual', () => {
    const edit = createModels().find((group) => group.id === 'edit');

    expect(edit?.items.map((item) => item.id)).toEqual([
      'undo',
      'redo',
      'edit-history-separator',
      'cut',
      'copy',
      'paste',
      'select-all',
      'edit-clipboard-separator',
      'find',
      'command-palette',
    ]);
    expect(JSON.stringify(edit)).not.toContain('deleteTable');
    expect(JSON.stringify(edit)).not.toContain('copyTable');
  });

  it('projects edit disabled state without subscribing React to selection changes', () => {
    const edit = createModels({
      editorDisplayMode: 'reading',
      editorState: {
        ...editableSelection,
        clipboardReadAvailable: true,
        clipboardWriteAvailable: true,
        readOnly: true,
        selectionEmpty: true,
        selectionLength: 0,
      },
    }).find((group) => group.id === 'edit');

    expect(findNode(edit?.items ?? [], 'cut')).toMatchObject({ disabled: true });
    expect(findNode(edit?.items ?? [], 'copy')).toMatchObject({ disabled: true });
    expect(findNode(edit?.items ?? [], 'paste')).toMatchObject({ disabled: true });
    expect(findNode(edit?.items ?? [], 'select-all')).not.toMatchObject({
      disabled: true,
    });
  });

  it('projects read-only write protection through every nested top-menu action', () => {
    const groups = createModels({
      editorDisplayMode: 'reading',
      editorState: { ...editableSelection, readOnly: true },
    });
    const nodes = groups.flatMap((group) => group.items);

    for (const id of [
      'undo',
      'redo',
      'cut',
      'paste',
      'normal-paragraph',
      'heading-1',
      'ordered-list',
      'quote',
      'code-block',
      'insert-math-block',
      'insert-table',
      'horizontal-rule',
      'bold',
      'italic',
      'strikethrough',
      'inline-code',
      'link',
      'image',
    ]) {
      expect(findNode(nodes, id), id).toMatchObject({ disabled: true });
    }

    for (const id of ['copy', 'select-all', 'find', 'source-mode', 'save-as']) {
      expect(findNode(nodes, id), id).not.toMatchObject({ disabled: true });
    }
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
      shortcut: undefined,
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

  it('projects the system theme through the existing typed theme radio group', () => {
    const groups = createModels({ theme: 'system' });
    const nodes = groups.flatMap((group) => group.items);

    expect(findNode(nodes, 'theme-system')).toMatchObject({
      checked: true,
      invocation: { action: 'setSystemTheme', kind: 'action' },
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
      'cut',
      'copy',
      'paste',
      'select-all',
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
      'insert-math-block',
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
      'theme-system',
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

  it('creates typed parameterized recent-file payload actions', () => {
    const file = createModels({
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
    expect(second).toMatchObject({
      invocation: {
        action: 'openRecentFile',
        kind: 'payloadAction',
        payload: { path: 'E:/notes/二.md' },
      },
    });
  });

  it('shows a truthful empty state when there are no recent files', () => {
    const file = createModels().find((group) => group.id === 'file');

    expect(findNode(file?.items ?? [], 'recent-files-empty')).toMatchObject({
      disabled: true,
      label: 'recentFiles.empty',
      type: 'label',
    });
  });
});

describe('createFileTreeContextMenuModels', () => {
  const ids = (
    nodes: ReturnType<typeof createFileTreeContextMenuModels>,
  ) =>
    nodes
      .filter((node) => node.type === 'item')
      .map((node) => node.id);

  it('offers create actions without delete for the workspace root', () => {
    const nodes = createFileTreeContextMenuModels({
      t: (key) => key,
      target: {
        kind: 'workspaceRoot',
        name: 'Notes',
        path: 'E:/docs/Notes',
      },
    });

    expect(ids(nodes)).toEqual([
      'file-tree-new-file',
      'file-tree-new-folder',
      'file-tree-reveal',
      'file-tree-copy-path',
    ]);
    expect(ids(nodes)).not.toContain('file-tree-delete');
    expect(ids(nodes)).not.toContain('file-tree-rename');
  });

  it('offers directory mutations including delete', () => {
    const nodes = createFileTreeContextMenuModels({
      t: (key) => key,
      target: {
        kind: 'directory',
        name: 'Drafts',
        path: 'E:/docs/Notes/Drafts',
      },
    });

    expect(ids(nodes)).toEqual([
      'file-tree-new-file',
      'file-tree-new-folder',
      'file-tree-rename',
      'file-tree-reveal',
      'file-tree-copy-path',
      'file-tree-delete',
    ]);

    const newFile = nodes.find((node) => node.id === 'file-tree-new-file');
    expect(newFile).toMatchObject({
      invocation: {
        action: 'fileTreeCreateFile',
        kind: 'payloadAction',
        payload: { parentPath: 'E:/docs/Notes/Drafts' },
      },
    });

    const rename = nodes.find((node) => node.id === 'file-tree-rename');
    expect(rename).toMatchObject({
      invocation: {
        action: 'fileTreeRename',
        kind: 'payloadAction',
        payload: {
          entryKind: 'directory',
          name: 'Drafts',
          path: 'E:/docs/Notes/Drafts',
        },
      },
    });
  });

  it('offers file mutations without create actions', () => {
    const nodes = createFileTreeContextMenuModels({
      t: (key) => key,
      target: {
        kind: 'file',
        name: 'note.md',
        path: 'E:/docs/Notes/note.md',
      },
    });

    expect(ids(nodes)).toEqual([
      'file-tree-rename',
      'file-tree-reveal',
      'file-tree-copy-path',
      'file-tree-delete',
    ]);

    const rename = nodes.find((node) => node.id === 'file-tree-rename');
    expect(rename).toMatchObject({
      invocation: {
        action: 'fileTreeRename',
        kind: 'payloadAction',
        payload: {
          entryKind: 'file',
          name: 'note.md',
          path: 'E:/docs/Notes/note.md',
        },
      },
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
    if (node.type === 'label' || node.type === 'separator') {
      return [];
    }

    if (node.type === 'submenu') {
      return collectLeafContracts(node.items);
    }

    const action = node.invocation.action;

    return [`${node.id}:${action}:${node.shortcut ?? ''}`];
  });
}

function collectActionNodes(
  nodes: readonly CommandMenuNode[],
): Extract<CommandMenuNode, { type: 'checkbox' | 'item' | 'radio' }>[] {
  return nodes.flatMap((node) => {
    if (node.type === 'label' || node.type === 'separator') {
      return [];
    }

    if (node.type === 'submenu') {
      return collectActionNodes(node.items);
    }

    return node.invocation.kind === 'action' ? [node] : [];
  });
}

function collectInvokableNodes(
  nodes: readonly CommandMenuNode[],
): Extract<CommandMenuNode, { type: 'checkbox' | 'item' | 'radio' }>[] {
  return nodes.flatMap((node) => {
    if (node.type === 'label' || node.type === 'separator') {
      return [];
    }

    if (node.type === 'submenu') {
      return collectInvokableNodes(node.items);
    }

    return [node];
  });
}
