import type { ReactNode } from 'react';

export type ShellActionId = string;

export type ShellMenuItem = {
  action?: ShellActionId;
  disabled?: boolean;
  label: string;
  shortcut?: string;
};

export type ShellMenuGroup = {
  items: ShellMenuItem[];
  label: string;
};

export type ShellContextMenuItem = {
  action: ShellActionId;
  label: string;
  shortcut: string;
};

export type WindowControlsModel = {
  maximized: boolean;
  onChromeMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
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
  statistics: string;
  status: string;
};

export type ShellSlots = {
  dialogs: ReactNode;
  editor: ReactNode;
  sidebar: ReactNode;
  topChrome: ReactNode;
};
