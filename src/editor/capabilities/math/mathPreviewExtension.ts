import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
} from '@codemirror/view';
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import { createMathDocumentWorker } from './createMathDocumentWorker';
import { collectMathInventory, type MathInventoryFormula } from './mathInventory';
import {
  editorMathPreferencesField,
  setEditorMathPreferencesEffect,
} from './mathPreferences';
import {
  MathFormulaErrorWidget,
  MathFormulaWidget,
  mathFormulaGeometryKey,
} from './MathFormulaWidget';
import {
  MathRenderSession,
  type MathRenderSessionSnapshot,
  type MathWorkerLike,
} from './mathRenderSession';
import { resolveMathRefPosition } from './mathRefNavigation';
import type {
  MathFormulaRenderResult,
  MathLayoutMetrics,
} from './mathWorkerProtocol';
import './math.css';

export type MathPreviewDisplayMode = 'livePreview' | 'reading';

export type MathPreviewExtensionOptions = {
  readonly createWorker?: () => MathWorkerLike;
  readonly debounceMs?: number;
  readonly documentId: string;
  readonly mode: MathPreviewDisplayMode;
  readonly revealPosition?: (position: number) => void;
  readonly watchdogMs?: number;
};

const mathRenderSnapshotEffect =
  StateEffect.define<MathRenderSessionSnapshot>();
type MathCompositionRange = {
  readonly from: number;
  readonly to: number;
};

const mathCompositionEffect =
  StateEffect.define<readonly MathCompositionRange[] | null>();

const mathRenderSnapshotField = StateField.define<MathRenderSessionSnapshot>({
  create: () => ({
    documentId: null,
    error: null,
    generation: 0,
    lastSuccessfulFormulas: new Map(),
    result: null,
    status: 'idle',
  }),
  update(snapshot, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(mathRenderSnapshotEffect)) {
        return effect.value;
      }
    }
    return snapshot;
  },
});

const mathCompositionField = StateField.define<readonly MathCompositionRange[]>({
  create: () => [],
  update(composing, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(mathCompositionEffect)) {
        return effect.value ?? [];
      }
    }
    return transaction.docChanged
      ? composing.map((range) => ({
          from: transaction.changes.mapPos(range.from, -1),
          to: transaction.changes.mapPos(range.to, 1),
        }))
      : composing;
  },
});

export function mathPreviewExtension(
  options: MathPreviewExtensionOptions,
): Extension {
  const geometryCache = new BlockWidgetGeometryCache();

  return [
    editorMathPreferencesField,
    mathRenderSnapshotField,
    mathCompositionField,
    mathDecorationsField(options, geometryCache),
    mathRenderPlugin(options),
    EditorView.domEventHandlers({
      compositionstart(_event, view) {
        view.dispatch({
          effects: mathCompositionEffect.of(
            view.state.selection.ranges.map(({ from, to }) => ({ from, to })),
          ),
        });
        return false;
      },
      compositionend(_event, view) {
        view.dispatch({ effects: mathCompositionEffect.of(null) });
        return false;
      },
    }),
  ];
}

