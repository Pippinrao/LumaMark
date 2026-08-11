import type { LucideIcon } from 'lucide-react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { CommandShortcutLabels as ShortcutLabels } from './commandShortcuts';

export type CommandActionId =
  | 'copyTable'
  | 'deleteTable'
  | 'exitFocusMode'
  | 'toggleFocusMode'
  | 'focusEditor'
  | 'newDocument'
  | 'openAbout'
  | 'checkForUpdates'
  | 'openCommandPalette'
  | 'openFile'
  | 'openSearch'
  | 'openSettings'
  | 'openWorkspace'
  | 'redo'
  | 'resetZoom'
  | 'save'
  | 'saveAs'
  | 'setChineseLanguage'
  | 'setDarkTheme'
  | 'setEnglishLanguage'
  | 'setLightTheme'
  | 'setLivePreviewMode'
  | 'setReadingMode'
  | 'setSourceMode'
  | 'toggleDisplayMode'
  | 'toggleLanguage'
  | 'toggleSidebar'
  | 'toggleTheme'
  | 'undo'
  | MarkdownFormatCommand;

export type CommandHandlerMap = Record<CommandActionId, () => void>;

export type CommandModel = {
  disabled?: boolean;
  icon: LucideIcon;
  id: string;
  keywords: string[];
  label: string;
  run: () => void;
  shortcut?: string;
};

export type CommandMenuInvocation =
  | {
      action: CommandActionId;
      focusManagement?: 'action';
      kind: 'action';
    }
  | {
      focusManagement?: 'action';
      kind: 'callback';
      run: () => void;
    };

type CommandMenuItemNode = {
  disabled?: boolean;
  icon?: LucideIcon;
  id: string;
  invocation: CommandMenuInvocation;
  label: string;
  shortcut?: string;
  type: 'item';
};

type CommandMenuSeparatorNode = {
  id: string;
  type: 'separator';
};

type CommandMenuSubmenuNode = {
  disabled?: boolean;
  icon?: LucideIcon;
  id: string;
  items: CommandMenuNode[];
  label: string;
  type: 'submenu';
};

type CommandMenuCheckboxNode = {
  checked: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
  id: string;
  invocation: CommandMenuInvocation;
  label: string;
  shortcut?: string;
  type: 'checkbox';
};

type CommandMenuRadioNode = {
  checked: boolean;
  disabled?: boolean;
  group: string;
  icon?: LucideIcon;
  id: string;
  invocation: CommandMenuInvocation;
  label: string;
  shortcut?: string;
  type: 'radio';
};

export type CommandMenuNode =
  | CommandMenuCheckboxNode
  | CommandMenuItemNode
  | CommandMenuRadioNode
  | CommandMenuSeparatorNode
  | CommandMenuSubmenuNode;

export type CommandMenuGroup = {
  id: string;
  items: CommandMenuNode[];
  label: string;
};

export type CommandContextMenuItem = {
  action: CommandActionId;
  label: string;
  shortcut: string;
};

export type CommandShortcutLabels = ShortcutLabels;
