import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  scripts: Record<string, string>;
};

describe('package quality scripts', () => {
  it('keeps performance benchmarks out of the default unit test gate', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts.test).toContain('--exclude');
    expect(packageJson.scripts.test).toContain('tests/perf/**');
    expect(packageJson.scripts['perf:bench']).toContain('tests/perf');
  });
});

async function readPackageJson(): Promise<PackageJson> {
  const content = await readFile(join(process.cwd(), 'package.json'), 'utf8');

  return JSON.parse(content) as PackageJson;
}
