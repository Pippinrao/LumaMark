export type MarkdownDecorationKind =
  | 'blockquote'
  | 'codeBlock'
  | 'emphasis'
  | 'heading'
  | 'inlineCode'
  | 'orderedList'
  | 'strikethrough'
  | 'strong'
  | 'taskList'
  | 'unorderedList';

export type MarkdownDecorationRange = {
  className: string;
  from: number;
  kind: MarkdownDecorationKind;
  to: number;
};

export type LineInfo = {
  from: number;
  text: string;
  to: number;
};

export function iterateLines(markdown: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let lineStart = 0;

  for (let index = 0; index <= markdown.length; index += 1) {
    if (index !== markdown.length && markdown[index] !== '\n') {
      continue;
    }

    lines.push({
      from: lineStart,
      text: markdown.slice(lineStart, index),
      to: index,
    });
    lineStart = index + 1;
  }

  return lines;
}
