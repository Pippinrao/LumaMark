import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Frontend unit CI timeouts', () => {
  it('gives Testing Library findBy queries a CI budget under the Vitest test timeout', () => {
    const viteConfig = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');
    const testingLibraryConfig = readFileSync(
      join(process.cwd(), 'src/test/testingLibraryConfig.ts'),
      'utf8',
    );

    expect(viteConfig).toMatch(/testTimeout:\s*process\.env\.CI \? 15_000 : 5_000/);
    expect(viteConfig).toContain("'src/test/testingLibraryConfig.ts'");
    expect(testingLibraryConfig).toMatch(
      /asyncUtilTimeout:\s*process\.env\.CI \? 10_000 : 1_000/,
    );
  });
});
