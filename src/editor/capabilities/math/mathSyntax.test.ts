import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import type { MathSyntaxMode } from './mathSyntax';

type MathNodeSnapshot = {
  name: string;
  from: number;
  to: number;
  text: string;
};

const MATH_NODE_NAMES = new Set([
  'MathBlock',
  'MathText',
  'InlineMath',
  'MathMark',
]);

function createState(
  doc: string,
  inlineMode: MathSyntaxMode = 'pandoc',
): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdownLanguage({ math: { inlineMode } })],
  });
}

function mathNodes(state: EditorState): MathNodeSnapshot[] {
  const nodes: MathNodeSnapshot[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (!MATH_NODE_NAMES.has(node.name)) {
        return;
      }
      nodes.push({
        name: node.name,
        from: node.from,
        to: node.to,
        text: state.doc.sliceString(node.from, node.to),
      });
    },
  });
  return nodes;
}

function parseMathNodes(
  doc: string,
  inlineMode: MathSyntaxMode = 'pandoc',
): MathNodeSnapshot[] {
  return mathNodes(createState(doc, inlineMode));
}

function mathNodeRanges(state: EditorState): Array<
  Pick<MathNodeSnapshot, 'name' | 'from' | 'to'>
> {
  return mathNodes(state).map(({ name, from, to }) => ({ name, from, to }));
}

function parseMathNodeRanges(
  doc: string,
  inlineMode: MathSyntaxMode,
): Array<Pick<MathNodeSnapshot, 'name' | 'from' | 'to'>> {
  return mathNodeRanges(createState(doc, inlineMode));
}

