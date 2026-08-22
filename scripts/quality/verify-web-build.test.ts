import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

describe('verify-web-build', () => {
  it(
    'accepts the canonical indented Apache license heading generated from MathJax',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-canonical-license-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const assetsDirectory = path.join(distDirectory, 'assets');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(assetsDirectory, { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });
      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writePlantumlRenderFrame(distDirectory);
      await writeFile(path.join(assetsDirectory, 'index.js'), '0;', 'utf8');
      await Promise.all(
        Array.from({ length: 105 }, (_, index) =>
          writeFile(
            path.join(assetsDirectory, `mjx-ncm-${index}.woff2`),
            '',
          ),
        ),
      );
      await writeFile(
        path.join(distDirectory, 'THIRD_PARTY_LICENSES.txt'),
        [
          '@mathjax/src 4.1.3',
          '@mathjax/mathjax-newcm-font 4.1.3',
          'mhchemparser 4.2.1',
          'License: Apache-2.0',
          'Canonical license SHA-256: CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30',
          'mhchemparser license SHA-256: B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1',
          '                                 Apache License',
          '                           Version 2.0, January 2004',
        ].join('\n'),
        'utf8',
      );
      await writeFakePnpm(fakeBinDirectory);

      const result = await runVerifier(
        repositoryRoot,
        temporaryDirectory,
        fakeBinDirectory,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    },
    10_000,
  );

  it(
    'rejects Rolldown plugin timing warnings as a governed build failure',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-plugin-timings-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const assetsDirectory = path.join(distDirectory, 'assets');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(assetsDirectory, { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });
      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writePlantumlRenderFrame(distDirectory);
      await writeFile(path.join(assetsDirectory, 'index.js'), '0;', 'utf8');
      await Promise.all(
        Array.from({ length: 105 }, (_, index) =>
          writeFile(
            path.join(assetsDirectory, `mjx-ncm-${index}.woff2`),
            '',
          ),
        ),
      );
      await writeFile(
        path.join(distDirectory, 'THIRD_PARTY_LICENSES.txt'),
        [
          '@mathjax/src 4.1.3',
          '@mathjax/mathjax-newcm-font 4.1.3',
          'License: Apache-2.0',
          'Canonical license SHA-256: CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30',
          'Apache License',
          'Version 2.0, January 2004',
        ].join('\n'),
        'utf8',
      );
      await writeFakePnpm(
        fakeBinDirectory,
        '[PLUGIN_TIMINGS] react plugin exceeded timing budget',
      );

      const result = await runVerifier(
        repositoryRoot,
        temporaryDirectory,
        fakeBinDirectory,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        '[quality:web-build] Rolldown emitted a PLUGIN_TIMINGS warning.',
      );
    },
    10_000,
  );

  it(
    'accepts Rolldown plugin timing warnings that only name vite:asset',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-plugin-timings-asset-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const assetsDirectory = path.join(distDirectory, 'assets');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(assetsDirectory, { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });
      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writePlantumlRenderFrame(distDirectory);
      await writeFile(path.join(assetsDirectory, 'index.js'), '0;', 'utf8');
      await Promise.all(
        Array.from({ length: 105 }, (_, index) =>
          writeFile(
            path.join(assetsDirectory, `mjx-ncm-${index}.woff2`),
            '',
          ),
        ),
      );
      await writeFile(
        path.join(distDirectory, 'THIRD_PARTY_LICENSES.txt'),
        [
          '@mathjax/src 4.1.3',
          '@mathjax/mathjax-newcm-font 4.1.3',
          'mhchemparser 4.2.1',
          'License: Apache-2.0',
          'Canonical license SHA-256: CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30',
          'mhchemparser license SHA-256: B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1',
          '                                 Apache License',
          '                           Version 2.0, January 2004',
        ].join('\n'),
        'utf8',
      );
      await writeFakePnpm(
        fakeBinDirectory,
        '[PLUGIN_TIMINGS] Your build spent significant time in plugin `vite:asset`.',
      );

      const result = await runVerifier(
        repositoryRoot,
        temporaryDirectory,
        fakeBinDirectory,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain(
        '[PLUGIN_TIMINGS] Your build spent significant time in plugin `vite:asset`.',
      );
      expect(result.stderr).not.toContain(
        '[quality:web-build] Rolldown emitted a PLUGIN_TIMINGS warning.',
      );
    },
    10_000,
  );

  it(
    'rejects a web build without the packaged third-party license notice',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-license-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const assetsDirectory = path.join(distDirectory, 'assets');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(assetsDirectory, { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });
      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writePlantumlRenderFrame(distDirectory);
      await writeFile(path.join(assetsDirectory, 'index.js'), '0;', 'utf8');
      await Promise.all(
        Array.from({ length: 105 }, (_, index) =>
          writeFile(
            path.join(assetsDirectory, `mjx-ncm-${index}.woff2`),
            '',
          ),
        ),
      );
      await writeFakePnpm(fakeBinDirectory);

      const result = await runVerifier(
        repositoryRoot,
        temporaryDirectory,
        fakeBinDirectory,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        '[quality:web-build] Missing dist/THIRD_PARTY_LICENSES.txt.',
      );
    },
    10_000,
  );

  it(
    'rejects an incomplete packaged NewCM font asset set',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-fonts-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const assetsDirectory = path.join(distDirectory, 'assets');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(assetsDirectory, { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });
      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writePlantumlRenderFrame(distDirectory);
      await writeFile(path.join(assetsDirectory, 'index.js'), '0;', 'utf8');
      await Promise.all(
        Array.from({ length: 104 }, (_, index) =>
          writeFile(
            path.join(assetsDirectory, `mjx-ncm-${index}.woff2`),
            '',
          ),
        ),
      );
      await writeFakePnpm(fakeBinDirectory);

      const result = await runVerifier(
        repositoryRoot,
        temporaryDirectory,
        fakeBinDirectory,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        '[quality:web-build] Expected 105 packaged NewCM WOFF2 assets, found 104.',
      );
    },
    10_000,
  );

  it(
    'rejects an oversized JavaScript chunk outside dist/assets',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-budget-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(path.join(distDirectory, 'assets'), { recursive: true });
      await mkdir(path.join(distDirectory, 'workers'), { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });

      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writeFile(path.join(distDirectory, 'assets', 'index.js'), '0;', 'utf8');
      await writeFile(
        path.join(distDirectory, 'workers', 'math-worker.js'),
        '0'.repeat(700 * 1024 + 1),
        'utf8',
      );

      await writeFakePnpm(fakeBinDirectory);

      const result = await runVerifier(repositoryRoot, temporaryDirectory, fakeBinDirectory);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('[quality:web-build] Web chunk budget failed.');
      expect(result.stderr).toMatch(/workers[\\/]math-worker\.js/);
    },
    10_000,
  );

  it(
    'exempts lazy PlantUML and Graphviz engine chunks from the 700KiB JavaScript budget',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-plantuml-exempt-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const assetsDirectory = path.join(distDirectory, 'assets');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(assetsDirectory, { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });
      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writePlantumlRenderFrame(distDirectory);
      await writeFile(path.join(assetsDirectory, 'index.js'), '0;', 'utf8');
      await writeFile(
        path.join(assetsDirectory, 'plantuml-core.js'),
        '0'.repeat(700 * 1024 + 1),
        'utf8',
      );
      await writeFile(
        path.join(assetsDirectory, 'viz-global-engine.js'),
        '0'.repeat(700 * 1024 + 1),
        'utf8',
      );
      await Promise.all(
        Array.from({ length: 105 }, (_, index) =>
          writeFile(
            path.join(assetsDirectory, `mjx-ncm-${index}.woff2`),
            '',
          ),
        ),
      );
      await writeFile(
        path.join(distDirectory, 'THIRD_PARTY_LICENSES.txt'),
        [
          '@mathjax/src 4.1.3',
          '@mathjax/mathjax-newcm-font 4.1.3',
          'mhchemparser 4.2.1',
          'License: Apache-2.0',
          'Canonical license SHA-256: CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30',
          'mhchemparser license SHA-256: B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1',
          '                                 Apache License',
          '                           Version 2.0, January 2004',
        ].join('\n'),
        'utf8',
      );
      await writeFakePnpm(fakeBinDirectory);

      const result = await runVerifier(
        repositoryRoot,
        temporaryDirectory,
        fakeBinDirectory,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    },
    10_000,
  );

  it(
    'rejects a web build without the bundled PlantUML renderer page',
    async () => {
      const repositoryRoot = process.cwd();
      const temporaryDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'lumamark-web-build-plantuml-frame-'),
      );
      temporaryDirectories.push(temporaryDirectory);

      const distDirectory = path.join(temporaryDirectory, 'dist');
      const assetsDirectory = path.join(distDirectory, 'assets');
      const fakeBinDirectory = path.join(temporaryDirectory, 'fake-bin');
      await mkdir(assetsDirectory, { recursive: true });
      await mkdir(fakeBinDirectory, { recursive: true });
      await writeFile(
        path.join(distDirectory, 'index.html'),
        '<script type="module" src="/assets/index.js"></script>',
        'utf8',
      );
      await writeFile(path.join(assetsDirectory, 'index.js'), '0;', 'utf8');
      await Promise.all(
        Array.from({ length: 105 }, (_, index) =>
          writeFile(
            path.join(assetsDirectory, `mjx-ncm-${index}.woff2`),
            '',
          ),
        ),
      );
      await writeFile(
        path.join(distDirectory, 'THIRD_PARTY_LICENSES.txt'),
        [
          '@mathjax/src 4.1.3',
          '@mathjax/mathjax-newcm-font 4.1.3',
          'mhchemparser 4.2.1',
          'License: Apache-2.0',
          'Canonical license SHA-256: CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30',
          'mhchemparser license SHA-256: B40930BBCF80744C86C46A12BC9DA056641D722716C378F5659B9E555EF833E1',
          '                                 Apache License',
          '                           Version 2.0, January 2004',
        ].join('\n'),
        'utf8',
      );
      await writeFakePnpm(fakeBinDirectory);

      const result = await runVerifier(
        repositoryRoot,
        temporaryDirectory,
        fakeBinDirectory,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        '[quality:web-build] Missing dist/plantuml-render-frame.html.',
      );
    },
    10_000,
  );
});

