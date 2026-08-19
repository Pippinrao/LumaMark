import type { OutlineHeading } from './outlineParser';

export const OUTLINE_INDENT_WIDTH = 12;

const OUTLINE_LABEL_FONT = '13.12px system-ui, sans-serif';
const FALLBACK_CHARACTER_WIDTH = 8;

export function measureOutlineContentWidth(
  headings: readonly OutlineHeading[],
  measureText: (text: string) => number,
): number {
  let widest = 0;

  for (const heading of headings) {
    const width =
      Math.max(0, heading.level - 1) * OUTLINE_INDENT_WIDTH +
      measureText(heading.text);

    if (width > widest) {
      widest = width;
    }
  }

  return widest;
}

export function measureOutlineLabel(label: string): number {
  if (globalThis.navigator?.userAgent.toLowerCase().includes('jsdom')) {
    return label.length * FALLBACK_CHARACTER_WIDTH;
  }

  try {
    const context = globalThis.document
      ?.createElement('canvas')
      .getContext('2d');

    if (context) {
      context.font = OUTLINE_LABEL_FONT;
      return context.measureText(label).width;
    }
  } catch {
    // The character-width estimate keeps desktop startup resilient if canvas is unavailable.
  }

  return label.length * FALLBACK_CHARACTER_WIDTH;
}
