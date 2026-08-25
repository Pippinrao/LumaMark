import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('1MB document-statistics warmup', () => {
  it('warms the counted document before ADR 0007 P80 samples, not a toy string', () => {
    const bench = readFileSync(
      join(process.cwd(), 'tests/perf/documentStatisticsLargeDocument.bench.test.ts'),
      'utf8',
    );

    expect(bench).not.toContain("Text.of(['warmup'])");
    expect(bench).toMatch(
      /getDocumentStatisticsFromText\(doc\);[\s\S]+measureLatencySamples\(\(\) => \{\s*getDocumentStatisticsFromText\(doc\);/,
    );
  });
});
