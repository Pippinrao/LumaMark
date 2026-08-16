import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { rangeContainsFenceLine } from './plantumlChangeDetection';

describe('rangeContainsFenceLine', () => {
  it('detects backtick and tilde fence lines within the changed range', () => {
    const state = EditorState.create({
      doc: ['before', '```plantuml', 'Alice -> Bob', '~~~', 'after'].join('\n'),
    });

    expect(rangeContainsFenceLine(state, 7, 18)).toBe(true);
    expect(rangeContainsFenceLine(state, 32, 35)).toBe(true);
  });

  it('ignores fence-like text that is not a Markdown fence line', () => {
    const state = EditorState.create({
      doc: ['before', 'text ```plantuml', 'after'].join('\n'),
    });

    expect(rangeContainsFenceLine(state, 7, 23)).toBe(false);
  });
});
