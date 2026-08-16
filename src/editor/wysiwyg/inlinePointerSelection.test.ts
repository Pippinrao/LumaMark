import {
  history,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import {
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyEffectProbeExtension } from '../../../tests/e2e/support/rootEditorHistoryBrowserBridge';
import { markdownLanguage } from '../markdown/markdownLanguage';
import {
  inlinePointerOwnerFromEvent,
  inlinePointerPosition,
  resolveInlinePointerOwner,
} from './inlinePointerSelection';
import { markdownWysiwygExtension } from './markdownDecorations';

describe('inline pointer selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the innermost owner from the pointer target', () => {
    const outer = document.createElement('span');
    outer.dataset.lmInlineOwnerFrom = '1';
    outer.dataset.lmInlineOwnerTo = '12';
    const inner = document.createElement('span');
    inner.dataset.lmInlineOwnerFrom = '3';
    inner.dataset.lmInlineOwnerTo = '9';
    outer.appendChild(inner);

    let owner: ReturnType<typeof inlinePointerOwnerFromEvent> = null;
    outer.addEventListener('mousedown', (event) => {
      owner = inlinePointerOwnerFromEvent(event);
    });
    inner.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(owner).toEqual({ element: inner, from: 3, to: 9 });
  });

  it('maps the browser-native caret hit to the inline source position', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = 'before `alphaBeta` after';
    const from = source.indexOf('`');
    const to = source.lastIndexOf('`') + 1;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });
    const caretPositionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint',
    );

    try {
      const owner = parent.querySelector<HTMLElement>('.lm-md-inline-code');
      const textNode = [...(owner?.childNodes ?? [])].find(
        (node) => node.nodeValue === 'alphaBeta',
      );
      expect(textNode).toBeTruthy();
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({
          getClientRect: () => new DOMRect(),
          offset: 4,
          offsetNode: textNode!,
        })),
      });

      expect(
        inlinePointerPosition(
          view,
          { from, to },
          { x: 100, y: 20 },
        ),
      ).toBe(source.indexOf('alphaBeta') + 4);
    } finally {
      if (caretPositionDescriptor) {
        Object.defineProperty(
          document,
          'caretPositionFromPoint',
          caretPositionDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, 'caretPositionFromPoint');
      }
      view.destroy();
      parent.remove();
    }
  });

  it.each([
    { devicePixelRatio: 1, jitter: 1 },
    { devicePixelRatio: 1.25, jitter: 2 },
    { devicePixelRatio: 1.5, jitter: 3 },
    { devicePixelRatio: 2, jitter: 4 },
  ])(
    'preserves browser-classified double-click intent across $jitter CSS px at DPR $devicePixelRatio',
    async ({ devicePixelRatio, jitter }) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const source = 'before `alphaBeta` after';
      const contentFrom = source.indexOf('alphaBeta');
      const devicePixelRatioDescriptor = Object.getOwnPropertyDescriptor(
        window,
        'devicePixelRatio',
      );
      const caretPositionDescriptor = Object.getOwnPropertyDescriptor(
        document,
        'caretPositionFromPoint',
      );
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: source,
          extensions: [markdownLanguage(), markdownWysiwygExtension()],
          selection: { anchor: 1 },
        }),
      });

      try {
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          value: devicePixelRatio,
        });
        const textNode = [...parent.querySelector('.lm-md-inline-code')!.childNodes]
          .find((node) => node.nodeValue === 'alphaBeta');
        expect(textNode).toBeTruthy();
        Object.defineProperty(document, 'caretPositionFromPoint', {
          configurable: true,
          value: vi.fn(() => ({
            getClientRect: () => new DOMRect(),
            offset: 4,
            offsetNode: textNode!,
          })),
        });

        dispatchMouseGesture(parent, 100, 20, 1);
        await Promise.resolve();
        dispatchMouseGesture(parent, 100 + jitter, 20, 2);
        await Promise.resolve();

        expect(view.state.selection.main.from).toBe(contentFrom);
        expect(view.state.selection.main.to).toBe(contentFrom + 'alphaBeta'.length);
        expect(
          view.state.doc.sliceString(
            view.state.selection.main.from,
            view.state.selection.main.to,
          ),
        ).toBe('alphaBeta');
      } finally {
        restoreProperty(window, 'devicePixelRatio', devicePixelRatioDescriptor);
        restoreProperty(
          document,
          'caretPositionFromPoint',
          caretPositionDescriptor,
        );
        view.destroy();
        parent.remove();
      }
    },
  );

  it('keeps pointer settlement selection and effects outside undo history', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = 'before `alphaBeta` after';
    const caretPositionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint',
    );
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          history(),
          historyEffectProbeExtension,
          markdownLanguage(),
          markdownWysiwygExtension(),
        ],
        selection: { anchor: 1 },
      }),
    });

    try {
      const textNode = [...parent.querySelector('.lm-md-inline-code')!.childNodes]
        .find((node) => node.nodeValue === 'alphaBeta');
      expect(textNode).toBeTruthy();
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({
          getClientRect: () => new DOMRect(),
          offset: 4,
          offsetNode: textNode!,
        })),
      });
      const before = {
        redo: redoDepth(view.state),
        undo: undoDepth(view.state),
      };

      dispatchMouseGesture(parent, 100, 20, 1);
      await Promise.resolve();

      expect({
        redo: redoDepth(view.state),
        undo: undoDepth(view.state),
      }).toEqual(before);
    } finally {
      restoreProperty(
        document,
        'caretPositionFromPoint',
        caretPositionDescriptor,
      );
      view.destroy();
      parent.remove();
    }
  });

  it('does not replay observed effects when undoing a history probe event', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const observedEffect = StateEffect.define<number>();
    const observedState = StateField.define<number>({
      create: () => 0,
      update: (value, transaction) => {
        for (const effect of transaction.effects) {
          if (effect.is(observedEffect)) {
            value += effect.value;
          }
        }
        return value;
      },
    });
    const view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [history(), historyEffectProbeExtension, observedState],
      }),
    });

    try {
      view.dispatch({ effects: observedEffect.of(1) });
      expect(view.state.field(observedState)).toBe(1);
      expect(undoDepth(view.state)).toBe(1);

      expect(undo(view)).toBe(true);

      expect(view.state.field(observedState)).toBe(1);
      expect(redoDepth(view.state)).toBe(1);
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it('does not force a word selection when the second press becomes a drag', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = 'before `alphaBeta` after';
    const settlementSelections: boolean[] = [];
    const caretPositionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint',
    );
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          markdownLanguage(),
          markdownWysiwygExtension(),
          EditorView.updateListener.of((update) => {
            for (const transaction of update.transactions) {
              if (transaction.annotation(Transaction.addToHistory) === false) {
                settlementSelections.push(transaction.selection !== undefined);
              }
            }
          }),
        ],
        selection: { anchor: 1 },
      }),
    });

    try {
      const textNode = [...parent.querySelector('.lm-md-inline-code')!.childNodes]
        .find((node) => node.nodeValue === 'alphaBeta');
      expect(textNode).toBeTruthy();
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({
          getClientRect: () => new DOMRect(),
          offset: 4,
          offsetNode: textNode!,
        })),
      });

      dispatchMouseGesture(parent, 100, 20, 1);
      await Promise.resolve();
      settlementSelections.length = 0;
      dispatchMouseGesture(parent, 104, 20, 2, 108, 20);
      await Promise.resolve();

      expect(settlementSelections).toEqual([false]);
    } finally {
      restoreProperty(
        document,
        'caretPositionFromPoint',
        caretPositionDescriptor,
      );
      view.destroy();
      parent.remove();
    }
  });

  it('does not claim a following-text caret that only grazes inline-code padding', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = 'before `alphaBeta` after';
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });
    const caretPositionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint',
    );

    try {
      const owner = parent.querySelector<HTMLElement>('.lm-md-inline-code');
      const afterNode = [...parent.querySelectorAll('.cm-line')]
        .flatMap((element) => [...element.childNodes])
        .find((node) => node.nodeValue?.includes('after'));
      expect(owner).toBeTruthy();
      expect(afterNode).toBeTruthy();
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({
          getClientRect: () => new DOMRect(),
          offset: 0,
          offsetNode: afterNode!,
        })),
      });

      let resolved: ReturnType<typeof resolveInlinePointerOwner> = null;
      owner!.addEventListener('mousedown', (event) => {
        resolved = resolveInlinePointerOwner(event, view);
      });
      owner!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

      expect(resolved).toBeNull();
    } finally {
      restoreProperty(
        document,
        'caretPositionFromPoint',
        caretPositionDescriptor,
      );
      view.destroy();
      parent.remove();
    }
  });

  it('places a collapsed caret in following text when chip padding intercepts the hit', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = 'before `alphaBeta` after';
    const to = source.lastIndexOf('`') + 1;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });
    const caretPositionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint',
    );

    try {
      const owner = parent.querySelector<HTMLElement>('.lm-md-inline-code');
      const afterNode = [...parent.querySelectorAll('.cm-line')]
        .flatMap((element) => [...element.childNodes])
        .find((node) => node.nodeValue?.includes('after'));
      expect(owner).toBeTruthy();
      expect(afterNode).toBeTruthy();
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({
          getClientRect: () => new DOMRect(),
          offset: 0,
          offsetNode: afterNode!,
        })),
      });

      dispatchMouseGestureOn(owner!, 140, 20, 1);
      await Promise.resolve();

      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.selection.main.head).toBeGreaterThanOrEqual(to);
      expect(view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      )).toBe('');

      dispatchMouseGestureOn(owner!, 140, 20, 3);
      await Promise.resolve();
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      )).toBe('');
    } finally {
      restoreProperty(
        document,
        'caretPositionFromPoint',
        caretPositionDescriptor,
      );
      view.destroy();
      parent.remove();
    }
  });

  it('single-clicks the following word instead of selecting it after an inline-code press', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const source = 'before `alphaBeta` after';
    const from = source.indexOf('`');
    const to = source.lastIndexOf('`') + 1;
    const caretPositionDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'caretPositionFromPoint',
    );
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [markdownLanguage(), markdownWysiwygExtension()],
      }),
    });

    try {
      const owner = parent.querySelector<HTMLElement>('.lm-md-inline-code');
      const textNode = [...(owner?.childNodes ?? [])].find(
        (node) => node.nodeValue === 'alphaBeta',
      );
      const afterNode = [...parent.querySelectorAll('.cm-line')]
        .flatMap((element) => [...element.childNodes])
        .find((node) => node.nodeValue?.includes('after'));
      expect(textNode).toBeTruthy();
      expect(afterNode).toBeTruthy();
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({
          getClientRect: () => new DOMRect(),
          offset: 4,
          offsetNode: textNode!,
        })),
      });

      dispatchMouseGestureOn(owner!, 100, 20, 1);
      await Promise.resolve();
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.selection.main.head).toBeGreaterThan(from);
      expect(view.state.selection.main.head).toBeLessThan(to);

      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: vi.fn(() => ({
          getClientRect: () => new DOMRect(),
          offset: 0,
          offsetNode: afterNode!,
        })),
      });
      dispatchMouseGestureOn(afterNode!.parentElement ?? parent, 140, 20, 2);
      await Promise.resolve();

      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.sliceDoc(
        view.state.selection.main.from,
        view.state.selection.main.to,
      )).toBe('');
      expect(view.state.selection.main.head).toBeGreaterThanOrEqual(to);
    } finally {
      restoreProperty(
        document,
        'caretPositionFromPoint',
        caretPositionDescriptor,
      );
      view.destroy();
      parent.remove();
    }
  });
});

function dispatchMouseGesture(
  parent: HTMLElement,
  clientX: number,
  clientY: number,
  detail: number,
  mouseUpClientX = clientX,
  mouseUpClientY = clientY,
): void {
  const owner = parent.querySelector<HTMLElement>('.lm-md-inline-code');
  if (!owner) {
    throw new Error('Expected inline-code owner.');
  }
  dispatchMouseGestureOn(
    owner,
    clientX,
    clientY,
    detail,
    mouseUpClientX,
    mouseUpClientY,
  );
}

function dispatchMouseGestureOn(
  target: EventTarget,
  clientX: number,
  clientY: number,
  detail: number,
  mouseUpClientX = clientX,
  mouseUpClientY = clientY,
): void {
  target.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    button: 0,
    clientX,
    clientY,
    detail,
  }));
  document.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    button: 0,
    clientX: mouseUpClientX,
    clientY: mouseUpClientY,
    detail,
  }));
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}
