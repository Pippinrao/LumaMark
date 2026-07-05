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
    expect(workflow).toContain('pnpm test:e2e');
    expect(workflow).toContain('pnpm quality:web-build');
    expect(workflow).toContain('cargo check --manifest-path src-tauri/Cargo.toml');
    expect(workflow).toContain('cargo test --manifest-path src-tauri/Cargo.toml');
    expect(workflow).toContain('pnpm perf:bench');
    expect(workflow.indexOf('pnpm perf:bench')).toBeGreaterThan(
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
  const content = await readFile(join(process.cwd(), 'package.json'), 'utf8');

  return JSON.parse(content) as PackageJson;
}

async function readWorkflow(name: string): Promise<string> {
  return readFile(join(process.cwd(), '.github', 'workflows', name), 'utf8');
}
