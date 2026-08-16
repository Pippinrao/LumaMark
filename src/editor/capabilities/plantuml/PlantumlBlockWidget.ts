import { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import type { EditorMediaPreviewRequestHandler } from '../../core/editorEvents';
import { isEditorRenderLocked } from '../../core/editorRenderLock';
import { announceReadOnlyEditAttempt } from '../../core/readOnlyEditAttempt';
import type { AbsolutePlantumlBlock } from './plantumlBlockDetection';
import { isPlantumlSyntaxErrorSvg } from './plantumlErrorSvg';
import {
  setActivePlantumlBlockEffect,
} from './plantumlEditingState';
import {
  beginPlantumlSourceEditing,
  resolveCurrentPlantumlBlock,
} from './plantumlInlineEditor';
import type { PlantumlRenderScheduler } from './plantumlRenderScheduler';
import { getMediaPreviewButtonLabel } from '../mediaPreviewButton';
import {
  BlockWidgetGeometryCache,
  BlockWidgetGeometryTracker,
  blockWidgetGeometryKey,
} from '../blockWidgetGeometry';
import {
  createPlantumlWidgetDom,
  type PlantumlWidgetDom,
} from './plantumlWidgetDom';

type PlantumlBlockWidgetOptions = {
  onMediaPreviewRequest?: EditorMediaPreviewRequestHandler;
};

const PLANTUML_LOADING_HEIGHT_ESTIMATE = 48;

export class PlantumlBlockWidget extends WidgetType {
  private cancelRender: (() => void) | null = null;
  private readonly geometry: BlockWidgetGeometryTracker;
  private renderedSvg: string | null = null;

  constructor(
    private readonly block: AbsolutePlantumlBlock,
    private readonly scheduler: PlantumlRenderScheduler,
    private readonly options: PlantumlBlockWidgetOptions,
    private readonly theme: 'dark' | 'default',
    private readonly editing = false,
    geometryCache = new BlockWidgetGeometryCache(),
    geometryKey = plantumlBlockGeometryKey(block),
    private readonly sourceControlsEnabled = true,
  ) {
    super();
    this.geometry = new BlockWidgetGeometryTracker(
      geometryCache,
      geometryKey,
      PLANTUML_LOADING_HEIGHT_ESTIMATE,
    );
  }

  eq(widget: PlantumlBlockWidget): boolean {
    return (
      widget.block.blockId === this.block.blockId &&
      widget.block.content === this.block.content &&
      widget.options.onMediaPreviewRequest === this.options.onMediaPreviewRequest &&
      widget.theme === this.theme &&
      widget.editing === this.editing &&
      widget.sourceControlsEnabled === this.sourceControlsEnabled
    );
  }

  get estimatedHeight(): number {
    return this.geometry.estimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const dom: PlantumlWidgetDom = createPlantumlWidgetDom({
      expandLabel: getMediaPreviewButtonLabel(view.state),
      onDelete: this.sourceControlsEnabled
        ? () => {
            this.deleteBlock(view, dom.wrapper);
          }
        : undefined,
      onEdit: this.sourceControlsEnabled
        ? () => {
            beginPlantumlSourceEditing(view, dom.wrapper, this.block);
          }
        : undefined,
      onExpand: this.options.onMediaPreviewRequest
        ? () => {
            if (this.renderedSvg !== null) {
              this.options.onMediaPreviewRequest?.({
                kind: 'plantuml',
                svg: this.renderedSvg,
              });
            }
          }
        : undefined,
    });

    if (this.editing) {
      dom.wrapper.classList.add('lm-plantuml-preview-editing');
    }

    this.geometry.mount(view, dom.wrapper);
    this.requestPreviewRender(view, dom, this.block.content);

    return dom.wrapper;
  }

  destroy(dom: HTMLElement): void {
    this.geometry.unmount(dom);
    this.cancelRender?.();
    this.cancelRender = null;
    this.renderedSvg = null;
  }

  // Pointer events stay on the widget so clicking the diagram cannot remap the caret onto the hidden fence.
  ignoreEvent(): boolean {
    return true;
  }

  private requestPreviewRender(
    view: EditorView,
    dom: PlantumlWidgetDom,
    source: string,
  ): void {
    this.cancelRender?.();
    this.cancelRender = this.scheduler.request({
      blockId: this.block.blockId,
      dark: this.theme === 'dark',
      jobOwner: this,
      onError: () => {
        dom.expand?.setAttribute('hidden', '');
        dom.wrapper.classList.add('lm-plantuml-preview-error');
        dom.wrapper.dataset.status = 'error';
        dom.status.hidden = false;
        dom.status.className = 'lm-plantuml-error';
        dom.status.textContent = i18n.t('plantuml.renderFailed');
        this.geometry.sync();
      },
      onLoading: () => {
        this.renderedSvg = null;
        dom.expand?.setAttribute('hidden', '');
        dom.wrapper.classList.remove('lm-plantuml-preview-error');
        dom.wrapper.dataset.status = 'loading';
        dom.status.hidden = false;
        dom.status.className = 'lm-plantuml-status';
        dom.status.textContent = i18n.t('plantuml.loading');
        dom.svgContainer.replaceChildren();
        this.geometry.sync();
      },
      onSuccess: ({ svg }) => {
        this.renderedSvg = svg;
        const syntaxError = isPlantumlSyntaxErrorSvg(svg);
        if (syntaxError) {
          dom.expand?.setAttribute('hidden', '');
          dom.wrapper.classList.add('lm-plantuml-preview-error');
          dom.wrapper.dataset.status = 'error';
          dom.status.hidden = false;
          dom.status.className = 'lm-plantuml-error';
          dom.status.textContent = i18n.t('plantuml.renderFailed');
        } else {
          dom.expand?.removeAttribute('hidden');
          dom.wrapper.classList.remove('lm-plantuml-preview-error');
          dom.wrapper.dataset.status = 'success';
          dom.status.hidden = true;
          dom.status.textContent = '';
        }
        dom.svgContainer.innerHTML = svg;
        this.geometry.sync();
      },
      source,
    }).cancel;
  }

  private deleteBlock(view: EditorView, widget: HTMLElement): void {
    if (isEditorRenderLocked(view.state)) {
      announceReadOnlyEditAttempt(view);
      return;
    }
    const block = resolveCurrentPlantumlBlock(view, widget, this.block);
    if (!block) {
      return;
    }

    const range = deletionRangeForBlock(view.state, block);
    view.dispatch({
      changes: {
        from: range.from,
        to: range.to,
      },
      effects: setActivePlantumlBlockEffect.of(null),
      userEvent: 'delete.plantuml',
    });
    view.focus();
  }
}

export function plantumlBlockGeometryKey(block: AbsolutePlantumlBlock): string {
  return blockWidgetGeometryKey('plantuml', [block.content]);
}

function deletionRangeForBlock(
  state: EditorState,
  block: AbsolutePlantumlBlock,
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
