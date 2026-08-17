import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  getDocumentStatistics,
  getDocumentStatisticsFromText,
} from './documentStatistics';

describe('getDocumentStatistics', () => {
  it('counts lines, Chinese words, Latin words, and visible characters predictably', () => {
    expect(getDocumentStatistics('第一行 hello\n\n第二行 world')).toEqual({
      characters: 16,
      lines: 3,
      words: 8,
    });
  });

  it('reports an empty document without phantom lines or words', () => {
    expect(getDocumentStatistics('')).toEqual({
      characters: 0,
      lines: 0,
      words: 0,
    });
  });
});

describe('getDocumentStatisticsFromText', () => {
  it('matches the string API without copying the full document string', () => {
    const markdown = Array.from(
      { length: 4_000 },
      (_, index) => `Line ${index} 第一行 hello`,
    ).join('\n');
    const state = EditorState.create({ doc: markdown });
    const toString = state.doc.toString.bind(state.doc);
    let copiedFullDocument = false;
    state.doc.toString = () => {
      copiedFullDocument = true;
      return toString();
    };

    expect(state.doc.children).not.toBeNull();
    expect(getDocumentStatisticsFromText(state.doc)).toEqual(
      getDocumentStatistics(markdown),
    );
    expect(copiedFullDocument).toBe(false);
  });
});
