import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

async function readRepoFile(relativePath: string) {
  return readFile(join(repoRoot, relativePath), 'utf8');
}

describe('Windows signed-release workflows', () => {
  it('forces GitHub-produced NSIS artifacts through the shared signing action', async () => {
    const [publish, build, action, releaseGuide, architecture] = await Promise.all([
      readRepoFile(join('.github', 'workflows', 'windows-release-publish.yml')),
      readRepoFile(join('.github', 'workflows', 'windows-release-build.yml')),
      readRepoFile(join('.github', 'actions', 'prepare-tauri-signing', 'action.yml')),
      readRepoFile(join('docs', 'release', 'WINDOWS_V1_BUILD.md')),
      readRepoFile(join('docs', 'architecture', 'DETAILED_ARCHITECTURE.md')),
    ]);

    for (const workflow of [publish, build]) {
      expect(workflow).toContain('uses: ./.github/actions/prepare-tauri-signing');
      expect(workflow).toContain('private-key: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}');
      expect(workflow).toContain(
        'private-key-password: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}',
      );
      expect(workflow).toContain('*.sig');
    }

    expect(action).toContain("throw 'TAURI_SIGNING_PRIVATE_KEY secret is required");
    expect(action).toContain('TAURI_SIGNING_PRIVATE_KEY_PATH');
    expect(publish).toContain('pnpm build:nsis');
    expect(publish).toContain('ref: ${{ github.event.inputs.tag || github.ref }}');
    expect(publish).toContain('Updater signature $sig is empty or truncated.');
    expect(build).toContain('pnpm build');
    expect(build).toContain('Unsigned CI installers are not release artifacts.');
    expect(build).toContain('Expected exactly one signed NSIS *.sig');
    expect(releaseGuide).toContain('正式分发只接受 GitHub Actions 签名发布');
    expect(architecture).toContain('windows-release-publish.yml');
  });

  it('stops leftover smoke-install processes before NSIS uninstall', async () => {
    const smoke = await readRepoFile(
      join('scripts', 'release', 'windows-installer-smoke.ps1'),
    );

    expect(smoke).toContain('function Stop-SmokeInstallProcesses');
    expect(smoke).toContain('Smoke-installed LumaMark did not exit before uninstall');
    expect(smoke).toMatch(
      /Stop-SmokeInstallProcesses -InstallDir \$resolvedInstallDir\s+Assert-NoRunningLumaMarkProcesses/,
    );
    expect(smoke).toContain(
      'Get-Process -Name lumamark -ErrorAction SilentlyContinue',
    );
  });
});
