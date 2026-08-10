import type { EditorView } from '@codemirror/view';

type ViewStateWithMeasureFlag = {
  mustMeasureContent: boolean | 'refresh';
};

/**
 * Block widgets that change size after mount (image load, mermaid render)
 * must refresh CodeMirror's height map. Viewport-only measure is not enough
 * when the widget is off-screen — force a full refresh like CM does for fonts.
 */
export function syncBlockWidgetHeight(
  view: EditorView,
  dom: HTMLElement,
  previousHeight: number,
): number {
  const height = dom.getBoundingClientRect().height;
  if (height <= 0) {
    return previousHeight;
  }

  if (Math.abs(height - previousHeight) < 0.5) {
    view.requestMeasure();
    return previousHeight;
  }

  const viewState = (
    view as EditorView & {
      viewState: ViewStateWithMeasureFlag;
    }
  ).viewState;
  viewState.mustMeasureContent = 'refresh';
  view.requestMeasure();
  return height;
}
