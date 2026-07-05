import { describe, expect, it } from 'vitest';
import {
  addTableColumn,
  addTableRow,
  deleteTableColumn,
  deleteTableRow,
  parseMarkdownTable,
  resizeTable,
  serializeMarkdownTable,
  setTableAlignment,
  updateTableCell,
} from './markdownTableModel';

describe('markdown table model', () => {
  it('parses GFM table source with alignment empty cells and Chinese content', () => {
    const table = parseMarkdownTable(
      [
        '| 名称 | Status | Notes |',
        '| :--- | :---: | ---: |',
        '| Luma | Ready | 中文 |',
        '| Empty | | Tail |',
      ].join('\n'),
      12,
    );

    expect(table).toEqual({
      alignments: ['left', 'center', 'right'],
      from: 12,
      header: ['名称', 'Status', 'Notes'],
      rows: [
        ['Luma', 'Ready', '中文'],
        ['Empty', '', 'Tail'],
      ],
      to: 100,
    });
  });

  it('normalizes uneven rows to the header column count', () => {
    const table = parseMarkdownTable(
      ['| A | B | C |', '| --- | --- | --- |', '| 1 | 2 |', '| 3 | 4 | 5 | 6 |'].join('\n'),
      0,
    );

    expect(table.rows).toEqual([
      ['1', '2', ''],
      ['3', '4', '5'],
    ]);
  });

  it('keeps escaped pipe characters inside cells and escapes edited pipe content', () => {
    const table = parseMarkdownTable(
      ['| A | B |', '| --- | --- |', String.raw`| 1 \| one | 2 |`].join('\n'),
      0,
    );
    const edited = updateTableCell(table, {
      columnIndex: 1,
      rowIndex: 0,
      section: 'body',
      value: 'A | B',
    });

    expect(table.rows).toEqual([['1 | one', '2']]);
    expect(serializeMarkdownTable(edited)).toBe(
      [String.raw`| A | B |`, String.raw`| --- | --- |`, String.raw`| 1 \| one | A \| B |`].join('\n'),
    );
  });

  it('serializes edited table model as legal GFM markdown', () => {
    const table = parseMarkdownTable(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
      0,
    );
    const edited = updateTableCell(table, {
      columnIndex: 1,
      rowIndex: 0,
      section: 'body',
      value: 'Updated',
    });

    expect(serializeMarkdownTable(edited)).toBe(
      ['| A | B |', '| --- | --- |', '| 1 | Updated |'].join('\n'),
    );
  });

  it('adds and deletes rows and columns without mutating the original table', () => {
    const table = parseMarkdownTable(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
      0,
    );
    const withRow = addTableRow(table, 1);
    const withColumn = addTableColumn(withRow, 1);
    const withoutRow = deleteTableRow(withColumn, 0);
    const withoutColumn = deleteTableColumn(withoutRow, 2);

    expect(table.rows).toEqual([['1', '2']]);
    expect(serializeMarkdownTable(withoutColumn)).toBe(
      ['| A | B |', '| --- | --- |', '|  |  |'].join('\n'),
    );
  });

  it('updates column alignment', () => {
    const table = parseMarkdownTable(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
      0,
    );

    expect(serializeMarkdownTable(setTableAlignment(table, 1, 'right'))).toBe(
      ['| A | B |', '| --- | ---: |', '| 1 | 2 |'].join('\n'),
    );
  });

  it('resizes body rows and columns while preserving top-left content', () => {
    const table = parseMarkdownTable(
      [
        '| A | B | C |',
        '| :--- | :---: | ---: |',
        '| 1 | 2 | 3 |',
        '| 4 | 5 | 6 |',
      ].join('\n'),
      0,
    );

    expect(serializeMarkdownTable(resizeTable(table, { columns: 2, rows: 3 }))).toBe(
      [
        '| A | B |',
        '| :--- | :---: |',
        '| 1 | 2 |',
        '| 4 | 5 |',
        '|  |  |',
      ].join('\n'),
    );
  });

  it('keeps resized tables legal with at least one column and one body row', () => {
    const table = parseMarkdownTable(
      ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'),
      0,
    );

    expect(serializeMarkdownTable(resizeTable(table, { columns: 0, rows: 0 }))).toBe(
      ['| A |', '| --- |', '| 1 |'].join('\n'),
    );
  });
});
