import {
  Bold,
  CheckSquare,
  Code,
  Command,
  Eye,
  BookOpen,
  FileCode2,
  FileText,
  Focus,
  FilePlus,
  FolderOpen,
  Heading,
  History,
  Image,
  Info,
  Italic,
  Languages,
  Link,
  List,
  ListChecks,
  Moon,
  PanelLeft,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  SaveAll,
  Search,
  Settings,
  Strikethrough,
  Sun,
  Table2,
  Undo2,
} from 'lucide-react';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import type {
  CommandActionId,
  CommandContextMenuItem,
  CommandHandlerMap,
  CommandMenuGroup,
  CommandMenuNode,
  CommandModel,
  CommandShortcutLabels,
} from './commandTypes';

type Translate = (key: string) => string;

const ACTION_MANAGED_FOCUS = new Set<CommandActionId>([
  'bold',
  'codeBlock',
  'focusEditor',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'horizontalRule',
  'image',
  'inlineCode',
  'italic',
  'link',
  'newDocument',
  'openAbout',
  'checkForUpdates',
  'openCommandPalette',
  'openSearch',
  'openSettings',
  'orderedList',
  'paragraph',
  'quote',
  'redo',
  'resetZoom',
  'strikethrough',
  'table',
  'taskList',
  'undo',
  'unorderedList',
]);

const EDITOR_DEPENDENT_ACTIONS = new Set<CommandActionId>([
  'bold',
  'codeBlock',
  'copyTable',
  'deleteTable',
  'exitFocusMode',
  'focusEditor',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'horizontalRule',
  'image',
  'inlineCode',
  'italic',
  'link',
  'openSearch',
  'orderedList',
  'paragraph',
  'quote',
  'redo',
  'resetZoom',
  'save',
  'saveAs',
  'setLivePreviewMode',
  'setReadingMode',
  'setSourceMode',
  'strikethrough',
  'table',
  'taskList',
  'toggleDisplayMode',
  'toggleFocusMode',
  'undo',
  'unorderedList',
]);

