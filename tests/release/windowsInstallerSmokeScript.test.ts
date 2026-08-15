import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(
  process.cwd(),
  'scripts',
  'release',
  'windows-installer-smoke.ps1',
);
const WINDOWS_EXTERNAL_PROCESS_TEST_TIMEOUT_MS = 15_000;

describe.skipIf(process.platform !== 'win32')('windows installer smoke script', () => {
  it('prints a safe NSIS plan without running the installer', () => {
    const result = runPlan('-InstallerKind', 'Nsis');

    expect(result.status).toBe(0);
    const plan = parsePlan(result.stdout);

    expect(plan.installerKind).toBe('Nsis');
    expect(plan.willExecute).toBe(false);
    expect(plan.requiresAdmin).toBe(false);
    expect(plan.existingInstallDir).toEqual(expect.any(String));
    expect(plan.blockingRegistryState).toEqual(expect.any(Array));
    expect(plan.existingAssociationState).toEqual(expect.any(Array));
    expect(plan.installDir.toLowerCase()).toContain(
      '\\lumamark-installer-smoke\\nsis',
    );
    expect(plan.installArguments).toEqual(
      expect.arrayContaining(['/S', '/NS']),
    );
    expect(plan.installArguments.at(-1)).toMatch(/^\/D=/);
    expect(plan.executablePath).toMatch(/\\lumamark\.exe$/);
    expect(plan.uninstallPath).toMatch(/\\uninstall\.exe$/);
    expect(plan.installedAcceptanceScripts).toContain(
      'scripts\\release\\verify-installed-second-instance-open.mjs',
    );
  }, WINDOWS_EXTERNAL_PROCESS_TEST_TIMEOUT_MS);

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
  }, WINDOWS_EXTERNAL_PROCESS_TEST_TIMEOUT_MS);

  it('rejects the smoke root itself as an install directory', () => {
    const plan = parsePlan(runPlan('-InstallerKind', 'Nsis').stdout);
    const smokeRoot = join(plan.installDir, '..');
    const result = runPlan(
      '-InstallerKind',
      'Nsis',
      '-InstallDir',
      smokeRoot,
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('strict child of');
  }, WINDOWS_EXTERNAL_PROCESS_TEST_TIMEOUT_MS);

  it('marks MSI plans as administrator-gated', () => {
    const result = runPlan('-InstallerKind', 'Msi');

    expect(result.status).toBe(0);
    const plan = parsePlan(result.stdout);

    expect(plan.installerKind).toBe('Msi');
    expect(plan.willExecute).toBe(false);
    expect(plan.requiresAdmin).toBe(true);
    expect(plan.installCommand).toBe('msiexec.exe');
    expect(plan.uninstallCommand).toBe('msiexec.exe');
  }, WINDOWS_EXTERNAL_PROCESS_TEST_TIMEOUT_MS);

  it('runs the real installed window chrome acceptance before uninstalling', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain(
      'scripts\\release\\verify-installed-window-chrome.mjs',
    );
  });

  it('refuses silent install or uninstall while any LumaMark process is running', () => {
    const script = readFileSync(scriptPath, 'utf8');
    const guardCalls = script.match(/Assert-NoRunningLumaMarkProcesses/g) ?? [];
    const firstTargetRemoval = script.indexOf(
      'if (Test-Path -LiteralPath $resolvedInstallDir)',
    );
    const preflightGuard = script.indexOf(
      'Assert-NoRunningLumaMarkProcesses',
      script.indexOf("throw 'MSI smoke requires an elevated PowerShell session.'"),
    );

    expect(script).toContain('function Assert-NoRunningLumaMarkProcesses');
    expect(script).toContain('Get-Process -Name lumamark');
    expect(script).toContain('$Process.WaitForExit(5000)');
    expect(script).toContain('did not exit after Stop-Process');
    expect(preflightGuard).toBeGreaterThan(0);
    expect(preflightGuard).toBeLessThan(firstTargetRemoval);
    expect(guardCalls).toHaveLength(6);
  });

  it('never offers a side-by-side override for shared LumaMark registry keys', () => {
    const script = readFileSync(scriptPath, 'utf8');
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(script).not.toContain('AllowExistingInstall');
    expect(
      packageJson.scripts['release:installer-acceptance:nsis'],
    ).not.toContain('-AllowExistingInstall');
  });

  it('requires an isolated product registry profile before executing an installer', () => {
    const script = readFileSync(scriptPath, 'utf8');

    for (const registryPath of [
      'HKCU:\\Software\\Classes\\.md',
      'HKCU:\\Software\\Classes\\.markdown',
      'HKCU:\\Software\\Classes\\.mdown',
      'HKCU:\\Software\\Classes\\LumaMark.Markdown',
      'HKLM:\\Software\\Classes\\Installer\\Products',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ]) {
      expect(script).toContain(registryPath);
    }

    expect(script).toContain('Get-LumaMarkSharedRegistryState');
    expect(script).toContain('$blockingRegistryState.Count -gt 0');
    expect(script).toContain('Windows Sandbox or a clean Windows user profile');
  });

  it('snapshots and verifies exact Markdown association restoration', () => {
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('New-MarkdownAssociationRegistrySnapshot');
    expect(script).toContain('Restore-MarkdownAssociationRegistrySnapshot');
    expect(script).toContain('reg.exe export');
    expect(script).toContain('reg.exe import');
    expect(script).toContain('Registry restoration hash mismatch');
    expect(script).toContain('$associationRegistryRestored = $true');
    expect(script).toContain('lumamark-installer-registry-snapshot-');
    expect(script).toContain('$restoreErrors.Count -gt 0');
    expect(script).toContain('Registry restoration failed for one or more keys');
    expect(script).not.toMatch(/New-Item[^\r\n]+-LiteralPath/);
  });

  it('fails if uninstall leaves blocking product registry state behind', () => {
    const script = readFileSync(scriptPath, 'utf8');
    const postcondition = script.indexOf(
      '$remainingBlockingRegistryState = @(Get-LumaMarkSharedRegistryState)',
    );
    const successOutput = script.indexOf('installedExecutableLaunched = $true');

    expect(postcondition).toBeGreaterThan(0);
    expect(postcondition).toBeLessThan(successOutput);
    expect(script).toContain('$remainingBlockingRegistryState.Count -gt 0');
    expect(script).toContain('Uninstall left blocking registry state behind');
  });
});

type SmokePlan = {
  executablePath: string;
  existingInstallDir: string;
  blockingRegistryState: string[];
  existingAssociationState: string[];
  installArguments: string[];
  installCommand: string;
  installDir: string;
  installedAcceptanceScripts: string[];
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
