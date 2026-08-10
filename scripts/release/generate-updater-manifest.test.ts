import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildUpdaterManifest,
  generateUpdaterManifestFile,
} from './generate-updater-manifest.mjs';

describe('generate-updater-manifest', () => {
  it('builds a windows-x86_64 latest.json payload', () => {
    expect(
      buildUpdaterManifest({
        version: '0.2.17',
        signature: 'sig-content\n',
        notes: 'Fixes',
        pubDate: '2026-08-09T00:00:00.000Z',
      }),
    ).toEqual({
      version: '0.2.17',
      notes: 'Fixes',
      pub_date: '2026-08-09T00:00:00.000Z',
      platforms: {
        'windows-x86_64': {
          signature: 'sig-content',
          url: 'https://github.com/Pippinrao/LumaMark/releases/download/v0.2.17/LumaMark_0.2.17_x64-setup.exe',
        },
      },
    });
  });

  it('writes latest.json from package version and signature fixture', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lumamark-updater-manifest-'));
    const packageJsonPath = path.join(tempDir, 'package.json');
    const signaturePath = path.join(tempDir, 'LumaMark_0.2.17_x64-setup.exe.sig');
    const outputPath = path.join(tempDir, 'latest.json');

    await writeFile(packageJsonPath, JSON.stringify({ version: '0.2.17' }), 'utf8');
    await writeFile(signaturePath, 'fixture-signature', 'utf8');

    const manifest = await generateUpdaterManifestFile({
      packageJsonPath,
      signaturePath,
      outputPath,
      notes: 'Release notes',
      pubDate: '2026-08-09T12:00:00.000Z',
    });

    expect(manifest.version).toBe('0.2.17');
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(manifest);
  });

  it('fails when the signature file is missing', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lumamark-updater-manifest-'));
    const packageJsonPath = path.join(tempDir, 'package.json');
    await writeFile(packageJsonPath, JSON.stringify({ version: '0.2.17' }), 'utf8');

    const signaturePath = path.join(tempDir, 'LumaMark_0.2.17_x64-setup.exe.sig');
    await expect(
      generateUpdaterManifestFile({
        packageJsonPath,
        signaturePath,
        outputPath: path.join(tempDir, 'latest.json'),
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Missing updater signature file/),
      cause: expect.any(Error),
    });
  });
});

