import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { insertMarkdownTable } from '../widgets/table/tableCommands';

export type MarkdownFormatCommand =
  | 'bold'
  | 'codeBlock'
  | 'heading1'
  | 'heading2'
  | 'inlineCode'
  | 'italic'
  | 'link'
  | 'quote'
  | 'table'
  | 'taskList'
  | 'unorderedList';

export function applyMarkdownFormatCommand(
  view: EditorView,
  command: MarkdownFormatCommand,
): boolean {
  switch (command) {
    case 'bold':
      return wrapSelection(view, '**', '**', 'bold');
    case 'italic':
      return wrapSelection(view, '*', '*', 'italic');
    case 'inlineCode':
      return wrapSelection(view, '`', '`', 'code');
    case 'link':
      return wrapSelection(view, '[', '](url)', 'link');
    case 'heading1':
      return replaceHeadingPrefix(view, '# ');
    case 'heading2':
      return replaceHeadingPrefix(view, '## ');
    case 'unorderedList':
      return prefixSelectedLines(view, '- ');
    case 'taskList':
      return prefixSelectedLines(view, '- [ ] ');
    case 'quote':
      return prefixSelectedLines(view, '> ');
    case 'codeBlock':
      return wrapSelection(view, '```\n', '\n```', 'code');
    case 'table':
      if (!insertMarkdownTable(view)) {
        return false;
      }

      view.focus();
      return true;
  }
}

function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
): boolean {
  const selection = view.state.selection.main;
  const selectedText = view.state.doc.sliceString(selection.from, selection.to);
  const content = selectedText || placeholder;
  const insert = `${before}${content}${after}`;
  const cursorFrom = selection.from + before.length;
  const cursorTo = cursorFrom + content.length;

  view.dispatch({
    changes: {
      from: selection.from,
      insert,
      to: selection.to,
    },
    selection: EditorSelection.range(cursorFrom, cursorTo),
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}

function replaceHeadingPrefix(view: EditorView, prefix: '# ' | '## '): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const text = line.text;
  const headingMatch = /^(#{1,6})[ \t]+/.exec(text);
  const from = line.from;
  const to = headingMatch ? line.from + headingMatch[0].length : line.from;

  view.dispatch({
    changes: {
      from,
      insert: prefix,
      to,
    },
    selection: EditorSelection.cursor(selection.head + prefix.length - (to - from)),
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}

function prefixSelectedLines(view: EditorView, prefix: string): boolean {
  const selection = view.state.selection.main;
  const fromLine = view.state.doc.lineAt(selection.from);
  const toLine = view.state.doc.lineAt(selection.to);
  const changes = [];

  for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);

    if (!line.text.trim()) {
      continue;
    }

    changes.push({
      from: line.from,
      insert: prefix,
    });
  }

  if (!changes.length) {
    changes.push({
      from: fromLine.from,
      insert: prefix,
    });
  }

  view.dispatch({
    changes,
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}
