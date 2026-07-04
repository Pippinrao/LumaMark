export type OutlineHeading = {
  from: number;
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  line: number;
  text: string;
  to: number;
};

type FenceState = {
  marker: '`' | '~';
  size: number;
};

const atxHeadingPattern = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/;
const fencePattern = /^[ \t]{0,3}(`{3,}|~{3,})/;

export function parseMarkdownOutline(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const idCounts = new Map<string, number>();
  let fence: FenceState | null = null;
  let lineStart = 0;
  let lineNumber = 1;

  for (const line of markdown.split('\n')) {
    const lineEnd = lineStart + line.length;
    fence = updateFenceState(line, fence);

    if (!fence) {
      const match = atxHeadingPattern.exec(line);

      if (match) {
        const text = cleanHeadingText(match[2]);
        const id = uniqueHeadingId(createHeadingId(text), idCounts);

        headings.push({
          from: lineStart,
          id,
          level: match[1].length as OutlineHeading['level'],
          line: lineNumber,
          text,
          to: lineEnd,
        });
      }
    }

    lineStart = lineEnd + 1;
    lineNumber += 1;
  }

  return headings;
}

function updateFenceState(line: string, fence: FenceState | null): FenceState | null {
  const match = fencePattern.exec(line);

  if (!match) {
    return fence;
  }

  const markerText = match[1];
  const marker = markerText[0] as FenceState['marker'];

  if (!fence) {
    return {
      marker,
      size: markerText.length,
    };
  }

  if (fence.marker === marker && markerText.length >= fence.size) {
    return null;
  }

  return fence;
}

function cleanHeadingText(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~[\]]/g, '')
    .trim();
}

function createHeadingId(text: string): string {
  const id = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return id || 'heading';
}

function uniqueHeadingId(baseId: string, idCounts: Map<string, number>): string {
  const count = idCounts.get(baseId) ?? 0;
  idCounts.set(baseId, count + 1);

  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}
