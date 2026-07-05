export type MarkdownTableAlignment = 'center' | 'left' | 'none' | 'right';

export type MarkdownTableModel = {
  alignments: MarkdownTableAlignment[];
  from: number;
  header: string[];
  rows: string[][];
  to: number;
};

export type TableCellLocation = {
  columnIndex: number;
  rowIndex: number;
  section: 'body' | 'header';
};

export function parseMarkdownTable(
  source: string,
  from = 0,
): MarkdownTableModel {
  const lines = source.split(/\r?\n/);
  const header = parseTableLine(lines[0] ?? '');
  const alignments = normalizeCells(
    parseAlignmentLine(lines[1] ?? ''),
    header.length,
    'none',
  );
  const rows = lines
    .slice(2)
    .filter((line) => line.trim().length > 0)
    .map((line) => normalizeCells(parseTableLine(line), header.length, ''));

  return {
    alignments,
    from,
    header,
    rows,
    to: from + source.length,
  };
}

export function serializeMarkdownTable(table: MarkdownTableModel): string {
  const columnCount = table.header.length;
  const header = normalizeCells(table.header, columnCount, '');
  const alignments = normalizeCells(table.alignments, columnCount, 'none');

  return [
    serializeTableLine(header),
    serializeTableLine(alignments.map(serializeAlignment)),
    ...table.rows.map((row) =>
      serializeTableLine(normalizeCells(row, columnCount, '')),
    ),
  ].join('\n');
}

export function updateTableCell(
  table: MarkdownTableModel,
  location: TableCellLocation & { value: string },
): MarkdownTableModel {
  if (location.section === 'header') {
    return {
      ...table,
      header: replaceAt(table.header, location.columnIndex, location.value),
    };
  }

  return {
    ...table,
    rows: replaceAt(table.rows, location.rowIndex, (row) =>
      replaceAt(row ?? [], location.columnIndex, location.value),
    ),
  };
}

export function addTableRow(
  table: MarkdownTableModel,
  afterRowIndex: number,
): MarkdownTableModel {
  const nextRows = [...table.rows];
  const insertAt = Math.min(Math.max(afterRowIndex + 1, 0), nextRows.length);
  nextRows.splice(insertAt, 0, createEmptyRow(table.header.length));

  return {
    ...table,
    rows: nextRows,
  };
}

export function deleteTableRow(
  table: MarkdownTableModel,
  rowIndex: number,
): MarkdownTableModel {
  if (table.rows.length <= 1) {
    return {
      ...table,
      rows: [createEmptyRow(table.header.length)],
    };
  }

  return {
    ...table,
    rows: table.rows.filter((_, index) => index !== rowIndex),
  };
}

export function addTableColumn(
  table: MarkdownTableModel,
  afterColumnIndex: number,
): MarkdownTableModel {
  const insertAt = Math.min(
    Math.max(afterColumnIndex + 1, 0),
    table.header.length,
  );

  return {
    ...table,
    alignments: insertAtValue(table.alignments, insertAt, 'none'),
    header: insertAtValue(table.header, insertAt, ''),
    rows: table.rows.map((row) => insertAtValue(row, insertAt, '')),
  };
}

export function deleteTableColumn(
  table: MarkdownTableModel,
  columnIndex: number,
): MarkdownTableModel {
  if (table.header.length <= 1) {
    return table;
  }

  return {
    ...table,
    alignments: table.alignments.filter((_, index) => index !== columnIndex),
    header: table.header.filter((_, index) => index !== columnIndex),
    rows: table.rows.map((row) =>
      row.filter((_, index) => index !== columnIndex),
    ),
  };
}

export function setTableAlignment(
  table: MarkdownTableModel,
  columnIndex: number,
  alignment: MarkdownTableAlignment,
): MarkdownTableModel {
  return {
    ...table,
    alignments: replaceAt(table.alignments, columnIndex, alignment),
  };
}

export function resizeTable(
  table: MarkdownTableModel,
  size: { columns: number; rows: number },
): MarkdownTableModel {
  const columnCount = Math.max(1, Math.floor(size.columns));
  const rowCount = Math.max(1, Math.floor(size.rows));

  return {
    ...table,
    alignments: normalizeCells(table.alignments, columnCount, 'none'),
    header: normalizeCells(table.header, columnCount, ''),
    rows: Array.from({ length: rowCount }, (_, rowIndex) =>
      normalizeCells(table.rows[rowIndex] ?? [], columnCount, ''),
    ),
  };
}

function parseTableLine(line: string): string[] {
  const trimmed = trimOuterPipes(line.trim());
  const cells: string[] = [];
  let current = '';
  let escaped = false;

  for (const character of trimmed) {
    if (escaped) {
      current += character === '|' ? character : `\\${character}`;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (character === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  if (escaped) {
    current += '\\';
  }

  cells.push(current.trim());

  return cells;
}

function parseAlignmentLine(line: string): MarkdownTableAlignment[] {
  return parseTableLine(line).map((cell) => {
    const normalized = cell.replace(/\s+/g, '');
    const starts = normalized.startsWith(':');
    const ends = normalized.endsWith(':');

    if (starts && ends) {
      return 'center';
    }

    if (starts) {
      return 'left';
    }

    if (ends) {
      return 'right';
    }

    return 'none';
  });
}

function serializeTableLine(cells: readonly string[]): string {
  return `| ${cells.map(serializeCellContent).join(' | ')} |`;
}

function serializeAlignment(alignment: MarkdownTableAlignment): string {
  switch (alignment) {
    case 'center':
      return ':---:';
    case 'left':
      return ':---';
    case 'right':
      return '---:';
    case 'none':
      return '---';
  }
}

function trimOuterPipes(line: string): string {
  return line.replace(/^\|/, '').replace(/\|$/, '');
}

function serializeCellContent(cell: string): string {
  return cell.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function normalizeCells<T>(
  cells: readonly T[],
  count: number,
  emptyValue: T,
): T[] {
  return Array.from({ length: count }, (_, index) => cells[index] ?? emptyValue);
}

function createEmptyRow(columnCount: number): string[] {
  return Array.from({ length: columnCount }, () => '');
}

function insertAtValue<T>(items: readonly T[], index: number, value: T): T[] {
  const next = [...items];
  next.splice(index, 0, value);

  return next;
}

function replaceAt<T>(
  items: readonly T[],
  index: number,
  value: T | ((current: T | undefined) => T),
): T[] {
  return Array.from({ length: Math.max(items.length, index + 1) }, (_, itemIndex) => {
    if (itemIndex !== index) {
      return items[itemIndex];
    }

    return typeof value === 'function'
      ? (value as (current: T | undefined) => T)(items[itemIndex])
      : value;
  });
}
