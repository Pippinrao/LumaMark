import type { MarkdownDecorationRange } from './decorationTypes';

type InlineRule = {
  className: string;
  kind: MarkdownDecorationRange['kind'];
  pattern: RegExp;
};

const INLINE_RULES: InlineRule[] = [
  {
    className: 'lm-md-strong',
    kind: 'strong',
    pattern: /\*\*[^*\n]+?\*\*/g,
  },
  {
    className: 'lm-md-strong',
    kind: 'strong',
    pattern: /__[^_\n]+?__/g,
  },
  {
    className: 'lm-md-strikethrough',
    kind: 'strikethrough',
    pattern: /~~[^~\n]+?~~/g,
  },
  {
    className: 'lm-md-emphasis',
    kind: 'emphasis',
    pattern: /(?<!\*)\*[^*\n]+?\*(?!\*)/g,
  },
  {
    className: 'lm-md-emphasis',
    kind: 'emphasis',
    pattern: /(?<!_)_[^_\n]+?_(?!_)/g,
  },
];

export function collectEmphasisDecorations(
  markdown: string,
): MarkdownDecorationRange[] {
  const ranges: MarkdownDecorationRange[] = [];

  for (const rule of INLINE_RULES) {
    for (const match of markdown.matchAll(rule.pattern)) {
      ranges.push({
        className: rule.className,
        from: match.index,
        kind: rule.kind,
        to: match.index + match[0].length,
      });
    }
  }

  return ranges;
}
