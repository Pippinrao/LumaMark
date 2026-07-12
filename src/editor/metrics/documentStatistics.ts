export type DocumentStatistics = {
  characters: number;
  lines: number;
  words: number;
};

const wordPattern = /\p{Script=Han}|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function getDocumentStatistics(text: string): DocumentStatistics {
  if (!text) {
    return { characters: 0, lines: 0, words: 0 };
  }

  return {
    characters: Array.from(text.replace(/\s/gu, '')).length,
    lines: text.split('\n').length,
    words: Array.from(text.matchAll(wordPattern)).length,
  };
}
