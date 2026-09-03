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

function mountEditor(options: {
  doc?: string;
  locate?: string;
  posAtCoords?: (coords: { x: number; y: number }) => number | null;
} = {}): {
  cleanup: () => void;
  updates: ViewUpdate[];
  view: EditorView;
} {
  const doc = options.doc ?? source;
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const updates: ViewUpdate[] = [];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        markdownWysiwygExtension(),
        EditorView.updateListener.of((update) => {
          updates.push(update);
        }),
      ],
    }),
  });
  const textNode = findTextNode(parent, options.locate ?? doc);
  // One CSS pixel per character keeps the pointer arithmetic readable.
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: vi.fn((x: number) => ({
      getClientRect: () => new DOMRect(),
      offset: Math.max(0, Math.min(doc.length, Math.round(x - 100) + 6)),
      offsetNode: textNode,
    })),
  });
  vi.spyOn(view, 'posAtCoords').mockImplementation((coords) => {
    if (!coords) {
      return null;
    }
    if (options.posAtCoords) {
      return options.posAtCoords(coords);
    }

    return Math.max(
      0,
      Math.min(doc.length, Math.round(coords.x - 100) + 6),
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

  it('treats a double-click-timing drag as a character range after slop', () => {
    const { cleanup, view } = mountEditor();
    try {
      const style = createPointerSelectionStyle(view, {
        kind: 'word-or-drag',
        position: 6,
        x: 100,
        y: 20,
      });
      const insideSlop = style.get(mouseEvent(102, 20), false, false);
      const pastSlop = style.get(mouseEvent(120, 20), false, false);

      expect(insideSlop.main.empty).toBe(false);
      expect(insideSlop.main.from).toBeLessThan(insideSlop.main.to);
      expect(pastSlop.main.anchor).toBe(6);
      expect(pastSlop.main.head).toBe(16);
      expect(pastSlop.main.empty).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('does not query caretPositionFromPoint on a double-click-timing drag move', () => {
    const { cleanup, view } = mountEditor();
    try {
      const caretSpy = document.caretPositionFromPoint as ReturnType<typeof vi.fn>;
      const style = createPointerSelectionStyle(view, {
        kind: 'word-or-drag',
        position: 6,
        x: 100,
        y: 20,
      });
      caretSpy.mockClear();
      style.get(mouseEvent(120, 20), false, false);
      expect(caretSpy).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('keeps the last expanded head when posAtCoords returns null over a widget', () => {
    const hits = new Map<number, number | null>([
      [120, 16],
      [140, null],
      [160, 24],
    ]);
    const { cleanup, view } = mountEditor({
      posAtCoords: (coords) => hits.get(coords.x) ?? null,
    });

    try {
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });
      const expanded = style.get(mouseEvent(120, 20), false, false);
      const overWidget = style.get(mouseEvent(140, 20), false, false);
      const afterWidget = style.get(mouseEvent(160, 20), false, false);

      expect(expanded.main.empty).toBe(false);
      expect(expanded.main.anchor).toBe(6);
      expect(expanded.main.head).toBe(16);
      expect(overWidget.main.empty).toBe(false);
      expect(overWidget.main.anchor).toBe(6);
      expect(overWidget.main.head).toBe(16);
      expect(afterWidget.main.empty).toBe(false);
      expect(afterWidget.main.anchor).toBe(6);
      expect(afterWidget.main.head).toBe(24);
    } finally {
      cleanup();
    }
  });

  it('does not jump the head backward onto a hidden delimiter during a forward drag', () => {
    const hits = new Map<number, number | null>([
      [120, 16],
      [130, 8],
      [140, 20],
    ]);
    const { cleanup, view } = mountEditor({
      doc: 'prefix **bold** suffix',
      locate: 'bold',
      posAtCoords: (coords) => hits.get(coords.x) ?? null,
    });

    try {
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });
      const expanded = style.get(mouseEvent(120, 20), false, false);
      const overDelimiter = style.get(mouseEvent(130, 20), false, false);
      const afterMark = style.get(mouseEvent(140, 20), false, false);
      const heads = [expanded, overDelimiter, afterMark].map(
        (selection) => selection.main.head,
      );

      expect(expanded.main.empty).toBe(false);
      expect(overDelimiter.main.empty).toBe(false);
      expect(overDelimiter.main.anchor).toBe(6);
      expect(overDelimiter.main.head).toBe(16);
      expect(afterMark.main.head).toBe(20);
      expect(heads).toEqual([16, 16, 20]);
    } finally {
      cleanup();
    }
  });

  it.each([
    ['bold', 'prefix **加粗内容** suffix', '加粗内容'],
    ['italic', 'prefix *斜体内容* suffix', '斜体内容'],
    ['strikethrough', 'prefix ~~删除内容~~ suffix', '删除内容'],
    ['inline-code', 'prefix `行内代码` suffix', '行内代码'],
    ['inline-math', 'prefix $E=mc^2$ suffix', 'E=mc^2'],
    ['link', 'prefix [链接文本](https://example.com) suffix', '链接文本'],
  ] as const)(
    'keeps a forward drag across %s from collapsing when a hit returns null',
    (_label, doc, locate) => {
      const hits = new Map<number, number | null>([
        [120, 18],
        [132, null],
        [148, 28],
      ]);
      const { cleanup, view } = mountEditor({
        doc,
        locate,
        posAtCoords: (coords) => hits.get(coords.x) ?? null,
      });

      try {
        const style = createPointerSelectionStyle(view, {
          position: 7,
          x: 100,
          y: 20,
        });
        const samples = [120, 132, 148].map((x) =>
          style.get(mouseEvent(x, 20), false, false).main,
        );

        expect(samples.every((range) => !range.empty)).toBe(true);
        expect(samples.every((range) => range.anchor === 7)).toBe(true);
        expect(samples.map((range) => range.head)).toEqual([18, 18, 28]);
      } finally {
        cleanup();
      }
    },
  );

  it('exposes dragRangeCommitted as false initially and true after a non-empty range', () => {
    const { cleanup, view } = mountEditor();

    try {
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });

      expect(style.dragRangeCommitted).toBe(false);

      // Still in slop — collapsed range, not committed
      style.get(mouseEvent(102, 20), false, false);
      expect(style.dragRangeCommitted).toBe(false);

      // Past slop — non-empty range, committed
      style.get(mouseEvent(120, 20), false, false);
      expect(style.dragRangeCommitted).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('rejects a line change when Y movement is below half a line height', () => {
    const multiLineDoc = 'line one\nline two\nline three';
    const { cleanup, view } = mountEditor({
      doc: multiLineDoc,
      locate: 'line one',
      posAtCoords: (coords) => {
        // Y < 30 → line 1, 30–60 → line 2, > 60 → line 3
        const lineOffset = Math.round(coords.x - 100);
        if (coords.y < 30) return Math.max(0, Math.min(8, lineOffset));
        if (coords.y < 60) return 9 + Math.max(0, Math.min(8, lineOffset));
        return 18 + Math.max(0, Math.min(10, lineOffset));
      },
    });

    try {
      Object.defineProperty(view, 'defaultLineHeight', {
        configurable: true,
        value: 60, // half = 30
      });

      const style = createPointerSelectionStyle(view, {
        position: 4,
        x: 104,
        y: 10, // start on line 1
      });

      // Drag right past slop on line 1
      const onLine1 = style.get(mouseEvent(110, 10), false, false);
      expect(onLine1.main.head).toBe(8);

      // Move to y=31 (line 2 boundary), |31-10|=21 < 30 → reject
      const tinyYMove = style.get(mouseEvent(110, 31), false, false);
      expect(tinyYMove.main.head).toBe(8); // should stay on line 1

      // Move to y=45, |45-10|=35 >= 30 → accept line change
      const bigYMove = style.get(mouseEvent(110, 45), false, false);
      expect(bigYMove.main.head).toBe(17); // pos on line 2
    } finally {
      cleanup();
    }
  });

  it('uses posAtCoords with precise=true so inter-line gaps return null', () => {
    const multiLineDoc = 'line one\nline two';
    const { cleanup, view } = mountEditor({
      doc: multiLineDoc,
      locate: 'line one',
      posAtCoords: () => {
        return null; // simulate inter-line gap
      },
    });

    try {
      Object.defineProperty(view, 'defaultLineHeight', {
        configurable: true,
        value: 40,
      });

      const style = createPointerSelectionStyle(view, {
        position: 4,
        x: 104,
        y: 20,
      });

      // First drag past slop — posAtCoords returns null
      const result = style.get(mouseEvent(120, 20), false, false);
      // Should retain lastHead (anchor position 4)
      expect(result.main.head).toBe(4);
      expect(result.main.empty).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('still shrinks the range when the pointer reverses toward the press', () => {
    const hits = new Map<number, number | null>([
      [120, 16],
      [110, 12],
    ]);
    const { cleanup, view } = mountEditor({
      posAtCoords: (coords) => hits.get(coords.x) ?? null,
    });

    try {
      const style = createPointerSelectionStyle(view, {
        position: 6,
        x: 100,
        y: 20,
      });
      const expanded = style.get(mouseEvent(120, 20), false, false);
      const reversed = style.get(mouseEvent(110, 20), false, false);

      expect(expanded.main.head).toBe(16);
      expect(reversed.main.empty).toBe(false);
      expect(reversed.main.anchor).toBe(6);
      expect(reversed.main.head).toBe(12);
    } finally {
      cleanup();
    }
  });
});
