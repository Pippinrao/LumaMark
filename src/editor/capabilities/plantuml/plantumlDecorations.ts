import {
  type EditorState,
  type Range,
  RangeSetBuilder,
  type Transaction,
} from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import {
  collectPlantumlBlocksInRanges,
  type AbsolutePlantumlBlock,
} from './plantumlBlockDetection';
import { rangeContainsFenceLine } from './plantumlChangeDetection';
import {
  type ActivePlantumlBlock,
  isActivePlantumlBlock,
} from './plantumlEditingState';
import {
  PlantumlBlockWidget,
  plantumlBlockGeometryKey,
} from './PlantumlBlockWidget';
import type { PlantumlRenderScheduler } from './plantumlRenderScheduler';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import { isEditorRenderLocked } from '../../core/editorRenderLock';

type PlantumlDecorationOptions = {
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
};

type PlantumlDecorationContext = {
  geometryCache: BlockWidgetGeometryCache;
  options: PlantumlDecorationOptions;
  scheduler: PlantumlRenderScheduler;
  theme: 'dark' | 'default';
};

export function buildPlantumlDecorations(
  state: EditorState,
  context: PlantumlDecorationContext,
): DecorationSet {
  const blocks = collectPlantumlBlocksInRanges(
    state,
    [{ from: 0, to: state.doc.length }],
  );
  const keyedBlocks = blocks.map((block) => ({
    block,
    geometryKey: plantumlBlockGeometryKey(block),
  }));
  context.geometryCache.retain(keyedBlocks.map(({ geometryKey }) => geometryKey));
  const builder = new RangeSetBuilder<Decoration>();

  for (const { block, geometryKey } of keyedBlocks) {
    const decoration = createPlantumlDecoration(
      state,
      block,
      context,
      geometryKey,
    );
    builder.add(decoration.from, decoration.to, decoration.value);
  }

  return builder.finish();
}

export function canRebuildActivePlantumlRange(
  transaction: Transaction,
  previousActiveBlock: ActivePlantumlBlock,
): boolean {
  return changesAreConfinedToRange(
    transaction,
    previousActiveBlock.from,
    previousActiveBlock.to,
  ) && !changesAlterFenceContext(transaction);
}

export function rebuildActivePlantumlRange(
  decorations: DecorationSet,
  transaction: Transaction,
  previousActiveBlock: ActivePlantumlBlock,
  activeBlock: ActivePlantumlBlock,
  context: PlantumlDecorationContext,
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
  const previousBlocks = collectPlantumlBlocksInRanges(
    transaction.startState,
    [{ from: previousActiveBlock.from, to: previousActiveBlock.to }],
  );
  const nextBlocks = collectPlantumlBlocksInRanges(
    transaction.state,
    [{ from: rebuildFrom, to: rebuildTo }],
  );
  const keyedNextBlocks = nextBlocks.map((block) => ({
    block,
    geometryKey: plantumlBlockGeometryKey(block),
  }));
  context.geometryCache.updateRetained(
    previousBlocks.map(plantumlBlockGeometryKey),
    keyedNextBlocks.map(({ geometryKey }) => geometryKey),
  );
  const additions = keyedNextBlocks.map(({ block, geometryKey }) =>
    createPlantumlDecoration(
      transaction.state,
      block,
      context,
      geometryKey,
    ));

  return mappedDecorations.update({
    add: additions,
    filter: (from, to, decoration) => {
      if (!(decoration.spec.widget instanceof PlantumlBlockWidget)) {
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

function createPlantumlDecoration(
  state: EditorState,
  block: AbsolutePlantumlBlock,
  context: PlantumlDecorationContext,
  geometryKey = plantumlBlockGeometryKey(block),
): Range<Decoration> {
  const sourceControlsEnabled = !isEditorRenderLocked(state);
  const editing = sourceControlsEnabled && isActivePlantumlBlock(state, block);
  const widget = new PlantumlBlockWidget(
    block,
    context.scheduler,
    context.options,
    context.theme,
    editing,
    context.geometryCache,
    geometryKey,
    sourceControlsEnabled,
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