export function createCommandPaletteModels({
  editorAvailable,
  fileOpening,
  focusMode = false,
  handlers,
  shortcuts,
  t,
}: {
  editorAvailable: boolean;
  fileOpening: boolean;
  focusMode?: boolean;
  handlers: CommandHandlerMap;
  shortcuts: CommandShortcutLabels;
  t: Translate;
}): readonly CommandModel[] {
  const actionCommand = (
    id: string,
    action: CommandActionId,
    icon: CommandModel['icon'],
    label: string,
    options: { disabled?: boolean; shortcut?: string } = {},
  ) =>
    command(id, icon, label, handlers[action], {
      ...options,
      disabled:
        options.disabled ||
        (!editorAvailable && EDITOR_DEPENDENT_ACTIONS.has(action)),
    });

  return [
    actionCommand('new-document', 'newDocument', FilePlus, t('command.newDocument')),
    actionCommand('open-file', 'openFile', FolderOpen, t('command.openFile'), {
      disabled: fileOpening,
    }),
    actionCommand(
      'open-workspace',
      'openWorkspace',
      FolderOpen,
      t('workspace.open'),
    ),
    actionCommand('save', 'save', Save, t('command.save'), {
      disabled: fileOpening,
    }),
    actionCommand('save-as', 'saveAs', SaveAll, t('command.saveAs'), {
      disabled: fileOpening,
    }),
    actionCommand('find', 'openSearch', Search, t('menu.find')),
    actionCommand('undo', 'undo', Undo2, t('menu.undo')),
    actionCommand('redo', 'redo', Redo2, t('menu.redo')),
    actionCommand(
      'toggle-theme',
      'toggleTheme',
      Moon,
      t('command.toggleTheme'),
    ),
    actionCommand(
      'toggle-language',
      'toggleLanguage',
      Languages,
      t('command.toggleLanguage'),
    ),
    actionCommand(
      'toggle-sidebar',
      'toggleSidebar',
      PanelLeft,
      t('command.toggleSidebar'),
    ),
    actionCommand(
      'focus-editor',
      'focusEditor',
      Focus,
      t('command.focusEditor'),
    ),
    actionCommand(
      'toggle-focus-mode',
      'toggleFocusMode',
      Focus,
      focusMode ? t('command.exitFocusMode') : t('command.enterFocusMode'),
    ),
    actionCommand(
      'reset-zoom',
      'resetZoom',
      RotateCcw,
      t('menu.resetZoom'),
    ),
    actionCommand(
      'open-settings',
      'openSettings',
      Settings,
      t('settings.title'),
    ),
    actionCommand(
      'check-for-updates',
      'checkForUpdates',
      RefreshCw,
      t('menu.checkForUpdates'),
    ),
    actionCommand('heading-1', 'heading1', Heading, t('menu.heading1')),
    actionCommand('heading-2', 'heading2', Heading, t('menu.heading2')),
    actionCommand('heading-3', 'heading3', Heading, t('menu.heading3')),
    actionCommand('heading-4', 'heading4', Heading, t('menu.heading4')),
    actionCommand('heading-5', 'heading5', Heading, t('menu.heading5')),
    actionCommand('heading-6', 'heading6', Heading, t('menu.heading6')),
    actionCommand(
      'insert-horizontal-rule',
      'horizontalRule',
      Minus,
      t('menu.horizontalRule'),
    ),
    actionCommand('insert-image', 'image', Image, t('menu.image'), {
      shortcut: shortcuts.image,
    }),
    actionCommand('insert-code-block', 'codeBlock', Code, t('menu.codeBlock'), {
      shortcut: shortcuts.codeBlock,
    }),
    actionCommand('insert-table', 'table', Table2, t('menu.table'), {
      shortcut: shortcuts.table,
    }),
    actionCommand(
      'insert-ordered-list',
      'orderedList',
      ListOrdered,
      t('menu.orderedList'),
    ),
    actionCommand(
      'toggle-strikethrough',
      'strikethrough',
      Strikethrough,
      t('menu.strikethrough'),
    ),
  ];
}

function command(
  id: string,
  icon: CommandModel['icon'],
  label: string,
  run: () => void,
  options: { disabled?: boolean; shortcut?: string } = {},
): CommandModel {
  return {
    icon,
    id,
    disabled: options.disabled,
    keywords: [label],
    label,
    run,
    shortcut: options.shortcut,
  };
}

