import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import {
  protectedSourceRangesExtension,
  protectedSourceRangesField,
} from './protectedSourceRanges';

function protectedSources(state: EditorState): string[] {
  return state
    .field(protectedSourceRangesField)
    .ranges.map((range) => state.doc.sliceString(range.from, range.to));
}

function createState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdownLanguage(), protectedSourceRangesExtension()],
  });
}

type FenceMutation = {
  readonly from: number;
  readonly to?: number;
  readonly insert?: string;
};

describe('protected source ranges state field', () => {
  it('maps existing ranges without rescanning for ordinary text input', () => {
    const initial = createState('---\ntitle: LumaMark\n---\n\nplain');
    const initialRangeState = initial.field(protectedSourceRangesField);
    const updated = initial.update({
      changes: { from: initial.doc.length, insert: ' text' },
    }).state;

    expect(updated.field(protectedSourceRangesField).scanGeneration).toBe(
      initialRangeState.scanGeneration,
    );
    expect(protectedSources(updated)).toEqual([
      '---\ntitle: LumaMark\n---',
    ]);
  });

  it.each([
    ['YAML front matter', '---\ntitle: LumaMark\n---\nplain', '---\ntitle: LumaMark\n---'],
    ['a footnote', '[^note]: source\nplain', '[^note]: source'],
    ['a standalone TOC marker', '[toc]\n\nplain', '[toc]'],
    ['a callout', '> [!NOTE]\n> source\n\nplain', '> [!NOTE]\n> source'],
  ])('rescans when creating %s', (_name, nextDocument, expectedSource) => {
    const initial = createState('plain');
    const initialRangeState = initial.field(protectedSourceRangesField);
    const updated = initial.update({
      changes: { from: 0, to: initial.doc.length, insert: nextDocument },
    }).state;

    expect(updated.field(protectedSourceRangesField).scanGeneration).toBe(
      initialRangeState.scanGeneration + 1,
    );
    expect(protectedSources(updated)).toContain(expectedSource);
  });

  it('rescans when deleting or modifying an existing protected marker', () => {
    const initial = createState('> [!NOTE]\n> source\n\nplain');
    const initialRangeState = initial.field(protectedSourceRangesField);
    const modified = initial.update({
      changes: { from: 2, to: 9, insert: 'quote' },
    }).state;

    expect(modified.field(protectedSourceRangesField).scanGeneration).toBe(
      initialRangeState.scanGeneration + 1,
    );
    expect(protectedSources(modified)).toEqual([]);

    const deleted = initial.update({
      changes: {
        from: 0,
        to: initial.doc.toString().indexOf('\n\n'),
        insert: 'plain',
      },
    }).state;

    expect(deleted.field(protectedSourceRangesField).scanGeneration).toBe(
      initialRangeState.scanGeneration + 1,
    );
    expect(protectedSources(deleted)).toEqual([]);
  });

  it.each([
    {
      name: 'creating an opening fence',
      initialDocument: 'before\n\n[^note]: source\n\n```\nafter',
      mutation: (document: string): FenceMutation => ({
        from: document.indexOf('\n') + 1,
        insert: '```\n',
      }),
      expectedSources: [],
    },
    {
      name: 'creating a closing fence',
      initialDocument: '```\ncode\n\n[^note]: source',
      mutation: (document: string): FenceMutation => ({
        from: document.indexOf('\n\n') + 1,
        insert: '```\n',
      }),
      expectedSources: ['[^note]: source'],
    },
    {
      name: 'deleting an opening fence',
      initialDocument: '```\n\n[^note]: source\n\n```\nafter',
      mutation: (): FenceMutation => ({ from: 0, to: 3 }),
      expectedSources: ['[^note]: source'],
    },
    {
      name: 'deleting a closing fence',
      initialDocument: '```\ncode\n\n```\n\n[^note]: source',
      mutation: (document: string): FenceMutation => {
        const closingFence = document.indexOf('```', 3);

        return { from: closingFence, to: closingFence + 3 };
      },
      expectedSources: [],
    },
    {
      name: 'rewriting a line into an opening fence',
      initialDocument: '``x\n\n[^note]: source\n\n```\nafter',
      mutation: (): FenceMutation => ({ from: 2, to: 3, insert: '`' }),
      expectedSources: [],
    },
    {
      name: 'rewriting a line into a closing fence',
      initialDocument: '```\ncode\n\n``x\n\n[^note]: source',
      mutation: (document: string): FenceMutation => {
        const invalidClosingFence = document.indexOf('``x');

        return {
          from: invalidClosingFence + 2,
          to: invalidClosingFence + 3,
          insert: '`',
        };
      },
      expectedSources: ['[^note]: source'],
    },
  ])(
    'keeps incremental ranges equivalent to a fresh state after $name',
    ({ initialDocument, mutation, expectedSources }) => {
      const initial = createState(initialDocument);
      const initialRangeState = initial.field(protectedSourceRangesField);
      const updated = initial.update({
        changes: mutation(initialDocument),
      }).state;
      const fresh = createState(updated.doc.toString());

      expect(protectedSources(updated)).toEqual(protectedSources(fresh));
      expect(protectedSources(updated)).toEqual(expectedSources);
      expect(updated.field(protectedSourceRangesField).scanGeneration).toBe(
        initialRangeState.scanGeneration + 1,
      );
    },
  );

  it.each([
    {
      name: 'ordinary fenced-code content',
      initialDocument: '```\ncode\n```\n\n[^note]: source',
      mutation: (document: string): FenceMutation => ({
        from: document.indexOf('code') + 4,
        insert: ' sample',
      }),
    },
    {
      name: 'inline backticks that do not form a fence',
      initialDocument: 'plain `` code\n\n[^note]: source',
      mutation: (document: string): FenceMutation => ({
        from: document.indexOf('``') + 2,
        insert: '`',
      }),
    },
  ])('does not rescan for $name', ({ initialDocument, mutation }) => {
    const initial = createState(initialDocument);
    const initialRangeState = initial.field(protectedSourceRangesField);
    const updated = initial.update({
      changes: mutation(initialDocument),
    }).state;

    expect(updated.field(protectedSourceRangesField).scanGeneration).toBe(
      initialRangeState.scanGeneration,
    );
    expect(protectedSources(updated)).toEqual(['[^note]: source']);
  });
});
