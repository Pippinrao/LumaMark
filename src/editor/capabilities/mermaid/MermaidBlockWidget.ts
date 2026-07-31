import { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
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
import {
  createMermaidWidgetDom,
  type MermaidWidgetDom,
} from './mermaidWidgetDom';

type MermaidBlockWidgetOptions = {
  config?: Record<string, unknown>;
  mermaidVersion?: string;
};

export class MermaidBlockWidget extends WidgetType {
  private cancelRender: (() => void) | null = null;

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
      widget.editing === this.editing
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const dom: MermaidWidgetDom = createMermaidWidgetDom({
      onDelete: () => {
        this.deleteBlock(view, dom.wrapper);
      },
      onEdit: () => {
        beginMermaidSourceEditing(view, dom.wrapper, this.block);
      },
    });

    if (this.editing) {
      dom.wrapper.classList.add('lm-mermaid-preview-editing');
    }

    this.requestPreviewRender(dom, this.block.content);

    return dom.wrapper;
  }

  destroy(): void {
    this.cancelRender?.();
    this.cancelRender = null;
  }

  ignoreEvent(): boolean {
    return false;
  }

  private requestPreviewRender(
    dom: MermaidWidgetDom,
    source: string,
  ): void {
    this.cancelRender?.();
    this.cancelRender = this.scheduler.request({
      blockId: this.block.blockId,
      config: safeMermaidConfig(this.options.config),
      mermaidVersion: this.options.mermaidVersion ?? this.defaultMermaidVersion,
      onError: () => {
        dom.wrapper.classList.add('lm-mermaid-preview-error');
        dom.wrapper.dataset.status = 'error';
        dom.status.hidden = false;
        dom.status.className = 'lm-mermaid-error';
        dom.status.textContent = i18n.t('mermaid.renderFailed');
      },
      onLoading: () => {
        dom.wrapper.classList.remove('lm-mermaid-preview-error');
        dom.wrapper.dataset.status = 'loading';
        dom.status.hidden = false;
        dom.status.className = 'lm-mermaid-status';
        dom.status.textContent = i18n.t('mermaid.loading');
        dom.svgContainer.replaceChildren();
      },
      onSuccess: ({ svg }) => {
        dom.wrapper.classList.remove('lm-mermaid-preview-error');
        dom.wrapper.dataset.status = 'success';
        dom.status.hidden = true;
        dom.status.textContent = '';
        dom.svgContainer.innerHTML = svg;
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
