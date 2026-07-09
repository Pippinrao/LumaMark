import {
  Copy,
  Focus,
  FolderOpen,
  Languages,
  Moon,
  Save,
  SaveAll,
  Settings,
  Table2,
  Trash2,
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
  handlers,
  shortcuts,
  t,
}: {
  handlers: CommandHandlerMap;
  shortcuts: CommandShortcutLabels;
  t: Translate;
}): readonly CommandModel[] {
  return [
    command('open-file', FolderOpen, t('command.openFile'), handlers.openFile),
    command(
      'open-workspace',
      FolderOpen,
      t('workspace.open'),
      handlers.openWorkspace,
    ),
    command('save', Save, t('command.save'), handlers.save),
    command('save-as', SaveAll, t('command.saveAs'), handlers.saveAs),
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
      'focus-editor',
      Focus,
      t('command.focusEditor'),
      handlers.focusEditor,
    ),
    command(
      'open-settings',
      Settings,
      t('settings.title'),
      handlers.openSettings,
    ),
    command('insert-table', Table2, t('menu.table'), handlers.table, {
      shortcut: shortcuts.insert,
    }),
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
  options: { shortcut?: string } = {},
): CommandModel {
  return {
    icon,
    id,
    keywords: [label],
    label,
    run,
    shortcut: options.shortcut,
  };
}

export function createTopMenuModels({
  editorDisplayMode,
  fileOpening,
  shortcuts,
  t,
}: {
  editorDisplayMode: EditorDisplayMode;
  fileOpening: boolean;
  shortcuts: CommandShortcutLabels;
  t: Translate;
}): CommandMenuGroup[] {
  return [
    {
      label: t('menu.file'),
      items: [
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
        { action: 'save', label: t('command.save') },
        { action: 'saveAs', label: t('command.saveAs') },
      ],
    },
    {
      label: t('menu.edit'),
      items: [
        { disabled: true, label: t('menu.undo') },
        { disabled: true, label: t('menu.redo') },
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
        { action: 'unorderedList', label: t('menu.unorderedList') },
        { action: 'taskList', label: t('menu.taskList') },
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
        { action: 'inlineCode', label: t('menu.inlineCode') },
        { action: 'link', label: t('menu.link') },
      ],
    },
    {
      label: t('menu.view'),
      items: [
        { action: 'focusEditor', label: t('command.focusEditor') },
        editorDisplayMode === 'source'
          ? {
              action: 'setLivePreviewMode',
              label: t('menu.livePreviewMode'),
            }
          : {
              action: 'setSourceMode',
              label: t('menu.sourceMode'),
            },
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
