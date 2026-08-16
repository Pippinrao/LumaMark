import { EditorSelection, type Extension } from '@codemirror/state';
import { type EditorView, keymap } from '@codemirror/view';
import { isEditorRenderLocked } from '../../core/editorRenderLock';
import { announceReadOnlyEditAttempt } from '../../core/readOnlyEditAttempt';
import {
  collectPlantumlBlocksInRanges,
  type AbsolutePlantumlBlock,
} from './plantumlBlockDetection';
import {
  activePlantumlBlock,
  setActivePlantumlBlockEffect,
} from './plantumlEditingState';

export function beginPlantumlSourceEditing(
  view: EditorView,
  widget: HTMLElement,
  fallbackBlock: AbsolutePlantumlBlock,
): boolean {
  if (isEditorRenderLocked(view.state)) {
    announceReadOnlyEditAttempt(view);
    return false;
  }

  const block = resolveCurrentPlantumlBlock(view, widget, fallbackBlock);
  if (!block) {
    return false;
  }

  view.dispatch({
    effects: setActivePlantumlBlockEffect.of({
      from: block.from,
      to: block.to,
    }),
    selection: EditorSelection.range(block.contentFrom, block.contentTo),
  });
  view.focus();

  return true;
}

export function plantumlSourceEditingKeymap(): Extension {
  return keymap.of([
    {
      key: 'Escape',
      run(view) {
        if (!activePlantumlBlock(view.state)) {
          return false;
        }

        view.dispatch({
          effects: setActivePlantumlBlockEffect.of(null),
        });
        view.focus();
        return true;
      },
    },
  ]);
}

export function resolveCurrentPlantumlBlock(
  view: EditorView,
  widget: HTMLElement,
  fallbackBlock: AbsolutePlantumlBlock,
): AbsolutePlantumlBlock | null {
  if (view.dom.contains(widget)) {
    const widgetPosition = view.posAtDOM(widget);
    const nearbyMatch = collectPlantumlBlocksInRanges(
      view.state,
      [{
        from: Math.max(0, widgetPosition - 1),
        to: Math.min(view.state.doc.length, widgetPosition + 1),
      }],
    ).find(
      (block) => block.from <= widgetPosition && block.to >= widgetPosition,
    );

    if (nearbyMatch) {
      return nearbyMatch;
    }
  }

  const active = activePlantumlBlock(view.state);

  if (active) {
    const activeMatch = collectPlantumlBlocksInRanges(
      view.state,
      [{ from: active.from, to: active.to }],
    ).find((block) => block.from <= active.to && block.to >= active.from);

    if (activeMatch) {
      return activeMatch;
    }
  }

  const fallbackFrom = Math.max(0, Math.min(
    fallbackBlock.from,
    view.state.doc.length,
  ));
  const fallbackTo = Math.max(fallbackFrom, Math.min(
    fallbackBlock.to,
    view.state.doc.length,
  ));

  return collectPlantumlBlocksInRanges(
    view.state,
    [{ from: fallbackFrom, to: fallbackTo }],
  ).find(
    (block) => block.from <= fallbackTo && block.to >= fallbackFrom,
  ) ?? null;
}
