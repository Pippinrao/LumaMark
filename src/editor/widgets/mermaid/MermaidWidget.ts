import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import mermaidPackage from 'mermaid/package.json';
import { i18n } from '../../../shared/i18n';
import { detectMermaidBlocks, type MermaidBlock } from './mermaidBlockDetector';
import {
  MermaidRenderScheduler,
  type MermaidRenderSchedulerOptions,
} from './mermaidRenderScheduler';
import './mermaid.css';

type DocumentRange = {
  from: number;
  to: number;
};

type AbsoluteMermaidBlock = MermaidBlock & {
  blockId: string;
};

type SafeMermaidConfig = Record<string, unknown> & {
  securityLevel: 'strict';
};

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
  return mermaidPreviewPlugin(options);
}

export function collectMermaidBlocksInRanges(
  state: EditorState,
  ranges: readonly DocumentRange[],
): AbsoluteMermaidBlock[] {
  const blocks: AbsoluteMermaidBlock[] = [];
  const seen = new Set<string>();

  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== 'FencedCode') {
          return;
        }

        const markdown = state.doc.sliceString(node.from, node.to);
        for (const block of detectMermaidBlocks(markdown)) {
          const from = node.from + block.from;
          const to = node.from + block.to;
          const blockId = `${from}:${to}`;

          if (seen.has(blockId)) {
            continue;
          }

          seen.add(blockId);
          blocks.push({
            ...block,
            blockId,
            contentFrom: node.from + block.contentFrom,
            contentTo: node.from + block.contentTo,
            from,
            to,
          });
        }
      },
    });
  }

  return blocks.sort((left, right) => left.from - right.from);
}

function mermaidPreviewPlugin(options: MermaidPreviewExtensionOptions): Extension {
  const scheduler = options.scheduler ?? getDefaultScheduler();

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly themeObserver: MutationObserver;

      constructor(private readonly view: EditorView) {
        this.decorations = buildMermaidDecorations(view, scheduler, options);
        this.themeObserver = new MutationObserver(() => {
          this.view.dispatch({
            effects: mermaidThemeChangedEffect.of(null),
          });
        });
        this.themeObserver.observe(document.documentElement, {
          attributeFilter: ['data-theme'],
          attributes: true,
        });
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged ||
          update.transactions.some((transaction) =>
            transaction.effects.some((effect) =>
              effect.is(mermaidThemeChangedEffect),
            ),
          )
        ) {
          this.decorations = buildMermaidDecorations(
            update.view,
            scheduler,
            options,
          );
        }
      }

      destroy() {
        this.themeObserver.disconnect();
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function buildMermaidDecorations(
  view: EditorView,
  scheduler: MermaidRenderScheduler,
  options: MermaidPreviewExtensionOptions,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const theme = currentMermaidTheme();

  for (const block of collectMermaidBlocksInRanges(
    view.state,
    view.visibleRanges,
  )) {
    if (selectionIntersectsBlock(view.state, block)) {
      continue;
    }

    builder.add(
      block.to,
      block.to,
      Decoration.widget({
        side: 1,
        widget: new MermaidBlockWidget(block, scheduler, options, theme),
      }),
    );
  }

  return builder.finish();
}

function selectionIntersectsBlock(
  state: EditorState,
  block: AbsoluteMermaidBlock,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= block.from && range.from <= block.to;
    }

    return range.from < block.to && range.to > block.from;
  });
}

class MermaidBlockWidget extends WidgetType {
  private cancelRender: (() => void) | null = null;

  constructor(
    private readonly block: AbsoluteMermaidBlock,
    private readonly scheduler: MermaidRenderScheduler,
    private readonly options: MermaidPreviewExtensionOptions,
    private readonly theme: 'dark' | 'default',
  ) {
    super();
  }

  eq(widget: MermaidBlockWidget): boolean {
    return (
      widget.block.blockId === this.block.blockId &&
      widget.block.content === this.block.content &&
      widget.theme === this.theme &&
      widget.options.mermaidVersion === this.options.mermaidVersion
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('section');
    wrapper.className = 'lm-mermaid-preview';
    wrapper.dataset.status = 'loading';

    const status = document.createElement('div');
    status.className = 'lm-mermaid-status';
    status.textContent = i18n.t('mermaid.loading');
    wrapper.appendChild(status);

    const actions = document.createElement('div');
    actions.className = 'lm-mermaid-actions';
    wrapper.appendChild(actions);

    const svgContainer = document.createElement('div');
    svgContainer.className = 'lm-mermaid-svg';
    wrapper.appendChild(svgContainer);

    this.cancelRender = this.scheduler.request({
      blockId: this.block.blockId,
      config: safeMermaidConfig(this.options.config),
      mermaidVersion: this.options.mermaidVersion ?? DEFAULT_MERMAID_VERSION,
      onError: () => {
        wrapper.classList.add('lm-mermaid-preview-error');
        wrapper.dataset.status = 'error';
        status.className = 'lm-mermaid-error';
        status.textContent = i18n.t('mermaid.renderFailed');
        actions.replaceChildren(createEditSourceButton(view, this.block));
      },
      onLoading: () => {
        wrapper.classList.remove('lm-mermaid-preview-error');
        wrapper.dataset.status = 'loading';
        status.className = 'lm-mermaid-status';
        status.textContent = i18n.t('mermaid.loading');
        actions.replaceChildren();
        svgContainer.replaceChildren();
      },
      onSuccess: ({ svg }) => {
        wrapper.dataset.status = 'success';
        status.textContent = '';
        actions.replaceChildren();
        svgContainer.innerHTML = svg;
      },
      source: this.block.content,
      theme: this.theme,
    }).cancel;

    return wrapper;
  }

  destroy(): void {
    this.cancelRender?.();
    this.cancelRender = null;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function createEditSourceButton(
  view: EditorView,
  block: AbsoluteMermaidBlock,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lm-mermaid-edit-source';
  button.textContent = i18n.t('mermaid.editSource');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    view.dispatch({
      selection: {
        anchor: block.contentFrom,
      },
    });
    view.focus();
  });

  return button;
}

function getDefaultScheduler(): MermaidRenderScheduler {
  defaultScheduler ??= new MermaidRenderScheduler({
    debounceMs: 120,
    render: renderWithMermaid,
  });

  return defaultScheduler;
}

async function renderWithMermaid({
  config,
  source,
  theme,
}: Parameters<MermaidRenderSchedulerOptions['render']>[0]): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  const mermaidTheme = theme === 'dark' ? 'dark' : 'default';
  mermaid.initialize({
    ...safeMermaidConfig(config),
    startOnLoad: false,
    theme: mermaidTheme,
  });
  const result = await mermaid.render(
    `lm-mermaid-${crypto.randomUUID()}`,
    source,
  );

  return result.svg;
}

function safeMermaidConfig(
  config: Record<string, unknown> | undefined,
): SafeMermaidConfig {
  return {
    ...config,
    securityLevel: 'strict',
  };
}

function currentMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'dark'
    ? 'dark'
    : 'default';
}
