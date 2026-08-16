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

export type PlantumlBlock = {
  content: string;
  contentFrom: number;
  contentTo: number;
  fence: string;
  from: number;
  info: string;
  language: 'plantuml';
  to: number;
};

export type AbsolutePlantumlBlock = PlantumlBlock & {
  blockId: string;
};

export function collectPlantumlBlocksInRanges(
  state: EditorState,
  ranges: readonly DocumentRange[],
): AbsolutePlantumlBlock[] {
  const blocks: AbsolutePlantumlBlock[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'FencedCode') {
          return;
        }

        const block = plantumlBlockFromFencedCode(state, node.node);
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

function plantumlBlockFromFencedCode(
  state: EditorState,
  fencedCode: MarkdownSyntaxNode,
): PlantumlBlock | null {
  const codeInfo = fencedCode.getChild('CodeInfo');
  const codeText = fencedCode.getChild('CodeText');

  if (!codeInfo || !codeText) {
    return null;
  }

  const info = state.doc.sliceString(codeInfo.from, codeInfo.to).trim();
  if (!isPlantumlCodeInfo(info)) {
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
    language: 'plantuml',
    to: fencedCode.to,
  };
}

function isPlantumlCodeInfo(info: string): boolean {
  const normalizedInfo = info.toLowerCase();

  return normalizedInfo === 'plantuml' || normalizedInfo.startsWith('plantuml ');
}