function mathRenderPlugin(options: MathPreviewExtensionOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      private destroyed = false;
      private inventory: MathInventoryFormula[];
      private readonly resizeObserver: ResizeObserver | null;
      private resizeRenderFrame: number | null = null;
      private lastSuccessfulStylesheet = '';
      private readonly session: MathRenderSession;
      private readonly styleElement = document.createElement('style');

      constructor(private readonly view: EditorView) {
        this.inventory = collectMathInventory(this.view.state);
        this.styleElement.dataset.lmMathStyle = options.documentId;
        document.head.appendChild(this.styleElement);
        this.session = new MathRenderSession({
          createWorker: options.createWorker ?? createMathDocumentWorker,
          debounceMs: options.debounceMs,
          onChange: (snapshot) => {
            queueMicrotask(() => {
              if (this.destroyed) {
                return;
              }
              if (snapshot.result) {
                // Keep the last fully successful CHTML stylesheet. An error
                // generation can emit a sparse font subset and must not wipe
                // rare-glyph CSS that a previous success already loaded.
                const hasFormulaError = snapshot.result.formulas.some(
                  (formula) => formula.error !== undefined,
                );
                if (!hasFormulaError) {
                  this.lastSuccessfulStylesheet = snapshot.result.stylesheet;
                  this.styleElement.textContent = snapshot.result.stylesheet;
                } else if (this.lastSuccessfulStylesheet.length === 0) {
                  this.styleElement.textContent = snapshot.result.stylesheet;
                }
              }
              this.view.dispatch({ effects: mathRenderSnapshotEffect.of(snapshot) });
            });
          },
          watchdogMs: options.watchdogMs,
        });
        this.resizeObserver = typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => this.scheduleResizeRender());
        this.resizeObserver?.observe(this.view.contentDOM);
        this.requestRender(this.inventory);
      }

      update(update: { docChanged: boolean; transactions: readonly { effects: readonly StateEffect<unknown>[] }[] }): void {
        const preferencesChanged = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setEditorMathPreferencesEffect)),
        );
        if (update.docChanged) {
          const nextInventory = collectMathInventory(this.view.state);
          if (
            preferencesChanged ||
            !sameFormulaSequence(this.inventory, nextInventory)
          ) {
            this.inventory = nextInventory;
            this.requestRender(nextInventory);
          } else {
            this.inventory = nextInventory;
          }
        } else if (preferencesChanged) {
          this.inventory = collectMathInventory(this.view.state);
          this.requestRender(this.inventory);
        }
      }

      destroy(): void {
        this.destroyed = true;
        if (this.resizeRenderFrame !== null) {
          cancelAnimationFrame(this.resizeRenderFrame);
          this.resizeRenderFrame = null;
        }
        this.resizeObserver?.disconnect();
        this.session.destroy();
        this.styleElement.remove();
      }

      private requestRender(inventory = this.inventory): void {
        const preferences = this.view.state.field(editorMathPreferencesField);
        this.session.request({
          documentId: options.documentId,
          formulas: inventory.map(({ display, id, source }) => ({
            display,
            id,
            source,
          })),
          layoutMetrics: currentLayoutMetrics(this.view),
          preferences: {
            numbering: preferences.equationNumbering,
            physics: preferences.physicsEnabled,
          },
        });
      }

      private scheduleResizeRender(): void {
        if (this.resizeRenderFrame !== null) {
          return;
        }
        this.resizeRenderFrame = requestAnimationFrame(() => {
          this.resizeRenderFrame = null;
          if (!this.destroyed) {
            this.requestRender();
          }
        });
      }
    },
  );
}

