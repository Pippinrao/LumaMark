import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  scripts: Record<string, string>;
};

type TauriCapability = {
  permissions: string[];
};

describe('package quality scripts', () => {
  it('grants the custom window chrome permissions used by AppShell controls', async () => {
    const capability = await readJsonFile<TauriCapability>(
      'src-tauri',
      'capabilities',
      'default.json',
    );

    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        'core:window:allow-close',
        'core:window:allow-is-maximized',
        'core:window:allow-minimize',
        'core:window:allow-start-dragging',
        'core:window:allow-toggle-maximize',
      ]),
    );
  });

  it('keeps performance benchmarks out of the default unit test gate', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts.test).toContain('--exclude');
    expect(packageJson.scripts.test).toContain('tests/perf/**');
    expect(packageJson.scripts['perf:bench']).toContain('tests/perf');
    expect(packageJson.scripts['perf:bench']).toContain(
      '--no-file-parallelism',
    );
  });

  it('defines a release artifact verification script', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['release:verify-artifacts']).toBe(
      'node scripts/release/verify-windows-artifacts.mjs',
    );
  });

  it('defines a focused V1 UX prototype quality script', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['quality:v1-ux-prototype']).toBe(
      'playwright test tests/e2e/v1-ux-prototype.spec.ts',
    );
  });

  it('defines a V1 UX screenshot capture script for visual review evidence', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['quality:v1-ux-screenshots']).toBe(
      'node scripts/quality/capture-v1-ux-screenshots.mjs',
    );
    await expectFile('scripts', 'quality', 'capture-v1-ux-screenshots.mjs');
  });

  it('defines explicit Markdown corpus download and verification scripts', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['download:markdown-corpus']).toBe(
      'node scripts/quality/download-markdown-corpus.mjs',
    );
    expect(packageJson.scripts['test:markdown-corpus']).toBe(
      'node scripts/quality/test-markdown-corpus.mjs',
    );
    await expectFile('scripts', 'quality', 'markdown-corpus-manifest.json');
    await expectFile('scripts', 'quality', 'download-markdown-corpus.mjs');
    await expectFile('scripts', 'quality', 'test-markdown-corpus.mjs');
  });

  it('defines a GitHub Actions V1 quality gate with isolated performance benchmarks', async () => {
    const workflow = await readWorkflow('v1-quality.yml');

    expect(workflow).toContain('name: V1 Quality Gate');
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('actions/checkout@v7');
    expect(workflow).toContain('actions/setup-node@v6');
    expect(workflow).toContain('pnpm/action-setup@v6');
    expect(workflow).toContain('registry-url: https://registry.npmmirror.com/');
    expect(workflow).toContain(
      'PLAYWRIGHT_DOWNLOAD_HOST: https://npmmirror.com/mirrors/playwright',
    );
    expect(workflow).toContain('pnpm typecheck');
    expect(workflow).toContain('pnpm lint');
    expect(workflow).toContain('pnpm test');
    expect(workflow).toContain('pnpm test:fixtures');
    expect(workflow).toContain('pnpm download:markdown-corpus');
    expect(workflow).toContain('pnpm test:markdown-corpus');
    expect(workflow).toContain('pnpm quality:v1-ux-prototype');
    expect(workflow).toContain('pnpm quality:v1-ux-screenshots');
    expect(workflow).toContain('actions/upload-artifact@v7');
    expect(workflow).toContain('name: v1-ux-screenshots');
    expect(workflow).toContain('test-results/v1-ux-screenshots/*.png');
    expect(workflow).toContain('pnpm test:e2e');
    expect(workflow).toContain('pnpm test:live-assets');
    expect(workflow).toContain('pnpm quality:web-build');
    expect(workflow).toContain('pnpm test:e2e:production');
    expect(workflow).toContain('cargo check --manifest-path src-tauri/Cargo.toml');
    expect(workflow).toContain('cargo test --manifest-path src-tauri/Cargo.toml');
    expect(workflow.indexOf('pnpm quality:v1-ux-prototype')).toBeLessThan(
      workflow.indexOf('pnpm test:e2e'),
    );
    expect(workflow.indexOf('pnpm quality:v1-ux-screenshots')).toBeLessThan(
      workflow.indexOf('test-results/v1-ux-screenshots/*.png'),
    );
    expect(workflow.indexOf('pnpm download:markdown-corpus')).toBeLessThan(
      workflow.indexOf('pnpm test:markdown-corpus'),
    );
    expect(workflow.indexOf('pnpm test:markdown-corpus')).toBeLessThan(
      workflow.indexOf('pnpm test:e2e'),
    );
    expect(workflow).toContain('pnpm perf:bench');
    expect(workflow.indexOf('pnpm perf:bench')).toBeGreaterThan(
      workflow.indexOf('pnpm quality:web-build'),
    );
    expect(workflow.indexOf('pnpm test:e2e:production')).toBeGreaterThan(
      workflow.indexOf('pnpm quality:web-build'),
    );
  });

  it('defines a manual Windows release build workflow that uploads installer artifacts', async () => {
    const workflow = await readWorkflow('windows-release-build.yml');

    expect(workflow).toContain('name: Windows Release Build');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('runs-on: windows-latest');
    expect(workflow).toContain('actions/checkout@v7');
    expect(workflow).toContain('actions/setup-node@v6');
    expect(workflow).toContain('pnpm/action-setup@v6');
    expect(workflow).toContain('actions/upload-artifact@v7');
    expect(workflow).toContain('registry-url: https://registry.npmmirror.com/');
    expect(workflow).toContain('pnpm install --frozen-lockfile');
    expect(workflow).toContain('pnpm build');
    expect(workflow).toContain('pnpm release:verify-artifacts');
    expect(workflow.indexOf('pnpm release:verify-artifacts')).toBeGreaterThan(
      workflow.indexOf('pnpm build'),
    );
    expect(workflow).toContain('src-tauri/target/release/lumamark.exe');
    expect(workflow).toContain('src-tauri/target/release/bundle/msi/*.msi');
    expect(workflow).toContain('src-tauri/target/release/bundle/nsis/*setup.exe');
    expect(workflow).toContain(
      'src-tauri/target/release/lumamark-windows-artifacts.json',
    );
  });
});

async function readPackageJson(): Promise<PackageJson> {
  return readJsonFile<PackageJson>('package.json');
}

async function readJsonFile<T>(...segments: string[]): Promise<T> {
  const content = await readFile(join(process.cwd(), ...segments), 'utf8');

  return JSON.parse(content) as T;
}

async function readWorkflow(name: string): Promise<string> {
  return readFile(join(process.cwd(), '.github', 'workflows', name), 'utf8');
}

async function expectFile(...segments: string[]): Promise<void> {
  await expect(access(join(process.cwd(), ...segments))).resolves.toBeUndefined();
}
