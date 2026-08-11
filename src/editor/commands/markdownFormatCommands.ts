import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { createEditorCapabilityCommands } from '../capabilities';
import { announceReadOnlyEditAttempt } from '../core/readOnlyEditAttempt';
import { toggleBlockquote } from './blockquoteCommands';

export type MarkdownFormatCommand =
  | 'bold'
  | 'codeBlock'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'horizontalRule'
  | 'image'
  | 'inlineCode'
  | 'italic'
  | 'link'
  | 'orderedList'
  | 'paragraph'
  | 'quote'
  | 'strikethrough'
  | 'table'
  | 'taskList'
  | 'unorderedList';

export function applyMarkdownFormatCommand(
  view: EditorView,
  command: MarkdownFormatCommand,
): boolean {
  if (view.state.readOnly) {
    announceReadOnlyEditAttempt(view);
    return true;
  }

  switch (command) {
    case 'bold':
      return wrapSelection(view, '**', '**', 'bold', true);
    case 'italic':
      return wrapSelection(view, '*', '*', 'italic', true);
    case 'strikethrough':
      return wrapSelection(view, '~~', '~~', 'strikethrough', true);
    case 'inlineCode':
      return wrapSelection(view, '`', '`', 'code', true);
    case 'link':
      return wrapSelection(view, '[', '](url)', 'link');
    case 'image':
      return wrapSelection(view, '![', '](url)', 'image');
    case 'horizontalRule':
      return insertHorizontalRule(view);
    case 'paragraph':
      return normalizeParagraph(view);
    case 'heading1':
      return replaceHeadingPrefix(view, '#');
    case 'heading2':
      return replaceHeadingPrefix(view, '##');
    case 'heading3':
      return replaceHeadingPrefix(view, '###');
    case 'heading4':
      return replaceHeadingPrefix(view, '####');
    case 'heading5':
      return replaceHeadingPrefix(view, '#####');
    case 'heading6':
      return replaceHeadingPrefix(view, '######');
    case 'unorderedList':
      return prefixSelectedLines(view, '- ', /^(\s*)([-*+]\s+)/);
    case 'orderedList':
      return prefixSelectedLines(view, '1. ', /^(\s*)(\d+[.)]\s+)/);
    case 'taskList':
      return prefixSelectedLines(
        view,
        '- [ ] ',
        /^(\s{0,3})((?:[-*+]|\d+[.)])\s+\[[ xX]\](?:\s+)?)(?=\S|$)/,
      );
    case 'quote':
      return toggleBlockquote(view);
    case 'codeBlock':
      return createEditorCapabilityCommands(view).wrapCodeBlock();
    case 'table':
      return createEditorCapabilityCommands(view).insertTable();
  }
}

function normalizeParagraph(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const heading = /^( {0,3})#{1,6}[ \t]+/.exec(line.text);

  if (!heading) {
    view.focus();
    return true;
  }

  const markerLength = heading[0].length - heading[1].length;
  const markerFrom = line.from + heading[1].length;

  view.dispatch({
    changes: {
      from: markerFrom,
      to: markerFrom + markerLength,
      insert: '',
    },
    selection: EditorSelection.cursor(
      Math.max(markerFrom, selection.head - markerLength),
    ),
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}

function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
  allowUnwrap = false,
): boolean {
  const selection = view.state.selection.main;
  const selectedText = view.state.doc.sliceString(selection.from, selection.to);

  if (allowUnwrap && selectedText && isWrappedSelection(view, before, after)) {
    const wrapperFrom = selection.from - before.length;

    view.dispatch({
      changes: {
        from: wrapperFrom,
        insert: selectedText,
        to: selection.to + after.length,
      },
      selection: EditorSelection.range(
        wrapperFrom,
        wrapperFrom + selectedText.length,
      ),
      userEvent: 'input.format',
    });
    view.focus();

    return true;
  }

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

function isWrappedSelection(
  view: EditorView,
  before: string,
  after: string,
): boolean {
  const selection = view.state.selection.main;

  if (selection.from < before.length || selection.to + after.length > view.state.doc.length) {
    return false;
  }

  return (
    view.state.doc.sliceString(selection.from - before.length, selection.from) ===
      before &&
    view.state.doc.sliceString(selection.to, selection.to + after.length) === after
  );
}

function insertHorizontalRule(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.to);

  if (line.length === 0) {
    const previousLine =
      line.number > 1 ? view.state.doc.line(line.number - 1) : null;
    const needsParagraphBoundary = Boolean(previousLine?.text.trim());
    const hasFollowingLine = line.number < view.state.doc.lines;
    const insertion = needsParagraphBoundary ? '\n---\n' : '---';

    view.dispatch({
      changes: { from: line.from, insert: insertion },
      selection: EditorSelection.cursor(
        line.from + insertion.length + (hasFollowingLine ? 1 : 0),
      ),
      userEvent: 'input.format',
    });
    view.focus();

    return true;
  }

  const hasFollowingLine = line.number < view.state.doc.lines;
  const insertion = hasFollowingLine ? '\n\n---\n' : '\n\n---\n\n';

  view.dispatch({
    changes: { from: line.to, insert: insertion },
    selection: EditorSelection.cursor(
      line.to + insertion.length + (hasFollowingLine ? 1 : 0),
    ),
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}

function replaceHeadingPrefix(view: EditorView, marker: string): boolean {
  const selection = view.state.selection.main;
  const line = view.state.doc.lineAt(selection.from);
  const text = line.text;
  const headingMatch = /^(#{1,6})(?=[ \t]+)/.exec(text);
  const from = line.from;
  const to = headingMatch ? line.from + headingMatch[0].length : line.from;
  const insert = headingMatch ? marker : `${marker} `;

  view.dispatch({
    changes: {
      from,
      insert,
      to,
    },
    selection: EditorSelection.cursor(selection.head + insert.length - (to - from)),
    userEvent: 'input.format',
  });
  view.focus();

  return true;
}

function prefixSelectedLines(
  view: EditorView,
  prefix: string,
  removablePrefix: RegExp,
): boolean {
  const selection = view.state.selection.main;
  const fromLine = view.state.doc.lineAt(selection.from);
  const toLine = view.state.doc.lineAt(selection.to);
  const lines = [];

  for (let lineNumber = fromLine.number; lineNumber <= toLine.number; lineNumber += 1) {
    lines.push(view.state.doc.line(lineNumber));
  }

  const nonEmptyLines = lines.filter((line) => line.text.trim());
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => removablePrefix.test(line.text));
  const changes = [];

  for (const line of lines) {
    const marker = removablePrefix.exec(line.text);

    if (!line.text.trim()) {
      continue;
    }

    if (shouldRemove && marker) {
      const markerFrom = line.from + marker[1].length;

      changes.push({
        from: markerFrom,
        to: markerFrom + marker[2].length,
        insert: '',
      });
    } else {
      changes.push({
        from: line.from + leadingIndentLength(line.text),
        insert: prefix,
      });
    }
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

function leadingIndentLength(text: string): number {
  return /^\s*/.exec(text)?.[0].length ?? 0;
}
