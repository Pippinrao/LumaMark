import type { LucideIcon } from 'lucide-react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';

export type CommandActionId =
  | 'copyTable'
  | 'deleteTable'
  | 'focusEditor'
  | 'openCommandPalette'
  | 'openFile'
  | 'openSettings'
  | 'openWorkspace'
  | 'save'
  | 'saveAs'
  | 'setLivePreviewMode'
  | 'setSourceMode'
  | 'toggleLanguage'
  | 'toggleTheme'
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

export type CommandMenuItem = {
  action?: CommandActionId;
  disabled?: boolean;
  label: string;
  shortcut?: string;
};

export type CommandMenuGroup = {
  items: CommandMenuItem[];
  label: string;
};

export type CommandContextMenuItem = {
  action: CommandActionId;
  label: string;
  shortcut: string;
};

export type CommandShortcutLabels = {
  copy: string;
  delete: string;
  insert: string;
};
