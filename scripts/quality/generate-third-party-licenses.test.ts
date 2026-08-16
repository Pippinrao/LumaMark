import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('generate-third-party-licenses', () => {
  it('writes a deterministic Apache-2.0 notice for MathJax and mhchemparser', async () => {
    const fixture = await createFixture();
    const result = await runGenerator(fixture.root);

    expect(result.exitCode).toBe(0);
    const notice = await readFile(
      path.join(fixture.root, 'dist', 'THIRD_PARTY_LICENSES.txt'),
      'utf8',
    );
    expect(notice).toContain('@mathjax/src 4.1.3');
    expect(notice).toContain('@mathjax/mathjax-newcm-font 4.1.3');
    expect(notice).toContain('mhchemparser 4.2.1');
    expect(notice).toContain('License: Apache-2.0');
    expect(notice).toContain(fixture.licenseText.trim());
    expect(notice).toContain(fixture.mhchemLicenseText.trim());
    expect(notice).toContain(
      'mhchemparser license SHA-256: B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1',
    );
    await expect(
      readFile(
        path.join(
          fixture.root,
          'src-tauri',
          'resources',
          'THIRD_PARTY_LICENSES.txt',
        ),
        'utf8',
      ),
    ).resolves.toBe(notice);
  });

  it('fails closed when the canonical MathJax license text changes', async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.root, 'node_modules', '@mathjax', 'src', 'LICENSE'),
      `${fixture.licenseText}\nmodified`,
      'utf8',
    );

    const result = await runGenerator(fixture.root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('MathJax Apache-2.0 license SHA-256 mismatch');
  });

  it('fails closed when the mhchemparser license text changes', async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.root, 'node_modules', 'mhchemparser', 'LICENSE.txt'),
      `${fixture.mhchemLicenseText}\nmodified`,
      'utf8',
    );

    const result = await runGenerator(fixture.root);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'mhchemparser Apache-2.0 license SHA-256 mismatch',
    );
  });
});

async function createFixture() {
  const repositoryRoot = process.cwd();
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'lumamark-third-party-licenses-'),
  );
  temporaryDirectories.push(root);
  const licenseText = await readFile(
    path.join(repositoryRoot, 'node_modules', '@mathjax', 'src', 'LICENSE'),
    'utf8',
  );
  const mhchemLicenseText = await readFile(
    path.join(
      repositoryRoot,
      'node_modules',
      '.pnpm',
      'mhchemparser@4.2.1',
      'node_modules',
      'mhchemparser',
      'LICENSE.txt',
    ),
    'utf8',
  ).catch(async () =>
    readFile(
      path.join(
        repositoryRoot,
        'node_modules',
        '@mathjax',
        'src',
        'node_modules',
        'mhchemparser',
        'LICENSE.txt',
      ),
      'utf8',
    ),
  );

  await mkdir(path.join(root, 'node_modules', '@mathjax', 'src'), {
    recursive: true,
  });
  await mkdir(
    path.join(root, 'node_modules', '@mathjax', 'mathjax-newcm-font'),
    { recursive: true },
  );
  await mkdir(path.join(root, 'node_modules', 'mhchemparser'), {
    recursive: true,
  });
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@mathjax/mathjax-newcm-font': '4.1.3',
        '@mathjax/src': '4.1.3',
      },
    }),
    'utf8',
  );
  await writeFile(
    path.join(root, 'node_modules', '@mathjax', 'src', 'package.json'),
    JSON.stringify({
      license: 'Apache-2.0',
      name: '@mathjax/src',
      repository: { url: 'https://github.com/mathjax/Mathjax-src' },
      version: '4.1.3',
    }),
    'utf8',
  );
  await writeFile(
    path.join(
      root,
      'node_modules',
      '@mathjax',
      'mathjax-newcm-font',
      'package.json',
    ),
    JSON.stringify({
      license: 'Apache-2.0',
      name: '@mathjax/mathjax-newcm-font',
      repository: { url: 'https://github.com/mathjax/MathJax-fonts.git' },
      version: '4.1.3',
    }),
    'utf8',
  );
  await writeFile(
    path.join(root, 'node_modules', 'mhchemparser', 'package.json'),
    JSON.stringify({
      license: 'Apache-2.0',
      name: 'mhchemparser',
      repository: 'github:mhchem/mhchemParser',
      version: '4.2.1',
    }),
    'utf8',
  );
  await writeFile(
    path.join(root, 'node_modules', '@mathjax', 'src', 'LICENSE'),
    licenseText,
    'utf8',
  );
  await writeFile(
    path.join(root, 'node_modules', 'mhchemparser', 'LICENSE.txt'),
    mhchemLicenseText,
    'utf8',
  );

  return { licenseText, mhchemLicenseText, root };
}

function runGenerator(root: string) {
  return new Promise<{ exitCode: number | null; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          path.join(
            process.cwd(),
            'scripts',
            'quality',
            'generate-third-party-licenses.mjs',
          ),
          '--root',
          root,
        ],
        { windowsHide: true },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.once('error', reject);
      child.once('close', (exitCode) => resolve({ exitCode, stderr }));
    },
  );
}
