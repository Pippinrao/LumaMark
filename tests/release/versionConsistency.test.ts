import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = join(
  process.cwd(),
  'scripts',
  'release',
  'verify-version-consistency.mjs',
);
const temporaryRoots: string[] = [];

describe('release version consistency verifier', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('accepts matching package, Cargo, Cargo lock, and Tauri versions', () => {
    const root = createVersionRoot('0.1.3');

    const result = runVerifier('--root', root, '--expected-version', '0.1.3');

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ version: '0.1.3' });
    expect(result.stderr).toBe('');
  });

  it('fails when any release version differs from the expected tag version', () => {
    const root = createVersionRoot('0.1.3');
    writeFileSync(
      join(root, 'src-tauri', 'tauri.conf.json'),
      JSON.stringify({ version: '0.1.2' }),
    );

    const result = runVerifier('--root', root, '--expected-version', '0.1.3');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'src-tauri/tauri.conf.json: expected 0.1.3, found 0.1.2',
    );
  });
});

function createVersionRoot(version: string): string {
  const root = mkdtempSync(join(tmpdir(), 'lumamark-version-consistency-'));
  temporaryRoots.push(root);
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(
    join(root, 'src-tauri', 'Cargo.toml'),
    `[package]\nname = "lumamark"\nversion = "${version}"\n`,
  );
  writeFileSync(
    join(root, 'src-tauri', 'Cargo.lock'),
    `[[package]]\nname = "lumamark"\nversion = "${version}"\n`,
  );
  writeFileSync(
    join(root, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ version }),
  );

  return root;
}

function runVerifier(...args: string[]) {
  return spawnSync('node', [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}
