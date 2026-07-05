import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  collectMarkdownDecorationRanges,
  markdownWysiwygExtension,
} from './markdownDecorations';
import { markdownLanguage } from '../markdown/markdownLanguage';
import { toggleTaskListAtSelection } from './taskListCommands';

describe('markdown WYSIWYG decorations', () => {
  it('marks heading lines with level-specific ranges', () => {
    const ranges = collectMarkdownDecorationRanges('# 标题\n\n### Deep\nbody');

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-heading lm-md-heading-1',
          from: 0,
          kind: 'heading',
          to: 4,
        },
        {
          className: 'lm-md-heading lm-md-heading-3',
          from: 6,
          kind: 'heading',
          to: 14,
        },
      ]),
    );
  });

  it('marks bold italic and strikethrough inline ranges', () => {
    const ranges = collectMarkdownDecorationRanges(
      '**粗体** and *斜体* and ~~删除~~',
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-strong',
          from: 0,
          kind: 'strong',
          to: 6,
        },
        {
          className: 'lm-md-emphasis',
          from: 11,
          kind: 'emphasis',
          to: 15,
        },
        {
          className: 'lm-md-strikethrough',
          from: 20,
          kind: 'strikethrough',
          to: 26,
        },
      ]),
    );
  });

  it('marks underscore bold and italic inline ranges', () => {
    const ranges = collectMarkdownDecorationRanges(
      '__粗体__ and _斜体_',
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-strong',
          from: 0,
          kind: 'strong',
          to: 6,
        },
        {
          className: 'lm-md-emphasis',
          from: 11,
          kind: 'emphasis',
          to: 15,
        },
      ]),
    );
  });

  it('marks blockquotes lists tasks inline code and code blocks', () => {
    const markdown = [
      '> quote',
      '- bullet',
      '1. ordered',
      '- [ ] task',
      '[Luma](https://example.com)',
      '',
      '---',
      'inline `code`',
      '```ts',
      'const x = 1',
      '```',
    ].join('\n');

    const ranges = collectMarkdownDecorationRanges(markdown);

    expect(ranges.map((range) => range.kind)).toEqual(
      expect.arrayContaining([
        'blockquote',
        'unorderedList',
        'orderedList',
        'taskList',
        'inlineCode',
        'codeBlock',
        'link',
        'horizontalRule',
      ]),
    );
  });

  it('marks links autolinks and horizontal rules from the markdown syntax tree', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '[Luma](https://example.com)',
        '',
        '<https://example.com>',
        '',
        '---',
      ].join('\n'),
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-link',
          from: 0,
          kind: 'link',
          to: 27,
        },
        {
          className: 'lm-md-link',
          from: 29,
          kind: 'link',
          to: 50,
        },
        {
          className: 'lm-md-horizontal-rule',
          from: 52,
          kind: 'horizontalRule',
          to: 55,
        },
      ]),
    );
  });

  it('marks tilde fenced code blocks and ignores markdown inside them', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '~~~md',
        '# not a heading',
        '- [ ] not a task',
        '~~~',
      ].join('\n'),
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-code-block',
          from: 0,
          kind: 'codeBlock',
          to: 42,
        },
      ]),
    );
    expect(
      ranges.filter((range) =>
        ['heading', 'taskList', 'unorderedList'].includes(range.kind),
      ),
    ).toEqual([]);
  });

  it('marks only list markers for unordered and ordered lists', () => {
    const ranges = collectMarkdownDecorationRanges('- bullet\n\n12. ordered');

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-list lm-md-unordered-list lm-md-list-marker',
          from: 0,
          kind: 'unorderedList',
          to: 1,
        },
        {
          className: 'lm-md-list lm-md-ordered-list lm-md-list-marker',
          from: 10,
          kind: 'orderedList',
          to: 13,
        },
      ]),
    );
  });

  it('marks ordered task list markers', () => {
    const ranges = collectMarkdownDecorationRanges('1. [ ] ordered task');

    expect(ranges).toEqual(
      expect.arrayContaining([
        {
          className: 'lm-md-list lm-md-task-list lm-md-list-marker',
          from: 0,
          kind: 'taskList',
          to: 6,
        },
      ]),
    );
  });

  it('marks GFM table blocks and cells with document-grade ranges', () => {
    const ranges = collectMarkdownDecorationRanges(
      ['| Name | Status |', '| --- | --- |', '| Luma | Ready |'].join('\n'),
    );

    expect(ranges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: 'lm-md-table',
          from: 0,
          kind: 'table',
        }),
        expect.objectContaining({
          className: 'lm-md-table-header',
          from: 0,
          kind: 'tableHeader',
        }),
        expect.objectContaining({
          className: 'lm-md-table-cell',
          kind: 'tableCell',
        }),
        expect.objectContaining({
          className: 'lm-md-table-delimiter',
          kind: 'tableDelimiter',
        }),
      ]),
    );
  });

  it('does not apply emphasis styling inside inline code or code blocks', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '`**literal**`',
        '```md',
        '**also literal**',
        '```',
      ].join('\n'),
    );

    expect(ranges.filter((range) => range.kind === 'strong')).toEqual([]);
  });

  it('does not apply block markdown styling inside code blocks', () => {
    const ranges = collectMarkdownDecorationRanges(
      [
        '```md',
        '# not a heading',
        '- not a list',
        '> not a quote',
        '```',
      ].join('\n'),
    );

    expect(
      ranges.filter((range) =>
        ['blockquote', 'heading', 'unorderedList'].includes(range.kind),
      ),
    ).toEqual([]);
  });

});

