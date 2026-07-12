import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';
import { collectMarkdownDecorationRanges } from '../wysiwyg/markdownDecorations';

const parents: HTMLElement[] = [];

describe('markdown format commands', () => {
  afterEach(() => {
    for (const parent of parents.splice(0)) {
      parent.remove();
    }
  });

  it.each([
    ['bold', 'plain text', 0, 5, '**plain** text'],
    ['italic', 'plain text', 0, 5, '*plain* text'],
    ['strikethrough', 'plain text', 0, 5, '~~plain~~ text'],
    ['inlineCode', 'plain text', 0, 5, '`plain` text'],
    ['link', 'plain text', 0, 5, '[plain](url) text'],
    ['image', 'plain text', 0, 5, '![plain](url) text'],
  ] satisfies Array<[MarkdownFormatCommand, string, number, number, string]>)(
    'wraps the current selection as %s',
    (command, doc, from, to, expected) => {
      const view = createView(doc, from, to);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      view.destroy();
    },
  );

  it('inserts an image placeholder and selects its alt text when nothing is selected', () => {
    const view = createView('', 0, 0);

    applyMarkdownFormatCommand(view, 'image');

    expect(view.state.doc.toString()).toBe('![image](url)');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'image',
    );
    view.destroy();
  });

  it.each([
    ['bold', '**plain** text', 2, 7, 'plain text'],
    ['italic', '*plain* text', 1, 6, 'plain text'],
    ['strikethrough', '~~plain~~ text', 2, 7, 'plain text'],
    ['inlineCode', '`plain` text', 1, 6, 'plain text'],
  ] satisfies Array<[MarkdownFormatCommand, string, number, number, string]>)(
    'removes existing %s markers around the selected text',
    (command, doc, from, to, expected) => {
      const view = createView(doc, from, to);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
        'plain',
      );
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    },
  );

  it.each([
    ['* [x] item', 'item'],
    ['+ [ ] item', 'item'],
    ['1. [x] item', 'item'],
    ['- [ ]', ''],
    ['* [x]', ''],
    ['1. [ ]', ''],
  ])('removes alternate task-list markers from %s', (doc, expected) => {
    const view = createView(doc, 0, doc.length);

    applyMarkdownFormatCommand(view, 'taskList');

    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
    view.destroy();
  });

  it.each([
    ['link', '[plain](url) text', 1, 6, '[[plain](url)](url) text'],
    ['image', '![plain](url) text', 2, 7, '![![plain](url)](url) text'],
  ] satisfies Array<[MarkdownFormatCommand, string, number, number, string]>)(
    'does not discard existing %s destinations when formatting their selected text',
    (command, doc, from, to, expected) => {
      const view = createView(doc, from, to);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      view.destroy();
    },
  );

  it('inserts a horizontal rule after the current non-empty block without replacing its source', () => {
    const view = createView('Before\nAfter', 3, 3);

    applyMarkdownFormatCommand(view, 'horizontalRule');

    expect(view.state.doc.toString()).toBe('Before\n\n---\n\nAfter');
    expect(view.state.sliceDoc(0, 6)).toBe('Before');
    view.destroy();
  });

  it('preserves a paragraph boundary when inserting a horizontal rule on an empty line', () => {
    const view = createView('Before\n\nAfter', 7, 7);

    applyMarkdownFormatCommand(view, 'horizontalRule');

    expect(view.state.doc.toString()).toBe('Before\n\n---\n\nAfter');
    expect(
      collectMarkdownDecorationRanges(view.state.doc.toString()).some(
        (range) => range.kind === 'horizontalRule',
      ),
    ).toBe(true);
    view.destroy();
  });

  it.each([
    ['heading1', 'Title', '# Title'],
    ['heading2', '# Title', '## Title'],
    ['heading3', 'Title', '### Title'],
    ['heading4', 'Title', '#### Title'],
    ['heading5', 'Title', '##### Title'],
    ['heading6', 'Title', '###### Title'],
    ['orderedList', 'item', '1. item'],
    ['unorderedList', 'item', '- item'],
    ['taskList', 'item', '- [ ] item'],
    ['quote', 'quote', '> quote'],
  ] satisfies Array<[MarkdownFormatCommand, string, string]>)(
    'applies %s to the current line',
    (command, doc, expected) => {
      const view = createView(doc, doc.length, doc.length);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      view.destroy();
    },
  );

  it.each([
    ['unorderedList', '- first\n- second', 'first\nsecond'],
    ['orderedList', '1. first\n2. second', 'first\nsecond'],
    ['taskList', '- [ ] first\n- [x] second', 'first\nsecond'],
    ['quote', '> first\n> second', 'first\nsecond'],
  ] satisfies Array<[MarkdownFormatCommand, string, string]>)(
    'removes %s markers when every selected non-empty line already has one',
    (command, doc, expected) => {
      const view = createView(doc, 0, doc.length);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    },
  );

  it.each([
    ['unorderedList', '  - child', '  child'],
    ['orderedList', '  1. child', '  child'],
    ['taskList', '  - [x] child', '  child'],
  ] satisfies Array<[MarkdownFormatCommand, string, string]>)(
    'removes nested %s markers without changing indentation',
    (command, doc, expected) => {
      const view = createView(doc, 0, doc.length);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    },
  );

  it.each([
    ['unorderedList', '  child', '  - child'],
    ['orderedList', '  child', '  1. child'],
    ['taskList', '  child', '  - [ ] child'],
  ] satisfies Array<[MarkdownFormatCommand, string, string]>)(
    'adds nested %s markers after existing indentation',
    (command, doc, expected) => {
      const view = createView(doc, 0, doc.length);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      view.destroy();
    },
  );

  it('wraps the selected block in a fenced code block', () => {
    const view = createView('const value = 1', 0, 15);

    applyMarkdownFormatCommand(view, 'codeBlock');

    expect(view.state.doc.toString()).toBe('```\nconst value = 1\n```');
    view.destroy();
  });

  it('inserts a starter markdown table', () => {
    const view = createView('before\n', 7, 7);

    applyMarkdownFormatCommand(view, 'table');

    expect(view.state.doc.toString()).toBe(
      ['before', '', '|   |   |', '| - | - |', '|   |   |', ''].join('\n'),
    );
    view.destroy();
  });

  it('prefixes every selected non-empty line as an ordered list and supports undo', () => {
    const view = createView('first\n\nsecond', 0, 13);

    applyMarkdownFormatCommand(view, 'orderedList');

    expect(view.state.doc.toString()).toBe('1. first\n\n1. second');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('first\n\nsecond');
    view.destroy();
  });

  it.each([
    ['heading3', '#   Title', '###   Title'],
    ['heading4', '##\t\tTitle', '####\t\tTitle'],
  ] satisfies Array<[MarkdownFormatCommand, string, string]>)(
    'changes only the marker when applying %s to an existing heading',
    (command, doc, expected) => {
      const view = createView(doc, doc.length, doc.length);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
      view.destroy();
    },
  );
});

function createView(doc: string, from: number, to: number): EditorView {
  const parent = document.createElement('div');
  parents.push(parent);
  document.body.appendChild(parent);

  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [history()],
      selection: { anchor: from, head: to },
    }),
  });
}
