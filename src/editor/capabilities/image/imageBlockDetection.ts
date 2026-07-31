import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type DocumentRange = {
  from: number;
  to: number;
};

type MarkdownSyntaxNode = {
  from: number;
  to: number;
  getChild: (type: string) => MarkdownSyntaxNode | null;
};

export type ImageBlock = {
  alt: string;
  blockId: string;
  from: number;
  source: string;
  to: number;
};

export function collectImageBlocksInRanges(
  state: EditorState,
  ranges: readonly DocumentRange[],
): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'Image') {
          return;
        }

        const block = imageBlockFromNode(state, node.node);
        if (!block || seen.has(block.blockId)) {
          return;
        }

        seen.add(block.blockId);
        blocks.push(block);
      },
    });
  }

  return blocks.sort((left, right) => left.from - right.from);
}

function imageBlockFromNode(
  state: EditorState,
  node: MarkdownSyntaxNode,
): ImageBlock | null {
  const sourceNode = node.getChild('URL');

  if (!sourceNode) {
    return null;
  }

  const raw = state.doc.sliceString(node.from, node.to);
  const line = state.doc.lineAt(node.from);
  const lineText = state.doc.sliceString(line.from, line.to);

  if (lineText.trim() !== raw || node.to > line.to) {
    return null;
  }

  const altMatch = raw.match(/^!\[(?<alt>(?:\\.|(?!\]).)*)\]/);
  const source = state.doc.sliceString(sourceNode.from, sourceNode.to).trim();

  return {
    alt: unescapeMarkdownAlt(altMatch?.groups?.alt ?? ''),
    blockId: `${line.from}:${line.to}`,
    from: line.from,
    source,
    to: line.to,
  };
}

function unescapeMarkdownAlt(alt: string): string {
  return alt.replace(/\\(.)/g, (match, character: string) =>
    character === '\\' || character === '[' || character === ']'
      ? character
      : match,
  );
}
