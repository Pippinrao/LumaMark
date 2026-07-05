import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from '@codemirror/state';
import {
  addTableColumn,
  addTableRow,
  deleteTableColumn,
  deleteTableRow,
  serializeMarkdownTable,
  setTableAlignment,
  type MarkdownTableAlignment,
  type MarkdownTableModel,
} from './markdownTableModel';
import { collectTableBlocksInRanges } from './TableWidget';

const STARTER_TABLE = ['| Column 1 | Column 2 |', '| --- | --- |', '|  |  |'].join('\n');

export function insertMarkdownTable(state: EditorState): TransactionSpec {
  const selection = state.selection.main;
  const prefix = selection.from > 0 && state.doc.sliceString(selection.from - 1, selection.from) !== '\n'
    ? '\n'
    : '';
  const insert = `${prefix}${STARTER_TABLE}`;
  const tableStart = selection.from + prefix.length;

  return {
    changes: {
      from: selection.from,
      insert,
      to: selection.to,
    },
    selection: EditorSelection.cursor(tableStart),
    userEvent: 'input.table-insert',
  };
}

export function addRowAtSelection(
  state: EditorState,
  afterRowIndex: number,
): TransactionSpec {
  return replaceTableAtSelection(state, (table) =>
    addTableRow(table, afterRowIndex),
  );
}

export function deleteRowAtSelection(
  state: EditorState,
  rowIndex: number,
): TransactionSpec {
  return replaceTableAtSelection(state, (table) =>
    deleteTableRow(table, rowIndex),
  );
}

export function addColumnAtSelection(
  state: EditorState,
  afterColumnIndex: number,
): TransactionSpec {
  return replaceTableAtSelection(state, (table) =>
    addTableColumn(table, afterColumnIndex),
  );
}

export function deleteColumnAtSelection(
  state: EditorState,
  columnIndex: number,
): TransactionSpec {
  return replaceTableAtSelection(state, (table) =>
    deleteTableColumn(table, columnIndex),
  );
}

export function setAlignmentAtSelection(
  state: EditorState,
  columnIndex: number,
  alignment: MarkdownTableAlignment,
): TransactionSpec {
  return replaceTableAtSelection(state, (table) =>
    setTableAlignment(table, columnIndex, alignment),
  );
}

function replaceTableAtSelection(
  state: EditorState,
  edit: (table: MarkdownTableModel) => MarkdownTableModel,
): TransactionSpec {
  const table = tableAtSelection(state);

  if (!table) {
    return {};
  }

  return {
    changes: {
      from: table.from,
      insert: serializeMarkdownTable(edit(table)),
      to: table.to,
    },
    userEvent: 'input.table-edit',
  };
}

function tableAtSelection(state: EditorState): MarkdownTableModel | null {
  const head = state.selection.main.head;

  return (
    collectTableBlocksInRanges(state, [
      {
        from: 0,
        to: state.doc.length,
      },
    ]).find((table) => head >= table.from && head <= table.to) ?? null
  );
}
