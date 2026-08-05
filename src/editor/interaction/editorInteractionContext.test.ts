import {
  EditorSelection,
  EditorState,
  type SelectionRange,
} from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import { deriveEditorInteractionContext } from './editorInteractionContext';

function createState(
  doc: string,
  selection: EditorSelection | SelectionRange,
): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      markdownLanguage(),
    ],
    selection,
  });
}

describe('editor interaction context', () => {
  it('activates only the innermost inline owner for a collapsed caret', () => {
    const doc = '**outer *中文* tail**';
    const state = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('中文') + 1),
    );

    const context = deriveEditorInteractionContext(state, false);
    const selection = context.selections[0];

    expect(selection.inlineOwners.map((owner) => owner.kind)).toEqual([
      'Emphasis',
    ]);
    expect(
      selection.delimiterRanges.map((range) =>
        state.doc.sliceString(range.from, range.to),
      ),
    ).toEqual(['*', '*']);
    expect(context.activeInlineOwners).toEqual(selection.inlineOwners);
    expect(selection.block?.kind).toBe('Paragraph');
    expect(selection.crossesBlocks).toBe(false);
  });

  it('activates every nested inline owner intersected by a non-empty selection', () => {
    const doc = '**outer *中文* tail**';
    const state = createState(
      doc,
      EditorSelection.range(doc.indexOf('中文'), doc.indexOf('中文') + 2),
    );

    const selection = deriveEditorInteractionContext(
      state,
      false,
    ).selections[0];

    expect(selection.inlineOwners.map((owner) => owner.kind)).toEqual([
      'StrongEmphasis',
      'Emphasis',
    ]);
  });

  it('does not activate either adjacent owner at their shared boundary', () => {
    const doc = '**a**_b_';
    const state = createState(doc, EditorSelection.cursor(5));

    const context = deriveEditorInteractionContext(state, false);

    expect(context.selections[0].inlineOwners).toEqual([]);
    expect(context.activeInlineOwners).toEqual([]);
  });

  it('uses real intersection for a non-empty selection across adjacent owners', () => {
    const doc = '**a**_b_';
    const state = createState(
      doc,
      EditorSelection.create([EditorSelection.range(4, 6)]),
    );

    const context = deriveEditorInteractionContext(state, false);

    expect(
      context.selections[0].inlineOwners.map((owner) => owner.kind),
    ).toEqual(['StrongEmphasis', 'Emphasis']);

    const boundaryOnlyState = createState(
      doc,
      EditorSelection.create([EditorSelection.range(5, 6)]),
    );
    expect(
      deriveEditorInteractionContext(
        boundaryOnlyState,
        false,
      ).selections[0].inlineOwners.map((owner) => owner.kind),
    ).toEqual(['Emphasis']);
  });

  it('derives each selection independently and merges active owners', () => {
    const doc = '**甲** plain ``乙`文``';
    const state = createState(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf('甲')),
        EditorSelection.cursor(doc.indexOf('乙')),
      ]),
    );

    const context = deriveEditorInteractionContext(state, true);

    expect(context.composition).toBe(true);
    expect(
      context.selections.map((selection) =>
        selection.inlineOwners.map((owner) => owner.kind),
      ),
    ).toEqual([['StrongEmphasis'], ['InlineCode']]);
    expect(
      context.activeInlineOwners.map((owner) => owner.kind),
    ).toEqual(['StrongEmphasis', 'InlineCode']);
    expect(
      context.selections[1].delimiterRanges.map((range) =>
        state.doc.sliceString(range.from, range.to),
      ),
    ).toEqual(['``', '``']);
  });

  it.each([
    {
      cursorText: 'plain',
      doc: 'plain',
      expected: 'Paragraph',
    },
    {
      cursorText: 'ATX',
      doc: '# ATX',
      expected: 'ATXHeading1',
    },
    {
      cursorText: 'Setext',
      doc: 'Setext\n===',
      expected: 'SetextHeading1',
    },
    {
      cursorText: 'item',
      doc: '- item',
      expected: 'ListItem',
    },
    {
      cursorText: 'quote',
      doc: '> quote',
      expected: 'Blockquote',
    },
    {
      cursorText: 'const',
      doc: '```ts\nconst x = 1\n```',
      expected: 'FencedCode',
    },
    {
      cursorText: 'value',
      doc: '| value |\n| --- |',
      expected: 'TableCell',
    },
  ])(
    'derives the smallest $expected block',
    ({ cursorText, doc, expected }) => {
      const state = createState(
        doc,
        EditorSelection.cursor(doc.indexOf(cursorText)),
      );

      const context = deriveEditorInteractionContext(state, false);

      expect(context.selections[0].block?.kind).toBe(expected);
    },
  );

  it('reports selections that cross syntax blocks but not soft lines', () => {
    const blocks = 'first\n\nsecond';
    const crossBlockState = createState(
      blocks,
      EditorSelection.create([
        EditorSelection.range(
          blocks.indexOf('first') + 1,
          blocks.indexOf('second') + 1,
        ),
      ]),
    );
    const softLine = 'first\nsecond';
    const softLineState = createState(
      softLine,
      EditorSelection.create([
        EditorSelection.range(1, softLine.length - 1),
      ]),
    );

    expect(
      deriveEditorInteractionContext(crossBlockState, false).selections[0]
        .crossesBlocks,
    ).toBe(true);
    expect(
      deriveEditorInteractionContext(softLineState, false).selections[0]
        .crossesBlocks,
    ).toBe(false);
  });

  it('keeps blockquote delimiters scoped to the active line', () => {
    const doc = '> first\n\n> second';
    const state = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('first') + 1),
    );

    const selection = deriveEditorInteractionContext(
      state,
      false,
    ).selections[0];

    expect(
      selection.block?.delimiterRanges.map((range) =>
        state.doc.sliceString(range.from, range.to),
      ),
    ).toEqual([]);
    expect(
      selection.delimiterRanges.map((range) =>
        state.doc.sliceString(range.from, range.to),
      ),
    ).toEqual(['>']);
  });

  it.each([
    {
      block: 'Blockquote',
      cursorText: 'nested',
      doc: '> > nested',
      expected: ['>', '>'],
      name: 'nested blockquote',
    },
    {
      block: 'ListItem',
      cursorText: 'quoted task',
      doc: '> - [ ] quoted task',
      expected: ['>', '-'],
      name: 'task list inside a blockquote',
    },
  ] as const)(
    'exposes the complete structural delimiter path for $name',
    ({ block, cursorText, doc, expected }) => {
      const state = createState(
        doc,
        EditorSelection.cursor(doc.indexOf(cursorText) + 1),
      );

      const selection = deriveEditorInteractionContext(
        state,
        false,
      ).selections[0];

      expect(selection.block?.kind).toBe(block);
      expect(
        selection.delimiterRanges.map((range) =>
          state.doc.sliceString(range.from, range.to),
        ),
      ).toEqual(expected);
    },
  );

  it('does not expose unrelated outer blockquote markers for a nested active line', () => {
    const doc = '> outer\n>\n> - inner\n>\n> tail';
    const state = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('inner') + 1),
    );

    const delimiters = deriveEditorInteractionContext(
      state,
      false,
    ).selections[0].delimiterRanges;
    const activeQuotePosition = doc.lastIndexOf('>', doc.indexOf('inner'));

    expect(
      delimiters
        .filter((range) => range.kind === 'QuoteMark')
        .map((range) => range.from),
    ).toEqual([activeQuotePosition]);
  });

  it('derives the blockquote delimiter path independently for multiple selections', () => {
    const doc = '> > first\n\n> - second';
    const state = createState(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf('first') + 1),
        EditorSelection.cursor(doc.indexOf('second') + 1),
      ]),
    );

    const context = deriveEditorInteractionContext(state, false);

    expect(
      context.selections.map((selection) =>
        selection.delimiterRanges.map((range) =>
          state.doc.sliceString(range.from, range.to),
        ),
      ),
    ).toEqual([
      ['>', '>'],
      ['>', '-'],
    ]);
  });

  it('excludes a quoted line when the selection ends at its line start', () => {
    const doc = '> - first\n> - second';
    const secondLineFrom = doc.indexOf('> - second');
    const state = createState(
      doc,
      EditorSelection.range(doc.indexOf('first'), secondLineFrom),
    );

    const delimiterPositions = deriveEditorInteractionContext(
      state,
      false,
    ).selections[0].delimiterRanges.map((range) => range.from);

    expect(delimiterPositions).toEqual([doc.indexOf('>')]);
  });

  it('includes only the active-line quote path inside fenced code', () => {
    const doc = '> ```ts\n> code\n> ```';
    const state = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('code') + 1),
    );

    const quotePositions = deriveEditorInteractionContext(
      state,
      false,
    ).selections[0].delimiterRanges
      .filter((range) => range.kind === 'QuoteMark')
      .map((range) => range.from);

    expect(quotePositions).toEqual([
      doc.indexOf('>', doc.indexOf('\n') + 1),
    ]);
  });

  it('exposes only the fenced-code delimiter on the active boundary line', () => {
    const doc = '```ts\nconst value = 1\n```';
    const contentState = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('value')),
    );
    const openingState = createState(doc, EditorSelection.cursor(2));
    const closingState = createState(
      doc,
      EditorSelection.cursor(doc.lastIndexOf('```') + 1),
    );
    const visibleDelimiters = (state: EditorState) =>
      deriveEditorInteractionContext(state, false).selections[0].delimiterRanges
        .filter((range) => range.kind === 'CodeInfo' || range.kind === 'CodeMark')
        .map((range) => state.doc.sliceString(range.from, range.to));

    expect(visibleDelimiters(contentState)).toEqual([]);
    expect(visibleDelimiters(openingState)).toEqual(['```', 'ts']);
    expect(visibleDelimiters(closingState)).toEqual(['```']);
  });

  it('keeps a fenced-code boundary visible while a selection includes it', () => {
    const doc = '```ts\nconst value = 1\n```';
    const state = createState(
      doc,
      EditorSelection.range(1, doc.indexOf('value')),
    );

    expect(
      deriveEditorInteractionContext(state, false).selections[0].delimiterRanges
        .filter((range) => range.kind === 'CodeInfo' || range.kind === 'CodeMark')
        .map((range) => state.doc.sliceString(range.from, range.to)),
    ).toEqual(['```', 'ts']);
  });

  it('keeps quote delimiter collection bounded for a large cross-block selection', () => {
    const doc = Array.from(
      { length: 2_000 },
      (_, index) => `> quote ${index}`,
    ).join('\n\n');
    const state = createState(
      doc,
      EditorSelection.range(1, doc.length),
    );

    const quoteRanges = deriveEditorInteractionContext(
      state,
      false,
    ).selections[0].delimiterRanges.filter(
      (range) => range.kind === 'QuoteMark',
    );

    expect(quoteRanges.length).toBeLessThanOrEqual(1);
    if (quoteRanges[0]) {
      expect(quoteRanges[0].from).toBe(doc.lastIndexOf('>'));
    }
  });

  it('exposes the delimiters surrounding the active table cell', () => {
    const doc = '| first | second |\n| --- | --- |';
    const state = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('first') + 1),
    );

    const block = deriveEditorInteractionContext(
      state,
      false,
    ).selections[0].block;

    expect(block?.kind).toBe('TableCell');
    expect(
      block?.delimiterRanges.map((range) =>
        state.doc.sliceString(range.from, range.to),
      ),
    ).toEqual(['|', '|']);
  });

  it.each([
    {
      doc: 'plain',
      expected: 'Paragraph',
    },
    {
      doc: '# heading',
      expected: 'ATXHeading1',
    },
    {
      doc: '- item',
      expected: 'ListItem',
    },
    {
      doc: '> quote',
      expected: 'Blockquote',
    },
  ])(
    'keeps a collapsed caret at the document end in its $expected block',
    ({ doc, expected }) => {
      const state = createState(
        doc,
        EditorSelection.cursor(doc.length),
      );

      expect(
        deriveEditorInteractionContext(
          state,
          false,
        ).selections[0].block?.kind,
      ).toBe(expected);
    },
  );

  it.each([
    {
      cursorText: 'del',
      doc: '~~del~~',
      expected: 'Strikethrough',
    },
    {
      cursorText: 'url',
      doc: '[label](url "title")',
      expected: 'Link',
    },
    {
      cursorText: 'https',
      doc: '<https://example.com>',
      expected: 'Autolink',
    },
    {
      cursorText: 'alt',
      doc: '![alt](image.png)',
      expected: 'Image',
    },
  ])(
    'activates $expected from its content or destination',
    ({ cursorText, doc, expected }) => {
      const state = createState(
        doc,
        EditorSelection.cursor(doc.indexOf(cursorText) + 1),
      );

      expect(
        deriveEditorInteractionContext(
          state,
          false,
        ).activeInlineOwners.map((owner) => owner.kind),
      ).toEqual([expected]);
    },
  );

  it('includes a link destination and title in its delimiter ranges', () => {
    const doc = '[label](https://example.com "标题")';
    const state = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('example')),
    );

    const link = deriveEditorInteractionContext(
      state,
      false,
    ).activeInlineOwners[0];

    expect(
      link.delimiterRanges.map((range) =>
        state.doc.sliceString(range.from, range.to),
      ),
    ).toEqual([
      '[',
      ']',
      '(',
      'https://example.com',
      '"标题"',
      ')',
    ]);
  });

  it('does not activate escaped emphasis syntax', () => {
    const doc = String.raw`\*escaped* and *active*`;
    const escapedState = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('escaped')),
    );
    const activeState = createState(
      doc,
      EditorSelection.cursor(doc.indexOf('active')),
    );

    expect(
      deriveEditorInteractionContext(escapedState, false).activeInlineOwners,
    ).toEqual([]);
    expect(
      deriveEditorInteractionContext(
        activeState,
        false,
      ).activeInlineOwners.map((owner) => owner.kind),
    ).toEqual(['Emphasis']);
  });

  it.each([
    {
      doc: '---\ntitle: LumaMark\n---\n# Heading',
      expected: ['---\ntitle: LumaMark\n---'],
      name: 'closed YAML front matter',
    },
    {
      doc: '---\ntitle: LumaMark\n...\n# Heading',
      expected: ['---\ntitle: LumaMark\n...'],
      name: 'YAML front matter with an ellipsis close',
    },
    {
      doc: '[^note]: source\ntext[^note]',
      expected: ['[^note]: source', '[^note]'],
      name: 'footnote definitions and references',
    },
    {
      doc: 'before\n  [toc]  \nafter',
      expected: ['  [toc]  '],
      name: 'a standalone TOC marker',
    },
    {
      doc: '> [!NOTE]\n> protected source\n\nplain',
      expected: ['> [!NOTE]\n> protected source'],
      name: 'a callout block',
    },
  ])('protects $name', ({ doc, expected }) => {
    const state = createState(doc, EditorSelection.cursor(doc.length));
    const context = deriveEditorInteractionContext(state, false);

    expect(
      context.protectedSourceRanges.map((range) =>
        state.doc.sliceString(range.from, range.to),
      ),
    ).toEqual(expected);
  });

  it.each([
    '---\nno closing delimiter',
    'Title\n---',
    '> ordinary quote',
    '[label](url)',
    'inline [toc] text',
  ])('does not protect ordinary Markdown source for %j', (doc) => {
    const state = createState(doc, EditorSelection.cursor(doc.length));

    expect(
      deriveEditorInteractionContext(state, false).protectedSourceRanges,
    ).toEqual([]);
  });

  it('reuses protected-source analysis for selection-only updates', () => {
    const doc = [
      '---',
      'title: LumaMark',
      '---',
      '',
      'paragraph',
    ].join('\n');
    const state = createState(doc, EditorSelection.cursor(0));
    const first = deriveEditorInteractionContext(
      state,
      false,
    ).protectedSourceRanges;
    const selectionOnlyState = state.update({
      selection: EditorSelection.cursor(doc.length),
    }).state;

    expect(selectionOnlyState.doc).toBe(state.doc);
    expect(
      deriveEditorInteractionContext(
        selectionOnlyState,
        false,
      ).protectedSourceRanges,
    ).toBe(first);
  });
});
