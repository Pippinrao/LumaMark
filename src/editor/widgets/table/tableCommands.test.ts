import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import {
  addColumnAtSelection,
  addRowAtSelection,
  deleteColumnAtSelection,
  deleteRowAtSelection,
  insertMarkdownTable,
  setAlignmentAtSelection,
} from './tableCommands';

describe('table commands', () => {
  it('inserts a starter GFM table at the selection', () => {
    const state = EditorState.create({
      doc: 'before\n',
      extensions: [markdownLanguage()],
      selection: EditorSelection.cursor(7),
    });
    const transaction = state.update(insertMarkdownTable(state));

    expect(transaction.state.doc.toString()).toBe(
      ['before', '| Column 1 | Column 2 |', '| --- | --- |', '|  |  |'].join('\n'),
    );
  });

  it('adds and deletes rows in the table containing the selection', () => {
    const state = createTableState();
    const withRow = state.update(addRowAtSelection(state, 0)).state;
    const withoutRow = withRow.update(deleteRowAtSelection(withRow, 1)).state;

    expect(withRow.doc.toString()).toContain('|  |  |');
    expect(withoutRow.doc.toString()).toBe(createTableSource());
  });

  it('adds and deletes columns in the table containing the selection', () => {
    const state = createTableState();
    const withColumn = state.update(addColumnAtSelection(state, 0)).state;
    const withoutColumn = withColumn.update(deleteColumnAtSelection(withColumn, 1)).state;

    expect(withColumn.doc.toString()).toBe(
      ['before', '', '| A |  | B |', '| --- | --- | --- |', '| 1 |  | 2 |', '', 'after'].join('\n'),
    );
    expect(withoutColumn.doc.toString()).toBe(createTableSource());
  });

  it('sets alignment in the table containing the selection', () => {
    const state = createTableState();
    const transaction = state.update(setAlignmentAtSelection(state, 1, 'right'));

    expect(transaction.state.doc.toString()).toBe(
      ['before', '', '| A | B |', '| --- | ---: |', '| 1 | 2 |', '', 'after'].join('\n'),
    );
  });
});

function createTableState(): EditorState {
  const source = createTableSource();

  return EditorState.create({
    doc: source,
    extensions: [markdownLanguage()],
    selection: EditorSelection.cursor(source.indexOf('1')),
  });
}

function createTableSource(): string {
  return ['before', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n');
}
