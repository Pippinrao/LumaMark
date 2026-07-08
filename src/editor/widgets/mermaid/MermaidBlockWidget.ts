import { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import type { MermaidRenderScheduler } from './mermaidRenderScheduler';
import type { AbsoluteMermaidBlock } from './mermaidBlockDetection';
import {
  forgetEditingMermaidBlock,
  isEditingMermaidBlock,
  rememberEditingMermaidBlock,
} from './mermaidEditingState';
import { createMermaidInlineEditor } from './mermaidInlineEditor';
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
  private inlineEditor: EditorView | null = null;
  private parentView: EditorView | null = null;
  private pendingContent: string | null = null;

  constructor(
    private readonly block: AbsoluteMermaidBlock,
    private readonly scheduler: MermaidRenderScheduler,
    private readonly options: MermaidBlockWidgetOptions,
    private readonly theme: 'dark' | 'default',
    private readonly defaultMermaidVersion: string,
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
    const dom = createMermaidWidgetDom({
      onDelete: () => {
        this.deleteBlock(view);
      },
      onEdit: () => {
        rememberEditingMermaidBlock(this.block.from);
        this.openInlineEditor(view, dom, { focus: true });
      },
    });

    dom.wrapper.addEventListener('focusout', (event) => {
      const nextTarget = event.relatedTarget;

      window.setTimeout(() => {
        if (nextTarget instanceof Node) {
          if (dom.wrapper.contains(nextTarget)) {
            return;
          }
        } else if (dom.wrapper.contains(document.activeElement)) {
          return;
        }

        if (dom.wrapper.dataset.status === 'error') {
          return;
        }

        this.closeInlineEditor(dom);
      }, 0);
    });

    this.requestPreviewRender(view, dom, this.block.content);

    if (isEditingMermaidBlock(this.block.from)) {
      window.setTimeout(() => {
        this.openInlineEditor(view, dom, { focus: true });
      }, 0);
    }

    return dom.wrapper;
  }

  destroy(): void {
    this.flushPendingContent({ defer: true });
    this.cancelRender?.();
    this.cancelRender = null;
    this.inlineEditor?.destroy();
    this.inlineEditor = null;
    this.parentView = null;
  }

  ignoreEvent(event: Event): boolean {
    return (
      event.target instanceof Element &&
      event.target.closest('.lm-mermaid-editor') !== null
    );
  }

  private openInlineEditor(
    parentView: EditorView,
    dom: MermaidWidgetDom,
    options: { focus: boolean },
  ): void {
    if (this.inlineEditor) {
      if (options.focus) {
        this.inlineEditor.focus();
      }
      return;
    }

    dom.editorHost.hidden = false;
    dom.wrapper.classList.add('lm-mermaid-preview-editing');
    this.parentView = parentView;
    this.inlineEditor = createMermaidInlineEditor({
      doc: this.block.content,
      onChange: (content) => {
        this.queueContentUpdate(parentView, dom, content);
      },
      onEscape: () => {
        this.closeInlineEditor(dom);
        parentView.focus();
      },
      onFocusIn: () => {
        rememberEditingMermaidBlock(this.block.from);
      },
      parent: dom.editorHost,
    });
    if (options.focus) {
      this.inlineEditor.focus();
    }
  }

  private closeInlineEditor(dom: MermaidWidgetDom): void {
    if (!this.inlineEditor) {
      return;
    }

    const editor = this.inlineEditor;
    forgetEditingMermaidBlock(this.block.from);
    this.inlineEditor = null;
    this.flushPendingContent();
    editor.destroy();
    dom.editorHost.hidden = true;
    dom.wrapper.classList.remove('lm-mermaid-preview-editing');
  }

  private queueContentUpdate(
    parentView: EditorView,
    dom: MermaidWidgetDom,
    content: string,
  ): void {
    this.parentView = parentView;
    this.pendingContent = content;
    this.requestPreviewRender(parentView, dom, content);
  }

  private requestPreviewRender(
    parentView: EditorView,
    dom: MermaidWidgetDom,
    source: string,
  ): void {
    this.cancelRender?.();
    this.cancelRender = this.scheduler.request({
      blockId: this.block.blockId,
      config: safeMermaidConfig(this.options.config),
      mermaidVersion: this.options.mermaidVersion ?? this.defaultMermaidVersion,
      onError: () => {
        this.withInlineSelectionPreserved(() => {
          dom.wrapper.classList.add('lm-mermaid-preview-error');
          dom.wrapper.dataset.status = 'error';
          dom.status.hidden = false;
          dom.status.className = 'lm-mermaid-error';
          dom.status.textContent = i18n.t('mermaid.renderFailed');
          this.openInlineEditor(parentView, dom, { focus: false });
        });
      },
      onLoading: () => {
        this.withInlineSelectionPreserved(() => {
          dom.wrapper.classList.remove('lm-mermaid-preview-error');
          dom.wrapper.dataset.status = 'loading';
          dom.status.hidden = false;
          dom.status.className = 'lm-mermaid-status';
          dom.status.textContent = i18n.t('mermaid.loading');
          dom.svgContainer.replaceChildren();
        });
      },
      onSuccess: ({ svg }) => {
        this.withInlineSelectionPreserved(() => {
          dom.wrapper.classList.remove('lm-mermaid-preview-error');
          dom.wrapper.dataset.status = 'success';
          dom.status.hidden = true;
          dom.status.textContent = '';
          dom.svgContainer.innerHTML = svg;
        });
      },
      source,
      theme: this.theme,
    }).cancel;
  }

  private withInlineSelectionPreserved(updatePreview: () => void): void {
    const editor = this.inlineEditor;
    const selection = editor?.state.selection;
    const hadEditorFocus = editor
      ? editor.dom.contains(document.activeElement)
      : false;

    updatePreview();

    if (
      !editor ||
      this.inlineEditor !== editor ||
      !selection ||
      !hadEditorFocus
    ) {
      return;
    }

    if (!editor.state.selection.eq(selection)) {
      editor.dispatch({ selection });
    }

    if (!editor.composing) {
      editor.focus();
    }
  }

  private flushPendingContent(options: { defer?: boolean } = {}): void {
    if (this.pendingContent === null || !this.parentView) {
      return;
    }

    const content = this.pendingContent;
    const parentView = this.parentView;
    this.pendingContent = null;
    if (options.defer) {
      queueMicrotask(() => {
        replaceMermaidContent(parentView, this.block, content);
      });
      return;
    }

    replaceMermaidContent(parentView, this.block, content);
  }

  private deleteBlock(view: EditorView): void {
    forgetEditingMermaidBlock(this.block.from);
    const range = deletionRangeForBlock(view.state, this.block);
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
      },
      userEvent: 'delete.mermaid',
    });
    view.focus();
  }
}

function replaceMermaidContent(
  view: EditorView,
  block: AbsoluteMermaidBlock,
  content: string,
): void {
  view.dispatch({
    changes: {
      from: block.contentFrom,
      insert: content,
      to: block.contentTo,
    },
    userEvent: 'input.mermaid',
  });
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
