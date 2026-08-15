import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Vitest workspace isolation', () => {
  it('does not discover tests copied into a workspace-local pnpm store', () => {
    const config = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf8');

    expect(config).toContain("'**/.pnpm-store/**'");
  });
});
