import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = join(
  process.cwd(),
  'scripts',
  'release',
  'verify-windows-artifacts.mjs',
);

const tempRoots: string[] = [];

describe('windows release artifact verifier', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, {
        force: true,
        recursive: true,
      });
    }
  });

  it('prints a manifest with sizes and sha256 hashes for Windows release artifacts', () => {
    const root = createArtifactRoot({
      'src-tauri/target/release/lumamark.exe': 'exe-content',
      'src-tauri/target/release/bundle/msi/LumaMark_0.1.0_x64_en-US.msi':
        'msi-content',
      'src-tauri/target/release/bundle/nsis/LumaMark_0.1.0_x64-setup.exe':
        'nsis-content',
    });

    const result = runVerifier('--root', root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const manifest = JSON.parse(result.stdout) as ArtifactManifest;
    expect(manifest.generatedAt).toEqual(expect.any(String));
    expect(manifest.root).toBe(root);
    expect(manifest.artifacts).toHaveLength(3);
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'exe',
          path: 'src-tauri/target/release/lumamark.exe',
          sizeBytes: 11,
          sha256:
            'c4f69a3c35671f2fe0ef9e54b4e535541d89f7e45774ddb7d31cef7223320117',
        }),
        expect.objectContaining({
          kind: 'msi',
          path:
            'src-tauri/target/release/bundle/msi/LumaMark_0.1.0_x64_en-US.msi',
          sizeBytes: 11,
          sha256:
            '376423ee71233d8bdd307d29259765101d5a52cf7cd991e2cd0238a2a55ea907',
        }),
        expect.objectContaining({
          kind: 'nsis',
          path:
            'src-tauri/target/release/bundle/nsis/LumaMark_0.1.0_x64-setup.exe',
          sizeBytes: 12,
          sha256:
            '27fdf16ef6c28d7bbbb313820967f04c62f3c798b4e9f23376af3d1ce38a5fb7',
        }),
      ]),
    );
  });

  it('fails when a required Windows artifact is missing', () => {
    const root = createArtifactRoot({
      'src-tauri/target/release/lumamark.exe': 'exe-content',
      'src-tauri/target/release/bundle/nsis/LumaMark_0.1.0_x64-setup.exe':
        'nsis-content',
    });

    const result = runVerifier('--root', root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing required artifact: msi');
  });
});

type ArtifactManifest = {
  artifacts: Array<{
    kind: 'exe' | 'msi' | 'nsis';
    path: string;
    sha256: string;
    sizeBytes: number;
  }>;
  generatedAt: string;
  root: string;
};

function createArtifactRoot(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'lumamark-release-artifacts-'));
  tempRoots.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(root, ...relativePath.split('/'));
    mkdirSync(join(fullPath, '..'), {
      recursive: true,
    });
    writeFileSync(fullPath, content, {
      flag: 'wx',
    });
  }

  return root;
}

function runVerifier(...args: string[]) {
  return spawnSync('node', [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}
