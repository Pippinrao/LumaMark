import {
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import mermaidPackage from 'mermaid/package.json';
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import { MermaidRenderScheduler } from './mermaidRenderScheduler';
import { renderWithMermaid } from './mermaidRenderAdapter';
import { changedRangesRequireMermaidRebuild } from './mermaidChangeDetection';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import {
  activeMermaidBlock,
  mermaidEditingStateField,
} from './mermaidEditingState';
import { mermaidSourceEditingKeymap } from './mermaidInlineEditor';
import {
  buildMermaidDecorations,
  canRebuildActiveMermaidRange,
  changesTouchRange,
  rebuildActiveMermaidRange,
} from './mermaidDecorations';
import './mermaid.css';

export type MermaidPreviewExtensionOptions = {
  config?: Record<string, unknown>;
  mermaidVersion?: string;
  scheduler?: MermaidRenderScheduler;
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
};

const DEFAULT_MERMAID_VERSION = mermaidPackage.version;
const mermaidThemeChangedEffect = StateEffect.define();
let defaultScheduler: MermaidRenderScheduler | null = null;

export function mermaidPreviewExtension(
  options: MermaidPreviewExtensionOptions = {},
): Extension {
  const scheduler = options.scheduler ?? getDefaultScheduler();
  const geometryCache = new BlockWidgetGeometryCache();

  return [
    mermaidEditingStateField,
    mermaidSourceEditingKeymap(),
    mermaidDecorationsField(scheduler, options, geometryCache),
    mermaidThemeObserver(),
  ];
}

function mermaidThemeObserver(): Extension {
  return ViewPlugin.fromClass(
    class {
      private readonly themeObserver: MutationObserver;

      constructor(private readonly view: EditorView) {
        this.themeObserver = new MutationObserver(() => {
          queueMicrotask(() => {
            this.view.dispatch({
              effects: mermaidThemeChangedEffect.of(null),
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

function mermaidDecorationsField(
  scheduler: MermaidRenderScheduler,
  options: MermaidPreviewExtensionOptions,
  geometryCache: BlockWidgetGeometryCache,
): Extension {
  const decorationContext = () => ({
    defaultMermaidVersion: DEFAULT_MERMAID_VERSION,
    geometryCache,
    options,
    scheduler,
    theme: currentMermaidTheme(),
  });
  const rebuildAll = (state: Parameters<typeof buildMermaidDecorations>[0]) =>
    buildMermaidDecorations(state, decorationContext());

  return StateField.define<DecorationSet>({
    create(state) {
      return rebuildAll(state);
    },
    update(value, transaction) {
      if (transaction.effects.some((effect) => effect.is(mermaidThemeChangedEffect))) {
        return rebuildAll(transaction.state);
      }

      const previousActiveBlock = activeMermaidBlock(transaction.startState);
      const activeBlock = activeMermaidBlock(transaction.state);

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
          canRebuildActiveMermaidRange(transaction, previousActiveBlock)
        ) {
          return rebuildActiveMermaidRange(
            value,
            transaction,
            previousActiveBlock,
            activeBlock,
            decorationContext(),
          );
        }

        return rebuildAll(transaction.state);
      }

      if (changedRangesRequireMermaidRebuild(value, transaction)) {
        return rebuildAll(transaction.state);
      }

      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function getDefaultScheduler(): MermaidRenderScheduler {
  defaultScheduler ??= new MermaidRenderScheduler({
    debounceMs: 120,
    render: renderWithMermaid,
  });

  return defaultScheduler;
}

function currentMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'default';
}

export { collectMermaidBlocksInRanges } from './mermaidBlockDetection';
