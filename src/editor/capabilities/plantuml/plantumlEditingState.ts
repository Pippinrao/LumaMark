import {
  type ChangeDesc,
  type EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import {
  activeBlockFromEmptyFenceAutoClose,
} from '../code-block/fenceAutoClose';
import {
  collectPlantumlBlocksInRanges,
  type AbsolutePlantumlBlock,
} from './plantumlBlockDetection';

export type ActivePlantumlBlock = {
  from: number;
  to: number;
};

export const setActivePlantumlBlockEffect =
  StateEffect.define<ActivePlantumlBlock | null>({
    map(value, changes) {
      return value ? mapActiveBlock(value, changes) : null;
    },
  });

export const plantumlEditingStateField =
  StateField.define<ActivePlantumlBlock | null>({
    create: () => null,
    update(value, transaction) {
      let next = value ? mapActiveBlock(value, transaction.changes) : null;

      for (const effect of transaction.effects) {
        if (effect.is(setActivePlantumlBlockEffect)) {
          next = effect.value;
        }
      }

      if (!next) {
        next = activeBlockFromEmptyFenceAutoClose(
          transaction,
          findPlantumlBlockAt,
        );
      }

      if (!next || replacesWholeDocument(transaction)) {
        return null;
      }

      if (
        transaction.docChanged &&
        changesTouchBlock(transaction, value ?? next)
      ) {
        const currentBlock = findBlockOverlapping(
          transaction.state,
          next,
        );

        if (!currentBlock) {
          return null;
        }

        next = {
          from: currentBlock.from,
          to: currentBlock.to,
        };
      }

      return selectionTouchesBlock(transaction.newSelection, next)
        ? next
        : null;
    },
  });

export function activePlantumlBlock(
  state: EditorState,
): ActivePlantumlBlock | null {
  return state.field(plantumlEditingStateField, false) ?? null;
}

export function isActivePlantumlBlock(
  state: EditorState,
  block: AbsolutePlantumlBlock,
): boolean {
  const active = activePlantumlBlock(state);

  return Boolean(
    active &&
      block.from <= active.from &&
      block.to >= active.to,
  );
}

function mapActiveBlock(
  block: ActivePlantumlBlock,
  changes: ChangeDesc,
): ActivePlantumlBlock {
  return {
    from: changes.mapPos(block.from, -1),
    to: changes.mapPos(block.to, 1),
  };
}

function replacesWholeDocument(transaction: Transaction): boolean {
  let replacesDocument = false;

  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (
      fromA === 0 &&
      toA === transaction.startState.doc.length
    ) {
      replacesDocument = true;
    }
  });

  return replacesDocument;
}

function changesTouchBlock(
  transaction: Transaction,
  block: ActivePlantumlBlock,
): boolean {
  let touches = false;

  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (touches) {
      return;
    }

    touches = fromA === toA
      ? block.from <= fromA && fromA <= block.to
      : fromA < block.to && toA > block.from;
  });

  return touches;
}

function findPlantumlBlockAt(
  state: EditorState,
  head: number,
): AbsolutePlantumlBlock | null {
  const from = Math.max(0, head - 1);
  const to = Math.min(state.doc.length, head + 1);
  return collectPlantumlBlocksInRanges(state, [{ from, to }])
    .find((block) => block.from <= head && head <= block.to) ?? null;
}

function findBlockOverlapping(
  state: EditorState,
  range: ActivePlantumlBlock,
): AbsolutePlantumlBlock | null {
  const from = Math.max(0, Math.min(range.from, state.doc.length));
  const to = Math.max(from, Math.min(range.to, state.doc.length));

  return collectPlantumlBlocksInRanges(state, [{ from, to }])
    .find((block) => block.from <= to && block.to >= from) ?? null;
}

function selectionTouchesBlock(
  selection: EditorSelection,
  block: ActivePlantumlBlock,
): boolean {
  return selection.ranges.some(
    (range) => range.from <= block.to && range.to >= block.from,
  );
}
