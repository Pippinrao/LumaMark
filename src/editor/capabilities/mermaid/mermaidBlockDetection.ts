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

export type MermaidBlock = {
  content: string;
  contentFrom: number;
  contentTo: number;
  fence: string;
  from: number;
  info: string;
  language: 'mermaid';
  to: number;
};

export type AbsoluteMermaidBlock = MermaidBlock & {
  blockId: string;
};

export function collectMermaidBlocksInRanges(
  state: EditorState,
  ranges: readonly DocumentRange[],
): AbsoluteMermaidBlock[] {
  const blocks: AbsoluteMermaidBlock[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'FencedCode') {
          return;
        }

        const block = mermaidBlockFromFencedCode(state, node.node);
        if (!block) {
          return;
        }

        const blockId = `${block.from}:${block.to}`;
        if (seen.has(blockId)) {
          return;
        }

        seen.add(blockId);
        blocks.push({
          ...block,
          blockId,
        });
      },
    });
  }

  return blocks.sort((left, right) => left.from - right.from);
}

function mermaidBlockFromFencedCode(
  state: EditorState,
  fencedCode: MarkdownSyntaxNode,
): MermaidBlock | null {
  const codeInfo = fencedCode.getChild('CodeInfo');
  const codeText = fencedCode.getChild('CodeText');

  if (!codeInfo || !codeText) {
    return null;
  }

  const info = state.doc.sliceString(codeInfo.from, codeInfo.to).trim();
  if (!isMermaidCodeInfo(info)) {
    return null;
  }

  const openingFence = fencedCode.getChild('CodeMark');

  return {
    content: state.doc.sliceString(codeText.from, codeText.to),
    contentFrom: codeText.from,
    contentTo: codeText.to,
    fence: openingFence
      ? state.doc.sliceString(openingFence.from, openingFence.to)
      : '',
    from: fencedCode.from,
    info,
    language: 'mermaid',
    to: fencedCode.to,
  };
}

function isMermaidCodeInfo(info: string): boolean {
  const normalizedInfo = info.toLowerCase();

  return normalizedInfo === 'mermaid' || normalizedInfo.startsWith('mermaid ');
}
