import { history, redo, undo } from '@codemirror/commands';
import {
  EditorSelection,
  EditorState,
  type Extension,
  type SelectionRange,
} from '@codemirror/state';
import {
  EditorView,
  keymap,
  runScopeHandlers,
  type ViewUpdate,
} from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import {
  indentListItems,
  insertParagraphBreak,
  insertSoftLineBreak,
  paragraphEditingKeymap,
  unindentListItems,
} from './paragraphEditing';

const cleanupViews: Array<() => void> = [];

function createView(
  doc: string,
  selection: EditorSelection | SelectionRange,
  ...extensions: Extension[]
): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        markdownLanguage(),
        history(),
        ...extensions,
      ],
      selection,
    }),
  });

  cleanupViews.push(() => {
    view.destroy();
    parent.remove();
  });

  return view;
}

afterEach(() => {
  cleanupViews.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

describe('paragraph editing commands', () => {
  it('inserts a blank-line paragraph boundary in one transaction', () => {
    const updates: ViewUpdate[] = [];
    const view = createView(
      'plain',
      EditorSelection.cursor(2),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          updates.push(update);
        }
      }),
    );

    expect(insertParagraphBreak(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('pl\n\nain');
    expect(view.state.selection.main).toMatchObject({
      anchor: 4,
      head: 4,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].transactions).toHaveLength(1);
  });

  it.each([
    ['start', 0, '\n\nplain'],
    ['end', 5, 'plain\n\n'],
  ])(
    'handles an ordinary paragraph %s boundary',
    (_name, position, expected) => {
      const view = createView(
        'plain',
        EditorSelection.cursor(position),
      );

      expect(insertParagraphBreak(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(expected);
    },
  );

  it('inserts a single soft line break with Shift+Enter semantics', () => {
    const view = createView('plain', EditorSelection.cursor(2));

    expect(insertSoftLineBreak(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('pl\nain');
    expect(view.state.selection.main).toMatchObject({
      anchor: 3,
      head: 3,
    });
  });

  it.each([
    {
      command: insertParagraphBreak,
      expected: 'f\n\nd',
      name: 'paragraph break',
    },
    {
      command: insertSoftLineBreak,
      expected: 'f\nd',
      name: 'soft line break',
    },
  ])(
    'replaces a selection inside one soft-line paragraph with a $name',
    ({ command, expected }) => {
      const doc = 'first\nsecond';
      const view = createView(
        doc,
        EditorSelection.create([
          EditorSelection.range(1, doc.length - 1),
        ]),
      );

      expect(command(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(expected);
    },
  );

  it('replaces every selection atomically in one ordinary paragraph', () => {
    const view = createView(
      'ab cd',
      EditorSelection.create([
        EditorSelection.cursor(1),
        EditorSelection.range(3, 5),
      ]),
    );

    expect(insertParagraphBreak(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('a\n\nb \n\n');
    expect(
      view.state.selection.ranges.map((range) => range.head),
    ).toEqual([3, 7]);
  });

  it('leaves an empty line to the default Enter behavior', () => {
    const doc = 'first\n\nsecond';
    const view = createView(
      doc,
      EditorSelection.cursor(doc.indexOf('\n') + 1),
    );

    expect(insertParagraphBreak(view)).toBe(false);
    expect(insertSoftLineBreak(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('does not handle paragraph breaks during IME composition', () => {
    const view = createView('中文输入', EditorSelection.cursor(2));
    vi.spyOn(view, 'composing', 'get').mockReturnValue(true);

    expect(insertParagraphBreak(view)).toBe(false);
    expect(insertSoftLineBreak(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('中文输入');
  });

  it('does not mutate a read-only document', () => {
    const view = createView(
      'plain',
      EditorSelection.cursor(2),
      EditorState.readOnly.of(true),
    );

    expect(insertParagraphBreak(view)).toBe(false);
    expect(insertSoftLineBreak(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('plain');
  });

  it.each([
    ['ATX heading', '# Heading', 3],
    ['Setext heading', 'Heading\n---', 3],
    ['list item', '- item', 3],
    ['blockquote', '> quote', 3],
    ['fenced code', '```ts\nconst value = 1\n```', 8],
    ['table cell', '| value |\n| --- |', 3],
  ])(
    'leaves %s Enter handling to its structural keymap',
    (_name, doc, position) => {
      const view = createView(doc, EditorSelection.cursor(position));

      expect(insertParagraphBreak(view)).toBe(false);
      expect(insertSoftLineBreak(view)).toBe(false);
      expect(view.state.doc.toString()).toBe(doc);
    },
  );

  it('does not consume a selection that crosses Markdown blocks', () => {
    const doc = 'first\n\nsecond';
    const view = createView(
      doc,
      EditorSelection.create([
        EditorSelection.range(1, doc.length - 1),
      ]),
    );

    expect(insertParagraphBreak(view)).toBe(false);
    expect(insertSoftLineBreak(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('rejects every selection when one selection is structural', () => {
    const doc = 'plain\n\n- item';
    const view = createView(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.cursor(doc.indexOf('item')),
      ]),
    );

    expect(insertParagraphBreak(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('undoes and redoes a paragraph break as one history event', () => {
    const view = createView('plain', EditorSelection.cursor(2));

    expect(insertParagraphBreak(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('pl\n\nain');
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('plain');
    expect(undo(view)).toBe(false);
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('pl\n\nain');
  });

  it('exposes paragraph and list commands through the interaction keymap', () => {
    const state = EditorState.create({
      extensions: [paragraphEditingKeymap()],
    });
    const bindings = state.facet(keymap).flat();

    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'Enter',
          run: insertParagraphBreak,
        }),
        expect.objectContaining({
          key: 'Shift-Enter',
          run: insertSoftLineBreak,
        }),
        expect.objectContaining({
          key: 'Tab',
          run: indentListItems,
        }),
        expect.objectContaining({
          key: 'Shift-Tab',
          run: unindentListItems,
        }),
      ]),
    );
  });

  it.each([
    ['Enter', false, 'plain\n\n'],
    ['Shift-Enter', true, 'plain\n'],
  ])(
    'runs ordinary paragraph %s through the editor keymap',
    (_name, shiftKey, expected) => {
      const view = createView(
        'plain',
        EditorSelection.cursor(5),
        paragraphEditingKeymap(),
      );

      expect(
        runScopeHandlers(
          view,
          new KeyboardEvent('keydown', {
            key: 'Enter',
            shiftKey,
          }),
          'editor',
        ),
      ).toBe(true);
      expect(view.state.doc.toString()).toBe(expected);
    },
  );

  it('keeps the official Markdown list continuation ahead of paragraph editing', () => {
    const view = createView(
      '- item',
      EditorSelection.cursor(6),
      paragraphEditingKeymap(),
    );

    expect(
      runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: 'Enter' }),
        'editor',
      ),
    ).toBe(true);
    expect(view.state.doc.toString()).toBe('- item\n- ');
  });
});

describe('list-only indentation commands', () => {
  it.each([
    {
      after: '- parent\n  - child',
      before: '- parent\n- child',
      name: 'unordered list item',
      position: 12,
    },
    {
      after: '1. parent\n  2. child',
      before: '1. parent\n2. child',
      name: 'ordered list item',
      position: 14,
    },
  ])('indents only the selected $name', ({ after, before, position }) => {
    const view = createView(
      before,
      EditorSelection.cursor(position),
    );

    expect(indentListItems(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(after);
  });

  it.each([
    {
      after: '- parent\n- child',
      before: '- parent\n  - child',
      name: 'unordered list item',
      position: 14,
    },
    {
      after: '1. parent\n2. child',
      before: '1. parent\n  2. child',
      name: 'ordered list item',
      position: 16,
    },
  ])('unindents only the selected $name', ({ after, before, position }) => {
    const view = createView(
      before,
      EditorSelection.cursor(position),
    );

    expect(unindentListItems(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(after);
  });

  it('indents multiple list-item selections in one command', () => {
    const view = createView(
      '- a\n- b\n- c',
      EditorSelection.create([
        EditorSelection.cursor(2),
        EditorSelection.cursor(10),
      ]),
    );

    expect(indentListItems(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('  - a\n- b\n  - c');
    expect(
      view.state.selection.ranges.map((range) => range.head),
    ).toEqual([4, 14]);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- a\n- b\n- c');
    expect(undo(view)).toBe(false);
  });

  it('rejects a paragraph even though the official indent command can edit it', () => {
    const view = createView('plain', EditorSelection.cursor(2));

    expect(indentListItems(view)).toBe(false);
    expect(unindentListItems(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('plain');
  });

  it('rejects every selection when one selection is outside a list item', () => {
    const doc = '- item\n\nplain';
    const view = createView(
      doc,
      EditorSelection.create([
        EditorSelection.cursor(doc.indexOf('item')),
        EditorSelection.cursor(doc.indexOf('plain')),
      ]),
    );

    expect(indentListItems(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('does not reinterpret a range spanning separate list items', () => {
    const doc = '- first\n- second';
    const view = createView(
      doc,
      EditorSelection.create([
        EditorSelection.range(
          doc.indexOf('first'),
          doc.indexOf('second') + 'second'.length,
        ),
      ]),
    );

    expect(indentListItems(view)).toBe(false);
    expect(unindentListItems(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('does not indent list items during IME composition or in read-only mode', () => {
    const composingView = createView(
      '- 中文',
      EditorSelection.cursor(3),
    );
    vi.spyOn(composingView, 'composing', 'get').mockReturnValue(true);
    const readOnlyView = createView(
      '- item',
      EditorSelection.cursor(3),
      EditorState.readOnly.of(true),
    );

    expect(indentListItems(composingView)).toBe(false);
    expect(unindentListItems(composingView)).toBe(false);
    expect(indentListItems(readOnlyView)).toBe(false);
    expect(unindentListItems(readOnlyView)).toBe(false);
    expect(composingView.state.doc.toString()).toBe('- 中文');
    expect(readOnlyView.state.doc.toString()).toBe('- item');
  });
});
