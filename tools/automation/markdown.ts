import { parser } from '@lezer/markdown';
import { AutomationError, MAX_DIAGRAMS } from './types.ts';
import { messages } from './messages.ts';
import type { DiagramFormat } from './types.ts';

export type DiagramBlock = { source: string; format: DiagramFormat; blockLine: number; sourceLines: number[] };

export function extractDiagrams(markdown: string): DiagramBlock[] {
  markdown = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const blocks: DiagramBlock[] = [];
  const starts = [0];
  for (let index = 0; index < markdown.length; index++) {
    if (markdown[index] === '\n') starts.push(index + 1);
  }
  function lineAt(position: number) {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid] <= position) low = mid;
      else high = mid;
    }
    return low + 1;
  }
  parser.parse(markdown).iterate({
    enter(ref) {
      if (ref.name !== 'FencedCode') return;
      const node = ref.node;
      const info = node.getChild('CodeInfo');
      const language = info ? markdown.slice(info.from, info.to).trim().split(/\s/)[0].toLowerCase() : '';
      if (language !== 'mermaid' && language !== 'plantuml') return false;
      const fragments = node.getChildren('CodeText');
      const contentByLine = new Map<number, string>();
      for (const fragment of fragments) {
        const text = markdown.slice(fragment.from, fragment.to).split('\n');
        text.forEach((content, offset) => {
          const line = lineAt(fragment.from) + offset;
          contentByLine.set(line, (contentByLine.get(line) ?? '') + content);
        });
      }
      // Lezer splits CodeText around blockquote marks; fragments that share a
      // source line must be joined, not turned into extra diagram lines.
      const sourceLines = [...contentByLine.keys()];
      blocks.push({ source: [...contentByLine.values()].join('\n'), format: language, blockLine: lineAt(node.from), sourceLines });
      if (blocks.length > MAX_DIAGRAMS) {
        throw new AutomationError('input.too_many_diagrams', messages.tooMany(MAX_DIAGRAMS));
      }
      return false;
    },
  });
  return blocks;
}
