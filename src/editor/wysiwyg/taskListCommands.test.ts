import {
  EditorSelection,
  EditorState,
  type ChangeSpec,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../markdown/markdownLanguage';
import {
  toggleTaskAtPosition,
  toggleTaskListAtSelection,
  toggleTaskListCommand,
} from './taskListCommands';

function applyChange(state: EditorState, change: ChangeSpec | null): EditorState {
  if (!change) {
    throw new Error('Expected a task marker change.');
  }

  return state.update({ changes: change }).state;
}

function selectionCoordinates(state: EditorState) {
  return state.selection.ranges.map(({ anchor, head }) => ({ anchor, head }));
}

describe('task list commands', () => {
  it('toggles the task owning an explicit position instead of the main selection', () => {
    const doc = ['- [ ] first', '- [ ] second'].join('\n');
    const secondMarkerStatePosition = doc.lastIndexOf('[ ]') + 1;
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(doc.indexOf('first')),
    });

    const change = toggleTaskAtPosition(state, doc.indexOf('second'));

    expect(change).toEqual({
      from: secondMarkerStatePosition,
      insert: 'x',
      to: secondMarkerStatePosition + 1,
    });
    expect(applyChange(state, change).doc.toString()).toBe(
      ['- [ ] first', '- [x] second'].join('\n'),
    );
  });

  it.each([
    {
      doc: '- [ ] top-level task',
      expected: '- [x] top-level task',
      name: 'a top-level unordered task',
      positionText: 'top-level',
    },
    {
      doc: '12. [X] ordered task',
      expected: '12. [ ] ordered task',
      name: 'an ordered task',
      positionText: 'ordered',
    },
    {
      doc: ['- [ ] parent', '    - [ ] child'].join('\n'),
      expected: ['- [ ] parent', '    - [x] child'].join('\n'),
      name: 'a task nested by four spaces',
      positionText: 'child',
    },
    {
      doc: ['> - [ ] quoted task', '>   continuation'].join('\n'),
      expected: ['> - [x] quoted task', '>   continuation'].join('\n'),
      name: 'a blockquote task from its continuation',
      positionText: 'continuation',
    },
    {
      doc: ['- [ ] task', '  continuation'].join('\n'),
      expected: ['- [x] task', '  continuation'].join('\n'),
      name: 'a task from its continuation line',
      positionText: 'continuation',
    },
  ])('toggles $name from the syntax tree', ({ doc, expected, positionText }) => {
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(doc.indexOf(positionText)),
    });

    const change = toggleTaskListAtSelection(state);

    expect(applyChange(state, change).doc.toString()).toBe(expected);
  });

  it('uses the innermost list item and never toggles its parent task', () => {
    const doc = ['- [ ] parent', '    - [ ] child'].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
    });

    const parentChange = toggleTaskAtPosition(state, doc.indexOf('parent'));
    const childChange = toggleTaskAtPosition(state, doc.indexOf('child'));

    expect(parentChange).toEqual({ from: 3, insert: 'x', to: 4 });
    expect(childChange).toEqual({
      from: doc.lastIndexOf('[ ]') + 1,
      insert: 'x',
      to: doc.lastIndexOf('[ ]') + 2,
    });
  });

  it('keeps the nested task owner at its end boundary before a sibling', () => {
    const doc = [
      '- [ ] parent',
      '    - [ ] child',
      '    - [ ] sibling',
    ].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
    });
    const childEnd = doc.indexOf('\n', doc.indexOf('child'));
    const childMarker = doc.lastIndexOf('[ ]', doc.indexOf('child'));

    expect(toggleTaskAtPosition(state, childEnd)).toEqual({
      from: childMarker + 1,
      insert: 'x',
      to: childMarker + 2,
    });
  });

  it.each([
    { current: ' ', next: 'x' },
    { current: 'x', next: ' ' },
    { current: 'X', next: ' ' },
  ])(
    'replaces only the TaskMarker state character for [$current]',
    ({ current, next }) => {
      const doc = `- [${current}] task`;
      const state = EditorState.create({
        doc,
        extensions: [markdownLanguage()],
        selection: EditorSelection.cursor(doc.indexOf('task')),
      });

      const change = toggleTaskListAtSelection(state);

      expect(change).toEqual({ from: 3, insert: next, to: 4 });
      expect(applyChange(state, change).doc.toString()).toBe(
        `- [${next}] task`,
      );
    },
  );

  it.each([
    {
      doc: ['```md', '- [ ] fenced literal', '```'].join('\n'),
      name: 'a fenced code block',
      positionText: 'fenced',
    },
    {
      doc: [
        '- [ ] parent',
        '',
        '  ```md',
        '  - [ ] fenced literal',
        '  ```',
      ].join('\n'),
      name: 'a fenced code block owned by a task item',
      positionText: 'fenced',
    },
    {
      doc: [
        '> - [ ] parent',
        '>',
        '>   ```md',
        '>   - [ ] fenced literal',
        '>   ```',
      ].join('\n'),
      name: 'a blockquoted fenced code block owned by a task item',
      positionText: 'fenced',
    },
    {
      doc: 'plain [ ] bracket text',
      name: 'ordinary bracket text',
      positionText: 'bracket',
    },
    {
      doc: '- item with [ ] bracket text',
      name: 'ordinary bracket text in a list item',
      positionText: 'bracket',
    },
  ])('does not toggle $name', ({ doc, positionText }) => {
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(doc.indexOf(positionText)),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
    expect(toggleTaskAtPosition(state, doc.indexOf(positionText))).toBeNull();
  });

  it('does not fall back to line text when no Markdown syntax tree is installed', () => {
    const doc = '- [ ] task';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf('task')),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
    expect(toggleTaskAtPosition(state, doc.indexOf('task'))).toBeNull();
  });

  it('returns null for read-only editor states', () => {
    const doc = '- [ ] task';
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage(), EditorState.readOnly.of(true)],
      selection: EditorSelection.cursor(doc.indexOf('task')),
    });

    expect(toggleTaskListAtSelection(state)).toBeNull();
    expect(toggleTaskAtPosition(state, doc.indexOf('task'))).toBeNull();
  });

  it('returns false without dispatching in a read-only editor view', () => {
    const doc = '- [ ] task';
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), EditorState.readOnly.of(true)],
        selection: EditorSelection.cursor(doc.indexOf('task')),
      }),
    });

    expect(toggleTaskListCommand(view)).toBe(false);
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
  });

  it.each([2, 3, 4, 5])(
    'keeps a caret at TaskMarker position %s stable',
    (position) => {
      const state = EditorState.create({
        doc: '- [ ] task',
        extensions: [markdownLanguage()],
        selection: EditorSelection.cursor(position),
      });

      const updated = applyChange(
        state,
        toggleTaskListAtSelection(state),
      );

      expect(selectionCoordinates(updated)).toEqual([
        { anchor: position, head: position },
      ]);
    },
  );

  it.each([
    { anchor: 2, head: 8, name: 'forward' },
    { anchor: 8, head: 2, name: 'backward' },
  ])('keeps a $name selection stable', ({ anchor, head }) => {
    const state = EditorState.create({
      doc: '- [ ] task',
      extensions: [markdownLanguage()],
      selection: EditorSelection.range(anchor, head),
    });

    const updated = applyChange(
      state,
      toggleTaskListAtSelection(state),
    );

    expect(selectionCoordinates(updated)).toEqual([{ anchor, head }]);
  });

  it('keeps every anchor and head stable for multiple selections', () => {
    const doc = ['- [ ] first', '- [x] second'].join('\n');
    const secondMarkerFrom = doc.indexOf('[x]');
    const selection = EditorSelection.create([
      EditorSelection.range(2, 8),
      EditorSelection.range(secondMarkerFrom + 6, secondMarkerFrom),
    ]);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          EditorState.allowMultipleSelections.of(true),
          markdownLanguage(),
        ],
        selection,
      }),
    });
    const before = selectionCoordinates(view.state);

    expect(toggleTaskListCommand(view)).toBe(true);

    expect(selectionCoordinates(view.state)).toEqual(before);
    expect(view.state.doc.toString()).toBe(
      ['- [x] first', '- [x] second'].join('\n'),
    );

    view.destroy();
  });
});
