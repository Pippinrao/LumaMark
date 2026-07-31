import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { rangeContainsFenceLine } from './mermaidChangeDetection';

describe('rangeContainsFenceLine', () => {
  it('detects backtick and tilde fence lines within the changed range', () => {
    const state = EditorState.create({
      doc: ['before', '```mermaid', 'graph TD', '~~~', 'after'].join('\n'),
    });

    expect(rangeContainsFenceLine(state, 7, 17)).toBe(true);
    expect(rangeContainsFenceLine(state, 27, 30)).toBe(true);
  });

  it('ignores fence-like text that is not a Markdown fence line', () => {
    const state = EditorState.create({
      doc: ['before', 'text ```mermaid', 'after'].join('\n'),
    });

    expect(rangeContainsFenceLine(state, 7, 22)).toBe(false);
  });
});
