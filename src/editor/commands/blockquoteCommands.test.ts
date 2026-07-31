import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMarkdownFormatCommand } from './markdownFormatCommands';

const parents: HTMLElement[] = [];

describe('blockquote format command', () => {
  afterEach(() => {
    for (const parent of parents.splice(0)) {
      parent.remove();
    }
  });

  it('wraps and unwraps one ordinary line without changing its content', () => {
    const wrapped = createView('quote', 0, 5);

    applyMarkdownFormatCommand(wrapped.view, 'quote');

    expect(wrapped.view.state.doc.toString()).toBe('> quote');
    expect(undo(wrapped.view)).toBe(true);
    expect(wrapped.view.state.doc.toString()).toBe('quote');
    wrapped.view.destroy();

    const unwrapped = createView('> quote', 0, 7);

    applyMarkdownFormatCommand(unwrapped.view, 'quote');

    expect(unwrapped.view.state.doc.toString()).toBe('quote');
    expect(undo(unwrapped.view)).toBe(true);
    expect(unwrapped.view.state.doc.toString()).toBe('> quote');
    unwrapped.view.destroy();
  });

  it('wraps structural blank lines so separate paragraphs form one blockquote', () => {
    const original = 'first\n\nsecond';
    const { view } = createView(original, 0, original.length);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('> first\n>\n> second');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(original);
    view.destroy();
  });

  it('unwraps a blockquote including its structural blank line', () => {
    const original = '> first\n>\n> second';
    const { view } = createView(original, 0, original.length);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('first\n\nsecond');
    view.destroy();
  });

  it('adds one common outer layer to mixed input and reverses it exactly', () => {
    const original = '> first\n\nsecond';
    const { view } = createView(original, 0, original.length);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('> > first\n>\n> second');

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe(original);
    view.destroy();
  });

  it('removes bare markers and at most one following whitespace character', () => {
    const original = '>\n  >\tsecond\n>   third';
    const { view } = createView(original, 0, original.length);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('\n  second\n  third');
    view.destroy();
  });

  it('adds and removes markers after existing indentation', () => {
    const original = '  first\n\tsecond';
    const { view } = createView(original, 0, original.length);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('  > first\n\t> second');

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe(original);
    view.destroy();
  });

  it('preserves indentation and inserts a starter after it on a collapsed blank line', () => {
    const original = 'before\n  \nafter';
    const { view } = createView(original, 8, 8);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('before\n  > \nafter');
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(11);
    view.destroy();
  });

  it('does not include the next line when a forward selection ends at its start', () => {
    const { view } = createView('first\nsecond', 0, 6);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('> first\nsecond');
    expect(view.state.selection.main.anchor).toBeLessThan(view.state.selection.main.head);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'first\n',
    );
    view.destroy();
  });

  it('preserves reverse selection direction at an exact line-start endpoint', () => {
    const { view } = createView('first\nsecond', 6, 0);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('> first\nsecond');
    expect(view.state.selection.main.anchor).toBeGreaterThan(view.state.selection.main.head);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'first\n',
    );
    view.destroy();
  });

  it.each([
    ['forward', 0, 2],
    ['reverse', 2, 0],
  ])(
    'keeps a %s selection outside a marker inserted at its indentation boundary',
    (_direction, anchor, head) => {
      const selection = EditorSelection.create([
        EditorSelection.range(anchor, head, 17, 2, 1),
      ]);
      const { view } = createViewWithSelection('  first\nsecond', selection);

      applyMarkdownFormatCommand(view, 'quote');

      const mapped = view.state.selection.main;
      expect(view.state.doc.toString()).toBe('  > first\nsecond');
      expect(view.state.sliceDoc(mapped.from, mapped.to)).toBe('  ');
      expect(mapped.anchor < mapped.head).toBe(anchor < head);
      expect(mapped.goalColumn).toBe(17);
      expect(mapped.bidiLevel).toBe(2);
      expect(mapped.assoc).toBe(1);
      expect(mapped.undirectional).toBe(false);
      view.destroy();
    },
  );

  it('maps every range while formatting only the existing main range', () => {
    const doc = 'secondary\nmain\nlater';
    const selection = EditorSelection.create(
      [
        EditorSelection.cursor(2, 1, 2, 7),
        EditorSelection.range(10, 14, 9, 2, 1),
        EditorSelection.range(15, 20, 11, 4, -1),
      ],
      1,
    );
    const { view } = createViewWithSelection(doc, selection);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('secondary\n> main\nlater');
    expect(view.state.selection.ranges).toHaveLength(3);
    expect(view.state.selection.mainIndex).toBe(1);
    expect(view.state.sliceDoc(12, 16)).toBe('main');
    expect(view.state.sliceDoc(17, 22)).toBe('later');
    expect(view.state.selection.ranges[0]?.assoc).toBe(1);
    expect(view.state.selection.ranges[0]?.bidiLevel).toBe(2);
    expect(view.state.selection.ranges[0]?.goalColumn).toBe(7);
    expect(view.state.selection.ranges[1]?.goalColumn).toBe(9);
    expect(view.state.selection.ranges[2]?.bidiLevel).toBe(4);
    expect(view.state.selection.ranges[2]?.goalColumn).toBe(11);
    view.destroy();
  });

  it('preserves secondary ranges when the main cursor starts a blank blockquote', () => {
    const doc = 'secondary\n  \nlater';
    const selection = EditorSelection.create(
      [
        EditorSelection.cursor(2, -1, 2, 7),
        EditorSelection.cursor(11, 1, 4, 9),
        EditorSelection.range(13, 18, 11, 2, -1),
      ],
      1,
    );
    const { view } = createViewWithSelection(doc, selection);

    applyMarkdownFormatCommand(view, 'quote');

    expect(view.state.doc.toString()).toBe('secondary\n  > \nlater');
    expect(view.state.selection.ranges).toHaveLength(3);
    expect(view.state.selection.mainIndex).toBe(1);
    expect(view.state.selection.ranges[0]?.head).toBe(2);
    expect(view.state.selection.ranges[0]?.assoc).toBe(-1);
    expect(view.state.selection.main.head).toBe(14);
    expect(view.state.selection.main.assoc).toBe(1);
    expect(view.state.selection.main.bidiLevel).toBe(4);
    expect(view.state.selection.main.goalColumn).toBe(9);
    expect(view.state.sliceDoc(15, 20)).toBe('later');
    expect(view.state.selection.ranges[2]?.goalColumn).toBe(11);
    view.destroy();
  });

  it('dispatches one input.format transaction', () => {
    const { updates, view } = createView('quote', 0, 5, true);

    applyMarkdownFormatCommand(view, 'quote');

    expect(updates).toHaveLength(1);
    expect(updates[0]?.transactions).toHaveLength(1);
    expect(updates[0]?.transactions[0]?.annotation(Transaction.userEvent)).toBe(
      'input.format',
    );
    view.destroy();
  });
});

function createView(
  doc: string,
  anchor: number,
  head: number,
  trackUpdates = false,
): { updates: ViewUpdate[]; view: EditorView } {
  return createViewWithSelection(
    doc,
    EditorSelection.single(anchor, head),
    trackUpdates,
  );
}

function createViewWithSelection(
  doc: string,
  selection: EditorSelection,
  trackUpdates = false,
): { updates: ViewUpdate[]; view: EditorView } {
  const parent = document.createElement('div');
  const updates: ViewUpdate[] = [];
  parents.push(parent);
  document.body.appendChild(parent);

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        history(),
        trackUpdates
          ? EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                updates.push(update);
              }
            })
          : [],
      ],
      selection,
    }),
  });

  return { updates, view };
}
