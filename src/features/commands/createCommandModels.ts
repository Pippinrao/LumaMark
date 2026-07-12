import {
  Copy,
  Focus,
  FilePlus,
  FolderOpen,
  Heading,
  Image,
  Languages,
  Moon,
  PanelLeft,
  ListOrdered,
  Minus,
  Redo2,
  Save,
  SaveAll,
  Search,
  Settings,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { EditorDisplayMode } from '../../editor/core/editorDisplayMode';
import type {
  CommandActionId,
  CommandContextMenuItem,
  CommandHandlerMap,
  CommandMenuGroup,
  CommandModel,
  CommandShortcutLabels,
} from './commandTypes';

type Translate = (key: string) => string;

export function createCommandPaletteModels({
  fileOpening,
  focusMode = false,
  handlers,
  shortcuts,
  t,
}: {
  fileOpening: boolean;
  focusMode?: boolean;
  handlers: CommandHandlerMap;
  shortcuts: CommandShortcutLabels;
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
    command('insert-image', Image, t('menu.image'), handlers.image),
    command('insert-table', Table2, t('menu.table'), handlers.table, {
      shortcut: shortcuts.insert,
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
    command(
      'copy-table',
      Copy,
      t('table.copyTable'),
      handlers.copyTable,
      {
        shortcut: shortcuts.copy,
      },
    ),
    command(
      'delete-table',
      Trash2,
      t('table.deleteTable'),
      handlers.deleteTable,
      {
        shortcut: shortcuts.delete,
      },
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
  shortcuts,
  t,
}: {
  editorDisplayMode: EditorDisplayMode;
  fileOpening: boolean;
  focusMode?: boolean;
  shortcuts: CommandShortcutLabels;
  t: Translate;
}): CommandMenuGroup[] {
  return [
    {
      label: t('menu.file'),
      items: [
        { action: 'newDocument', label: t('command.newDocument') },
        {
          action: 'openFile',
          disabled: fileOpening,
          label: t('command.openFile'),
        },
        {
          action: 'openWorkspace',
          disabled: fileOpening,
          label: t('workspace.open'),
        },
        {
          action: 'save',
          disabled: fileOpening,
          label: t('command.save'),
        },
        {
          action: 'saveAs',
          disabled: fileOpening,
          label: t('command.saveAs'),
        },
      ],
    },
    {
      label: t('menu.edit'),
      items: [
        { action: 'undo', label: t('menu.undo') },
        { action: 'redo', label: t('menu.redo') },
        { action: 'openSearch', label: t('menu.find') },
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
        {
          action: 'openCommandPalette',
          label: t('commandPalette.open'),
        },
      ],
    },
    {
      label: t('menu.paragraph'),
      items: [
        { action: 'heading1', label: t('menu.heading1') },
        { action: 'heading2', label: t('menu.heading2') },
        { action: 'heading3', label: t('menu.heading3') },
        { action: 'heading4', label: t('menu.heading4') },
        { action: 'heading5', label: t('menu.heading5') },
        { action: 'heading6', label: t('menu.heading6') },
        { action: 'orderedList', label: t('menu.orderedList') },
        { action: 'unorderedList', label: t('menu.unorderedList') },
        { action: 'taskList', label: t('menu.taskList') },
        { action: 'horizontalRule', label: t('menu.horizontalRule') },
        {
          action: 'table',
          label: t('menu.table'),
          shortcut: shortcuts.insert,
        },
        { action: 'quote', label: t('menu.quote') },
        { action: 'codeBlock', label: t('menu.codeBlock') },
      ],
    },
    {
      label: t('menu.format'),
      items: [
        { action: 'bold', label: t('menu.bold') },
        { action: 'italic', label: t('menu.italic') },
        { action: 'strikethrough', label: t('menu.strikethrough') },
        { action: 'inlineCode', label: t('menu.inlineCode') },
        { action: 'link', label: t('menu.link') },
        { action: 'image', label: t('menu.image') },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        { action: 'focusEditor', label: t('command.focusEditor') },
        {
          action: 'toggleFocusMode',
          label: focusMode
            ? t('command.exitFocusMode')
            : t('command.enterFocusMode'),
        },
        editorDisplayMode === 'source'
          ? {
              action: 'setLivePreviewMode',
              label: t('menu.livePreviewMode'),
            }
          : {
              action: 'setSourceMode',
              label: t('menu.sourceMode'),
            },
        { action: 'toggleSidebar', label: t('command.toggleSidebar') },
        { action: 'openSettings', label: t('settings.title') },
      ],
    },
    {
      label: t('menu.theme'),
      items: [
        { action: 'toggleTheme', label: t('command.toggleTheme') },
        {
          action: 'toggleLanguage',
          label: t('command.toggleLanguage'),
        },
      ],
    },
    {
      label: t('menu.help'),
      items: [{ action: 'openSettings', label: t('menu.about') }],
    },
  ];
}

export function createEditorContextMenuModels({
  shortcuts,
  t,
}: {
  shortcuts: CommandShortcutLabels;
  t: Translate;
}): CommandContextMenuItem[] {
  return [
    {
      action: 'table',
      label: t('menu.table'),
      shortcut: shortcuts.insert,
    },
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
  ];
}

export function runCommandAction(
  handlers: CommandHandlerMap,
  action: CommandActionId,
): void {
  handlers[action]();
}
