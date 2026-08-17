import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const WINDOWS_EXTERNAL_PROCESS_TEST_TIMEOUT_MS = 15_000;

type PackageJson = {
  dependencies: Record<string, string>;
  scripts: Record<string, string>;
};

type TauriCapability = {
  permissions: string[];
};

describe('package quality scripts', () => {
  it('pins the CodeMirror view version used by the media geometry bridge', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.dependencies['@codemirror/view']).toBe('6.43.4');
  });

  it('grants the custom window chrome permissions used by AppShell controls', async () => {
    const capability = await readJsonFile<TauriCapability>(
      'src-tauri',
      'capabilities',
      'default.json',
    );

    expect(capability.permissions).toEqual(
      expect.arrayContaining([
        'core:window:allow-close',
        'core:window:allow-destroy',
        'core:window:allow-is-maximized',
        'core:window:allow-minimize',
        'core:window:allow-start-dragging',
        'core:window:allow-toggle-maximize',
      ]),
    );
  });

  it('registers the official text clipboard plugin with least-privilege permissions', async () => {
    const packageJson = await readPackageJson();
    const cargoToml = await readFile(
      join(process.cwd(), 'src-tauri', 'Cargo.toml'),
      'utf8',
    );
    const tauriLibrary = await readFile(
      join(process.cwd(), 'src-tauri', 'src', 'lib.rs'),
      'utf8',
    );
    const capability = await readJsonFile<TauriCapability>(
      'src-tauri',
      'capabilities',
      'default.json',
    );

    expect(packageJson.dependencies['@tauri-apps/plugin-clipboard-manager']).toBe(
      '^2.3.2',
    );
    expect(cargoToml).toContain('tauri-plugin-clipboard-manager = "2"');
    expect(tauriLibrary).toContain(
      '.plugin(tauri_plugin_clipboard_manager::init())',
    );
    expect(
      capability.permissions.filter((permission) =>
        permission.startsWith('clipboard-manager:'),
      ),
    ).toEqual([
      'clipboard-manager:allow-read-text',
      'clipboard-manager:allow-write-text',
    ]);
    expect(capability.permissions).not.toContain('clipboard-manager:default');
  });

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

  it('defines installed media caret acceptance with Win32 SendInput', async () => {
    const packageJson = await readPackageJson();
    const acceptance = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-installed-media-caret-os.mjs',
      ),
      'utf8',
    );
    const installerSmoke = await readFile(
      join(process.cwd(), 'scripts', 'release', 'windows-installer-smoke.ps1'),
      'utf8',
    );

    expect(packageJson.scripts['release:installed-media-caret-os']).toBe(
      'node scripts/release/verify-installed-media-caret-os.mjs',
    );
    expect(installerSmoke).toContain('verify-installed-media-caret-os.mjs');
    expect(acceptance).toContain('LUMAMARK_EXECUTABLE');
    expect(acceptance).toContain('app.pid');
    expect(acceptance).toContain('ClientToScreen');
    expect(acceptance).toContain('SetThreadDpiAwarenessContext');
    expect(acceptance).toContain('GetDpiForWindow');
    expect(acceptance).toContain('GetClientRect');
    expect(acceptance).toContain('GetSystemMetrics');
    expect(acceptance).toContain('SendInput');
    expect(acceptance).toContain('MOUSEEVENTF_VIRTUALDESK');
    expect(acceptance).toContain('KEYEVENTF_UNICODE');
    expect(acceptance).toContain("phase: 'narrow'");
    expect(acceptance).toContain("phase: 'wide'");
    expect(acceptance).toContain('terminateProcessTree');
    expect(acceptance).toContain('HWND_TOPMOST');
    expect(acceptance).toContain('RaiseForPointer');
    expect(acceptance).toContain('SwitchToThisWindow');
    expect(acceptance).toContain('pointIsInTargetWindow');
    expect(acceptance).toContain('targetVerifiedBeforeInput');
    expect(acceptance).toContain('watchdogExpired');
    expect(acceptance).toContain("'Probe'");
    expect(acceptance).toContain('OpenInputDesktop');
    expect(acceptance).toContain('GetAsyncKeyState');
    expect(acceptance).toContain('WTSQuerySessionInformation');
    expect(acceptance).not.toContain('GetWindowRect');
    expect(acceptance).not.toContain('page.mouse');
    expect(acceptance).not.toContain('page.keyboard');
  });

  it('defines installed reading-mode acceptance with guarded Win32 input', async () => {
    const packageJson = await readPackageJson();
    const acceptance = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-installed-reading-mode-os.mjs',
      ),
      'utf8',
    );
    const installerSmoke = await readFile(
      join(process.cwd(), 'scripts', 'release', 'windows-installer-smoke.ps1'),
      'utf8',
    );
    const win32Helper = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-installed-media-caret-os.mjs',
      ),
      'utf8',
    );
    const tableTests = await readFile(
      join(
        process.cwd(),
        'src',
        'editor',
        'capabilities',
        'table',
        'tablePreviewExtension.test.ts',
      ),
      'utf8',
    );

    expect(packageJson.scripts['release:installed-reading-mode-os']).toBe(
      'node scripts/release/verify-installed-reading-mode-os.mjs',
    );
    expect(installerSmoke).toContain(
      'verify-installed-reading-mode-os.mjs',
    );
    expect(acceptance).toContain('verify-installed-media-caret-os.mjs');
    expect(acceptance).toContain("'--write-win32-helper'");
    expect(acceptance).toContain('LUMAMARK_EXECUTABLE');
    expect(acceptance).toContain('createAcceptanceSettingsEnvironment({');
    expect(acceptance).toContain('app.pid');
    expect(acceptance).toContain("invokeWin32('Probe')");
    expect(acceptance).toContain("invokeWin32('Click'");
    expect(acceptance).toContain("invokeWin32('Unicode'");
    expect(acceptance).toContain("invokeWin32('Save')");
    expect(acceptance).toContain('targetVerifiedBeforeInput');
    expect(acceptance).toContain('pointIsInTargetWindow');
    expect(acceptance).toContain('.lm-editor-reading-mode');
    expect(acceptance).toContain('.tbl-cell-view');
    expect(acceptance).toContain('aria-readonly');
    expect(acceptance).toContain('lm-status-readonly-flash');
    expect(acceptance).toContain('sourceUnchangedAfterBlockedInput');
    expect(acceptance).toContain('selectionUnchangedAfterBlockedInput');
    expect(acceptance).toContain('undoHistoryNotMeasuredByInstalledScript');
    expect(acceptance).toContain('savedMarkdownExact');
    expect(acceptance).toContain('view.state.readOnly');
    expect(acceptance).toContain('view.state.facet(editableFacet)');
    expect(acceptance).toContain('view.state.selection.toJSON()');
    expect(acceptance).toContain('event.isTrusted');
    expect(acceptance).toContain('matchesExpectedTarget');
    expect(acceptance).toContain('readOnlyFlashCount');
    expect(acceptance).toContain('isProcessRunning(app.pid)');
    expect(acceptance).toContain('AbortSignal.timeout(2_000)');
    expect(acceptance).toMatch(
      /await\s+awaitRunAcceptanceShutdown\(\s*runAcceptancePromise,\s*cleanupFailures,\s*\)/,
    );
    expect(acceptance).toContain('expectedRootDocument');
    expect(acceptance).toContain('expectedNestedSelectionHead');
    expect(acceptance).toContain('const acceptanceAbort = new AbortController();');
    expect(acceptance).toContain('watchdogExpired');
    expect(acceptance).toContain('terminateProcessTree');
    expect(acceptance).toContain('removePackagedWebviewTempDirectory');
    expect(acceptance).not.toContain('GetWindowRect');
    expect(acceptance).not.toContain('mouse_event');
    expect(acceptance).not.toContain('page.mouse');
    expect(acceptance).not.toContain('page.keyboard');
    expect(acceptance).not.toMatch(
      /\.(?:click|dblclick|press|type|fill|focus|dispatchEvent)\s*\(/,
    );
    expect(acceptance).not.toMatch(
      /new\s+(?:KeyboardEvent|MouseEvent|PointerEvent|InputEvent)\s*\(/,
    );
    expect(acceptance).not.toMatch(/\.dispatch\s*\(/);

    const orderedWin32Path = [
      "'activate-live-table-cell'",
      "label: 'live-cell-unicode'",
      "clickLocatorWithWin32(viewMenu, 'open-view-menu')",
      "clickLocatorWithWin32(readingModeItem, 'enter-reading-mode')",
      "clickLocatorWithWin32(readingPreview, 'click-locked-table-preview')",
      "clickLocatorWithWin32(readingParagraph, 'focus-reading-root')",
      "label: 'blocked-reading-unicode'",
      "invokeWin32('Save')",
    ].map((token) => acceptance.indexOf(token));
    expect(orderedWin32Path.every((index) => index >= 0)).toBe(true);
    expect(orderedWin32Path).toEqual(
      [...orderedWin32Path].sort((left, right) => left - right),
    );

    expect(win32Helper).toContain('ClientToScreen');
    expect(win32Helper).toContain('WindowFromPoint');
    expect(win32Helper).toContain('SendInput');
    expect(win32Helper).toContain('KEYEVENTF_UNICODE');
    expect(win32Helper).toContain('targetVerifiedBeforeInput');
    expect(win32Helper).toContain('pointIsInTargetWindow');
    expect(tableTests).toContain(
      'restores nested focus after moving it to the root while reading',
    );
    expect(tableTests).toContain('expect(undo(editor.view)).toBe(true)');
    expect(tableTests).toContain('expect(redo(editor.view)).toBe(true)');
    expect(tableTests).toContain('expect(undoDepth(editor.view.state))');
    expect(tableTests).toContain('expect(redoDepth(editor.view.state))');
  });

  it('keeps the installed table OS matrix on the maintained blur target', async () => {
    const matrix = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'repro-installed-table-caret-matrix-os.mjs',
      ),
      'utf8',
    );
    const blurTable = matrix.match(
      /async function blurTable\(\) \{[\s\S]*?\n\}/,
    )?.[0];

    expect(blurTable).toContain("hasText: 'after'");
    expect(blurTable).not.toContain("hasText: 'before'");
    expect(matrix).toContain(
      "from './packagedWebviewHarness.mjs'",
    );
    expect(matrix).toContain('createPackagedWebviewEnvironment({');
    expect(matrix).not.toContain(
      'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:',
    );
    expect(matrix).toContain('app.pid');
    expect(matrix).toContain("invokeWin32('Probe')");
    expect(matrix).toContain("invokeWin32('Click'");
    expect(matrix).toContain('removePackagedWebviewTempDirectory');
    expect(matrix).toContain('terminateProcessTree');
    expect(matrix).not.toContain('Get-Process lumamark');
    expect(matrix).not.toContain('mouse_event');
    expect(matrix).not.toContain('process.exit(');
  });

  it('fails safely before any installed media SendInput can outlive its guard', async () => {
    const acceptance = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-installed-media-caret-os.mjs',
      ),
      'utf8',
    );
    const watchdog = acceptance.match(
      /const acceptanceWatchdog = setTimeout\([\s\S]*?acceptanceDeadline - Date\.now\(\)\)\);/,
    )?.[0];
    const moveAndVerify = acceptance.match(
      /private static void MoveAndVerify\([\s\S]*?\n {2}\}/,
    )?.[0];
    const physicalInputGuard = acceptance.match(
      /private static void EnsurePhysicalInputsReleased\(\) \{[\s\S]*?\n {2}\}/,
    )?.[0];
    const focusTarget = acceptance.match(
      /private static void FocusTarget\([\s\S]*?\n {2}\}/,
    )?.[0];
    const invokeWin32 = acceptance.match(
      /function invokeWin32\([\s\S]*?const stdout = execFileSync\(/,
    )?.[0];

    expect(watchdog).toBeDefined();
    expect(watchdog).not.toContain('terminateProcessTree');
    expect(watchdog).not.toContain('browser.close');
    expect(watchdog).toContain('acceptanceAbort.abort');
    expect(acceptance).toContain(
      'const acceptanceAbort = new AbortController();',
    );
    expect(acceptance).toContain(
      'Promise.race([runAcceptancePromise, acceptanceWatchdogFailure])',
    );
    expect(acceptance).toContain('const acceptanceDeadline = Date.now() + 240_000;');
    expect(acceptance).toContain("'-DeadlineUnixMilliseconds'");
    expect(acceptance).toContain('ConfigureDeadline($DeadlineUnixMilliseconds)');
    expect(acceptance).toMatch(
      /private static void SendExact[\s\S]*?EnsureBeforeDeadline\(\);[\s\S]*?SendInput\(/,
    );
    expect(acceptance).toContain('const runAcceptancePromise = runAcceptance();');
    expect(acceptance).toMatch(
      /awaitRunAcceptanceShutdown[\s\S]*?removePackagedWebviewTempDirectory/,
    );
    expect(acceptance).toMatch(
      /await awaitRunAcceptanceShutdown\([^;]+;\s+if \(browser\)[\s\S]*?removePackagedWebviewTempDirectory/,
    );
    expect(acceptance).toMatch(
      /successOutput\s+&&\s+!evidence\.watchdogExpired\s+&&\s+process\.exitCode !== 1/,
    );
    expect(moveAndVerify).toMatch(
      /EnsureInputReady\(processId, hwnd\);\s+VerifyForegroundTarget\(processId, hwnd\);\s+SendExact\(/,
    );
    expect(physicalInputGuard).toContain('VK_S');
    expect(focusTarget).toContain('int stableSamples = 0;');
    expect(focusTarget).toContain('attempt < 50');
    expect(focusTarget).toContain('stableSamples >= 2');
    expect(focusTarget).toContain('Thread.Sleep(100)');
    expect(invokeWin32).toMatch(
      /acceptanceAbort\.signal\.throwIfAborted\(\);[\s\S]*?execFileSync\(/,
    );
    expect(acceptance).toMatch(
      /execFileSync\([\s\S]*?windowsHide:\s*true[\s\S]*?\)\.trim\(\)/,
    );
    expect(acceptance).toContain('await acceptanceDelay(150)');
    expect(acceptance).toMatch(
      /withTimeout\(\s*collectFailureState\(\),\s*5_000/,
    );
    expect(acceptance).toMatch(
      /public static void Resize\(\s*int processId,\s*int width,\s*int height,\s*double dpr\s*\)/,
    );
    expect(acceptance).toContain('Math.Round(width * dpr)');
    expect(acceptance).toContain('Math.Round(height * dpr)');
    expect(acceptance).toMatch(
      /::Resize\(\s*\$TargetProcessId,\s*\$Width,\s*\$Height,\s*\$Dpr\s*\)/,
    );
  });

  it.runIf(process.platform === 'win32')(
    'keeps the installed media Win32 SendInput helper compilable',
    async () => {
      const acceptance = await readFile(
        join(
          process.cwd(),
          'scripts',
          'release',
          'verify-installed-media-caret-os.mjs',
        ),
        'utf8',
      );
      const csharp = acceptance.match(
        /Add-Type -TypeDefinition @'\r?\n(?<source>[\s\S]*?)\r?\n'@/,
      )?.groups?.source;

      expect(csharp).toBeDefined();
      const temporaryDirectory = await mkdtemp(
        join(tmpdir(), 'lumamark-media-caret-csharp-'),
      );
      const scriptPath = join(temporaryDirectory, 'compile.ps1');
      try {
        await writeFile(
          scriptPath,
          `Add-Type -TypeDefinition @'\n${csharp}\n'@`,
          'utf8',
        );
        await expect(
          execFileAsync('powershell.exe', [
            '-NoProfile',
            '-File',
            scriptPath,
          ]),
        ).resolves.toBeDefined();
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    },
    WINDOWS_EXTERNAL_PROCESS_TEST_TIMEOUT_MS,
  );

  it('defines a release version consistency verification script', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['release:verify-versions']).toBe(
      'node scripts/release/verify-version-consistency.mjs',
    );
    await expectFile('scripts', 'release', 'verify-version-consistency.mjs');
  });

  it('defines a real installed Windows titlebar acceptance script', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['release:installed-window-chrome']).toBe(
      'node scripts/release/verify-installed-window-chrome.mjs',
    );
    await expectFile(
      'scripts',
      'release',
      'verify-installed-window-chrome.mjs',
    );
  });

  it('defines a focused V1 UX prototype quality script', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['quality:v1-ux-prototype']).toBe(
      'playwright test tests/e2e/v1-ux-prototype.spec.ts',
    );
  });

  it('defines a V1 UX screenshot capture script for visual review evidence', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['quality:v1-ux-screenshots']).toBe(
      'node scripts/quality/capture-v1-ux-screenshots.mjs',
    );
    await expectFile('scripts', 'quality', 'capture-v1-ux-screenshots.mjs');
  });

  it('defines explicit Markdown corpus download and verification scripts', async () => {
    const packageJson = await readPackageJson();

    expect(packageJson.scripts['download:markdown-corpus']).toBe(
      'node scripts/quality/download-markdown-corpus.mjs',
    );
    expect(packageJson.scripts['test:markdown-corpus']).toBe(
      'node scripts/quality/test-markdown-corpus.mjs',
    );
    await expectFile('scripts', 'quality', 'markdown-corpus-manifest.json');
    await expectFile('scripts', 'quality', 'download-markdown-corpus.mjs');
    await expectFile('scripts', 'quality', 'test-markdown-corpus.mjs');
  });

  it('defines a GitHub Actions V1 quality gate with isolated performance benchmarks', async () => {
    const workflow = await readWorkflow('v1-quality.yml');

    expect(workflow).toContain('name: V1 Quality Gate');
    expect(workflow).toContain('runs-on: windows-latest');
    // Full Windows E2E plus production/perf no longer fits in 30 minutes.
    expect(workflow).toContain('    timeout-minutes: 60');
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
    expect(workflow).toContain('pnpm download:markdown-corpus');
    expect(workflow).toContain('pnpm test:markdown-corpus');
    expect(workflow).toContain('pnpm quality:v1-ux-prototype');
    expect(workflow).toContain('pnpm quality:v1-ux-screenshots');
    expect(workflow).toContain('actions/upload-artifact@v7');
    expect(workflow).toContain('name: v1-ux-screenshots');
    expect(workflow).toContain('test-results/v1-ux-screenshots/*.png');
    expect(workflow).toContain('pnpm test:e2e');
    expect(workflow).toContain('pnpm test:live-assets');
    expect(workflow).toContain('pnpm quality:web-build');
    expect(workflow).toContain('pnpm test:e2e:production');
    expect(workflow).toContain('cargo check --manifest-path src-tauri/Cargo.toml');
    expect(workflow).toContain('cargo test --manifest-path src-tauri/Cargo.toml');
    expect(workflow.indexOf('pnpm quality:v1-ux-prototype')).toBeLessThan(
      workflow.indexOf('pnpm test:e2e'),
    );
    expect(workflow.indexOf('pnpm quality:v1-ux-screenshots')).toBeLessThan(
      workflow.indexOf('test-results/v1-ux-screenshots/*.png'),
    );
    expect(workflow.indexOf('pnpm download:markdown-corpus')).toBeLessThan(
      workflow.indexOf('pnpm test:markdown-corpus'),
    );
    expect(workflow.indexOf('pnpm test:markdown-corpus')).toBeLessThan(
      workflow.indexOf('pnpm test:e2e'),
    );
    expect(workflow).toContain('pnpm perf:bench');
    expect(workflow.indexOf('pnpm perf:bench')).toBeGreaterThan(
      workflow.indexOf('pnpm quality:web-build'),
    );
    expect(workflow.indexOf('pnpm test:e2e:production')).toBeGreaterThan(
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
  return readJsonFile<PackageJson>('package.json');
}

async function readJsonFile<T>(...segments: string[]): Promise<T> {
  const content = await readFile(join(process.cwd(), ...segments), 'utf8');

  return JSON.parse(content) as T;
}

async function readWorkflow(name: string): Promise<string> {
  return readFile(join(process.cwd(), '.github', 'workflows', name), 'utf8');
}

async function expectFile(...segments: string[]): Promise<void> {
  await expect(access(join(process.cwd(), ...segments))).resolves.toBeUndefined();
}
