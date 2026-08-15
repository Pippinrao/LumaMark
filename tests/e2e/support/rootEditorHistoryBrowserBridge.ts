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

export function installRootEditorHistoryBrowserBridge(
  content: HTMLElement,
): void {
  const bridge = content as RootEditorHistoryContentBridge;
  const view = bridge.resolveRootEditorViewForTest();
  const probeExtensions: Extension[] = [
    invertedEffects.of((transaction) => transaction.effects),
  ];

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