export function createTopMenuModels({
  editorDisplayMode,
  editorAvailable,
  fileOpening,
  focusMode = false,
  language,
  openRecentFile,
  recentFiles,
  shortcuts,
  sidebarOpen,
  t,
  theme,
}: {
  editorDisplayMode: EditorDisplayMode;
  editorAvailable: boolean;
  fileOpening: boolean;
  focusMode?: boolean;
  language: 'en' | 'zh-CN';
  openRecentFile: (path: string) => void;
  recentFiles: readonly { name: string; path: string }[];
  sidebarOpen: boolean;
  shortcuts: CommandShortcutLabels;
  t: Translate;
  theme: 'dark' | 'light';
}): CommandMenuGroup[] {
  const groups: CommandMenuGroup[] = [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        menuItem('new-document', 'newDocument', FilePlus, t('command.newDocument'), shortcuts.newDocument),
        menuItem('open-file', 'openFile', FolderOpen, t('command.openFile'), shortcuts.openFile, fileOpening),
        submenu(
          'recent-files',
          History,
          t('recentFiles.title'),
          recentFiles.length
            ? recentFiles.map((file, index) =>
                menuCallbackItem(
                  `recent-file-${index}`,
                  FileText,
                  file.name,
                  () => openRecentFile(file.path),
                ),
              )
            : [
                {
                  disabled: true,
                  icon: FileText,
                  id: 'recent-files-empty',
                  invocation: { kind: 'callback', run: () => undefined },
                  label: t('recentFiles.empty'),
                  type: 'item',
                },
              ],
          fileOpening,
        ),
        menuItem('open-workspace', 'openWorkspace', FolderOpen, t('workspace.open'), undefined, fileOpening),
        separator('file-open-separator'),
        menuItem('save', 'save', Save, t('command.save'), shortcuts.save, fileOpening),
        menuItem('save-as', 'saveAs', SaveAll, t('command.saveAs'), shortcuts.saveAs, fileOpening),
        separator('file-settings-separator'),
        menuItem('settings', 'openSettings', Settings, t('settings.title')),
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        menuItem('undo', 'undo', Undo2, t('menu.undo'), shortcuts.undo),
        menuItem('redo', 'redo', Redo2, t('menu.redo'), shortcuts.redo),
        separator('edit-history-separator'),
        menuItem('find', 'openSearch', Search, t('menu.find'), shortcuts.find),
        menuItem('command-palette', 'openCommandPalette', Command, t('commandPalette.open'), shortcuts.commandPalette),
      ],
    },
    {
      id: 'paragraph',
      label: t('menu.paragraph'),
      items: [
        menuItem('normal-paragraph', 'paragraph', Pilcrow, t('menu.normalParagraph'), shortcuts.normalParagraph),
        separator('paragraph-heading-separator'),
        ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
          menuItem(
            `heading-${level}`,
            `heading${level}`,
            Heading,
            t(`menu.heading${level}`),
            shortcuts[`heading${level}`],
          ),
        ),
        separator('paragraph-block-separator'),
        submenu('lists', List, t('menu.lists'), [
          menuItem('ordered-list', 'orderedList', ListOrdered, t('menu.orderedList')),
          menuItem('unordered-list', 'unorderedList', List, t('menu.unorderedList')),
          menuItem('task-list', 'taskList', ListChecks, t('menu.taskList')),
        ]),
        submenu('blocks', Quote, t('menu.blocks'), [
          menuItem('quote', 'quote', Quote, t('menu.quote')),
          menuItem('code-block', 'codeBlock', Code, t('menu.codeBlock'), shortcuts.codeBlock),
        ]),
        submenu('insert', FileText, t('menu.insert'), [
          menuItem('insert-table', 'table', Table2, t('menu.table'), shortcuts.table),
          menuItem('horizontal-rule', 'horizontalRule', Minus, t('menu.horizontalRule')),
        ]),
      ],
    },
    {
      id: 'format',
      label: t('menu.format'),
      items: [
        menuItem('bold', 'bold', Bold, t('menu.bold'), shortcuts.bold),
        menuItem('italic', 'italic', Italic, t('menu.italic'), shortcuts.italic),
        menuItem('strikethrough', 'strikethrough', Strikethrough, t('menu.strikethrough')),
        menuItem('inline-code', 'inlineCode', Code, t('menu.inlineCode')),
        separator('format-link-separator'),
        menuItem('link', 'link', Link, t('menu.link')),
        menuItem('image', 'image', Image, t('menu.image'), shortcuts.image),
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        radio('live-preview-mode', 'display-mode', 'setLivePreviewMode', Eye, t('menu.livePreviewMode'), editorDisplayMode === 'livePreview', shortcuts.sourceMode),
        radio('source-mode', 'display-mode', 'setSourceMode', FileCode2, t('menu.sourceMode'), editorDisplayMode === 'source'),
        radio('reading-mode', 'display-mode', 'setReadingMode', BookOpen, t('menu.readingMode'), editorDisplayMode === 'reading'),
        separator('view-mode-separator'),
        checkbox('sidebar', 'toggleSidebar', PanelLeft, t('command.toggleSidebar'), sidebarOpen, shortcuts.sidebar),
        checkbox('focus-mode', 'toggleFocusMode', CheckSquare, t('menu.focusMode'), focusMode, shortcuts.focusMode),
        separator('view-focus-separator'),
        menuItem('reset-zoom', 'resetZoom', RotateCcw, t('menu.resetZoom')),
        menuItem('focus-editor', 'focusEditor', Focus, t('command.focusEditor')),
      ],
    },
    {
      id: 'theme',
      label: t('menu.theme'),
      items: [
        radio('theme-light', 'theme', 'setLightTheme', Sun, t('settings.themeLight'), theme === 'light'),
        radio('theme-dark', 'theme', 'setDarkTheme', Moon, t('settings.themeDark'), theme === 'dark'),
      ],
    },
    {
      id: 'language',
      label: t('menu.language'),
      items: [
        radio('language-zh', 'language', 'setChineseLanguage', Languages, t('settings.languageChinese'), language === 'zh-CN'),
        radio('language-en', 'language', 'setEnglishLanguage', Languages, t('settings.languageEnglish'), language === 'en'),
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        menuItem(
          'check-for-updates',
          'checkForUpdates',
          RefreshCw,
          t('menu.checkForUpdates'),
        ),
        menuItem('about', 'openAbout', Info, t('menu.about')),
      ],
    },
  ];

  return editorAvailable
    ? groups
    : groups.map((group) => ({
        ...group,
        items: disableEditorDependentMenuNodes(group.items),
      }));
}

