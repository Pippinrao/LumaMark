import type { Locator } from '@playwright/test';

export type RootEditorViewTestBridge = {
  coordsAtPos(position: number, side?: number): DOMRect | null;
  posAtCoords(
    coords: { x: number; y: number },
    precise?: boolean,
  ): number | null;
  dispatch(spec: {
    scrollIntoView?: boolean;
    selection: { anchor: number; head?: number };
  }): void;
  focus(): void;
  scrollDOM: HTMLElement;
  state: {
    doc: {
      sliceString(from: number, to?: number): string;
      toString(): string;
    };
    selection: {
      main: { anchor: number; from: number; head: number; to: number };
    };
  };
};

export type RootEditorContentTestBridge = HTMLElement & {
  readRootEditorHistoryDepthForTest(): { redo: number; undo: number };
  resolveRootEditorViewForTest(): RootEditorViewTestBridge;
};

export async function installRootEditorViewTestBridge(
  editor: Locator,
): Promise<void> {
  await editor.evaluate((content) => {
    const tile = (content as HTMLElement & { cmTile?: unknown }).cmTile;

    if (!tile || typeof tile !== 'object' || !('root' in tile)) {
      throw new Error('CodeMirror root tile is unavailable.');
    }

    const root = tile.root;
    if (!root || typeof root !== 'object' || !('view' in root)) {
      throw new Error('CodeMirror root view is unavailable.');
    }

    const view = root.view;
    if (
      !view ||
      typeof view !== 'object' ||
      !('coordsAtPos' in view) ||
      typeof view.coordsAtPos !== 'function' ||
      !('posAtCoords' in view) ||
      typeof view.posAtCoords !== 'function' ||
      !('dispatch' in view) ||
      typeof view.dispatch !== 'function' ||
      !('focus' in view) ||
      typeof view.focus !== 'function' ||
      !('scrollDOM' in view) ||
      !(view.scrollDOM instanceof HTMLElement) ||
      !('state' in view) ||
      !view.state ||
      typeof view.state !== 'object' ||
      !('doc' in view.state) ||
      !view.state.doc ||
      typeof view.state.doc !== 'object' ||
      !('sliceString' in view.state.doc) ||
      typeof view.state.doc.sliceString !== 'function' ||
      !('toString' in view.state.doc) ||
      typeof view.state.doc.toString !== 'function' ||
      !('selection' in view.state) ||
      !view.state.selection ||
      typeof view.state.selection !== 'object' ||
      !('main' in view.state.selection)
    ) {
      throw new Error('CodeMirror root view does not match the E2E contract.');
    }

    Object.defineProperty(content, 'resolveRootEditorViewForTest', {
      configurable: true,
      value: () => view,
    });
  });
}

export async function installRootEditorHistoryTestBridge(
  editor: Locator,
): Promise<void> {
  await editor.evaluate(async (content) => {
    const modulePath = '/tests/e2e/support/rootEditorHistoryBrowserBridge.ts';
    const historyBridge = await import(/* @vite-ignore */ modulePath) as {
      installRootEditorHistoryBrowserBridge(target: HTMLElement): void;
    };

    historyBridge.installRootEditorHistoryBrowserBridge(content as HTMLElement);
  });
}

export async function readRootEditorHistoryDepth(
  editor: Locator,
): Promise<{ redo: number; undo: number }> {
  return editor.evaluate((content) => {
    const bridge = content as RootEditorContentTestBridge;
    if (typeof bridge.readRootEditorHistoryDepthForTest !== 'function') {
      throw new Error('CodeMirror history test bridge is unavailable.');
    }
    return bridge.readRootEditorHistoryDepthForTest();
  });
}
