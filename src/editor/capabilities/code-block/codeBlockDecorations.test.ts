import {
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state';
import {
  type DecorationSet,
  EditorView,
} from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { forceParsing } from '@codemirror/language';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { codeBlockPreviewExtension } from './codeBlockDecorations';

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  });
}

type TestEditor = {
  parent: HTMLDivElement;
  view: EditorView;
};

const editors: TestEditor[] = [];

afterEach(() => {
  for (const { parent, view } of editors.splice(0)) {
    view.destroy();
    parent.remove();
  }
});

function createView(
  doc: string,
  selection = 0,
  ...extensions: Extension[]
): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        codeBlockPreviewExtension(),
        ...extensions,
      ],
      selection: EditorSelection.cursor(selection),
    }),
  });
  editors.push({ parent, view });
  return view;
}

type CodeBlockLineDecoration = {
  className: string;
  description?: string;
  language?: string;
  position: number;
};

function codeBlockLineDecorations(view: EditorView): CodeBlockLineDecoration[] {
  const sources = view.state.facet(EditorView.decorations);
  const lineDecorations: CodeBlockLineDecoration[] = [];

  for (const source of sources) {
    const decorations: DecorationSet =
      typeof source === 'function' ? source(view) : source;
    decorations.between(0, view.state.doc.length, (from, _to, decoration) => {
      const className = decoration.spec.class;

      if (
        typeof className === 'string' &&
        className.split(' ').includes('lm-md-code-block-line')
      ) {
        const language = decoration.spec.attributes?.['data-lm-code-language'];
        const description = decoration.spec.attributes?.['aria-description'];

        lineDecorations.push({
          className,
          ...(typeof description === 'string' ? { description } : {}),
          ...(typeof language === 'string' ? { language } : {}),
          position: from,
        });
      }
    });
  }

  return lineDecorations;
}

function codeBlockLinePositions(view: EditorView): number[] {
  return codeBlockLineDecorations(view).map(({ position }) => position);
}

