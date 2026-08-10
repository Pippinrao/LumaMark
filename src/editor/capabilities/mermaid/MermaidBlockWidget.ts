import { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import type { AbsoluteMermaidBlock } from './mermaidBlockDetection';
import {
  setActiveMermaidBlockEffect,
} from './mermaidEditingState';
import {
  beginMermaidSourceEditing,
  resolveCurrentMermaidBlock,
} from './mermaidInlineEditor';
import type { MermaidRenderScheduler } from './mermaidRenderScheduler';
import { safeMermaidConfig } from './mermaidRenderAdapter';
import { getMediaPreviewButtonLabel } from '../mediaPreviewButton';
import { syncBlockWidgetHeight } from '../blockWidgetGeometry';
import {
  createMermaidWidgetDom,
  type MermaidWidgetDom,
} from './mermaidWidgetDom';

type MermaidBlockWidgetOptions = {
  config?: Record<string, unknown>;
  mermaidVersion?: string;
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
};

const MERMAID_LOADING_HEIGHT_ESTIMATE = 48;

export class MermaidBlockWidget extends WidgetType {
  private cancelRender: (() => void) | null = null;
  private measuredHeight = MERMAID_LOADING_HEIGHT_ESTIMATE;
  private renderedSvg: string | null = null;

  constructor(
    private readonly block: AbsoluteMermaidBlock,
    private readonly scheduler: MermaidRenderScheduler,
    private readonly options: MermaidBlockWidgetOptions,
    private readonly theme: 'dark' | 'default',
    private readonly defaultMermaidVersion: string,
    private readonly editing = false,
  ) {
    super();
  }

  eq(widget: MermaidBlockWidget): boolean {
    return (
      widget.block.blockId === this.block.blockId &&
      widget.block.content === this.block.content &&
      widget.theme === this.theme &&
      widget.options.mermaidVersion === this.options.mermaidVersion &&
      widget.options.onMediaPreviewRequest === this.options.onMediaPreviewRequest &&
      widget.editing === this.editing
    );
  }

  get estimatedHeight(): number {
    return this.measuredHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const dom: MermaidWidgetDom = createMermaidWidgetDom({
      expandLabel: getMediaPreviewButtonLabel(view.state),
      onDelete: () => {
        this.deleteBlock(view, dom.wrapper);
      },
      onEdit: () => {
        beginMermaidSourceEditing(view, dom.wrapper, this.block);
      },
      onExpand: this.options.onMediaPreviewRequest
        ? () => {
            if (this.renderedSvg !== null) {
              this.options.onMediaPreviewRequest?.({
                kind: 'mermaid',
                svg: this.renderedSvg,
              });
            }
          }
        : undefined,
    });

    if (this.editing) {
      dom.wrapper.classList.add('lm-mermaid-preview-editing');
    }

    this.requestPreviewRender(view, dom, this.block.content);
    queueMicrotask(() => {
      this.measuredHeight = syncBlockWidgetHeight(
        view,
        dom.wrapper,
        this.measuredHeight,
      );
    });

    return dom.wrapper;
  }

  destroy(): void {
    this.cancelRender?.();
    this.cancelRender = null;
    this.renderedSvg = null;
  }

  ignoreEvent(): boolean {
    return false;
  }

  private requestPreviewRender(
    view: EditorView,
    dom: MermaidWidgetDom,
    source: string,
  ): void {
    this.cancelRender?.();
    this.cancelRender = this.scheduler.request({
      blockId: this.block.blockId,
      config: safeMermaidConfig(this.options.config),
      mermaidVersion: this.options.mermaidVersion ?? this.defaultMermaidVersion,
      onError: () => {
        dom.expand?.setAttribute('hidden', '');
        dom.wrapper.classList.add('lm-mermaid-preview-error');
        dom.wrapper.dataset.status = 'error';
        dom.status.hidden = false;
        dom.status.className = 'lm-mermaid-error';
        dom.status.textContent = i18n.t('mermaid.renderFailed');
        this.measuredHeight = syncBlockWidgetHeight(
          view,
          dom.wrapper,
          this.measuredHeight,
        );
      },
      onLoading: () => {
        this.renderedSvg = null;
        dom.expand?.setAttribute('hidden', '');
        dom.wrapper.classList.remove('lm-mermaid-preview-error');
        dom.wrapper.dataset.status = 'loading';
        dom.status.hidden = false;
        dom.status.className = 'lm-mermaid-status';
        dom.status.textContent = i18n.t('mermaid.loading');
        dom.svgContainer.replaceChildren();
        this.measuredHeight = syncBlockWidgetHeight(
          view,
          dom.wrapper,
          this.measuredHeight,
        );
      },
      onSuccess: ({ svg }) => {
        this.renderedSvg = svg;
        dom.expand?.removeAttribute('hidden');
        dom.wrapper.classList.remove('lm-mermaid-preview-error');
        dom.wrapper.dataset.status = 'success';
        dom.status.hidden = true;
        dom.status.textContent = '';
        dom.svgContainer.innerHTML = svg;
        this.measuredHeight = syncBlockWidgetHeight(
          view,
          dom.wrapper,
          this.measuredHeight,
        );
      },
      source,
      theme: this.theme,
    }).cancel;
  }

  private deleteBlock(view: EditorView, widget: HTMLElement): void {
    const block = resolveCurrentMermaidBlock(view, widget, this.block);
    if (!block) {
      return;
    }

    const range = deletionRangeForBlock(view.state, block);
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
      },
      effects: setActiveMermaidBlockEffect.of(null),
      userEvent: 'delete.mermaid',
    });
    view.focus();
  }
}

function deletionRangeForBlock(
  state: EditorState,
  block: AbsoluteMermaidBlock,
): { from: number; to: number } {
  const before = block.from > 0
    ? state.doc.sliceString(block.from - 1, block.from)
    : '';
  const after = block.to < state.doc.length
    ? state.doc.sliceString(block.to, block.to + 1)
    : '';

  if (before === '\n') {
    return { from: block.from - 1, to: block.to };
  }

  if (after === '\n') {
    return { from: block.from, to: block.to + 1 };
  }

  return { from: block.from, to: block.to };
}