describe('markdown WYSIWYG extension', () => {
  it('rehides markdown marks when the cursor leaves the active line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['# Title', 'plain'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(1),
      }),
    });

    expect(parent.querySelector('.lm-md-hidden-mark')).toBeNull();

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('plain')),
    });

    expect(parent.querySelector('.lm-md-hidden-mark')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('adds stable line classes for unordered and task list preview rows', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- item', '- [ ] task'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.length),
      }),
    });

    expect(parent.querySelector('.lm-md-unordered-list-line')).not.toBeNull();
    expect(parent.querySelector('.lm-md-task-list-line')).not.toBeNull();
    expect(parent.querySelector('.lm-md-list-bullet')).not.toBeNull();
    expect(parent.querySelector('.lm-md-task-checkbox')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('renders task checkbox widgets without changing source text', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '- [ ] task',
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });

    expect(view.state.doc.toString()).toBe('- [ ] task');
    expect(parent.querySelector('.lm-md-task-checkbox')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('renders ordered task checkbox widgets', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '1. [ ] task',
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });

    expect(parent.querySelector('.lm-md-task-checkbox')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('does not render task checkbox widgets inside fenced code blocks', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ['```md', '- [ ] literal task', '```'].join('\n'),
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });

    expect(parent.querySelector('.lm-md-task-checkbox')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('renders nested unordered list markers as preview bullets off the active line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- top', '  - nested', 'plain'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    expect(parent.querySelectorAll('.lm-md-list-bullet')).toHaveLength(2);
    expect(parent.querySelector('.lm-md-unordered-list-line')).not.toBeNull();

    view.destroy();
    parent.remove();
  });

  it('keeps source markers visible on the active list quote and code lines', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = ['- item', '> quote', '```ts', 'const x = 1', '```'].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(1),
      }),
    });

    expect(parent.querySelector('.lm-md-list-bullet')).toBeNull();
    expect(parent.textContent).toContain('- item');

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('quote')),
    });
    expect(parent.textContent).toContain('> quote');

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('```ts')),
    });
    expect(parent.textContent).toContain('```ts');

    view.destroy();
    parent.remove();
  });

  it('hides link quote and fenced code markdown marks away from the active line', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = [
      '> quote',
      '[Luma](https://example.com)',
      '```ts',
      'const x = 1',
      '```',
      'plain',
    ].join('\n');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
        selection: EditorSelection.cursor(doc.indexOf('plain')),
      }),
    });

    expect(parent.textContent).toContain('quote');
    expect(parent.textContent).toContain('Luma');
    expect(parent.textContent).toContain('const x = 1');
    expect(parent.textContent).not.toContain('> quote');
    expect(parent.textContent).not.toContain('[Luma]');
    expect(parent.textContent).not.toContain('https://example.com');
    expect(parent.textContent).not.toContain('```');

    view.destroy();
    parent.remove();
  });
});

describe('task list commands', () => {
  it('toggles an unchecked task marker at the current selection', () => {
    const state = EditorState.create({
      doc: '- [ ] task',
      selection: EditorSelection.cursor(3),
    });

    const changes = toggleTaskListAtSelection(state);
    if (!changes) {
      throw new Error('Expected unchecked task marker to toggle.');
    }
    const transaction = state.update({ changes });

    expect(transaction.state.doc.toString()).toBe('- [x] task');
  });

  it('toggles a checked task marker at the current selection', () => {
    const state = EditorState.create({
      doc: '- [x] task',
      selection: EditorSelection.cursor(4),
    });

    const changes = toggleTaskListAtSelection(state);
    if (!changes) {
      throw new Error('Expected checked task marker to toggle.');
    }
    const transaction = state.update({ changes });

    expect(transaction.state.doc.toString()).toBe('- [ ] task');
  });

  it('toggles an ordered task marker at the current selection', () => {
    const state = EditorState.create({
      doc: '1. [ ] task',
      selection: EditorSelection.cursor(5),
    });

    const changes = toggleTaskListAtSelection(state);
    if (!changes) {
      throw new Error('Expected ordered task marker to toggle.');
    }
    const transaction = state.update({ changes });

    expect(transaction.state.doc.toString()).toBe('1. [x] task');
  });

  it('does not toggle bracket text that is not a task list marker', () => {
    const state = EditorState.create({
      doc: 'plain [ ] text',
      selection: EditorSelection.cursor(7),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
  });

  it('does not toggle a task marker without a following space', () => {
    const state = EditorState.create({
      doc: '- [ ]literal',
      selection: EditorSelection.cursor(3),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
  });

  it('does not toggle task-like text inside fenced code blocks', () => {
    const state = EditorState.create({
      doc: ['```md', '- [ ] literal task', '```'].join('\n'),
      extensions: [markdownLanguage(), markdownWysiwygExtension()],
      selection: EditorSelection.cursor(9),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
  });
});
