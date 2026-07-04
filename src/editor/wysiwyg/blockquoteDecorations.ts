import type { MarkdownDecorationRange } from './decorationTypes';
import { iterateLines } from './decorationTypes';

export function collectBlockquoteDecorations(
  markdown: string,
): MarkdownDecorationRange[] {
  return iterateLines(markdown).flatMap((line) => {
    if (!/^\s{0,3}>\s?/.test(line.text)) {
      return [];
    }

    return [
      {
        className: 'lm-md-blockquote',
        from: line.from,
        kind: 'blockquote',
        to: line.to,
      },
    ];
  });
}
