import { syntaxTree } from '@codemirror/language';
import { type EditorState, type Transaction } from '@codemirror/state';
import { type DecorationSet } from '@codemirror/view';
import {
  collectMermaidBlocksInRanges,
  type DocumentRange,
} from './mermaidBlockDetection';

const FENCE_LINE_PATTERN = /^\s{0,3}(?:`{3,}|~{3,})/;
const BLOCK_CONTEXT_NODE_NAMES = new Set([
  'Blockquote',
  'BulletList',
  'CodeBlock',
  'FencedCode',
  'HTMLBlock',
  'ListItem',
  'OrderedList',
]);

export function changedRangesRequireMermaidRebuild(
  decorations: DecorationSet,
  transaction: Transaction,
): boolean {
  const newRanges: DocumentRange[] = [];
  let altersFenceContext = false;
  let altersMarkdownBlockContext = false;
  let touchesExistingBlock = false;

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    newRanges.push({ from: fromB, to: toB });

    if (
      !altersFenceContext &&
      (rangeContainsFenceLine(transaction.startState, fromA, toA) ||
        rangeContainsFenceLine(transaction.state, fromB, toB))
    ) {
      altersFenceContext = true;
    }

    if (
      !altersMarkdownBlockContext &&
      blockContextSignature(
        transaction.startState,
        fromA,
        toA,
      ) !== blockContextSignature(transaction.state, fromB, toB)
    ) {
      altersMarkdownBlockContext = true;
    }

    if (!touchesExistingBlock) {
      touchesExistingBlock = decorationsTouchRange(
        decorations,
        fromA,
        toA,
        transaction.startState.doc.length,
      );
    }

  });

  if (
    altersFenceContext ||
    altersMarkdownBlockContext ||
    touchesExistingBlock
  ) {
    return true;
  }

  return collectMermaidBlocksInRanges(transaction.state, newRanges).length > 0;
}

export function rangeContainsFenceLine(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const firstLine = state.doc.lineAt(from).number;
  const lastLine = state.doc.lineAt(to).number;

  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const prefix = state.doc.sliceString(
      line.from,
      Math.min(line.to, line.from + 8),
    );

    if (FENCE_LINE_PATTERN.test(prefix)) {
      return true;
    }
  }

  return false;
}

function decorationsTouchRange(
  decorations: DecorationSet,
  from: number,
  to: number,
  documentLength: number,
): boolean {
  const isInsertion = from === to;
  const queryFrom = isInsertion ? Math.max(0, from - 1) : from;
  const queryTo = isInsertion ? Math.min(documentLength, to + 1) : to;
  let touches = false;

  decorations.between(queryFrom, queryTo, (decorationFrom, decorationTo) => {
    touches = isInsertion
      ? decorationFrom <= from && from < decorationTo
      : decorationFrom < to && decorationTo > from;
    return touches ? false : undefined;
  });

  return touches;
}

function blockContextSignature(
  state: EditorState,
  from: number,
  to: number,
): string {
  const safeFrom = Math.max(0, Math.min(from, state.doc.length));
  const safeTo = Math.max(safeFrom, Math.min(to, state.doc.length));
  const firstLine = state.doc.lineAt(safeFrom);
  const lastLine = state.doc.lineAt(safeTo);
  const signature: string[] = [];

  syntaxTree(state).iterate({
    from: firstLine.from,
    to: lastLine.to,
    enter(node) {
      if (
        node.node.parent?.name !== 'Document' &&
        !BLOCK_CONTEXT_NODE_NAMES.has(node.name)
      ) {
        return;
      }

      const nodeLastPosition = Math.max(node.from, node.to - 1);
      const nodeFirstLine = state.doc.lineAt(node.from).number;
      const nodeLastLine = state.doc.lineAt(nodeLastPosition).number;
      signature.push([
        node.name,
        nodeFirstLine - firstLine.number,
        nodeLastLine - lastLine.number,
      ].join(':'));
    },
  });

  return signature.join('|');
}
