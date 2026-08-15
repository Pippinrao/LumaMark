type Alignment = 'center' | 'left' | 'none' | 'right';

export function canonicalizeTableFixtures(source: string): string {
  const lines = source.split('\n');

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = parseTableRow(lines[index]);
    const delimiter = parseTableRow(lines[index + 1]);

    if (
      header === null ||
      delimiter === null ||
      header.length !== delimiter.length ||
      !delimiter.every((cell) => /^:?-+:?$/.test(cell))
    ) {
      continue;
    }

    const rows = [header];
    let cursor = index + 2;
    while (cursor < lines.length) {
      const row = parseTableRow(lines[cursor]);
      if (row === null || row.length !== header.length) break;
      rows.push(row);
      cursor += 1;
    }

    const alignments = delimiter.map(readAlignment);
    const widths = header.map((_, column) =>
      Math.max(
        minimumAlignmentWidth(alignments[column]),
        ...rows.map((row) => row[column].length),
      ),
    );
    const formatted = [
      formatRow(rows[0], widths),
      formatDelimiter(widths, alignments),
      ...rows.slice(1).map((row) => formatRow(row, widths)),
    ];

    lines.splice(index, cursor - index, ...formatted);
    index += formatted.length - 1;
  }

  return lines.join('\n');
}

function parseTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

function readAlignment(delimiter: string): Alignment {
  const left = delimiter.startsWith(':');
  const right = delimiter.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return 'none';
}

function minimumAlignmentWidth(alignment: Alignment): number {
  if (alignment === 'center') return 3;
  if (alignment === 'left' || alignment === 'right') return 2;
  return 1;
}

function formatRow(row: readonly string[], widths: readonly number[]): string {
  return `| ${row
    .map((cell, column) => cell.padEnd(widths[column]))
    .join(' | ')} |`;
}

function formatDelimiter(
  widths: readonly number[],
  alignments: readonly Alignment[],
): string {
  const cells = widths.map((width, column) => {
    switch (alignments[column]) {
      case 'center':
        return `:${'-'.repeat(Math.max(1, width - 2))}:`;
      case 'left':
        return `:${'-'.repeat(Math.max(1, width - 1))}`;
      case 'right':
        return `${'-'.repeat(Math.max(1, width - 1))}:`;
      case 'none':
        return '-'.repeat(Math.max(1, width));
    }
  });

  return `| ${cells.join(' | ')} |`;
}
