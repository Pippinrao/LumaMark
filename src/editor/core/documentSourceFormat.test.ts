import { RangeSet, type RangeValue } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { createEditorState } from './createEditorState';
import {
  documentSourceFormatField,
  parseDocumentSource,
  serializeDocumentSource,
} from './documentSourceFormat';

function expectSerializableState(
  state: ReturnType<typeof createEditorState>,
): void {
  expect(parseDocumentSource(serializeDocumentSource(state)).text).toBe(
    state.doc.toString(),
  );
}

function createRandom(seed: number): () => number {
  let value = seed >>> 0;

  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

describe('document source format', () => {
  it('does not scan every line-ending override for a local text insertion', () => {
    const source = Array.from(
      { length: 4_096 },
      (_, index) => `line-${index}${index % 2 === 0 ? '\r\n' : '\n'}`,
    ).join('');
    const state = createEditorState({ doc: source });
    const overrideCount = state.field(documentSourceFormatField)
      .lineEndingOverrides.size;
    const originalUpdate = RangeSet.prototype.update;
    let filteredOverrideCount = 0;
    const updateSpy = vi
      .spyOn(RangeSet.prototype, 'update')
      .mockImplementation(function <T extends RangeValue>(
        this: RangeSet<T>,
        updateSpec: Parameters<RangeSet<T>['update']>[0],
      ) {
        const filter = updateSpec.filter;

        if (!filter || this.size !== overrideCount) {
          return originalUpdate.call(this, updateSpec);
        }

        return originalUpdate.call(this, {
          ...updateSpec,
          filter: (from, to, value) => {
            filteredOverrideCount += 1;
            return filter(from, to, value);
          },
        });
      });

    try {
      const insertionPosition = state.doc.line(2_048).from + 2;
      const editedState = state.update({
        changes: {
          from: insertionPosition,
          insert: 'x',
        },
      }).state;

      expect(overrideCount).toBe(2_048);
      expect(editedState.doc.length).toBe(state.doc.length + 1);
      expect(filteredOverrideCount).toBeLessThan(16);
    } finally {
      updateSpy.mockRestore();
    }
  });

  it('keeps preserved CR and LF distinct when an edit makes them adjacent', () => {
    const state = createEditorState({ doc: 'a\rX\nb' });
    const editedState = state.update({
      changes: {
        from: 2,
        to: 3,
      },
    }).state;

    expect(editedState.doc.toString()).toBe('a\n\nb');
    expectSerializableState(editedState);
  });

  it.each([
    '\uFEFFa\nb\r\nc\r\nd\ne\nf\ng\rh\ni',
    'a\rb\nc\r\nd\ne',
    'a\r\nb\rc\n\nd',
    'a\n\nb\r\n\r\nc\rd',
  ])(
    'keeps normalized text invariant through deterministic mixed-EOL edits for %j',
    (source) => {
      const random = createRandom(source.length * 97);
      const inserts = ['', 'x', '\n', '\n\n', 'x\n\ny'] as const;
      let state = createEditorState({ doc: source });

      for (let index = 0; index < 80; index += 1) {
        const from = Math.floor(random() * (state.doc.length + 1));
        const maximumDelete = Math.min(3, state.doc.length - from);
        const deleteLength = Math.floor(random() * (maximumDelete + 1));
        const insert = inserts[Math.floor(random() * inserts.length)];
        state = state.update({
          changes: {
            from,
            insert,
            to: from + deleteLength,
          },
        }).state;

        expectSerializableState(state);
      }
    },
  );
});
