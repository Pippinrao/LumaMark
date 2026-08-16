import {
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import { PlantumlRenderScheduler } from './plantumlRenderScheduler';
import { renderWithPlantuml } from './plantumlRenderAdapter';
import { changedRangesRequirePlantumlRebuild } from './plantumlChangeDetection';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import { isEditorRenderLocked } from '../../core/editorRenderLock';
import {
  activePlantumlBlock,
  plantumlEditingStateField,
} from './plantumlEditingState';
import { plantumlSourceEditingKeymap } from './plantumlInlineEditor';
import {
  buildPlantumlDecorations,
  canRebuildActivePlantumlRange,
  changesTouchRange,
  rebuildActivePlantumlRange,
} from './plantumlDecorations';
import './plantuml.css';

export type PlantumlPreviewExtensionOptions = {
  scheduler?: PlantumlRenderScheduler;
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
};

const plantumlThemeChangedEffect = StateEffect.define();
let defaultScheduler: PlantumlRenderScheduler | null = null;

export function plantumlPreviewExtension(
  options: PlantumlPreviewExtensionOptions = {},
): Extension {
  const scheduler = options.scheduler ?? getDefaultScheduler();
  const geometryCache = new BlockWidgetGeometryCache();

  return [
    plantumlEditingStateField,
    plantumlSourceEditingKeymap(),
    plantumlDecorationsField(scheduler, options, geometryCache),
    plantumlThemeObserver(),
  ];
}

function plantumlThemeObserver(): Extension {
  return ViewPlugin.fromClass(
    class {
      private readonly themeObserver: MutationObserver;

      constructor(private readonly view: EditorView) {
        this.themeObserver = new MutationObserver(() => {
          queueMicrotask(() => {
            this.view.dispatch({
              effects: plantumlThemeChangedEffect.of(null),
            });
          });
        });
        this.themeObserver.observe(document.documentElement, {
          attributeFilter: ['data-theme'],
          attributes: true,
        });
      }

      destroy() {
        this.themeObserver.disconnect();
      }
    },
  );
}

function plantumlDecorationsField(
  scheduler: PlantumlRenderScheduler,
  options: PlantumlPreviewExtensionOptions,
  geometryCache: BlockWidgetGeometryCache,
): Extension {
  const decorationContext = () => ({
    geometryCache,
    options,
    scheduler,
    theme: currentPlantumlTheme(),
  });
  const rebuildAll = (state: Parameters<typeof buildPlantumlDecorations>[0]) =>
    buildPlantumlDecorations(state, decorationContext());

  return StateField.define<DecorationSet>({
    create(state) {
      return rebuildAll(state);
    },
    update(value, transaction) {
      if (
        isEditorRenderLocked(transaction.startState) !==
        isEditorRenderLocked(transaction.state)
      ) {
        return rebuildAll(transaction.state);
      }

      if (
        transaction.effects.some((effect) =>
          effect.is(plantumlThemeChangedEffect),
        )
      ) {
        return rebuildAll(transaction.state);
      }

      const previousActiveBlock = activePlantumlBlock(transaction.startState);
      const activeBlock = activePlantumlBlock(transaction.state);

      if (Boolean(previousActiveBlock) !== Boolean(activeBlock)) {
        return rebuildAll(transaction.state);
      }

      if (
        !transaction.docChanged &&
        previousActiveBlock &&
        activeBlock &&
        (
          previousActiveBlock.from !== activeBlock.from ||
          previousActiveBlock.to !== activeBlock.to
        )
      ) {
        return rebuildAll(transaction.state);
      }

      if (!transaction.docChanged) {
        return value;
      }

      if (
        previousActiveBlock &&
        changesTouchRange(
          transaction,
          previousActiveBlock.from,
          previousActiveBlock.to,
        )
      ) {
        if (
          activeBlock &&
          canRebuildActivePlantumlRange(transaction, previousActiveBlock)
        ) {
          return rebuildActivePlantumlRange(
            value,
            transaction,
            previousActiveBlock,
            activeBlock,
            decorationContext(),
          );
        }

        return rebuildAll(transaction.state);
      }

      if (changedRangesRequirePlantumlRebuild(value, transaction)) {
        return rebuildAll(transaction.state);
      }

      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function getDefaultScheduler(): PlantumlRenderScheduler {
  defaultScheduler ??= new PlantumlRenderScheduler({
    debounceMs: 200,
    render: renderWithPlantuml,
  });

  return defaultScheduler;
}

function currentPlantumlTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
}

export { collectPlantumlBlocksInRanges } from './plantumlBlockDetection';
