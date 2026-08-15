import type { LucideIcon } from 'lucide-react';
import type { MarkdownFormatCommand } from '../../editor/commands/markdownFormatCommands';
import type { EditorInteractionRange } from '../../editor/interaction';
import type { CommandShortcutLabels as ShortcutLabels } from './commandShortcuts';

export type CommandActionId =
  | 'copy'
  | 'copyTable'
  | 'cut'
  | 'deleteImageReference'
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
  | 'paste'
  | 'redo'
  | 'resetZoom'
  | 'save'
  | 'saveAs'
  | 'selectAll'
  | 'setChineseLanguage'
  | 'setDarkTheme'
  | 'setEnglishLanguage'
  | 'setLightTheme'
  | 'setSystemTheme'
  | 'setLivePreviewMode'
  | 'setReadingMode'
  | 'setSourceMode'
  | 'toggleDisplayMode'
  | 'toggleLanguage'
  | 'toggleSidebar'
  | 'toggleTheme'
  | 'undo'
  | MarkdownFormatCommand;

export type CommandRangeActionId =
  | 'copyTable'
  | 'deleteImageReference'
  | 'deleteTable';

export type CommandPayloadActionMap = {
  copyImagePath: { src: string };
  copyLinkAddress: { href: string };
  fileTreeCopyPath: { path: string };
  fileTreeCreateDirectory: { parentPath: string };
  fileTreeCreateFile: { parentPath: string };
  fileTreeDelete: {
    entryKind: 'directory' | 'file';
    name: string;
    path: string;
  };
  fileTreeRename: {
    entryKind: 'directory' | 'file';
    name: string;
    path: string;
  };
  fileTreeReveal: { path: string };
  openLink: { href: string };
  openRecentFile: { path: string };
  revealImage: { src: string };
};

export type CommandPayloadActionId = keyof CommandPayloadActionMap;

export type CommandHandlerMap = {
  [Action in CommandActionId]: Action extends CommandRangeActionId
    ? (range?: EditorInteractionRange) => void
    : () => void;
};

export type CommandPayloadHandlerMap = {
  [Action in CommandPayloadActionId]: (
    payload: CommandPayloadActionMap[Action],
  ) => void;
};

export type CommandHandlerMaps = {
  actions: CommandHandlerMap;
  payloadActions: CommandPayloadHandlerMap;
};

export type CommandModel = {
  disabled?: boolean;
  icon: LucideIcon;
  id: string;
  invocation: CommandMenuInvocation;
  keywords: string[];
  label: string;
  shortcut?: string;
};

export type CommandPayloadInvocation<
  Action extends CommandPayloadActionId = CommandPayloadActionId,
> = {
  [SelectedAction in Action]: {
    action: SelectedAction;
    focusManagement?: 'action';
    kind: 'payloadAction';
    payload: CommandPayloadActionMap[SelectedAction];
  };
}[Action];

export type CommandMenuInvocation =
  | {
      action: Exclude<CommandActionId, CommandRangeActionId>;
      focusManagement?: 'action';
      kind: 'action';
    }
  | {
      action: CommandRangeActionId;
      focusManagement?: 'action';
      kind: 'rangeAction';
      range: EditorInteractionRange;
    }
  | CommandPayloadInvocation;

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

type CommandMenuLabelNode = {
  disabled: true;
  icon?: LucideIcon;
  id: string;
  label: string;
  type: 'label';
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
  | CommandMenuLabelNode
  | CommandMenuRadioNode
  | CommandMenuSeparatorNode
  | CommandMenuSubmenuNode;

export type CommandMenuGroup = {
  id: string;
  items: CommandMenuNode[];
  label: string;
};

export type CommandShortcutLabels = ShortcutLabels;
