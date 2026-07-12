import type { LucideIcon } from 'lucide-react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';

export type CommandActionId =
  | 'copyTable'
  | 'deleteTable'
  | 'exitFocusMode'
  | 'toggleFocusMode'
  | 'focusEditor'
  | 'newDocument'
  | 'openCommandPalette'
  | 'openFile'
  | 'openSearch'
  | 'openSettings'
  | 'openWorkspace'
  | 'redo'
  | 'save'
  | 'saveAs'
  | 'setLivePreviewMode'
  | 'setSourceMode'
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
