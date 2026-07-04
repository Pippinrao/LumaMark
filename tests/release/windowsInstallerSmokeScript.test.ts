import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(
  process.cwd(),
  'scripts',
  'release',
  'windows-installer-smoke.ps1',
);

describe.skipIf(process.platform !== 'win32')('windows installer smoke script', () => {
  it('prints a safe NSIS plan without running the installer', () => {
    const result = runPlan('-InstallerKind', 'Nsis');

    expect(result.status).toBe(0);
    const plan = parsePlan(result.stdout);

    expect(plan.installerKind).toBe('Nsis');
    expect(plan.willExecute).toBe(false);
    expect(plan.requiresAdmin).toBe(false);
    expect(plan.existingInstallDir).toEqual(expect.any(String));
    expect(plan.installDir.toLowerCase()).toContain(
      '\\lumamark-installer-smoke\\nsis',
    );
    expect(plan.installArguments).toEqual(
      expect.arrayContaining(['/S', '/NS']),
    );
    expect(plan.installArguments.at(-1)).toMatch(/^\/D=/);
    expect(plan.executablePath).toMatch(/\\lumamark\.exe$/);
    expect(plan.uninstallPath).toMatch(/\\uninstall\.exe$/);
  });

  it('rejects install directories outside the smoke sandbox', () => {
    const outsideSandbox = join(tmpdir(), 'lumamark-outside-smoke');
    const result = runPlan(
      '-InstallerKind',
      'Nsis',
      '-InstallDir',
      outsideSandbox,
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('InstallDir must stay under');
  });

  it('marks MSI plans as administrator-gated', () => {
    const result = runPlan('-InstallerKind', 'Msi');

    expect(result.status).toBe(0);
    const plan = parsePlan(result.stdout);

    expect(plan.installerKind).toBe('Msi');
    expect(plan.willExecute).toBe(false);
    expect(plan.requiresAdmin).toBe(true);
    expect(plan.installCommand).toBe('msiexec.exe');
    expect(plan.uninstallCommand).toBe('msiexec.exe');
  });
});

type SmokePlan = {
  executablePath: string;
  existingInstallDir: string;
  installArguments: string[];
  installCommand: string;
  installDir: string;
  installerKind: 'Msi' | 'Nsis';
  requiresAdmin: boolean;
  uninstallCommand: string;
  uninstallPath: string;
  willExecute: boolean;
};

function runPlan(...args: string[]) {
  return spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-PlanOnly',
      ...args,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    },
  );
}

function parsePlan(stdout: string): SmokePlan {
  return JSON.parse(stdout.trim()) as SmokePlan;
}