function mathDecorationsField(
  options: MathPreviewExtensionOptions,
  geometryCache: BlockWidgetGeometryCache,
): Extension {
  const { mode } = options;
  return StateField.define<DecorationSet>({
    create(state) {
      return buildMathDecorations(state, options, geometryCache);
    },
    update(decorations, transaction) {
      const renderChanged = transaction.effects.some((effect) =>
        effect.is(mathRenderSnapshotEffect),
      );
      const compositionChanged = transaction.effects.some((effect) =>
        effect.is(mathCompositionEffect),
      );
      const selectionChanged = transaction.selection !== undefined;
      if (
        !transaction.docChanged &&
        !selectionChanged &&
        !renderChanged &&
        !compositionChanged
      ) {
        return decorations;
      }

      const currentInventory = collectMathInventory(transaction.state);
      const previousInventory = transaction.docChanged
        ? collectMathInventory(transaction.startState)
        : currentInventory;
      const activeChanged =
        activeFormulaKey(transaction.startState, mode, previousInventory) !==
        activeFormulaKey(transaction.state, mode, currentInventory);
      const formulaSequenceChanged =
        transaction.docChanged &&
        !sameFormulaSequence(previousInventory, currentInventory);

      if (
        !shouldRebuildMathDecorations({
          activeChanged,
          compositionChanged,
          docChanged: transaction.docChanged,
          formulaSequenceChanged,
          renderChanged,
          selectionChanged,
        })
      ) {
        return transaction.docChanged
          ? decorations.map(transaction.changes)
          : decorations;
      }

      return buildMathDecorations(
        transaction.state,
        options,
        geometryCache,
        currentInventory,
      );
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildMathDecorations(
  state: EditorState,
  options: MathPreviewExtensionOptions,
  geometryCache: BlockWidgetGeometryCache,
  inventory = collectMathInventory(state),
): DecorationSet {
  const { mode } = options;
  const snapshot = state.field(mathRenderSnapshotField);
  const currentById = indexMathRenderResults(snapshot.result?.formulas ?? []);
  const ranges = [];
  const retainedGeometryKeys: string[] = [];

  for (const formula of inventory) {
    const active = mode === 'livePreview' && formulaIsActive(state, formula);
    const current = currentById.get(formula.id);
    const previous = snapshot.lastSuccessfulFormulas.get(formula.id);
    const chtml = current?.chtml ?? previous?.chtml;
    const error = current?.error ?? snapshot.error;

    if (!chtml) {
      if (error) {
        ranges.push(
          Decoration.widget({
            block: formula.display,
            side: 1,
            widget: new MathFormulaErrorWidget(formula.display, error),
          }).range(formula.to),
        );
      }
      continue;
    }

    if (!formula.display && active) {
      continue;
    }

    const widgetOptions = {
      activationOffset: formula.contentRanges[0]?.from !== undefined
        ? formula.contentRanges[0].from - formula.from
        : Math.min(2, Math.max(1, formula.to - formula.from - 1)),
      chtml,
      display: formula.display,
      error: error ?? null,
      formulaLength: formula.to - formula.from,
      onEquationRefClick: (href: string) => {
        const position = resolveMathRefPosition(href, snapshot, inventory);
        if (position == null || !options.revealPosition) {
          return false;
        }
        options.revealPosition(position);
        return true;
      },
      renderedAfterSource: formula.display && active,
      source: formula.source,
    };
    if (formula.display) {
      retainedGeometryKeys.push(mathFormulaGeometryKey(widgetOptions));
    }
    const widget = new MathFormulaWidget(widgetOptions, geometryCache);
    ranges.push(
      formula.display && active
        ? Decoration.widget({ block: true, side: 1, widget }).range(formula.to)
        : Decoration.replace({
            block: formula.display,
            inclusive: false,
            widget,
          }).range(formula.from, formula.to),
    );
  }

  geometryCache.retain(retainedGeometryKeys);

  return Decoration.set(ranges, true);
}

function formulaIsActive(
  state: EditorState,
  formula: MathInventoryFormula,
): boolean {
  const selectionIsActive = state.selection.ranges.some((selection) =>
    selection.empty
      ? formula.from < selection.head && selection.head < formula.to
      : selection.from < formula.to && selection.to > formula.from,
  );
  if (selectionIsActive) {
    return true;
  }

  return state.field(mathCompositionField).some((range) =>
    range.from === range.to
      ? formula.from < range.from && range.from < formula.to
      : range.from < formula.to && range.to > formula.from,
  );
}

function activeFormulaKey(
  state: EditorState,
  mode: MathPreviewDisplayMode,
  inventory: readonly MathInventoryFormula[],
): string {
  if (mode === 'reading') {
    return '';
  }
  return inventory
    .filter((formula) => formulaIsActive(state, formula))
    .map(({ id }) => id)
    .join('|');
}

function sameFormulaSequence(
  left: readonly MathInventoryFormula[],
  right: readonly MathInventoryFormula[],
): boolean {
  return left.length === right.length && left.every((formula, index) => {
    const other = right[index];
    return (
      other?.display === formula.display &&
      other.id === formula.id &&
      other.source === formula.source
    );
  });
}

export function indexMathRenderResults(
  formulas: readonly MathFormulaRenderResult[],
): ReadonlyMap<string, MathFormulaRenderResult> {
  const byId = new Map<string, MathFormulaRenderResult>();
  for (const formula of formulas) {
    byId.set(formula.id, formula);
  }
  return byId;
}

export type MathDecorationUpdateFacts = {
  readonly activeChanged: boolean;
  readonly compositionChanged: boolean;
  readonly docChanged: boolean;
  readonly formulaSequenceChanged: boolean;
  readonly renderChanged: boolean;
  readonly selectionChanged: boolean;
};

export function shouldRebuildMathDecorations({
  activeChanged,
  formulaSequenceChanged,
  renderChanged,
}: MathDecorationUpdateFacts): boolean {
  return renderChanged || formulaSequenceChanged || activeChanged;
}

function currentLayoutMetrics(view: EditorView): MathLayoutMetrics {
  const fontSize = Number.parseFloat(getComputedStyle(view.contentDOM).fontSize);
  const em = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
  return {
    containerWidth: view.contentDOM.clientWidth || 800,
    em,
    ex: em / 2,
  };
}

export { mathCompositionEffect };
