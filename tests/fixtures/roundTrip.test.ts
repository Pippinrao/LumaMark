import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownFixturePaths } from './fixturePaths';

describe('markdown fixture round-trip', () => {
  it.each(markdownFixturePaths)(
    'preserves the exact source bytes for $name',
    async ({ name, path }) => {
      const source = await readFile(path);
      const tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-round-trip-'));
      const tempPath = join(tempDirectory, name);

      try {
        await writeFile(tempPath, source);
        const roundTripped = await readFile(tempPath);

        expect(Buffer.compare(roundTripped, source)).toBe(0);
      } finally {
        await rm(tempDirectory, { recursive: true, force: true });
      }
    },
  );
});
