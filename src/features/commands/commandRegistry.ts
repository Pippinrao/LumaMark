import {
  Bold,
  BookOpen,
  ClipboardPaste,
  Code,
  Command,
  Copy,
  Eye,
  ExternalLink,
  FileCode2,
  FilePlus,
  FileText,
  Focus,
  FolderPlus,
  FolderOpen,
  Heading,
  Image,
  Info,
  Italic,
  Languages,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Moon,
  MonitorCog,
  PanelLeft,
  Pencil,
  Pilcrow,
  Quote,
  Redo2,
  RefreshCw,
  RotateCcw,
  Save,
  SaveAll,
  Scissors,
  Search,
  Settings,
  Strikethrough,
  Sun,
  Table2,
  TextSelect,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type {
  CommandActionId,
  CommandPayloadActionId,
  CommandShortcutLabels,
} from './commandTypes';

export type CommandDescriptorActionId =
  | CommandActionId
  | CommandPayloadActionId;
export type CommandScene =
  | 'editorContext'
  | 'fileTreeContext'
  | 'palette'
  | 'topMenu';

type CommandLabelContext = {
  focusMode: boolean;
  scene: CommandScene;
};

export type CommandAvailabilityPolicy =
  | {
      blockWhileFileOpening?: true;
      scope: 'always';
    }
  | {
      blockWhileFileOpening?: true;
      clipboard?: 'read' | 'write';
      requiresSelection?: true;
      scope: 'editor';
      writable?: true;
    }
  | {
      blockWhileFileOpening?: never;
      scope: 'surface';
    };

export type CommandDescriptor = {
  availability: CommandAvailabilityPolicy;
  focusManagement?: 'action';
  icon: LucideIcon;
  labelKey: string | null | ((context: CommandLabelContext) => string);
  shortcutKey?: keyof CommandShortcutLabels;
};

const always = { availability: { scope: 'always' } } as const;
const blockWhileFileOpening = {
  availability: { blockWhileFileOpening: true, scope: 'always' },
} as const;
const editor = { availability: { scope: 'editor' } } as const;
const editorClipboardRead = {
  availability: { clipboard: 'read', scope: 'editor', writable: true },
} as const;
const editorClipboardWrite = {
  availability: { clipboard: 'write', scope: 'editor' },
} as const;
const editorSelectionClipboardWrite = {
  availability: {
    clipboard: 'write',
    requiresSelection: true,
    scope: 'editor',
  },
} as const;
const editorWritable = {
  availability: { scope: 'editor', writable: true },
} as const;
const editorWritableSelectionClipboardWrite = {
  availability: {
    clipboard: 'write',
    requiresSelection: true,
    scope: 'editor',
    writable: true,
  },
} as const;
const editorWhileFileOpening = {
  availability: { blockWhileFileOpening: true, scope: 'editor' },
} as const;
const focusAction = { focusManagement: 'action' } as const;
const surface = { availability: { scope: 'surface' } } as const;
const formatAction = (icon: LucideIcon, labelKey: string, shortcutKey?: keyof CommandShortcutLabels) => ({
  ...editorWritable,
  ...focusAction,
  icon,
  labelKey,
  shortcutKey,
});
const editorAction = (icon: LucideIcon, labelKey: string, shortcutKey?: keyof CommandShortcutLabels) => ({
  ...editor,
  ...focusAction,
  icon,
  labelKey,
  shortcutKey,
});

export const commandRegistry = {
  bold: formatAction(Bold, 'menu.bold', 'bold'),
  checkForUpdates: { ...always, ...focusAction, icon: RefreshCw, labelKey: 'menu.checkForUpdates' },
  codeBlock: formatAction(Code, 'menu.codeBlock', 'codeBlock'),
  copy: { ...editorSelectionClipboardWrite, ...focusAction, icon: Copy, labelKey: 'menu.copy', shortcutKey: 'copy' },
  copyImagePath: { ...surface, icon: Image, labelKey: 'contextMenu.copyImagePath' },
  copyLinkAddress: { ...surface, icon: Link, labelKey: 'contextMenu.copyLinkAddress' },
  copyTable: { ...editorClipboardWrite, ...focusAction, icon: Table2, labelKey: 'table.copyTable', shortcutKey: 'copyTable' },
  cut: { ...editorWritableSelectionClipboardWrite, ...focusAction, icon: Scissors, labelKey: 'menu.cut', shortcutKey: 'cut' },
  deleteImageReference: formatAction(Trash2, 'contextMenu.deleteImageReference'),
  deleteTable: formatAction(Table2, 'table.deleteTable', 'deleteTable'),
  exitFocusMode: editorAction(Focus, 'command.exitFocusMode'),
  fileTreeCopyPath: { ...surface, icon: FileText, labelKey: 'contextMenu.copyPath' },
  fileTreeCreateDirectory: { ...surface, icon: FolderPlus, labelKey: 'contextMenu.newFolder' },
  fileTreeCreateFile: { ...surface, icon: FilePlus, labelKey: 'contextMenu.newFile' },
  fileTreeDelete: { ...surface, icon: Trash2, labelKey: 'contextMenu.delete' },
  fileTreeRename: { ...surface, icon: Pencil, labelKey: 'contextMenu.rename' },
  fileTreeReveal: { ...surface, icon: FolderOpen, labelKey: 'contextMenu.revealInOs' },
  focusEditor: editorAction(Focus, 'command.focusEditor'),
  heading1: formatAction(Heading, 'menu.heading1', 'heading1'),
  heading2: formatAction(Heading, 'menu.heading2', 'heading2'),
  heading3: formatAction(Heading, 'menu.heading3', 'heading3'),
  heading4: formatAction(Heading, 'menu.heading4', 'heading4'),
  heading5: formatAction(Heading, 'menu.heading5', 'heading5'),
  heading6: formatAction(Heading, 'menu.heading6', 'heading6'),
  horizontalRule: formatAction(Minus, 'menu.horizontalRule'),
  image: formatAction(Image, 'menu.image', 'image'),
  inlineCode: formatAction(Code, 'menu.inlineCode'),
  italic: formatAction(Italic, 'menu.italic', 'italic'),
  link: formatAction(Link, 'menu.link'),
  newDocument: { ...always, ...focusAction, icon: FilePlus, labelKey: 'command.newDocument', shortcutKey: 'newDocument' },
  openAbout: { ...always, ...focusAction, icon: Info, labelKey: 'menu.about' },
  openCommandPalette: { ...always, ...focusAction, icon: Command, labelKey: 'commandPalette.open', shortcutKey: 'commandPalette' },
  openFile: { ...blockWhileFileOpening, icon: FolderOpen, labelKey: 'command.openFile', shortcutKey: 'openFile' },
  openLink: { ...surface, icon: ExternalLink, labelKey: 'contextMenu.openLink' },
  openRecentFile: { ...blockWhileFileOpening, icon: FileText, labelKey: null },
  openSearch: editorAction(Search, 'menu.find', 'find'),
  openSettings: { ...always, ...focusAction, icon: Settings, labelKey: 'settings.title' },
  openWorkspace: { ...blockWhileFileOpening, icon: FolderOpen, labelKey: 'workspace.open' },
  orderedList: formatAction(ListOrdered, 'menu.orderedList'),
  paragraph: formatAction(Pilcrow, 'menu.normalParagraph', 'normalParagraph'),
  paste: { ...editorClipboardRead, ...focusAction, icon: ClipboardPaste, labelKey: 'menu.paste', shortcutKey: 'paste' },
  quote: formatAction(Quote, 'menu.quote'),
  redo: formatAction(Redo2, 'menu.redo', 'redo'),
  resetZoom: editorAction(RotateCcw, 'menu.resetZoom'),
  revealImage: { ...surface, icon: FolderOpen, labelKey: 'contextMenu.revealImage' },
  save: { ...editorWhileFileOpening, icon: Save, labelKey: 'command.save', shortcutKey: 'save' },
  saveAs: { ...editorWhileFileOpening, icon: SaveAll, labelKey: 'command.saveAs', shortcutKey: 'saveAs' },
  selectAll: editorAction(TextSelect, 'menu.selectAll', 'selectAll'),
  setChineseLanguage: { ...always, icon: Languages, labelKey: 'settings.languageChinese' },
  setDarkTheme: { ...always, icon: Moon, labelKey: 'settings.themeDark' },
  setEnglishLanguage: { ...always, icon: Languages, labelKey: 'settings.languageEnglish' },
  setLightTheme: { ...always, icon: Sun, labelKey: 'settings.themeLight' },
  setSystemTheme: { ...always, icon: MonitorCog, labelKey: 'settings.themeSystem' },
  setLivePreviewMode: { ...editor, icon: Eye, labelKey: 'menu.livePreviewMode' },
  setReadingMode: { ...editor, icon: BookOpen, labelKey: 'menu.readingMode' },
  setSourceMode: { ...editor, icon: FileCode2, labelKey: 'menu.sourceMode' },
  strikethrough: formatAction(Strikethrough, 'menu.strikethrough'),
  table: formatAction(Table2, 'menu.table', 'table'),
  taskList: formatAction(ListChecks, 'menu.taskList'),
  toggleDisplayMode: { ...editor, icon: Eye, labelKey: 'command.toggleDisplayMode', shortcutKey: 'sourceMode' },
  toggleFocusMode: {
    ...editor,
    ...focusAction,
    icon: Focus,
    labelKey: ({ focusMode, scene }) =>
      scene === 'palette'
        ? focusMode
          ? 'command.exitFocusMode'
          : 'command.enterFocusMode'
        : 'menu.focusMode',
    shortcutKey: 'focusMode',
  },
  toggleLanguage: { ...always, icon: Languages, labelKey: 'command.toggleLanguage' },
  toggleSidebar: { ...always, icon: PanelLeft, labelKey: 'command.toggleSidebar', shortcutKey: 'sidebar' },
  toggleTheme: { ...always, icon: Moon, labelKey: 'command.toggleTheme' },
  undo: formatAction(Undo2, 'menu.undo', 'undo'),
  unorderedList: formatAction(List, 'menu.unorderedList'),
} satisfies Record<CommandDescriptorActionId, CommandDescriptor>;

export function getCommandDescriptor(
  action: CommandDescriptorActionId,
): CommandDescriptor {
  if (!Object.hasOwn(commandRegistry, action)) {
    throw new Error(`Unknown command descriptor: ${String(action)}`);
  }

  return commandRegistry[action];
}

export function resolveCommandPresentation(
  action: CommandDescriptorActionId,
  {
    focusMode = false,
    label,
    scene,
    shortcuts,
    t,
  }: {
    focusMode?: boolean;
    label?: string;
    scene: CommandScene;
    shortcuts?: CommandShortcutLabels;
    t: (key: string) => string;
  },
) {
  const descriptor = getCommandDescriptor(action);
  const labelKey =
    typeof descriptor.labelKey === 'function'
      ? descriptor.labelKey({ focusMode, scene })
      : descriptor.labelKey;

  if (!label && !labelKey) {
    throw new Error(`Command action requires a dynamic label: ${action}`);
  }

  return {
    focusManagement: descriptor.focusManagement,
    icon: descriptor.icon,
    label: label ?? t(labelKey!),
    shortcut: descriptor.shortcutKey
      ? shortcuts?.[descriptor.shortcutKey]
      : undefined,
  };
}
