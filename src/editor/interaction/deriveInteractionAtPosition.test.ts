import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import { deriveInteractionAtPosition } from './editorInteractionContext';

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdownLanguage()],
    selection: EditorSelection.cursor(0),
  });
}

function posOf(doc: string, text: string, offset = 0): number {
  const index = doc.indexOf(text);
  if (index < 0) {
    throw new Error(`Missing fixture text: ${text}`);
  }
  return index + offset;
}

describe('deriveInteractionAtPosition', () => {
  it('targets a link from its label text', () => {
    const doc = 'see [docs](https://example.com) here';
    const state = createState(doc);

    expect(deriveInteractionAtPosition(state, posOf(doc, 'docs') + 1)).toEqual({
      from: posOf(doc, '[docs]'),
      href: 'https://example.com',
      kind: 'link',
      to: posOf(doc, ') here') + 1,
    });
  });

  it('targets a link from its URL child', () => {
    const doc = '[label](https://example.com/path)';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, 'example') + 1),
    ).toMatchObject({
      href: 'https://example.com/path',
      kind: 'link',
    });
  });

  it('returns plain for text adjacent to a link', () => {
    const doc = 'before [link](https://example.com) after';
    const state = createState(doc);

    expect(deriveInteractionAtPosition(state, posOf(doc, 'before') + 1)).toEqual(
      {
        at: posOf(doc, 'before') + 1,
        kind: 'plain',
      },
    );
    expect(deriveInteractionAtPosition(state, posOf(doc, 'after') + 1)).toEqual({
      at: posOf(doc, 'after') + 1,
      kind: 'plain',
    });
  });

  it('targets a link nested inside emphasis', () => {
    const doc = '*see [nested](./note.md) link*';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, 'nested') + 1),
    ).toMatchObject({
      href: './note.md',
      kind: 'link',
    });
  });

  it('targets an image destination', () => {
    const doc = '![alt text](./photo.png)';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, 'alt') + 1),
    ).toMatchObject({
      kind: 'image',
      src: './photo.png',
    });
  });

  it('parses relative, assets, remote, and titled image destinations', () => {
    const cases = [
      {
        doc: '![rel](./photo.png)',
        needle: 'rel',
        src: './photo.png',
      },
      {
        doc: '![asset](assets/pic.png)',
        needle: 'asset',
        src: 'assets/pic.png',
      },
      {
        doc: '![remote](https://example.com/a.png)',
        needle: 'remote',
        src: 'https://example.com/a.png',
      },
      {
        doc: '![titled](a.png "t")',
        needle: 'titled',
        src: 'a.png',
      },
    ] as const;

    for (const fixture of cases) {
      const state = createState(fixture.doc);
      expect(
        deriveInteractionAtPosition(
          state,
          posOf(fixture.doc, fixture.needle) + 1,
        ),
      ).toEqual({
        from: 0,
        kind: 'image',
        src: fixture.src,
        to: fixture.doc.length,
      });
    }
  });

  it('does not treat bracket text inside fenced code as a link', () => {
    const doc = '```ts\nconst x = "[a](b)"\n```';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, '[a](b)') + 1),
    ).toMatchObject({
      kind: 'codeBlock',
    });
  });

  it('does not treat bracket text inside inline code as a link', () => {
    const doc = 'use `[a](b)` literally';
    const state = createState(doc);

    expect(deriveInteractionAtPosition(state, posOf(doc, '[a]') + 1)).toEqual({
      at: posOf(doc, '[a]') + 1,
      kind: 'plain',
    });
  });

  it('does not yield link targets inside protected-source ranges', () => {
    const doc = '---\ntitle: [docs](https://example.com)\n---\n\nbody';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, 'docs') + 1),
    ).toEqual({
      at: posOf(doc, 'docs') + 1,
      kind: 'plain',
    });
  });

  it('targets a table when the position is inside a table cell', () => {
    const doc = '| first | second |\n| --- | --- |\n| a | b |';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, 'first') + 1),
    ).toMatchObject({
      kind: 'table',
    });
  });

  it('returns plain for ordinary paragraph text', () => {
    const doc = 'ordinary paragraph';
    const state = createState(doc);

    expect(deriveInteractionAtPosition(state, posOf(doc, 'paragraph'))).toEqual(
      {
        at: posOf(doc, 'paragraph'),
        kind: 'plain',
      },
    );
  });

  it('targets an autolink URL', () => {
    const doc = 'visit <https://example.com> please';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, 'https') + 1),
    ).toMatchObject({
      href: 'https://example.com',
      kind: 'link',
    });
  });

  it('targets a mermaid fenced block', () => {
    const doc = '```mermaid\ngraph TD\nA-->B\n```';
    const state = createState(doc);

    expect(
      deriveInteractionAtPosition(state, posOf(doc, 'graph') + 1),
    ).toMatchObject({
      kind: 'mermaid',
    });
  });
});
