export const FILE_TREE_INDENT_WIDTH = 16;

const FILE_TREE_LABEL_FONT = '13px system-ui, sans-serif';
const FALLBACK_CHARACTER_WIDTH = 8;

export type FileTreeContentRow = {
  depth: number;
  label: string;
};

export function measureFileTreeContentWidth(
  rows: readonly FileTreeContentRow[],
  measureText: (text: string) => number,
): number {
  let widest = 0;

  for (const row of rows) {
    const width = row.depth * FILE_TREE_INDENT_WIDTH + measureText(row.label);

    if (width > widest) {
      widest = width;
    }
  }

  return widest;
}

export function measureFileTreeLabel(label: string): number {
  if (globalThis.navigator?.userAgent.toLowerCase().includes('jsdom')) {
    return label.length * FALLBACK_CHARACTER_WIDTH;
  }

  try {
    const context = globalThis.document
      ?.createElement('canvas')
      .getContext('2d');

    if (context) {
      context.font = FILE_TREE_LABEL_FONT;
      return context.measureText(label).width;
    }
  } catch {
    // The character-width estimate keeps desktop startup resilient if canvas is unavailable.
  }

  return label.length * FALLBACK_CHARACTER_WIDTH;
}
