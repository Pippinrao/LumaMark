import { syntaxTree } from '@codemirror/language';
import type {
  ChangeDesc,
  EditorState,
  Transaction,
} from '@codemirror/state';
import {
  collectImageBlocksInRanges,
  type DocumentRange,
  type ImageBlock,
} from './imageBlockDetection';

type TopLevelSyntaxContext = {
  endLineOffset: number;
  extendsAfterRange: boolean;
  extendsBeforeRange: boolean;
  name: string;
  startLineOffset: number;
};

export function changedRangesAffectImageBlocks(
  transaction: Transaction,
): boolean {
  let topLevelContextChanged = false;
  const oldRanges: DocumentRange[] = [];
  const newRanges: DocumentRange[] = [];

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    const oldRange = expandRangeToLines(transaction.startState, fromA, toA);
    const newRange = expandRangeToLines(transaction.state, fromB, toB);

    oldRanges.push(oldRange);
    newRanges.push(newRange);
    topLevelContextChanged ||= syntaxContextChangedAcrossRange(
      transaction.startState,
      oldRange,
      transaction.state,
      newRange,
    );
  });

  return (
    collectImageBlocksInRanges(transaction.startState, oldRanges).length > 0 ||
    collectImageBlocksInRanges(transaction.state, newRanges).length > 0 ||
    rangesContainCodeFenceMarker(transaction.startState, oldRanges) ||
    rangesContainCodeFenceMarker(transaction.state, newRanges) ||
    topLevelContextChanged
  );
}

export function mapImageBlocks(
  blocks: readonly ImageBlock[],
  changes: ChangeDesc,
): readonly ImageBlock[] {
  return blocks.map((block) => {
    const from = changes.mapPos(block.from, 1);
    const to = changes.mapPos(block.to, -1);

    return {
      ...block,
      blockId: `${from}:${to}`,
      from,
      to,
    };
  });
}

export function imageBlockPositionsChanged(
  previousBlocks: readonly ImageBlock[],
  nextBlocks: readonly ImageBlock[],
): boolean {
  return (
    previousBlocks.length !== nextBlocks.length ||
    previousBlocks.some((block, index) => {
      const nextBlock = nextBlocks[index];
      return (
        !nextBlock || block.from !== nextBlock.from || block.to !== nextBlock.to
      );
    })
  );
}

export function imageSelectionStateChanged(
  previousState: EditorState,
  previousBlocks: readonly ImageBlock[],
  nextState: EditorState,
  nextBlocks: readonly ImageBlock[],
): boolean {
  return previousBlocks.some((block, index) => {
    const nextBlock = nextBlocks[index];
    return (
      !nextBlock ||
      selectionIntersectsBlock(previousState, block) !==
        selectionIntersectsBlock(nextState, nextBlock)
    );
  });
}

export function selectionIntersectsBlock(
  state: EditorState,
  block: ImageBlock,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from > block.from && range.from < block.to;
    }

    return range.from < block.to && range.to > block.from;
  });
}

function syntaxContextChangedAcrossRange(
  previousState: EditorState,
  previousRange: DocumentRange,
  nextState: EditorState,
  nextRange: DocumentRange,
): boolean {
  const previousContexts = collectTopLevelSyntaxContexts(
    previousState,
    previousRange,
  );
  const nextContexts = collectTopLevelSyntaxContexts(nextState, nextRange);

  if (sameSyntaxContexts(previousContexts, nextContexts)) {
    return false;
  }

  return [...previousContexts, ...nextContexts].some(
    (context) => context.extendsBeforeRange || context.extendsAfterRange,
  );
}

function collectTopLevelSyntaxContexts(
  state: EditorState,
  range: DocumentRange,
): readonly TopLevelSyntaxContext[] {
  const contexts: TopLevelSyntaxContext[] = [];
  const rangeStartLine = state.doc.lineAt(range.from).number;

  syntaxTree(state).iterate({
    from: range.from,
    to: range.to,
    enter(node) {
      if (node.node.parent?.name !== 'Document') {
        return;
      }

      contexts.push({
        endLineOffset: state.doc.lineAt(node.to).number - rangeStartLine,
        extendsAfterRange: node.to > range.to,
        extendsBeforeRange: node.from < range.from,
        name: node.name,
        startLineOffset: state.doc.lineAt(node.from).number - rangeStartLine,
      });
      return false;
    },
  });

  return contexts;
}

function sameSyntaxContexts(
  previousContexts: readonly TopLevelSyntaxContext[],
  nextContexts: readonly TopLevelSyntaxContext[],
): boolean {
  return (
    previousContexts.length === nextContexts.length &&
    previousContexts.every((context, index) => {
      const next = nextContexts[index];
      return (
        next?.name === context.name &&
        next.startLineOffset === context.startLineOffset &&
        next.endLineOffset === context.endLineOffset &&
        next.extendsBeforeRange === context.extendsBeforeRange &&
        next.extendsAfterRange === context.extendsAfterRange
      );
    })
  );
}

function rangesContainCodeFenceMarker(
  state: EditorState,
  ranges: readonly DocumentRange[],
): boolean {
  for (const range of ranges) {
    let containsFenceMarker = false;

    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (
          node.name === 'CodeMark' &&
          node.node.parent?.name === 'FencedCode' &&
          /^(?:`{3,}|~{3,})$/.test(state.doc.sliceString(node.from, node.to))
        ) {
          containsFenceMarker = true;
        }
      },
    });

    if (containsFenceMarker) {
      return true;
    }
  }

  return false;
}

function expandRangeToLines(
  state: EditorState,
  from: number,
  to: number,
): DocumentRange {
  return {
    from: state.doc.lineAt(from).from,
    to: state.doc.lineAt(to).to,
  };
}
