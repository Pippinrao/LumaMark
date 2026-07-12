import { describe, expect, it } from 'vitest';
import { getDocumentStatistics } from './documentStatistics';

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
