import { Bold, FilePlus, FileText, History, List, Pilcrow, Quote } from 'lucide-react';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import type { EditorEditState } from '../../editor/commands/editorCommandPort';
import type {
  EditorContextTarget,
  EditorInteractionRange,
} from '../../editor/interaction';
import type {
  CommandActionId,
  CommandMenuGroup,
  CommandMenuInvocation,
  CommandMenuNode,
  CommandModel,
  CommandPayloadInvocation,
  CommandRangeActionId,
  CommandShortcutLabels,
} from './commandTypes';
import { isCommandActionDisabled } from './commandAvailability';
import {
  resolveCommandPresentation,
  type CommandScene,
} from './commandRegistry';
export {
  runCommandAction,
  runCommandMenuInvocation,
} from './commandInvocation';

type Translate = (key: string) => string;

type CommandPresentationBuildContext = {
  focusMode?: boolean;
  scene: CommandScene;
  shortcuts?: CommandShortcutLabels;
  t: Translate;
};

type CommandBuildContext = CommandPresentationBuildContext & {
  editorAvailable: boolean;
  editorState: EditorEditState;
  fileOpening?: boolean;
};

export function createCommandPaletteModels({
  editorAvailable,
  editorState,
  fileOpening,
  focusMode = false,
  shortcuts,
  t,
}: {
  editorAvailable: boolean;
  editorState: EditorEditState;
  fileOpening: boolean;
  focusMode?: boolean;
  shortcuts: CommandShortcutLabels;
  t: Translate;
}): readonly CommandModel[] {
  const context: CommandBuildContext = {
    editorAvailable,
    editorState,
    fileOpening,
    focusMode,
    scene: 'palette',
    shortcuts,
    t,
  };
  const actionCommand = (
    id: string,
    action: Exclude<CommandActionId, CommandRangeActionId>,
  ) => {
    const presentation = resolveCommandPresentation(action, context);
    const invocation: CommandMenuInvocation =
      presentation.focusManagement === 'action'
        ? { action, focusManagement: 'action', kind: 'action' }
        : { action, kind: 'action' };
    return command(
      id,
      presentation.icon,
      presentation.label,
      invocation,
      {
        disabled: commandDisabled(action, context),
        shortcut: presentation.shortcut,
      },
    );
  };

  return [
    actionCommand('new-document', 'newDocument'),
    actionCommand('open-file', 'openFile'),
    actionCommand('open-workspace', 'openWorkspace'),
    actionCommand('save', 'save'),
    actionCommand('save-as', 'saveAs'),
    actionCommand('find', 'openSearch'),
    actionCommand('undo', 'undo'),
    actionCommand('redo', 'redo'),
    actionCommand('cut', 'cut'),
    actionCommand('copy', 'copy'),
    actionCommand('paste', 'paste'),
    actionCommand('select-all', 'selectAll'),
    actionCommand('toggle-theme', 'toggleTheme'),
    actionCommand('toggle-language', 'toggleLanguage'),
    actionCommand('toggle-sidebar', 'toggleSidebar'),
    actionCommand('focus-editor', 'focusEditor'),
    actionCommand('toggle-display-mode', 'toggleDisplayMode'),
    actionCommand('toggle-focus-mode', 'toggleFocusMode'),
    actionCommand('reset-zoom', 'resetZoom'),
    actionCommand('open-settings', 'openSettings'),
    actionCommand('check-for-updates', 'checkForUpdates'),
    actionCommand('heading-1', 'heading1'),
    actionCommand('heading-2', 'heading2'),
    actionCommand('heading-3', 'heading3'),
    actionCommand('heading-4', 'heading4'),
    actionCommand('heading-5', 'heading5'),
    actionCommand('heading-6', 'heading6'),
    actionCommand('insert-horizontal-rule', 'horizontalRule'),
    actionCommand('insert-image', 'image'),
    actionCommand('insert-code-block', 'codeBlock'),
    actionCommand('insert-table', 'table'),
    actionCommand('insert-ordered-list', 'orderedList'),
    actionCommand('toggle-strikethrough', 'strikethrough'),
  ];
}

function command(
  id: string,
  icon: CommandModel['icon'],
  label: string,
  invocation: CommandMenuInvocation,
  options: { disabled?: boolean; shortcut?: string } = {},
): CommandModel {
  return {
    icon,
    id,
    disabled: options.disabled,
    invocation,
    keywords: [label],
    label,
    shortcut: options.shortcut,
  };
}

