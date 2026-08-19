import { EditorState } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import { createPointerSelectionStyle } from './pointerSelectionStyle';
import { markdownWysiwygExtension } from './markdownDecorations';

const source = 'alpha beta gamma';

function mouseEvent(x: number, y: number): MouseEvent {
  return new MouseEvent('mousemove', { clientX: x, clientY: y });
}

function findTextNode(root: ParentNode, text: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.includes(text)) {
      return node as Text;
    }
  }

  throw new Error(`Unable to locate rendered text: ${text}`);
}

function mountEditor(): {
  cleanup: () => void;
  updates: ViewUpdate[];
  view: EditorView;
} {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const updates: ViewUpdate[] = [];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: source,
      extensions: [
        markdownLanguage(),
        markdownWysiwygExtension(),
        EditorView.updateListener.of((update) => {
          updates.push(update);
        }),
      ],
    }),
  });
  const textNode = findTextNode(parent, 'alpha beta gamma');
  // One CSS pixel per character keeps the pointer arithmetic readable.
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: vi.fn((x: number) => ({
      getClientRect: () => new DOMRect(),
      offset: Math.max(0, Math.min(source.length, Math.round(x - 100) + 6)),
      offsetNode: textNode,
    })),
  });
  vi.spyOn(view, 'posAtCoords').mockImplementation((coords) => {
    if (!coords) {
      return null;
    }

    return Math.max(
      0,
      Math.min(source.length, Math.round(coords.x - 100) + 6),
    );
  });

  return {
    cleanup: () => {
      Reflect.deleteProperty(document, 'caretPositionFromPoint');
      view.destroy();
      parent.remove();
    },
    updates,
    view,
  };
}

describe('pointer selection style', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the press position while the pointer stays inside the click slop', () => {
    const { cleanup, view } = mountEditor();

    try {
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });

      for (const x of [100, 101, 102, 97]) {
        const selection = style.get(mouseEvent(x, 20), false, false);
        expect(selection.main.empty).toBe(true);
        expect(selection.main.head).toBe(6);
      }
    } finally {
      cleanup();
    }
  });

  it('extends to the pointer position once the move passes the click slop', () => {
    const { cleanup, view } = mountEditor();

    try {
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });
      const twoPixel = style.get(mouseEvent(102, 20), false, false);
      const twentyPixel = style.get(mouseEvent(120, 20), false, false);

      expect(twoPixel.main.empty).toBe(true);
      expect(twoPixel.main.head).toBe(6);
      expect(twentyPixel.main.anchor).toBe(6);
      expect(twentyPixel.main.head).toBe(16);
    } finally {
      cleanup();
    }
  });

  it('does not query caretPositionFromPoint while dragging past the click slop', () => {
    const { cleanup, view } = mountEditor();

    try {
      const caretSpy = document.caretPositionFromPoint as ReturnType<typeof vi.fn>;
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });
      caretSpy.mockClear();

      const selection = style.get(mouseEvent(120, 20), false, false);

      expect(caretSpy).not.toHaveBeenCalled();
      expect(selection.main.empty).toBe(false);
      expect(selection.main.anchor).toBe(6);
      expect(selection.main.head).toBe(16);
    } finally {
      cleanup();
    }
  });

  it('widens the click slop on high device pixel ratio displays', () => {
    const { cleanup, view } = mountEditor();
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      'devicePixelRatio',
    );

    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: 2,
      });
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });
      const selection = style.get(mouseEvent(104, 20), false, false);

      expect(selection.main.empty).toBe(true);
      expect(selection.main.head).toBe(6);
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'devicePixelRatio', descriptor);
      } else {
        Reflect.deleteProperty(window, 'devicePixelRatio');
      }
      cleanup();
    }
  });

  it('maps the press position through document changes', () => {
    const { cleanup, updates, view } = mountEditor();

    try {
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });
      updates.length = 0;
      view.dispatch({ changes: { from: 0, insert: 'xx' } });
      const update = updates.at(-1);
      expect(update?.docChanged).toBe(true);
      style.update(update!);

      const selection = style.get(mouseEvent(100, 20), false, false);
      expect(selection.main.empty).toBe(true);
      expect(selection.main.head).toBe(8);
    } finally {
      cleanup();
    }
  });
});
