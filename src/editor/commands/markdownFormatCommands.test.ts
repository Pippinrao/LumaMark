import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyMarkdownFormatCommand,
  type MarkdownFormatCommand,
} from './markdownFormatCommands';

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
    ['inlineCode', 'plain text', 0, 5, '`plain` text'],
    ['link', 'plain text', 0, 5, '[plain](url) text'],
  ] satisfies Array<[MarkdownFormatCommand, string, number, number, string]>)(
    'wraps the current selection as %s',
    (command, doc, from, to, expected) => {
      const view = createView(doc, from, to);

      applyMarkdownFormatCommand(view, command);

      expect(view.state.doc.toString()).toBe(expected);
      view.destroy();
    },
  );

  it.each([
    ['heading1', 'Title', '# Title'],
    ['heading2', '# Title', '## Title'],
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
});

function createView(doc: string, from: number, to: number): EditorView {
  const parent = document.createElement('div');
  parents.push(parent);
  document.body.appendChild(parent);

  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
    }),
  });
}