export function createTopMenuModels({
  editorDisplayMode,
  editorAvailable,
  editorState,
  fileOpening,
  focusMode = false,
  language,
  recentFiles,
  shortcuts,
  sidebarOpen,
  t,
  theme,
}: {
  editorDisplayMode: EditorDisplayMode;
  editorAvailable: boolean;
  editorState: EditorEditState;
  fileOpening: boolean;
  focusMode?: boolean;
  language: 'en' | 'zh-CN';
  recentFiles: readonly { name: string; path: string }[];
  sidebarOpen: boolean;
  shortcuts: CommandShortcutLabels;
  t: Translate;
  theme: 'dark' | 'light' | 'system';
}): CommandMenuGroup[] {
  const context: CommandBuildContext = {
    editorAvailable,
    editorState,
    fileOpening,
    focusMode,
    scene: 'topMenu',
    shortcuts,
    t,
  };
  const item = (
    id: string,
    action: Exclude<CommandActionId, CommandRangeActionId>,
  ) => menuItem(id, action, context);
  const choice = (
    id: string,
    group: string,
    action: Exclude<CommandActionId, CommandRangeActionId>,
    checked: boolean,
  ) => radio(id, group, action, checked, context);
  const toggle = (
    id: string,
    action: Exclude<CommandActionId, CommandRangeActionId>,
    checked: boolean,
  ) => checkbox(id, action, checked, context);
  const groups: CommandMenuGroup[] = [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        item('new-document', 'newDocument'),
        item('open-file', 'openFile'),
        submenu(
          'recent-files',
          History,
          t('recentFiles.title'),
          recentFiles.length
            ? recentFiles.map((file, index) =>
                payloadMenuItem(
                  `recent-file-${index}`,
                  {
                    action: 'openRecentFile',
                    kind: 'payloadAction',
                    payload: { path: file.path },
                  },
                  context,
                  { label: file.name },
                ),
              )
            : [
                menuLabel(
                  'recent-files-empty',
                  FileText,
                  t('recentFiles.empty'),
                ),
              ],
          isCommandActionDisabled('openRecentFile', { fileOpening }),
        ),
        item('open-workspace', 'openWorkspace'),
        separator('file-open-separator'),
        item('save', 'save'),
        item('save-as', 'saveAs'),
        separator('file-settings-separator'),
        item('settings', 'openSettings'),
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        item('undo', 'undo'),
        item('redo', 'redo'),
        separator('edit-history-separator'),
        item('cut', 'cut'),
        item('copy', 'copy'),
        item('paste', 'paste'),
        item('select-all', 'selectAll'),
        separator('edit-clipboard-separator'),
        item('find', 'openSearch'),
        item('command-palette', 'openCommandPalette'),
      ],
    },
    {
      id: 'paragraph',
      label: t('menu.paragraph'),
      items: [
        item('normal-paragraph', 'paragraph'),
        separator('paragraph-heading-separator'),
        ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
          item(`heading-${level}`, `heading${level}`),
        ),
        separator('paragraph-block-separator'),
        submenu('lists', List, t('menu.lists'), [
          item('ordered-list', 'orderedList'),
          item('unordered-list', 'unorderedList'),
          item('task-list', 'taskList'),
        ]),
        submenu('blocks', Quote, t('menu.blocks'), [
          item('quote', 'quote'),
          item('code-block', 'codeBlock'),
        ]),
        submenu('insert', FileText, t('menu.insert'), [
          item('insert-table', 'table'),
          item('horizontal-rule', 'horizontalRule'),
        ]),
      ],
    },
    {
      id: 'format',
      label: t('menu.format'),
      items: [
        item('bold', 'bold'),
        item('italic', 'italic'),
        item('strikethrough', 'strikethrough'),
        item('inline-code', 'inlineCode'),
        separator('format-link-separator'),
        item('link', 'link'),
        item('image', 'image'),
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        choice('live-preview-mode', 'display-mode', 'setLivePreviewMode', editorDisplayMode === 'livePreview'),
        choice('source-mode', 'display-mode', 'setSourceMode', editorDisplayMode === 'source'),
        choice('reading-mode', 'display-mode', 'setReadingMode', editorDisplayMode === 'reading'),
        separator('view-mode-separator'),
        toggle('sidebar', 'toggleSidebar', sidebarOpen),
        toggle('focus-mode', 'toggleFocusMode', focusMode),
        separator('view-focus-separator'),
        item('reset-zoom', 'resetZoom'),
        item('focus-editor', 'focusEditor'),
      ],
    },
    {
      id: 'theme',
      label: t('menu.theme'),
      items: [
        choice('theme-light', 'theme', 'setLightTheme', theme === 'light'),
        choice('theme-dark', 'theme', 'setDarkTheme', theme === 'dark'),
        choice('theme-system', 'theme', 'setSystemTheme', theme === 'system'),
      ],
    },
    {
      id: 'language',
      label: t('menu.language'),
      items: [
        choice('language-zh', 'language', 'setChineseLanguage', language === 'zh-CN'),
        choice('language-en', 'language', 'setEnglishLanguage', language === 'en'),
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        item('check-for-updates', 'checkForUpdates'),
        item('about', 'openAbout'),
      ],
    },
  ];

  return groups;
}

