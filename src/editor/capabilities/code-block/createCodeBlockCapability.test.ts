import {
  history,
  insertNewlineAndIndent,
  isolateHistory,
  redo,
  undo,
} from '@codemirror/commands';
import {
  Annotation,
  EditorState,
  type Extension,
  StateEffect,
  type Text,
} from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { createCodeBlockCapability } from './createCodeBlockCapability';

const finalFence = ['```ts', 'const value = 1', '```'].join('\n');
const cleanupViews: Array<() => void> = [];

function createState(doc = finalFence): EditorState {
  return EditorState.create({
    doc,
    extensions: [markdownLanguage(), createCodeBlockCapability().extensions],
    selection: { anchor: doc.length },
  });
}

function append(
  state: EditorState,
  insert: string,
  userEvent?: string,
): EditorState {
  return state.update({
    changes: { from: state.doc.length, insert },
    userEvent,
  }).state;
}

function createViewWithDocument(
  doc: string,
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
        createCodeBlockCapability().extensions,
        ...extensions,
      ],
      selection: { anchor: doc.length },
    }),
  });
  cleanupViews.push(() => {
    view.destroy();
    parent.remove();
  });
  return view;
}

function createSourceModeView(
  doc: string,
  ...extensions: Extension[]
): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdownLanguage(), ...extensions],
      selection: { anchor: doc.length },
    }),
  });
  cleanupViews.push(() => {
    view.destroy();
    parent.remove();
  });
  return view;
}

function createView(...extensions: Extension[]): EditorView {
  return createViewWithDocument(finalFence, ...extensions);
}

function typeText(view: EditorView, text: string): void {
  for (const character of text) {
    const position = view.state.selection.main.head;
    view.dispatch({
      changes: { from: position, insert: character },
      selection: { anchor: position + character.length },
      userEvent: 'input.type',
    });
  }
}

function pressEnter(view: EditorView): boolean {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    code: 'Enter',
    key: 'Enter',
  });

  return runScopeHandlers(view, event, 'editor') || insertNewlineAndIndent(view);
}

