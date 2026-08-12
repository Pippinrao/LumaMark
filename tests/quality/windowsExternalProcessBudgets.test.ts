import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const timeoutIdentifier = [
  'WINDOWS',
  'EXTERNAL',
  'PROCESS',
  'TEST',
  'TIMEOUT',
  'MS',
].join('_');

describe('Windows external-process test budgets', () => {
  it('gives hosted runners enough time for PowerShell startup and registry scans', async () => {
    const installerSmokeTest = await readTestFile(
      'tests',
      'release',
      'windowsInstallerSmokeScript.test.ts',
    );
    const packageScriptsTest = await readTestFile(
      'tests',
      'quality',
      'packageScripts.test.ts',
    );

    expect(installerSmokeTest).toContain(
      `const ${timeoutIdentifier} = 15_000;`,
    );
    expect(
      installerSmokeTest.match(new RegExp(timeoutIdentifier, 'g')),
    ).toHaveLength(5);
    expect(packageScriptsTest).toContain(
      `const ${timeoutIdentifier} = 15_000;`,
    );
    expect(
      packageScriptsTest.match(new RegExp(timeoutIdentifier, 'g')),
    ).toHaveLength(2);
  });
});

async function readTestFile(...segments: string[]) {
  return readFile(join(process.cwd(), ...segments), 'utf8');
}
