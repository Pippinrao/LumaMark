import {
  history,
  insertNewlineAndIndent,
  redo,
  undo,
} from '@codemirror/commands';
import { EditorState, type Extension, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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

afterEach(() => {
  cleanupViews.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
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
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${finalFence}\n\n`);
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