afterEach(() => {
  cleanupViews.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

describe('opening fenced code block completion', () => {
  it.each([
    ['```', '```\n\n```', 4],
    ['```ts', '```ts\n\n```', 6],
    ['~~~shell', '~~~shell\n\n~~~', 9],
    ['````typescript', '````typescript\n\n````', 15],
    ['  ~~~~~MyDSL option=value', '  ~~~~~MyDSL option=value\n  \n  ~~~~~', 28],
  ])(
    'completes a real opening fence while preserving its marker for %s',
    (opening, expectedDocument, expectedCaret) => {
      const view = createViewWithDocument(opening);

      expect(pressEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(expectedDocument);
      expect(view.state.selection.main.anchor).toBe(expectedCaret);
    },
  );

  it.each([
    ['```ts', '````'],
    ['~~~~shell', '~~~~~'],
  ])(
    'does not duplicate an existing closing fence for %s',
    (opening, closing) => {
      const doc = [opening, 'const value = 1', closing].join('\n');
      const view = createViewWithDocument(doc);
      view.dispatch({ selection: { anchor: opening.length } });

      expect(pressEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(
        [opening, '', 'const value = 1', closing].join('\n'),
      );
    },
  );

  it('matches the opening length instead of treating a shorter run as a close', () => {
    const opening = '````ts';
    const view = createViewWithDocument([opening, '```'].join('\n'));
    view.dispatch({ selection: { anchor: opening.length } });

    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      [opening, '', '````', '```'].join('\n'),
    );
  });

  it('does not invent source blank lines outside the completed block', () => {
    const opening = '```ts';
    const doc = ['before', opening, 'after'].join('\n');
    const view = createViewWithDocument(doc);
    view.dispatch({
      selection: { anchor: doc.indexOf(opening) + opening.length },
    });

    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      ['before', opening, '', '```', 'after'].join('\n'),
    );
  });

  it.each([
    ['two backticks', '``'],
    ['four-space indentation', '    ```ts'],
    ['inline fence text', 'prefix ```ts'],
    ['backtick in a backtick info string', '```ts`invalid'],
  ])('does not complete %s', (_label, opening) => {
    const view = createViewWithDocument(opening);

    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      `${opening}\n${opening.startsWith('    ') ? '    ' : ''}`,
    );
  });

  it('does not complete Enter when the selection is non-empty', () => {
    const opening = '```ts';
    const view = createViewWithDocument(opening);
    view.dispatch({ selection: { anchor: opening.length - 1, head: opening.length } });

    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```t\n');
  });

  it('does not complete an opening fence in read-only reading mode', () => {
    const opening = '```ts';
    const view = createViewWithDocument(
      opening,
      EditorState.readOnly.of(true),
    );

    expect(pressEnter(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(opening);
  });

  it('keeps the completed body scrolled into view', () => {
    const opening = '```ts';
    let completionScrollIntent: boolean | null = null;
    const view = createViewWithDocument(
      opening,
      EditorView.updateListener.of((update) => {
        const completion = update.transactions.find((transaction) =>
          transaction.isUserEvent('input.codeBlockAutoClose'),
        );

        if (completion?.docChanged) {
          completionScrollIntent = completion.scrollIntoView;
        }
      }),
    );

    expect(pressEnter(view)).toBe(true);
    expect(completionScrollIntent).toBe(true);
  });

  it.each([
    ['paste', 'input.paste'],
    ['IME composition', 'input.type.compose'],
    ['IME composition start', 'input.type.compose.start'],
  ])('does not reinterpret a newline from %s', (_label, userEvent) => {
    const opening = '```ts';
    const view = createViewWithDocument(opening);

    view.dispatch({
      changes: { from: opening.length, insert: '\n' },
      selection: { anchor: opening.length + 1 },
      userEvent,
    });

    expect(view.state.doc.toString()).toBe(`${opening}\n`);
  });

  it('undoes and redoes the completed pair as one history event', () => {
    const opening = '```ts';
    const view = createViewWithDocument(opening, history());

    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```ts\n\n```');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(opening);
    expect(view.state.selection.main.anchor).toBe(opening.length);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```ts\n\n```');
    expect(view.state.selection.main.anchor).toBe('```ts\n'.length);
  });

  it('keeps a genuinely typed opening fence separate from the completion history event', () => {
    const view = createViewWithDocument('', history());

    typeText(view, '```ts');
    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```ts\n\n```');

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```ts');
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```ts\n\n```');
  });

  it.each([
    ['paste', 'input.paste'],
    ['IME composition', 'input.type.compose'],
  ])(
    'completes only after an explicit Enter following an opening fence from %s',
    (_label, userEvent) => {
      const opening = '```ts';
      const view = createViewWithDocument('');

      view.dispatch({
        changes: { from: 0, insert: opening },
        selection: { anchor: opening.length },
        userEvent,
      });
      expect(view.state.doc.toString()).toBe(opening);

      expect(pressEnter(view)).toBe(true);
      expect(view.state.doc.toString()).toBe('```ts\n\n```');
    },
  );

  it('leaves source mode Enter behavior unchanged', () => {
    const opening = '```ts';
    const view = createSourceModeView(opening);

    expect(pressEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${opening}\n`);
  });
});

describe('final fenced code block exit filter', () => {
  it.each(['```ts', '~~~shell'])(
    'keeps an opening fence info string on the opening line for %s',
    (markdown) => {
      const view = createViewWithDocument('');

      typeText(view, markdown);

      expect(view.state.doc.toString()).toBe(markdown);
    },
  );

  it('moves ordinary typing below a final closing fence', () => {
    const state = append(createState(), 'Outside', 'input.type');

    expect(state.doc.toString()).toBe(`${finalFence}\nOutside`);
    expect(state.selection.main.anchor).toBe(state.doc.length);
  });

  it('preserves effects and scroll intent while moving input past the final fence', () => {
    const probeEffect = StateEffect.define<string>();
    const sentinel = Annotation.define<string>();
    let observed: {
      effect: string | null;
      history: string | null;
      scrollIntoView: boolean;
      sentinel: string | null;
    } | null = null;
    const view = createView(
      EditorView.updateListener.of((update) => {
        const transaction = update.transactions[0];
        const effect = transaction?.effects.find((candidate) =>
          candidate.is(probeEffect),
        );

        observed = {
          effect: effect?.value ?? null,
          history: transaction?.annotation(isolateHistory) ?? null,
          scrollIntoView: transaction?.scrollIntoView ?? false,
          sentinel: transaction?.annotation(sentinel) ?? null,
        };
      }),
    );

    view.dispatch({
      annotations: [isolateHistory.of('full'), sentinel.of('preserved')],
      changes: { from: finalFence.length, insert: 'Outside' },
      effects: probeEffect.of('preserved'),
      scrollIntoView: true,
      selection: { anchor: finalFence.length + 'Outside'.length },
      userEvent: 'input.type',
    });

    expect(observed).toEqual({
      effect: 'preserved',
      history: 'full',
      scrollIntoView: true,
      sentinel: 'preserved',
    });
  });

  it('keeps a real Enter command as a blank line below a final closing fence', () => {
    const view = createView();

    expect(insertNewlineAndIndent(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${finalFence}\n\n`);
    expect(view.state.selection.main.anchor).toBe(view.state.doc.length);
  });

  it('undoes and redoes a real Enter command as one history event', () => {
    const view = createView(history());

    expect(insertNewlineAndIndent(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${finalFence}\n\n`);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(finalFence);
    expect(view.state.selection.main.anchor).toBe(finalFence.length);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${finalFence}\n\n`);
    expect(view.state.selection.main.anchor).toBe(view.state.doc.length);
  });

  it('moves typing below the fence after an ArrowDown selection event', () => {
    const initial = createState();
    const afterArrowDown = initial.update({
      selection: { anchor: initial.doc.length },
      userEvent: 'select.keyboard',
    }).state;

    expect(append(afterArrowDown, 'Outside', 'input.type').doc.toString()).toBe(
      `${finalFence}\nOutside`,
    );
  });

  it.each([
    ['paste', 'input.paste'],
    ['IME composition', 'input.type.compose'],
    ['IME composition start', 'input.type.compose.start'],
    ['undo', 'undo'],
    ['redo', 'redo'],
    ['programmatic load', undefined],
  ])('does not reinterpret a tail append from %s', (_label, userEvent) => {
    const state = append(createState(), 'Outside', userEvent);

    expect(state.doc.toString()).toBe(`${finalFence}Outside`);
  });

  it('does not reinterpret a transaction with multiple changes', () => {
    const initial = createState();
    const state = initial.update({
      changes: [
        { from: 0, to: 1, insert: '~' },
        { from: initial.doc.length, insert: 'Outside' },
      ],
      userEvent: 'input.type',
    }).state;

    expect(state.doc.toString()).toBe(`~${finalFence.slice(1)}Outside`);
  });

  it('does not reinterpret a tail append when the caret is not at the tail', () => {
    const initial = EditorState.create({
      doc: finalFence,
      extensions: [markdownLanguage(), createCodeBlockCapability().extensions],
      selection: { anchor: 0 },
    });

    expect(append(initial, 'Outside', 'input.type').doc.toString()).toBe(
      `${finalFence}Outside`,
    );
  });

  it('does not materialize a large document when handling tail typing', () => {
    const document = `${'paragraph\n'.repeat(1_000_000)}\`\`\``;
    const initial = createState(document);
    const textPrototype = Object.getPrototypeOf(initial.doc) as Text;
    const toStringSpy = vi.spyOn(textPrototype, 'toString');

    const transaction = initial.update({
      changes: { from: initial.doc.length, insert: 'x' },
      userEvent: 'input.type',
    });
    const materializedLengths = toStringSpy.mock.contexts.map(
      (text) => (text as Text).length,
    );

    expect(materializedLengths).not.toContain(initial.doc.length);
    expect(materializedLengths).not.toContain(transaction.newDoc.length);
  });
});
