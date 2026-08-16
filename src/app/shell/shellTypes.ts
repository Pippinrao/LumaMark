import type { ReactNode } from 'react';
import type {
  CommandMenuGroup,
  CommandMenuInvocation,
  CommandMenuNode,
  CommandActionId,
} from '../../features/commands/commandTypes';

export type ShellActionId = CommandActionId;

export type ShellMenuGroup = CommandMenuGroup;
export type ShellMenuInvocation = CommandMenuInvocation;
export type ShellMenuNode = CommandMenuNode;

export type EditorPaneContextMenuHandlers = {
  closeContextMenu: (restoreFocus: boolean) => void;
  prepareContextMenu: (
    target: EventTarget | null,
    coordinates: { x: number; y: number } | undefined,
    source: 'keyboard' | 'pointer',
  ) => void;
};

export type WindowControlsModel = {
  maximized: boolean;
  onControl: (action: 'close' | 'minimize' | 'toggleMaximize') => void;
};

export type TopChromeLabels = {
  appName: string;
  close: string;
  controls: string;
  maximize: string;
  minimize: string;
  restore: string;
};

export type SidebarLabels = {
  files: string;
  outline: string;
  sidebar: string;
};

export type StatusBarLabels = {
  dirtyIndicator: string;
  readOnly: string;
  readOnlyFlash: string;
  statistics: string;
  status: string;
};

export type ShellSlots = {
  dialogs: ReactNode;
  editor: ReactNode;
  sidebar: ReactNode;
  startScreen: ReactNode;
  topChrome: ReactNode;
};
