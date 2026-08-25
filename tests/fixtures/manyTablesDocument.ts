export const MANY_TABLES_OPEN_COUNT = 32;

export function createManyTablesDocument(
  tableCount = MANY_TABLES_OPEN_COUNT,
): string {
  const tables = Array.from({ length: tableCount }, (_, index) => {
    const n = String(index + 1).padStart(2, '0');
    return [
      `## Table ${n}`,
      '',
      `| Col | Name | Value |`,
      `| --- | ---- | ----- |`,
      `| A${n} | alpha | ${index} |`,
      `| B${n} | beta | ${index + 1} |`,
      `| C${n} | gamma | ${index + 2} |`,
      '',
    ].join('\n');
  });

  return [
    '# Many tables',
    '',
    'Lead-in paragraph before the tables.',
    '',
    ...tables,
    'Tail paragraph after the tables.',
    '',
  ].join('\n');
}
