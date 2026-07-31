import { EditorSelection, type Extension } from '@codemirror/state';
import { type EditorView, keymap } from '@codemirror/view';
import {
  collectMermaidBlocksInRanges,
  type AbsoluteMermaidBlock,
} from './mermaidBlockDetection';
import {
  activeMermaidBlock,
  setActiveMermaidBlockEffect,
} from './mermaidEditingState';

export function beginMermaidSourceEditing(
  view: EditorView,
  widget: HTMLElement,
  fallbackBlock: AbsoluteMermaidBlock,
): boolean {
  const block = resolveCurrentMermaidBlock(view, widget, fallbackBlock);
  if (!block) {
    return false;
  }

  view.dispatch({
    effects: setActiveMermaidBlockEffect.of({
      from: block.from,
      to: block.to,
    }),
    selection: EditorSelection.range(block.contentFrom, block.contentTo),
  });
  view.focus();

  return true;
}

export function mermaidSourceEditingKeymap(): Extension {
  return keymap.of([
    {
      key: 'Escape',
      run(view) {
        if (!activeMermaidBlock(view.state)) {
          return false;
        }

        view.dispatch({
          effects: setActiveMermaidBlockEffect.of(null),
        });
        view.focus();
        return true;
      },
    },
  ]);
}

export function resolveCurrentMermaidBlock(
  view: EditorView,
  widget: HTMLElement,
  fallbackBlock: AbsoluteMermaidBlock,
): AbsoluteMermaidBlock | null {
  if (view.dom.contains(widget)) {
    const widgetPosition = view.posAtDOM(widget);
    const nearbyMatch = collectMermaidBlocksInRanges(
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

  const active = activeMermaidBlock(view.state);

  if (active) {
    const activeMatch = collectMermaidBlocksInRanges(
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

  return collectMermaidBlocksInRanges(
    view.state,
    [{ from: fallbackFrom, to: fallbackTo }],
  ).find(
    (block) => block.from <= fallbackTo && block.to >= fallbackFrom,
  ) ?? null;
}
