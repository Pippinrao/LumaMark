import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { collectMathInventory } from './mathInventory';

function state(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdownLanguage()],
  });
}

describe('collectMathInventory', () => {
  it('collects closed block and inline formulas in source order', () => {
    const doc = ['before $a+b$', '', '$$', 'x^2', '$$', '', 'after $c$'].join('\n');

    expect(collectMathInventory(state(doc))).toEqual([
      {
        contentRanges: [{ from: 8, to: 11 }],
        delimiterRanges: [
          { from: 7, to: 8 },
          { from: 11, to: 12 },
        ],
        display: false,
        from: 7,
        id: 'math:inline:0',
        source: 'a+b',
        to: 12,
      },
      {
        contentRanges: [{ from: 17, to: 20 }],
        delimiterRanges: [
          { from: 14, to: 16 },
          { from: 21, to: 23 },
        ],
        display: true,
        from: 14,
        id: 'math:block:1',
        source: 'x^2',
        to: 23,
      },
      {
        contentRanges: [{ from: 32, to: 33 }],
        delimiterRanges: [
          { from: 31, to: 32 },
          { from: 33, to: 34 },
        ],
        display: false,
        from: 31,
        id: 'math:inline:2',
        source: 'c',
        to: 34,
      },
    ]);
  });

  it('joins only MathText slices so nested container prefixes never enter TeX', () => {
    const doc = ['> > - $$', '> >     \\begin{aligned}', '> >       x &= 1', '> >     \\end{aligned}', '> >   $$'].join('\n');
    const inventory = collectMathInventory(state(doc));

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toEqual(
      expect.objectContaining({
        display: true,
        source: ['  \\begin{aligned}', '    x &= 1', '  \\end{aligned}'].join('\n'),
      }),
    );
    expect(inventory[0]?.contentRanges.map(({ from, to }) => doc.slice(from, to))).toEqual([
      '  \\begin{aligned}',
      '    x &= 1',
      '  \\end{aligned}',
    ]);
  });

  it('omits draft blocks that do not have exactly two MathMark children', () => {
    const doc = ['$$', 'x + y'].join('\n');

    expect(collectMathInventory(state(doc))).toEqual([]);
  });

  it('returns the same stable identities when collecting an unchanged state again', () => {
    const editorState = state('$x$ and $y$');

    expect(collectMathInventory(editorState).map(({ id }) => id)).toEqual(
      collectMathInventory(editorState).map(({ id }) => id),
    );
  });

  it('keeps an identity stable while the formula body is edited in place', () => {
    expect(collectMathInventory(state('$x$'))[0]?.id).toBe(
      collectMathInventory(state('$x + y$'))[0]?.id,
    );
    expect(collectMathInventory(state('$$\nx\n$$'))[0]?.id).toBe(
      collectMathInventory(state('$$\nx + y\n$$'))[0]?.id,
    );
  });

  it('keeps identities stable when ordinary text is inserted before formulas', () => {
    const doc = ['$x$', '', '$$', 'y', '$$'].join('\n');
    const shiftedDoc = `prefix ${doc}`;

    expect(collectMathInventory(state(shiftedDoc)).map(({ id }) => id)).toEqual(
      collectMathInventory(state(doc)).map(({ id }) => id),
    );
  });

  it('collects empty display formulas', () => {
    const formulas = collectMathInventory(state('$$\n\n$$'));

    expect(formulas).toEqual([
      expect.objectContaining({
        display: true,
        source: expect.stringMatching(/^\s*$/),
      }),
    ]);
  });
});