function menuItem(
  id: string,
  action: Exclude<CommandActionId, CommandRangeActionId>,
  context: CommandBuildContext,
  disabled = false,
): Extract<CommandMenuNode, { type: 'item' }> {
  const presentation = resolveCommandPresentation(action, context);
  return {
    disabled: commandDisabled(action, context, disabled),
    icon: presentation.icon,
    id,
    invocation: presentation.focusManagement === 'action'
      ? { action, focusManagement: 'action', kind: 'action' }
      : { action, kind: 'action' },
    label: presentation.label,
    shortcut: presentation.shortcut,
    type: 'item',
  };
}

function rangeMenuItem(
  id: string,
  action: CommandRangeActionId,
  range: EditorInteractionRange,
  context: CommandBuildContext,
  disabled = false,
): Extract<CommandMenuNode, { type: 'item' }> {
  const presentation = resolveCommandPresentation(action, context);
  return {
    disabled: commandDisabled(action, context, disabled),
    icon: presentation.icon,
    id,
    invocation: {
      action,
      ...(presentation.focusManagement === 'action'
        ? { focusManagement: 'action' as const }
        : {}),
      kind: 'rangeAction',
      range,
    },
    label: presentation.label,
    shortcut: presentation.shortcut,
    type: 'item',
  };
}

function separator(id: string): CommandMenuNode {
  return { id, type: 'separator' };
}

function submenu(
  id: string,
  icon: CommandModel['icon'],
  label: string,
  items: CommandMenuNode[],
  disabled?: boolean,
): CommandMenuNode {
  return { disabled, icon, id, items, label, type: 'submenu' };
}

function menuLabel(
  id: string,
  icon: CommandModel['icon'],
  label: string,
): CommandMenuNode {
  return {
    disabled: true,
    icon,
    id,
    label,
    type: 'label',
  };
}

function payloadMenuItem(
  id: string,
  invocation: CommandPayloadInvocation,
  context: CommandPresentationBuildContext,
  { disabled = false, label }: { disabled?: boolean; label?: string } = {},
): CommandMenuNode {
  const presentation = resolveCommandPresentation(invocation.action, {
    ...context,
    label,
  });
  const resolvedInvocation: CommandPayloadInvocation =
    presentation.focusManagement === 'action'
      ? { ...invocation, focusManagement: 'action' }
      : invocation;
  return {
    disabled: isCommandActionDisabled(invocation.action, {
      surfaceDisabled: disabled,
    }),
    icon: presentation.icon,
    id,
    invocation: resolvedInvocation,
    label: presentation.label,
    shortcut: presentation.shortcut,
    type: 'item',
  };
}

function checkbox(
  id: string,
  action: Exclude<CommandActionId, CommandRangeActionId>,
  checked: boolean,
  context: CommandBuildContext,
): CommandMenuNode {
  const presentation = resolveCommandPresentation(action, context);
  return {
    checked,
    disabled: commandDisabled(action, context),
    icon: presentation.icon,
    id,
    invocation: presentation.focusManagement === 'action'
      ? { action, focusManagement: 'action', kind: 'action' }
      : { action, kind: 'action' },
    label: presentation.label,
    shortcut: presentation.shortcut,
    type: 'checkbox',
  };
}

function radio(
  id: string,
  group: string,
  action: Exclude<CommandActionId, CommandRangeActionId>,
  checked: boolean,
  context: CommandBuildContext,
): CommandMenuNode {
  const presentation = resolveCommandPresentation(action, context);
  return {
    checked,
    disabled: commandDisabled(action, context),
    group,
    icon: presentation.icon,
    id,
    invocation: presentation.focusManagement === 'action'
      ? { action, focusManagement: 'action', kind: 'action' }
      : { action, kind: 'action' },
    label: presentation.label,
    shortcut: presentation.shortcut,
    type: 'radio',
  };
}

