import {
  type EditorState,
  type Range,
  RangeSetBuilder,
  type Transaction,
} from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import {
  collectMermaidBlocksInRanges,
  type AbsoluteMermaidBlock,
} from './mermaidBlockDetection';
import { rangeContainsFenceLine } from './mermaidChangeDetection';
import {
  type ActiveMermaidBlock,
  isActiveMermaidBlock,
} from './mermaidEditingState';
import { MermaidBlockWidget } from './MermaidBlockWidget';
import type { MermaidRenderScheduler } from './mermaidRenderScheduler';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';

type MermaidDecorationOptions = {
  config?: Record<string, unknown>;
  mermaidVersion?: string;
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
};

type MermaidDecorationContext = {
  defaultMermaidVersion: string;
  options: MermaidDecorationOptions;
  scheduler: MermaidRenderScheduler;
  theme: 'dark' | 'default';
};

export function buildMermaidDecorations(
  state: EditorState,
  context: MermaidDecorationContext,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of collectMermaidBlocksInRanges(
    state,
    [{ from: 0, to: state.doc.length }],
  )) {
    const decoration = createMermaidDecoration(state, block, context);
    builder.add(decoration.from, decoration.to, decoration.value);
  }

  return builder.finish();
}

export function canRebuildActiveMermaidRange(
  transaction: Transaction,
  previousActiveBlock: ActiveMermaidBlock,
): boolean {
  return changesAreConfinedToRange(
    transaction,
    previousActiveBlock.from,
    previousActiveBlock.to,
  ) && !changesAlterFenceContext(transaction);
}

export function rebuildActiveMermaidRange(
  decorations: DecorationSet,
  transaction: Transaction,
  previousActiveBlock: ActiveMermaidBlock,
  activeBlock: ActiveMermaidBlock,
  context: MermaidDecorationContext,
): DecorationSet {
  const mappedDecorations = decorations.map(transaction.changes);
  const mappedPreviousFrom = transaction.changes.mapPos(
    previousActiveBlock.from,
    -1,
  );
  const mappedPreviousTo = transaction.changes.mapPos(
    previousActiveBlock.to,
    1,
  );
  const rebuildFrom = Math.min(mappedPreviousFrom, activeBlock.from);
  const rebuildTo = Math.max(mappedPreviousTo, activeBlock.to);
  const additions = collectMermaidBlocksInRanges(
    transaction.state,
    [{ from: rebuildFrom, to: rebuildTo }],
  ).map((block) => createMermaidDecoration(
    transaction.state,
    block,
    context,
  ));

  return mappedDecorations.update({
    add: additions,
    filter: (from, to, decoration) => {
      if (!(decoration.spec.widget instanceof MermaidBlockWidget)) {
        return true;
      }

      return to < rebuildFrom || from > rebuildTo;
    },
    filterFrom: Math.max(0, rebuildFrom - 1),
    filterTo: Math.min(transaction.state.doc.length, rebuildTo + 1),
    sort: true,
  });
}

export function changesTouchRange(
  transaction: Transaction,
  from: number,
  to: number,
): boolean {
  let touches = false;

  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (touches) {
      return;
    }

    touches = fromA === toA
      ? from <= fromA && fromA <= to
      : fromA < to && toA > from;
  });

  return touches;
}

function createMermaidDecoration(
  state: EditorState,
  block: AbsoluteMermaidBlock,
  context: MermaidDecorationContext,
): Range<Decoration> {
  const editing = isActiveMermaidBlock(state, block);
  const widget = new MermaidBlockWidget(
    block,
    context.scheduler,
    context.options,
    context.theme,
    context.defaultMermaidVersion,
    editing,
  );

  return editing
    ? Decoration.widget({
        block: true,
        side: 1,
        widget,
      }).range(block.to)
    : Decoration.replace({
        block: true,
        widget,
      }).range(block.from, block.to);
}

function changesAlterFenceContext(transaction: Transaction): boolean {
  let altersFenceContext = false;

  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (altersFenceContext) {
      return;
    }

    altersFenceContext =
      rangeContainsFenceLine(transaction.startState, fromA, toA) ||
      rangeContainsFenceLine(transaction.state, fromB, toB);
  });

  return altersFenceContext;
}

function changesAreConfinedToRange(
  transaction: Transaction,
  from: number,
  to: number,
): boolean {
  let confined = true;

  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (!confined) {
      return;
    }

    confined = fromA === toA
      ? from <= fromA && fromA <= to
      : from <= fromA && toA <= to;
  });

  return confined;
}
