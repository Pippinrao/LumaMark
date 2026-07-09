import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
} from '@codemirror/view';
import mermaidPackage from 'mermaid/package.json';
import {
  MermaidRenderScheduler,
} from './mermaidRenderScheduler';
import { renderWithMermaid } from './mermaidRenderAdapter';
import {
  collectMermaidBlocksInRanges,
} from './mermaidBlockDetection';
import { MermaidBlockWidget } from './MermaidBlockWidget';
import './mermaid.css';

export type MermaidPreviewExtensionOptions = {
  config?: Record<string, unknown>;
  mermaidVersion?: string;
  scheduler?: MermaidRenderScheduler;
};

const DEFAULT_MERMAID_VERSION = mermaidPackage.version;
const mermaidThemeChangedEffect = StateEffect.define();
let defaultScheduler: MermaidRenderScheduler | null = null;

export function mermaidPreviewExtension(
  options: MermaidPreviewExtensionOptions = {},
): Extension {
  const scheduler = options.scheduler ?? getDefaultScheduler();

  return [
    mermaidDecorationsField(scheduler, options),
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
): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildMermaidDecorations(state, scheduler, options);
    },
    update(value, transaction) {
      if (
        transaction.docChanged ||
        transaction.selection ||
        transaction.effects.some((effect) => effect.is(mermaidThemeChangedEffect))
      ) {
        return buildMermaidDecorations(transaction.state, scheduler, options);
      }

      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

function buildMermaidDecorations(
  state: EditorState,
  scheduler: MermaidRenderScheduler,
  options: MermaidPreviewExtensionOptions,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const theme = currentMermaidTheme();

  for (const block of collectMermaidBlocksInRanges(
    state,
    [{ from: 0, to: state.doc.length }],
  )) {
    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        block: true,
        widget: new MermaidBlockWidget(
          block,
          scheduler,
          options,
          theme,
          DEFAULT_MERMAID_VERSION,
        ),
      }),
    );
  }

  return builder.finish();
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