function commandDisabled(
  action: CommandActionId,
  context: CommandBuildContext,
  disabled = false,
): boolean {
  return (
    disabled ||
    isCommandActionDisabled(action, {
      editorAvailable: context.editorAvailable,
      editorState: context.editorState,
      fileOpening: context.fileOpening,
    })
  );
}

export type FileTreeContextTarget = {
  kind: 'directory' | 'file' | 'workspaceRoot';
  name: string;
  path: string;
};

export function createFileTreeContextMenuModels({
  t,
  target,
}: {
  t: Translate;
  target: FileTreeContextTarget;
}): CommandMenuNode[] {
  const context: CommandPresentationBuildContext = {
    scene: 'fileTreeContext',
    t,
  };
  const nodes: CommandMenuNode[] = [];

  if (target.kind === 'workspaceRoot' || target.kind === 'directory') {
    nodes.push(
      payloadMenuItem(
        'file-tree-new-file',
        {
          action: 'fileTreeCreateFile',
          kind: 'payloadAction',
          payload: { parentPath: target.path },
        },
        context,
      ),
      payloadMenuItem(
        'file-tree-new-folder',
        {
          action: 'fileTreeCreateDirectory',
          kind: 'payloadAction',
          payload: { parentPath: target.path },
        },
        context,
      ),
    );
  }

  if (target.kind === 'directory' || target.kind === 'file') {
    nodes.push(
      payloadMenuItem(
        'file-tree-rename',
        {
          action: 'fileTreeRename',
          kind: 'payloadAction',
          payload: {
            entryKind: target.kind,
            name: target.name,
            path: target.path,
          },
        },
        context,
      ),
    );
  }

  if (nodes.length > 0) {
    nodes.push(separator('file-tree-mutate-separator'));
  }

  nodes.push(
    payloadMenuItem(
      'file-tree-reveal',
      {
        action: 'fileTreeReveal',
        kind: 'payloadAction',
        payload: { path: target.path },
      },
      context,
    ),
    payloadMenuItem(
      'file-tree-copy-path',
      {
        action: 'fileTreeCopyPath',
        kind: 'payloadAction',
        payload: { path: target.path },
      },
      context,
    ),
  );

  if (target.kind === 'directory' || target.kind === 'file') {
    nodes.push(
      separator('file-tree-delete-separator'),
      payloadMenuItem(
        'file-tree-delete',
        {
          action: 'fileTreeDelete',
          kind: 'payloadAction',
          payload: {
            entryKind: target.kind,
            name: target.name,
            path: target.path,
          },
        },
        context,
      ),
    );
  }

  return nodes;
}