async function flushViewportUpdate(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

async function scrollTo(view: EditorView, position: number): Promise<void> {
  view.dispatch({
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
    selection: EditorSelection.cursor(position),
  });
  await flushViewportUpdate();
  forceParsing(view, position, 100);
}

describe('code block line decorations', () => {
  it('does not create line decorations for thousands of offscreen code blocks', () => {
    const doc = Array.from(
      { length: 4_000 },
      (_, index) => ['```ts', `const value${index} = ${index}`, '```', ''].join('\n'),
    ).join('\n');
    const view = createView(doc);

    expect(codeBlockLinePositions(view).length).toBeLessThan(200);
  });

  it('rebuilds decorations for a code block that scrolls into the viewport', async () => {
    const firstBlock = ['```ts', 'const first = 1', '```'].join('\n');
    const spacer = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join(
      '\n',
    );
    const finalBlock = ['```ts', 'const final = 2', '```'].join('\n');
    const doc = [firstBlock, spacer, finalBlock].join('\n');
    const finalBlockFrom = doc.lastIndexOf('```ts');
    const view = createView(doc);

    expect(codeBlockLinePositions(view)).not.toContain(finalBlockFrom);

    await scrollTo(view, finalBlockFrom);
    forceParsing(view, finalBlockFrom + finalBlock.length, 100);

    expect(view.visibleRanges.some(({ from, to }) => from <= finalBlockFrom && to >= finalBlockFrom))
      .toBe(true);
    expect(codeBlockLinePositions(view)).toContain(finalBlockFrom);

    await scrollTo(view, 0);

    expect(codeBlockLinePositions(view)).toContain(0);
    expect(codeBlockLinePositions(view)).not.toContain(finalBlockFrom);
  });

  it('limits unique line decorations to exactly twenty buffered lines around the viewport', async () => {
    const bodyLines = Array.from(
      { length: 600 },
      (_, index) => `const value${index} = ${index}`,
    );
    const doc = ['```ts', ...bodyLines, '```'].join('\n');
    const middlePosition = doc.indexOf(bodyLines[300]);
    const view = createView(doc);

    await scrollTo(view, middlePosition);
    forceParsing(view, view.visibleRanges.at(-1)?.to ?? middlePosition, 100);

    const firstVisibleLine = view.state.doc.lineAt(view.visibleRanges[0].from).number;
    const lastVisibleLine = view.state.doc.lineAt(
      view.visibleRanges.at(-1)?.to ?? view.state.doc.length,
    ).number;
    const firstBufferedLine = Math.max(1, firstVisibleLine - 20);
    const lastBufferedLine = Math.min(view.state.doc.lines, lastVisibleLine + 20);
    const expectedPositions = Array.from(
      { length: lastBufferedLine - firstBufferedLine + 1 },
      (_, index) => view.state.doc.line(firstBufferedLine + index).from,
    );
    const lineDecorations = codeBlockLineDecorations(view);
    const positions = lineDecorations.map(({ position }) => position);

    expect(positions).toEqual(expectedPositions);
    expect(new Set(positions).size).toBe(positions.length);
    expect(
      positions.every(
        (position) =>
          position >= 0 &&
          position <= view.state.doc.length &&
          view.state.doc.lineAt(position).from === position,
      ),
    ).toBe(true);
    expect(
      lineDecorations.every(
        ({ className }) =>
          !className.includes('lm-md-code-block-start') &&
          !className.includes('lm-md-code-block-end'),
      ),
    ).toBe(true);
  });

  it('applies start and end classes only to the real fence lines', () => {
    const doc = ['paragraph', '', '```ts', 'const value = 1', '```'].join('\n');
    const view = createView(doc);

    expect(codeBlockLineDecorations(view)).toEqual([
      {
        className: 'lm-md-code-block-line lm-md-code-block-start',
        position: view.state.doc.line(3).from,
      },
      {
        className: 'lm-md-code-block-line',
        position: view.state.doc.line(4).from,
      },
      {
        className: 'lm-md-code-block-line lm-md-code-block-end',
        position: view.state.doc.line(5).from,
      },
    ]);
  });

  it('keeps the final body row uncapped when a fenced block is unclosed', () => {
    const doc = ['```ts', 'const first = 1', 'const final = 2'].join('\n');
    const view = createView(doc);
    const lineDecorations = codeBlockLineDecorations(view);
    const finalDecoration = lineDecorations.at(-1);

    expect(lineDecorations).toHaveLength(3);
    expect(finalDecoration?.position).toBe(view.state.doc.line(3).from);
    expect(finalDecoration?.className.split(' ')).not.toContain(
      'lm-md-code-block-end',
    );
  });

  it.each([
    ['```ts', '```', 'TypeScript'],
    ['~~~bash', '~~~', 'Shell'],
    ['```MyDSL option=value', '```', 'MyDSL'],
  ])(
    'shows the canonical language on an active code block for %s',
    (opening, closing, expectedLanguage) => {
      const doc = [opening, 'const value = 1', closing, '', 'paragraph'].join('\n');
      const bodyPosition = doc.indexOf('const') + 2;
      const paragraphPosition = doc.lastIndexOf('paragraph') + 2;
      const view = createView(doc, bodyPosition);

      const activeDecorations = codeBlockLineDecorations(view);
      expect(
        activeDecorations.every(({ className }) =>
          className.split(' ').includes('lm-md-code-block-active'),
        ),
      ).toBe(true);
      expect(activeDecorations[0]).toMatchObject({
        language: expectedLanguage,
        position: 0,
      });
      expect(
        activeDecorations.slice(1).every(({ language }) => language === undefined),
      ).toBe(true);
      expect(
        activeDecorations.every(
          ({ description }) => description === expectedLanguage,
        ),
      ).toBe(true);

      view.dispatch({ selection: EditorSelection.cursor(paragraphPosition) });

      expect(
        codeBlockLineDecorations(view).every(
          ({ className, description, language }) =>
            !className.split(' ').includes('lm-md-code-block-active') &&
            description === undefined &&
            language === undefined,
        ),
      ).toBe(true);
    },
  );

  it('does not invent a language label for an empty info string', () => {
    const doc = ['```', 'plain code', '```'].join('\n');
    const view = createView(doc, doc.indexOf('plain'));

    expect(
      codeBlockLineDecorations(view).every(({ language }) => language === undefined),
    ).toBe(true);
  });

  it('does not expose an active editing affordance in read-only mode', () => {
    const doc = ['```ts', 'const value = 1', '```'].join('\n');
    const view = createView(
      doc,
      doc.indexOf('const'),
      EditorState.readOnly.of(true),
    );

    expect(
      codeBlockLineDecorations(view).every(
        ({ className, language }) =>
          !className.split(' ').includes('lm-md-code-block-active') &&
          language === undefined,
      ),
    ).toBe(true);
  });

  it('keeps line decorations stable while selection moves within a fenced block', () => {
    const doc = ['```ts', 'const value = 1', '```'].join('\n');
    const view = createView(doc);
    const initialDecorations = codeBlockLineDecorations(view);
    const selectionPositions = [
      view.state.doc.line(1).from,
      view.state.doc.line(2).from + 3,
      view.state.doc.line(3).from,
    ];

    for (const selectionPosition of selectionPositions) {
      view.dispatch({ selection: EditorSelection.cursor(selectionPosition) });
      expect(codeBlockLineDecorations(view)).toEqual(initialDecorations);
    }
  });

  it('clears stale line decorations when an opening fence is deleted', () => {
    const doc = ['```ts', 'const value = 1'].join('\n');
    const view = createView(doc);

    expect(codeBlockLinePositions(view)).toHaveLength(2);

    view.dispatch({ changes: { from: 0, to: 5 } });

    expect(codeBlockLinePositions(view)).toHaveLength(0);
  });

  it('clears stale line decorations after an unclosed fence is closed', () => {
    const doc = ['```ts', 'const value = 1', '', 'ordinary text'].join('\n');
    const ordinaryTextFrom = doc.indexOf('ordinary text');
    const view = createView(doc);

    expect(codeBlockLinePositions(view)).toContain(ordinaryTextFrom);

    view.dispatch({
      changes: {
        from: ordinaryTextFrom,
        insert: '```\n',
      },
    });

    expect(codeBlockLinePositions(view)).not.toContain(ordinaryTextFrom + 4);
  });
});
