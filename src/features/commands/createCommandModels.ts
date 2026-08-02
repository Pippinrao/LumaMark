import {
  Bold,
  CheckSquare,
  Code,
  Command,
  Eye,
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
import { COMMAND_SHORTCUTS } from './commandShortcuts';

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
  'openCommandPalette',
  'openSearch',
  'openSettings',
  'orderedList',
  'paragraph',
  'quote',
  'redo',
  'strikethrough',
  'table',
  'taskList',
  'undo',
  'unorderedList',
]);

export function createCommandPaletteModels({
  fileOpening,
  focusMode = false,
  handlers,
  t,
}: {
  fileOpening: boolean;
  focusMode?: boolean;
  handlers: CommandHandlerMap;
  t: Translate;
}): readonly CommandModel[] {
  return [
    command('new-document', FilePlus, t('command.newDocument'), handlers.newDocument),
    command('open-file', FolderOpen, t('command.openFile'), handlers.openFile, {
      disabled: fileOpening,
    }),
    command(
      'open-workspace',
      FolderOpen,
      t('workspace.open'),
      handlers.openWorkspace,
    ),
    command('save', Save, t('command.save'), handlers.save, {
      disabled: fileOpening,
    }),
    command('save-as', SaveAll, t('command.saveAs'), handlers.saveAs, {
      disabled: fileOpening,
    }),
    command('find', Search, t('menu.find'), handlers.openSearch),
    command('undo', Undo2, t('menu.undo'), handlers.undo),
    command('redo', Redo2, t('menu.redo'), handlers.redo),
    command(
      'toggle-theme',
      Moon,
      t('command.toggleTheme'),
      handlers.toggleTheme,
    ),
    command(
      'toggle-language',
      Languages,
      t('command.toggleLanguage'),
      handlers.toggleLanguage,
    ),
    command(
      'toggle-sidebar',
      PanelLeft,
      t('command.toggleSidebar'),
      handlers.toggleSidebar,
    ),
    command(
      'focus-editor',
      Focus,
      t('command.focusEditor'),
      handlers.focusEditor,
    ),
    command(
      'toggle-focus-mode',
      Focus,
      focusMode ? t('command.exitFocusMode') : t('command.enterFocusMode'),
      handlers.toggleFocusMode,
    ),
    command(
      'open-settings',
      Settings,
      t('settings.title'),
      handlers.openSettings,
    ),
    command('heading-1', Heading, t('menu.heading1'), handlers.heading1),
    command('heading-2', Heading, t('menu.heading2'), handlers.heading2),
    command('heading-3', Heading, t('menu.heading3'), handlers.heading3),
    command('heading-4', Heading, t('menu.heading4'), handlers.heading4),
    command('heading-5', Heading, t('menu.heading5'), handlers.heading5),
    command('heading-6', Heading, t('menu.heading6'), handlers.heading6),
    command(
      'insert-horizontal-rule',
      Minus,
      t('menu.horizontalRule'),
      handlers.horizontalRule,
    ),
    command('insert-image', Image, t('menu.image'), handlers.image, {
      shortcut: COMMAND_SHORTCUTS.image,
    }),
    command('insert-code-block', Code, t('menu.codeBlock'), handlers.codeBlock, {
      shortcut: COMMAND_SHORTCUTS.codeBlock,
    }),
    command('insert-table', Table2, t('menu.table'), handlers.table, {
      shortcut: COMMAND_SHORTCUTS.table,
    }),
    command(
      'insert-ordered-list',
      ListOrdered,
      t('menu.orderedList'),
      handlers.orderedList,
    ),
    command(
      'toggle-strikethrough',
      Strikethrough,
      t('menu.strikethrough'),
      handlers.strikethrough,
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
  fileOpening,
  focusMode = false,
  language,
  openRecentFile,
  recentFiles,
  sidebarOpen,
  t,
  theme,
}: {
  editorDisplayMode: EditorDisplayMode;
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
  return [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        menuItem('new-document', 'newDocument', FilePlus, t('command.newDocument'), 'Ctrl+N'),
        menuItem('open-file', 'openFile', FolderOpen, t('command.openFile'), 'Ctrl+O', fileOpening),
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
        menuItem('save', 'save', Save, t('command.save'), 'Ctrl+S', fileOpening),
        menuItem('save-as', 'saveAs', SaveAll, t('command.saveAs'), 'Ctrl+Shift+S', fileOpening),
        separator('file-settings-separator'),
        menuItem('settings', 'openSettings', Settings, t('settings.title')),
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        menuItem('undo', 'undo', Undo2, t('menu.undo'), 'Ctrl+Z'),
        menuItem('redo', 'redo', Redo2, t('menu.redo'), 'Ctrl+Shift+Z'),
        separator('edit-history-separator'),
        menuItem('find', 'openSearch', Search, t('menu.find'), 'Ctrl+F'),
        menuItem('command-palette', 'openCommandPalette', Command, t('commandPalette.open'), 'Ctrl+K'),
      ],
    },
    {
      id: 'paragraph',
      label: t('menu.paragraph'),
      items: [
        menuItem('normal-paragraph', 'paragraph', Pilcrow, t('menu.normalParagraph'), COMMAND_SHORTCUTS.normalParagraph),
        separator('paragraph-heading-separator'),
        ...([1, 2, 3, 4, 5, 6] as const).map((level) =>
          menuItem(
            `heading-${level}`,
            `heading${level}`,
            Heading,
            t(`menu.heading${level}`),
            `Ctrl+${level}`,
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
          menuItem('code-block', 'codeBlock', Code, t('menu.codeBlock'), COMMAND_SHORTCUTS.codeBlock),
        ]),
        submenu('insert', FileText, t('menu.insert'), [
          menuItem('insert-table', 'table', Table2, t('menu.table'), COMMAND_SHORTCUTS.table),
          menuItem('horizontal-rule', 'horizontalRule', Minus, t('menu.horizontalRule')),
        ]),
      ],
    },
    {
      id: 'format',
      label: t('menu.format'),
      items: [
        menuItem('bold', 'bold', Bold, t('menu.bold'), 'Ctrl+B'),
        menuItem('italic', 'italic', Italic, t('menu.italic'), 'Ctrl+I'),
        menuItem('strikethrough', 'strikethrough', Strikethrough, t('menu.strikethrough')),
        menuItem('inline-code', 'inlineCode', Code, t('menu.inlineCode')),
        separator('format-link-separator'),
        menuItem('link', 'link', Link, t('menu.link')),
        menuItem('image', 'image', Image, t('menu.image'), COMMAND_SHORTCUTS.image),
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        radio('live-preview-mode', 'display-mode', 'setLivePreviewMode', Eye, t('menu.livePreviewMode'), editorDisplayMode === 'livePreview'),
        radio('source-mode', 'display-mode', 'setSourceMode', FileCode2, t('menu.sourceMode'), editorDisplayMode === 'source', COMMAND_SHORTCUTS.sourceMode),
        separator('view-mode-separator'),
        checkbox('sidebar', 'toggleSidebar', PanelLeft, t('command.toggleSidebar'), sidebarOpen, 'Ctrl+\\'),
        checkbox('focus-mode', 'toggleFocusMode', CheckSquare, t('menu.focusMode'), focusMode, 'Ctrl+Shift+F'),
        separator('view-focus-separator'),
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
      items: [menuItem('about', 'openAbout', Info, t('menu.about'))],
    },
  ];
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
      shortcut: COMMAND_SHORTCUTS.table,
    },
  ];

  if (tableContext) {
    items.push(
      {
        action: 'copyTable',
        label: t('table.copyTable'),
        shortcut: shortcuts.copy,
      },
      {
        action: 'deleteTable',
        label: t('table.deleteTable'),
        shortcut: shortcuts.delete,
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
