import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
} from '@codemirror/lang-markdown';
import { EditorState, type StateCommand, type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';

function runCommand(
  doc: string,
  command: StateCommand,
  position = doc.length,
): { handled: boolean; transaction: Transaction | null } {
  const state = EditorState.create({
    doc,
    extensions: [markdownLanguage()],
    selection: { anchor: position },
  });
  let transaction: Transaction | null = null;
  const handled = command({
    dispatch: (value) => {
      transaction = value;
    },
    state,
  });

  return { handled, transaction };
}

describe('official Markdown structure keymap characterization', () => {
  it.each([
    ['unordered list', '- item', '- item\n- '],
    ['ordered list', '1. item', '1. item\n2. '],
    ['task list', '- [ ] task', '- [ ] task\n- [ ] '],
    ['nested list', '- parent\n  - child', '- parent\n  - child\n  - '],
    ['blockquote', '> quote', '> quote\n> '],
  ])('continues a %s through the official Enter command', (_name, doc, expected) => {
    const result = runCommand(doc, insertNewlineContinueMarkup);

    expect(result.handled).toBe(true);
    expect(result.transaction?.state.doc.toString()).toBe(expected);
  });

  it('keeps the official non-tight-list transition for a blank second item', () => {
    const result = runCommand('- first\n- ', insertNewlineContinueMarkup);

    expect(result.handled).toBe(true);
    expect(result.transaction?.state.doc.toString()).toBe('- first\n\n- ');
    expect(result.transaction?.state.selection.main.head).toBe(11);
  });

  it('creates and then exits a multi-paragraph blockquote blank line', () => {
    const blankLine = runCommand('> quote\n> ', insertNewlineContinueMarkup);

    expect(blankLine.transaction?.state.doc.toString()).toBe(
      '> quote\n>\n> ',
    );

    const exit = runCommand(
      blankLine.transaction?.state.doc.toString() ?? '',
      insertNewlineContinueMarkup,
    );

    expect(exit.transaction?.state.doc.toString()).toBe('> quote\n\n');
  });

  it.each([
    ['unordered marker', '- ', ''],
    ['indented unordered marker', '  - ', ''],
    ['ordered marker', '1. ', ''],
    ['single quote marker', '> ', ''],
    ['nested quote marker', '> > ', '> '],
  ])('keeps official Backspace behavior for a %s', (_name, doc, expected) => {
    const result = runCommand(doc, deleteMarkupBackward);

    expect(result.handled).toBe(true);
    expect(result.transaction?.state.doc.toString()).toBe(expected);
  });
});
