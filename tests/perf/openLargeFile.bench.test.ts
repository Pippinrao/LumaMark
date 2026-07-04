import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';

describe('large Markdown file open baseline', () => {
  it.each(largeMarkdownFixturePaths)(
    'records UTF-8 read duration for $name',
    async ({ name, path }) => {
      const startedAt = performance.now();
      const source = await readFile(path, 'utf8');
      const durationMs = performance.now() - startedAt;
      const sizeMiB = Buffer.byteLength(source, 'utf8') / 1024 / 1024;

      process.stdout.write(
        `[perf:open-large-file] ${name}: ${sizeMiB.toFixed(2)} MiB read in ${durationMs.toFixed(2)} ms\n`,
      );

      expect(source.length).toBeGreaterThan(0);
      expect(Number.isFinite(durationMs)).toBe(true);
    },
  );
});