function disableEditorDependentMenuNodes(
  nodes: readonly CommandMenuNode[],
): CommandMenuNode[] {
  return nodes.map((node) => {
    if (node.type === 'submenu') {
      return {
        ...node,
        items: disableEditorDependentMenuNodes(node.items),
      };
    }

    if (
      node.type === 'separator' ||
      node.invocation.kind !== 'action' ||
      !EDITOR_DEPENDENT_ACTIONS.has(node.invocation.action)
    ) {
      return node;
    }

    return { ...node, disabled: true };
  });
}

function menuItem(
  id: string,
  action: CommandActionId,
  icon: CommandModel['icon'],
  label: string,
  shortcut?: string,
  disabled?: boolean,
): CommandMenuNode {
  return {
    disabled,
    icon,
    id,
    invocation: ACTION_MANAGED_FOCUS.has(action)
      ? { action, focusManagement: 'action', kind: 'action' }
      : { action, kind: 'action' },
    label,
    shortcut,
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

function menuCallbackItem(
  id: string,
  icon: CommandModel['icon'],
  label: string,
  run: () => void,
): CommandMenuNode {
  return {
    icon,
    id,
    invocation: { kind: 'callback', run },
    label,
    type: 'item',
  };
}

function checkbox(
  id: string,
  action: CommandActionId,
  icon: CommandModel['icon'],
  label: string,
  checked: boolean,
  shortcut?: string,
): CommandMenuNode {
  return {
    checked,
    icon,
    id,
    invocation: { action, kind: 'action' },
    label,
    shortcut,
    type: 'checkbox',
  };
}

function radio(
  id: string,
  group: string,
  action: CommandActionId,
  icon: CommandModel['icon'],
  label: string,
  checked: boolean,
  shortcut?: string,
): CommandMenuNode {
  return {
    checked,
    group,
    icon,
    id,
    invocation: { action, kind: 'action' },
    label,
    shortcut,
    type: 'radio',
  };
}

export function createEditorContextMenuModels({
  tableContext,
  shortcuts,
  t,
}: {
  tableContext: boolean;
  shortcuts: CommandShortcutLabels;
  t: Translate;
}): CommandContextMenuItem[] {
  const items: CommandContextMenuItem[] = [
    {
      action: 'table',
      label: t('menu.table'),
      shortcut: shortcuts.table,
    },
  ];

  if (tableContext) {
    items.push(
      {
        action: 'copyTable',
        label: t('table.copyTable'),
        shortcut: shortcuts.copyTable,
      },
      {
        action: 'deleteTable',
        label: t('table.deleteTable'),
        shortcut: shortcuts.deleteTable,
      },
    );
  }

  return items;
}

export function runCommandAction(
  handlers: CommandHandlerMap,
  action: CommandActionId,
): void {
  handlers[action]();
}
