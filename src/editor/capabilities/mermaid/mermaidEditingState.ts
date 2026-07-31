import {
  type ChangeDesc,
  type EditorSelection,
  type EditorState,
  StateEffect,
  StateField,
  type Transaction,
} from '@codemirror/state';
import {
  collectMermaidBlocksInRanges,
  type AbsoluteMermaidBlock,
} from './mermaidBlockDetection';

export type ActiveMermaidBlock = {
  from: number;
  to: number;
};

export const setActiveMermaidBlockEffect =
  StateEffect.define<ActiveMermaidBlock | null>({
    map(value, changes) {
      return value ? mapActiveBlock(value, changes) : null;
    },
  });

export const mermaidEditingStateField =
  StateField.define<ActiveMermaidBlock | null>({
    create: () => null,
    update(value, transaction) {
      let next = value ? mapActiveBlock(value, transaction.changes) : null;

      for (const effect of transaction.effects) {
        if (effect.is(setActiveMermaidBlockEffect)) {
          next = effect.value;
        }
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

export function activeMermaidBlock(
  state: EditorState,
): ActiveMermaidBlock | null {
  return state.field(mermaidEditingStateField, false) ?? null;
}

export function isActiveMermaidBlock(
  state: EditorState,
  block: AbsoluteMermaidBlock,
): boolean {
  const active = activeMermaidBlock(state);

  return Boolean(
    active &&
      block.from <= active.from &&
      block.to >= active.to,
  );
}

function mapActiveBlock(
  block: ActiveMermaidBlock,
  changes: ChangeDesc,
): ActiveMermaidBlock {
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
  block: ActiveMermaidBlock,
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

function findBlockOverlapping(
  state: EditorState,
  range: ActiveMermaidBlock,
): AbsoluteMermaidBlock | null {
  const from = Math.max(0, Math.min(range.from, state.doc.length));
  const to = Math.max(from, Math.min(range.to, state.doc.length));

  return collectMermaidBlocksInRanges(state, [{ from, to }])
    .find((block) => block.from <= to && block.to >= from) ?? null;
}

function selectionTouchesBlock(
  selection: EditorSelection,
  block: ActiveMermaidBlock,
): boolean {
  return selection.ranges.some(
    (range) => range.from <= block.to && range.to >= block.from,
  );
}