function createDeterministicRandom(seed: number): () => number {
  let value = seed >>> 0;

  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function mathBlockParentNames(doc: string): string[] {
  const parents: string[] = [];
  syntaxTree(createState(doc)).iterate({
    enter(node) {
      if (node.name === 'MathBlock') {
        parents.push(node.node.parent?.name ?? '');
      }
    },
  });
  return parents;
}

function expectedNode(
  name: string,
  doc: string,
  text: string,
  from = doc.indexOf(text),
): MathNodeSnapshot {
  return { name, from, to: from + text.length, text };
}

describe('math Markdown block syntax', () => {
  it('parses top-level block math and records one opaque MathText per physical line', () => {
    const doc = ['$$', '  x + y', '', '\\frac{1}{2}', '$$'].join('\n');
    const secondTextFrom = doc.indexOf('\\frac');

    expect(parseMathNodes(doc)).toEqual([
      expectedNode('MathBlock', doc, doc),
      expectedNode('MathMark', doc, '$$'),
      expectedNode('MathText', doc, '  x + y'),
      expectedNode('MathText', doc, '', doc.indexOf('\n\n') + 1),
      expectedNode('MathText', doc, '\\frac{1}{2}', secondTextFrom),
      expectedNode('MathMark', doc, '$$', doc.lastIndexOf('$$')),
    ]);
  });

  it.each([
    {
      name: 'blockquote',
      doc: ['> $$', '>   x', '> $$'].join('\n'),
      block: '$$\n>   x\n> $$',
      text: '  x',
    },
    {
      name: 'list item',
      doc: ['- $$', '    x', '  $$'].join('\n'),
      block: '$$\n    x\n  $$',
      text: '  x',
    },
    {
      name: 'two blockquotes around a list item',
      doc: ['> > - $$', '> >     x', '> >   $$'].join('\n'),
      block: '$$\n> >     x\n> >   $$',
      text: '  x',
    },
    {
      name: 'nested list item',
      doc: ['- outer', '  - $$', '      x', '    $$'].join('\n'),
      block: '$$\n      x\n    $$',
      text: '  x',
    },
  ])(
    'strips only container prefixes and preserves TeX indentation in a $name',
    ({ doc, block, text }) => {
      const nodes = parseMathNodes(doc);
      const blockFrom = doc.indexOf('$$');
      const blockTo = doc.lastIndexOf('$$') + 2;
      const textFrom = doc.indexOf(text, doc.indexOf('\n'));

      expect(nodes.filter((node) => node.name === 'MathBlock')).toEqual([
        expectedNode('MathBlock', doc, block, blockFrom),
      ]);
      expect(nodes.filter((node) => node.name === 'MathText')).toEqual([
        expectedNode('MathText', doc, text, textFrom),
      ]);
      expect(nodes.filter((node) => node.name === 'MathMark')).toEqual([
        expectedNode('MathMark', doc, '$$', blockFrom),
        expectedNode('MathMark', doc, '$$', blockTo - 2),
      ]);
    },
  );

  it.each([
    ['blockquote', ['> $$', '> x', '> $$'].join('\n'), 'Blockquote'],
    ['list item', ['- $$', '  x', '  $$'].join('\n'), 'ListItem'],
  ])('keeps nested block math inside its %s parent', (_name, doc, parent) => {
    expect(mathBlockParentNames(doc)).toEqual([parent]);
  });

  it('keeps an unclosed block as a draft with one mark until its container ends', () => {
    const doc = ['> $$', '>   x', 'outside'].join('\n');

    expect(parseMathNodes(doc)).toEqual([
      expectedNode('MathBlock', doc, '$$\n>   x', doc.indexOf('$$')),
      expectedNode('MathMark', doc, '$$', doc.indexOf('$$')),
      expectedNode('MathText', doc, '  x', doc.indexOf('  x')),
    ]);
  });

  it.each([0, 1, 2, 3])(
    'accepts a delimiter indented %i spaces relative to its container',
    (indent) => {
      const padding = ' '.repeat(indent);
      const doc = [`${padding}$$`, `${padding}x`, `${padding}$$`].join('\n');

      expect(
        parseMathNodes(doc).filter((node) => node.name === 'MathBlock'),
      ).toHaveLength(1);
    },
  );

  it('leaves a four-space-indented top-level sequence as a code block', () => {
    const doc = ['    $$', '    x', '    $$'].join('\n');

    expect(parseMathNodes(doc)).toEqual([]);
    expect(syntaxTree(createState(doc)).toString()).toContain('CodeBlock');
  });

  it('interrupts a paragraph only for a standalone opening delimiter', () => {
    const doc = ['paragraph', '$$', 'x', '$$'].join('\n');

    expect(
      parseMathNodes(doc).filter((node) => node.name === 'MathBlock'),
    ).toEqual([
      expectedNode('MathBlock', doc, '$$\nx\n$$', doc.indexOf('$$')),
    ]);
  });

  it.each([
    '$$x$$',
    '$$ x',
    'x $$',
    '$$$',
    '$$ trailing',
    'before\n$$x$$\nafter',
  ])('does not parse a non-standalone block delimiter in %j', (doc) => {
    expect(
      parseMathNodes(doc).filter((node) => node.name === 'MathBlock'),
    ).toEqual([]);
  });
});

describe('math Markdown inline syntax', () => {
  it.each([
    ['$x$', '$x$'],
    ['before $x + y$ after', '$x + y$'],
    ['中文$α+变量$内容', '$α+变量$'],
    ['$x$!', '$x$'],
    ['$1$', '$1$'],
  ])('parses Pandoc inline math in %j', (doc, math) => {
    expect(
      parseMathNodes(doc).filter((node) => node.name === 'InlineMath'),
    ).toEqual([expectedNode('InlineMath', doc, math)]);
  });

  it.each([
    '$ x$',
    '$x $',
    '$x$2',
    '\\$x$',
    '`$x$`',
    ['```', '$x$', '```'].join('\n'),
    '$$x$$',
    '$$$x$$$',
    '$x\n$',
    '$x\\$',
    '$x $$ y$',
  ])('rejects invalid Pandoc inline math in %j', (doc) => {
    expect(
      parseMathNodes(doc).filter((node) => node.name === 'InlineMath'),
    ).toEqual([]);
  });

  it('runs after InlineCode without parsing dollar signs inside code', () => {
    const doc = '`$not-math$` and $math$';

    expect(
      parseMathNodes(doc).filter((node) => node.name === 'InlineMath'),
    ).toEqual([expectedNode('InlineMath', doc, '$math$')]);
  });

  it('keeps the TeX body opaque to Markdown inline parsing', () => {
    const doc = '$*x* [label](url)$';
    const tree = syntaxTree(createState(doc)).toString();

    expect(tree).toContain('InlineMath(MathMark,MathMark)');
    expect(tree).not.toContain('Emphasis');
    expect(tree).not.toContain('Link');
  });

  it.each([
    ['$ x$', '$ x$'],
    ['$x $', '$x $'],
    ['$x$2', '$x$'],
  ])(
    'accepts %j in legacy mode',
    (doc, math) => {
      expect(
        parseMathNodes(doc, 'legacy').filter(
          (node) => node.name === 'InlineMath',
        ),
      ).toEqual([expectedNode('InlineMath', doc, math)]);
    },
  );

  it.each(['$x\\$', '$$x$$', '`$x$`', '$x\n$'])(
    'still rejects %j in legacy mode',
    (doc) => {
      expect(
        parseMathNodes(doc, 'legacy').filter(
          (node) => node.name === 'InlineMath',
        ),
      ).toEqual([]);
    },
  );

  it('disables only inline math parsing in disabled mode', () => {
    const doc = ['$x$', '', '$$', 'y', '$$'].join('\n');
    const nodes = parseMathNodes(doc, 'disabled');

    expect(nodes.some((node) => node.name === 'InlineMath')).toBe(false);
    expect(nodes.filter((node) => node.name === 'MathBlock')).toHaveLength(1);
  });
});

describe('incremental math parsing', () => {
  it.each([
    {
      name: 'inline body',
      doc: '$x$',
      changes: { from: 1, to: 2, insert: 'alpha' },
    },
    {
      name: 'inline closing delimiter',
      doc: '$x$',
      changes: { from: 2, to: 3, insert: '' },
    },
    {
      name: 'inline opening whitespace',
      doc: '$x$',
      changes: { from: 1, insert: ' ' },
    },
    {
      name: 'ASCII digit after inline closing delimiter',
      doc: '$x$ tail',
      changes: { from: 3, insert: '2' },
    },
    {
      name: 'backslash before inline closing delimiter',
      doc: '$x$',
      changes: { from: 2, insert: '\\' },
    },
    {
      name: 'block body',
      doc: '$$\nx\n$$',
      changes: { from: 3, to: 4, insert: 'x + y' },
    },
    {
      name: 'block closing delimiter',
      doc: '$$\nx\n$$',
      changes: { from: 6, to: 7, insert: '' },
    },
    {
      name: 'new block closing delimiter',
      doc: '$$\nx',
      changes: { from: 4, insert: '\n$$' },
    },
  ])(
    'matches a fresh parse after editing the $name',
    ({ doc, changes }) => {
      const startState = createState(doc);
      syntaxTree(startState);
      const updatedState = startState.update({ changes }).state;
      const updatedDoc = updatedState.doc.toString();
      const incremental = mathNodes(updatedState).map(
        ({ name, from, to }) => ({ name, from, to }),
      );
      const fresh = parseMathNodes(updatedDoc).map(({ name, from, to }) => ({
        name,
        from,
        to,
      }));

      expect(incremental).toEqual(fresh);
    },
  );

  it.each([
    {
      mode: 'pandoc' as const,
      seed: 0x11_001,
      doc: [
        '> > - $$',
        '> >     \\frac{1}{2}',
        '> >   $$',
        '>',
        '> > inline $x + y$ and draft $z',
      ].join('\n'),
    },
    {
      mode: 'pandoc' as const,
      seed: 0x11_004,
      doc: [
        '- outer',
        '  - $$',
        '      a + b',
        '    $$',
        '  - inline $x$ and draft $z',
      ].join('\n'),
    },
    {
      mode: 'legacy' as const,
      seed: 0x11_002,
      doc: [
        '- $$',
        '    x + y',
        '  $$',
        '- inline $ x$ and draft $z',
      ].join('\n'),
    },
    {
      mode: 'legacy' as const,
      seed: 0x11_005,
      doc: [
        '> > - $$',
        '> >     x + y',
        '> >   $$',
        '> > inline $ x$ and draft $z',
      ].join('\n'),
    },
    {
      mode: 'disabled' as const,
      seed: 0x11_003,
      doc: [
        '> - $$',
        '>     x',
        '>   $$',
        '>',
        '> inline $x$ and draft $z',
      ].join('\n'),
    },
    {
      mode: 'disabled' as const,
      seed: 0x11_006,
      doc: [
        '- outer',
        '  - $$',
        '      x',
        '    $$',
        '  - inline $x$ and draft $z',
      ].join('\n'),
    },
  ])(
    'keeps incremental math node ranges identical to a fresh parse through deterministic random edits in $mode mode',
    ({ mode, seed, doc }) => {
      const random = createDeterministicRandom(seed);
      const inserts = ['', '$', '$$', 'x', ' ', '\n', '> ', '- ', '  ', '\\', '`'];
      let state = createState(doc, mode);
      syntaxTree(state);

      for (let step = 0; step < 120; step += 1) {
        const from = Math.floor(random() * (state.doc.length + 1));
        const maximumDelete = Math.min(5, state.doc.length - from);
        const deleteLength = Math.floor(random() * (maximumDelete + 1));
        const insert = inserts[Math.floor(random() * inserts.length)];

        state = state.update({
          changes: { from, to: from + deleteLength, insert },
        }).state;

        expect(mathNodeRanges(state), `step ${step}`).toEqual(
          parseMathNodeRanges(state.doc.toString(), mode),
        );
      }
    },
  );
});