export function createEditorContextMenuModels({
  editorAvailable,
  editorState,
  shortcuts,
  t,
  target,
}: {
  editorAvailable: boolean;
  editorState: EditorEditState;
  shortcuts: CommandShortcutLabels;
  t: Translate;
  target: EditorContextTarget;
}): CommandMenuNode[] {
  const context: CommandBuildContext = {
    editorAvailable,
    editorState,
    scene: 'editorContext',
    shortcuts,
    t,
  };
  const item = (
    id: string,
    action: Exclude<CommandActionId, CommandRangeActionId>,
    {
      danger,
      disabled = false,
      label,
    }: { danger?: boolean; disabled?: boolean; label?: string } = {},
  ) => ({
    ...menuItem(id, action, context, disabled),
    danger,
    ...(label ? { label } : {}),
  });
  const unsafeTarget =
    target.kind === 'codeBlock' ||
    target.kind === 'image' ||
    target.kind === 'mermaid' ||
    target.kind === 'table';
  const formatTargetDisabled = unsafeTarget;
  const insertTargetDisabled = unsafeTarget;
  const formatItems: CommandMenuNode[] = [
    item('context-bold', 'bold', { disabled: formatTargetDisabled }),
    item('context-italic', 'italic', { disabled: formatTargetDisabled }),
    item('context-strikethrough', 'strikethrough', {
      disabled: formatTargetDisabled,
    }),
    item('context-inline-code', 'inlineCode', {
      disabled: formatTargetDisabled,
    }),
    item('context-link', 'link', { disabled: formatTargetDisabled }),
  ];
  const paragraphItems: CommandMenuNode[] = [
    item('context-normal-paragraph', 'paragraph', {
      disabled: formatTargetDisabled,
    }),
    item('context-heading-1', 'heading1', { disabled: formatTargetDisabled }),
    item('context-heading-2', 'heading2', { disabled: formatTargetDisabled }),
    item('context-heading-3', 'heading3', { disabled: formatTargetDisabled }),
    item('context-heading-4', 'heading4', { disabled: formatTargetDisabled }),
    item('context-heading-5', 'heading5', { disabled: formatTargetDisabled }),
    item('context-heading-6', 'heading6', { disabled: formatTargetDisabled }),
    item('context-quote', 'quote', { disabled: formatTargetDisabled }),
    item('context-ordered-list', 'orderedList', {
      disabled: formatTargetDisabled,
    }),
    item('context-unordered-list', 'unorderedList', {
      disabled: formatTargetDisabled,
    }),
    item('context-task-list', 'taskList', {
      disabled: formatTargetDisabled,
    }),
    item('context-code-block', 'codeBlock', {
      disabled: formatTargetDisabled,
    }),
  ];
  const insertItems: CommandMenuNode[] = [
    item('context-insert-image', 'image', { disabled: insertTargetDisabled }),
    item('context-insert-table', 'table', { disabled: insertTargetDisabled }),
    item('context-horizontal-rule', 'horizontalRule', {
      disabled: insertTargetDisabled,
    }),
  ];
  const findSelection = editorState.eligibleFindSelection;
  const nodes: CommandMenuNode[] = [
    item('context-undo', 'undo'),
    item('context-redo', 'redo'),
    separator('context-history-separator'),
    item('context-cut', 'cut'),
    item('context-copy', 'copy'),
    item('context-paste', 'paste'),
    item('context-delete-selection', 'deleteSelection', { danger: true }),
    item('context-select-all', 'selectAll'),
    separator('context-clipboard-separator'),
    item(
      findSelection ? 'context-find-selection' : 'context-find',
      'openSearch',
      findSelection ? { label: t('contextMenu.findSelection') } : undefined,
    ),
    separator('context-find-separator'),
    submenu(
      'context-format',
      Bold,
      t('menu.format'),
      formatItems,
      formatItems.every((node) => node.type !== 'item' || node.disabled),
    ),
    submenu(
      'context-paragraph',
      Pilcrow,
      t('menu.paragraph'),
      paragraphItems,
      paragraphItems.every((node) => node.type !== 'item' || node.disabled),
    ),
    submenu(
      'context-insert',
      FilePlus,
      t('menu.insert'),
      insertItems,
      insertItems.every((node) => node.type !== 'item' || node.disabled),
    ),
  ];

  const contextualNodes: CommandMenuNode[] = [];

  if (target.kind === 'link') {
    const href = target.href;
    const rawHref = target.rawHref;
    contextualNodes.push(
      payloadMenuItem(
        'open-link',
        {
          action: 'openLink',
          kind: 'payloadAction',
          payload: { href },
        },
        context,
        { disabled: !editorAvailable || editorState.readOnly },
      ),
      payloadMenuItem(
        'copy-link-address',
        {
          action: 'copyLinkAddress',
          kind: 'payloadAction',
          payload: { href: rawHref },
        },
        context,
        { disabled: !editorAvailable || !editorState.clipboardWriteAvailable },
      ),
    );
  }

  if (target.kind === 'image') {
    const src = target.src;
    const range = { from: target.from, to: target.to };
    contextualNodes.push(
      payloadMenuItem(
        'copy-image-path',
        {
          action: 'copyImagePath',
          kind: 'payloadAction',
          payload: { src },
        },
        context,
        {
          disabled:
            !editorAvailable || !editorState.clipboardWriteAvailable,
        },
      ),
    );

    if (!/^(?:https?:|data:|blob:)/i.test(src.trim())) {
      contextualNodes.push(
        payloadMenuItem(
          'reveal-image',
          {
            action: 'revealImage',
            kind: 'payloadAction',
            payload: { src },
          },
          context,
          { disabled: !editorAvailable || editorState.readOnly },
        ),
      );
    }

    const deleteImageNode = rangeMenuItem(
        'delete-image-reference',
        'deleteImageReference',
        range,
        context,
      );
    contextualNodes.push(deleteImageNode);
  }

  if (target.kind === 'table') {
    const range = { from: target.from, to: target.to };
    contextualNodes.push(
      rangeMenuItem(
        'context-copy-table',
        'copyTable',
        range,
        context,
      ),
      {
        ...rangeMenuItem(
        'context-delete-table',
        'deleteTable',
        range,
        context,
        ),
        danger: true,
      },
    );
  }

  if (contextualNodes.length > 0) {
    nodes.push(separator('context-target-separator'), ...contextualNodes);
  }

  return nodes;
}
