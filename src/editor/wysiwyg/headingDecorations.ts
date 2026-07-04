import type { MarkdownDecorationRange } from './decorationTypes';
import { iterateLines } from './decorationTypes';

const HEADING_PATTERN = /^(#{1,6})\s+\S/;

export function collectHeadingDecorations(
  markdown: string,
): MarkdownDecorationRange[] {
  return iterateLines(markdown).flatMap((line) => {
    const match = line.text.match(HEADING_PATTERN);

    if (!match) {
      return [];
    }

    const level = match[1].length;

    return [
      {
        className: `lm-md-heading lm-md-heading-${level}`,
        from: line.from,
        kind: 'heading',
        to: line.to,
      },
    ];
  });
}
