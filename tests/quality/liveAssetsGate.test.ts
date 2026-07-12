import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('live remote image asset gate', () => {
  it('validates PNG and SVG content under a bounded request timeout', async () => {
    const script = await readFile('scripts/quality/test-live-assets.mjs', 'utf8');

    expect(script).toContain('AbortSignal.timeout');
    expect(script).toContain('PNG_SIGNATURE');
    expect(script).toContain('looksLikeSvg');
  });

  it('runs as an independent two-minute CI gate', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    const workflow = await readFile('.github/workflows/v1-quality.yml', 'utf8');

    expect(packageJson.scripts['test:live-assets']).toBe(
      'pnpm test:live-assets:public && pnpm test:live-assets:rust',
    );
    expect(packageJson.scripts['test:live-assets:public']).toBe(
      'node scripts/quality/test-live-assets.mjs',
    );
    expect(packageJson.scripts['test:live-assets:rust']).toBe(
      'cargo test --manifest-path src-tauri/Cargo.toml --test remote_image_live -- --ignored --nocapture',
    );
    expect(workflow).toContain('name: Live remote image assets');
    expect(workflow).toContain('timeout-minutes: 2');
    expect(workflow).toContain('run: pnpm test:live-assets');
  });
});
