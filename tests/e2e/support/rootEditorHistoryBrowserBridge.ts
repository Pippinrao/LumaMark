import {
  history,
  historyField,
  invertedEffects,
  redoDepth,
  undoDepth,
} from '@codemirror/commands';
import {
  type Extension,
  StateEffect,
  Transaction,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

type RootEditorHistoryContentBridge = HTMLElement & {
  readRootEditorHistoryDepthForTest?: () => { redo: number; undo: number };
  resolveRootEditorViewForTest: () => EditorView;
};

const historyEffectProbeMarker = StateEffect.define<null>();

export const historyEffectProbeExtension: Extension = invertedEffects.of(
  (transaction) => transaction.effects.length > 0
    ? [historyEffectProbeMarker.of(null)]
    : [],
);

export function installRootEditorHistoryBrowserBridge(
  content: HTMLElement,
): void {
  const bridge = content as RootEditorHistoryContentBridge;
  const view = bridge.resolveRootEditorViewForTest();
  const probeExtensions: Extension[] = [historyEffectProbeExtension];

  if (!view.state.field(historyField, false)) {
    probeExtensions.unshift(history());
  }

  view.dispatch({
    annotations: Transaction.addToHistory.of(false),
    effects: StateEffect.appendConfig.of(probeExtensions),
  });

  Object.defineProperty(content, 'readRootEditorHistoryDepthForTest', {
    configurable: true,
    value: () => ({
      redo: redoDepth(view.state),
      undo: undoDepth(view.state),
    }),
  });
}
