import type { KeyBinding } from '@codemirror/view';
import { applyMarkdownFormatCommand } from './markdownFormatCommands';

export const markdownFormatKeymap: readonly KeyBinding[] = [
  {
    key: 'Mod-b',
    run: (view) => applyMarkdownFormatCommand(view, 'bold'),
  },
  {
    key: 'Mod-i',
    run: (view) => applyMarkdownFormatCommand(view, 'italic'),
  },
  {
    key: 'Mod-0',
    run: (view) => applyMarkdownFormatCommand(view, 'paragraph'),
  },
  {
    key: 'Mod-1',
    run: (view) => applyMarkdownFormatCommand(view, 'heading1'),
  },
  {
    key: 'Mod-2',
    run: (view) => applyMarkdownFormatCommand(view, 'heading2'),
  },
  {
    key: 'Mod-3',
    run: (view) => applyMarkdownFormatCommand(view, 'heading3'),
  },
  {
    key: 'Mod-4',
    run: (view) => applyMarkdownFormatCommand(view, 'heading4'),
  },
  {
    key: 'Mod-5',
    run: (view) => applyMarkdownFormatCommand(view, 'heading5'),
  },
  {
    key: 'Mod-6',
    run: (view) => applyMarkdownFormatCommand(view, 'heading6'),
  },
  {
    key: 'Mod-Shift-k',
    run: (view) => applyMarkdownFormatCommand(view, 'codeBlock'),
  },
];
