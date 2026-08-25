import { ViewPlugin, type EditorView } from '@codemirror/view';
import { requestEditorContentMeasure } from '../capabilities/blockWidgetGeometry';

export const EDITOR_BLOCK_TRACK_WIDTH_VAR = '--lm-editor-block-track-width';
export const EDITOR_DESKTOP_GUTTER_PX = 96;
export const EDITOR_MOBILE_GUTTER_PX = 36;
export const EDITOR_MOBILE_MAX_WIDTH_PX = 720;

export function editorContentGutterPx(viewportWidth: number): number {
  return viewportWidth <= EDITOR_MOBILE_MAX_WIDTH_PX
    ? EDITOR_MOBILE_GUTTER_PX
    : EDITOR_DESKTOP_GUTTER_PX;
}

export function quantizedBlockTrackWidth(
  scrollClientWidth: number,
  gutterPx: number,
): number {
  if (!Number.isFinite(scrollClientWidth) || !Number.isFinite(gutterPx)) {
    return 0;
  }

  return Math.max(0, Math.round(scrollClientWidth - gutterPx));
}

export function shouldPublishBlockTrackWidth(
  previous: number | null,
  next: number,
): boolean {
  return previous !== next;
}

export function publishBlockTrackWidth(
  target: HTMLElement,
  widthPx: number,
): void {
  target.style.setProperty(EDITOR_BLOCK_TRACK_WIDTH_VAR, `${widthPx}px`);
}

function viewportWidthFor(view: EditorView): number {
  return view.dom.ownerDocument.defaultView?.innerWidth ?? EDITOR_MOBILE_MAX_WIDTH_PX + 1;
}

export type SyncEditorAvailableWidthOptions = {
  refreshHeightMap?: boolean;
};

export function syncEditorAvailableWidth(
  view: EditorView,
  previousWidth: number | null,
  options: SyncEditorAvailableWidthOptions = {},
): number | null {
  const nextWidth = quantizedBlockTrackWidth(
    view.scrollDOM.clientWidth,
    editorContentGutterPx(viewportWidthFor(view)),
  );

  if (nextWidth <= 0) {
    return previousWidth;
  }

  if (!shouldPublishBlockTrackWidth(previousWidth, nextWidth)) {
    return previousWidth;
  }

  publishBlockTrackWidth(view.dom, nextWidth);
  if (options.refreshHeightMap !== false) {
    requestEditorContentMeasure(view);
  }
  return nextWidth;
}

export const editorAvailableWidthExtension = ViewPlugin.fromClass(
  class EditorAvailableWidthPlugin {
    private frame: number | null = null;
    private previousWidth: number | null = null;
    private readonly observer: ResizeObserver | null;

    constructor(private readonly view: EditorView) {
      this.previousWidth = syncEditorAvailableWidth(view, null, {
        refreshHeightMap: false,
      });
      this.observer = typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            this.scheduleSync();
          });
      this.observer?.observe(view.scrollDOM);
    }

    destroy(): void {
      const win = this.view.dom.ownerDocument.defaultView;
      if (this.frame !== null && win) {
        win.cancelAnimationFrame(this.frame);
        this.frame = null;
      }
      this.observer?.disconnect();
    }

    private scheduleSync(): void {
      if (this.frame !== null) {
        return;
      }

      const win = this.view.dom.ownerDocument.defaultView;
      if (!win) {
        this.previousWidth = syncEditorAvailableWidth(
          this.view,
          this.previousWidth,
        );
        return;
      }

      this.frame = win.requestAnimationFrame(() => {
        this.frame = null;
        this.previousWidth = syncEditorAvailableWidth(
          this.view,
          this.previousWidth,
        );
      });
    }
  },
);