async function writePlantumlRenderFrame(distDirectory: string) {
  await writeFile(
    path.join(distDirectory, 'plantuml-render-frame.html'),
    '<script type="module" src="/assets/plantuml-render-frame.js"></script>',
    'utf8',
  );
}

async function writeFakePnpm(fakeBinDirectory: string, output = '') {
  if (process.platform === 'win32') {
    await writeFile(
      path.join(fakeBinDirectory, 'pnpm.cmd'),
      `@echo off\r\n${output ? `echo ${output} 1>&2\r\n` : ''}exit /b 0\r\n`,
      'utf8',
    );
    return;
  }

  const executablePath = path.join(fakeBinDirectory, 'pnpm');
  await writeFile(
    executablePath,
    `#!/bin/sh\n${output ? `echo '${output}' >&2\n` : ''}exit 0\n`,
    'utf8',
  );
  await chmod(executablePath, 0o755);
}

function runVerifier(
  repositoryRoot: string,
  workingDirectory: string,
  fakeBinDirectory: string,
) {
  return new Promise<{ exitCode: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const pathEnvironmentKey =
        Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
      const child = spawn(
        process.execPath,
        [path.join(repositoryRoot, 'scripts', 'quality', 'verify-web-build.mjs')],
        {
          cwd: workingDirectory,
          env: {
            ...process.env,
            [pathEnvironmentKey]: `${fakeBinDirectory}${path.delimiter}${process.env[pathEnvironmentKey] ?? ''}`,
          },
          windowsHide: true,
        },
      );
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.once('error', reject);
      child.once('close', (exitCode) => resolve({ exitCode, stderr, stdout }));
    },
  );
}
