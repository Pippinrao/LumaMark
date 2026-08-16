import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createAcceptanceSettingsEnvironment,
  createPackagedWebviewEnvironment,
  isRemoteDesktopRequest,
  isRetryableCodeMirrorSnapshotError,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

describe('packaged WebView release harness', () => {
  it('treats Tauri IPC as local desktop traffic', () => {
    expect(
      isRemoteDesktopRequest(
        'http://ipc.localhost/settings_get',
        'http://tauri.localhost',
      ),
    ).toBe(false);
    expect(
      isRemoteDesktopRequest(
        'http://tauri.localhost/assets/math.woff2',
        'http://tauri.localhost',
      ),
    ).toBe(false);
    expect(
      isRemoteDesktopRequest(
        'https://cdn.jsdelivr.net/npm/mathjax',
        'http://tauri.localhost',
      ),
    ).toBe(true);
  });

  it('retries only CodeMirror missing-tile snapshot races', () => {
    expect(
      isRetryableCodeMirrorSnapshotError(
        new Error('page.evaluate: Error: No tile at position 48'),
      ),
    ).toBe(true);
    expect(
      isRetryableCodeMirrorSnapshotError(
        new Error('Expected the root CodeMirror EditorView.'),
      ),
    ).toBe(false);
    expect(isRetryableCodeMirrorSnapshotError('No tile at position 48')).toBe(
      false,
    );
  });

  it('reserves a different available debug port for each run', async () => {
    const first = await reserveDebugPort();
    const second = await reserveDebugPort();

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    expect(second).not.toBe(first);

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(first, '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('rejects an explicitly requested port that is already occupied', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP address for the test server.');
    }

    await expect(reserveDebugPort(address.port)).rejects.toThrow(
      /already in use/i,
    );
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('isolates WebView2 data from an already-running installed app', () => {
    const tempDirectory = join('C:', 'temp', 'lumamark-packaged-webview');
    const environment = createPackagedWebviewEnvironment({
      baseEnvironment: { EXISTING_VALUE: 'preserved' },
      debugPort: 9_334,
      tempDirectory,
    });

    expect(environment).toMatchObject({
      EXISTING_VALUE: 'preserved',
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9334',
      WEBVIEW2_USER_DATA_FOLDER: join(tempDirectory, 'webview2-user-data'),
    });
  });

  it('keeps NSIS installed-acceptance scripts on isolated settings', async () => {
    const scripts = [
      'verify-installed-window-chrome.mjs',
      'verify-packaged-argv-open.mjs',
      'verify-packaged-menu-cold-start.mjs',
      'verify-packaged-table-caret.mjs',
      'verify-installed-media-caret-os.mjs',
      'verify-installed-reading-mode-os.mjs',
      'verify-installed-math-caret-os.mjs',
      'verify-installed-plantuml-os.mjs',
      'verify-installed-inline-code-caret-os.mjs',
    ];

    for (const fileName of scripts) {
      const source = await readFile(
        join(process.cwd(), 'scripts', 'release', fileName),
        'utf8',
      );
      expect(source).toContain('createAcceptanceSettingsEnvironment');
      expect(source).toContain('lumamark-menu-context-os-');
    }
  });

  it('opens a canonical table fixture in packaged table-caret acceptance', async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-packaged-table-caret.mjs',
      ),
      'utf8',
    );

    expect(source).toContain('| Left  | Right |');
    expect(source).toContain('| ----- | ----- |');
    expect(source).not.toContain('| --- | --- |');
  });

  it('reveals off-screen math before waiting for the installed MathJax widget', async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-installed-math-caret-os.mjs',
      ),
      'utf8',
    );

    expect(source).toContain('async function waitForMathRender(kind, source)');
    expect(source).toContain('async function revealMathSource(wrappedSource)');
    expect(source).toContain("view.constructor.scrollIntoView(from, { y: 'center' })");
    expect(source).not.toContain('scrollIntoView: true');
    expect(source).toContain('view.lineBlockAt(from)');
    expect(source).toContain('view.scrollDOM.scrollTop');
    expect(source).toContain('lm-math-${kind}-render');
    expect(source).toContain('width: 800');
    expect(source).not.toContain('width: 660');
  });

  it('scopes packaged settings away from the real app config directory', async () => {
    const tempDirectory = await mkdtemp(
      join(tmpdir(), 'lumamark-menu-context-os-harness-'),
    );
    try {
      const environment = await createAcceptanceSettingsEnvironment({
        baseEnvironment: { EXISTING_VALUE: 'preserved' },
        debugPort: 9_335,
        tempDirectory,
      });
      const settingsConfigDirectory = join(tempDirectory, 'settings-config');

      expect(environment).toMatchObject({
        EXISTING_VALUE: 'preserved',
        LUMAMARK_ACCEPTANCE_MODE: '1',
        LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR: settingsConfigDirectory,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9335',
        WEBVIEW2_USER_DATA_FOLDER: join(tempDirectory, 'webview2-user-data'),
      });
      expect(environment).not.toHaveProperty(
        'LUMAMARK_ROUTING_ACCEPTANCE_MODE',
      );
    } finally {
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });

  it('retries transient WebView2 locks while removing temporary data', async () => {
    const removeDirectory = vi.fn().mockResolvedValue(undefined);

    await removePackagedWebviewTempDirectory(
      join('C:', 'temp', 'lumamark-packaged-webview'),
      removeDirectory,
    );

    expect(removeDirectory).toHaveBeenCalledWith(
      join('C:', 'temp', 'lumamark-packaged-webview'),
      {
        force: true,
        maxRetries: 12,
        recursive: true,
        retryDelay: 250,
      },
    );
  });

  it('makes current production builds inseparable from public release gates', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['test:e2e:production']).toMatch(
      /^pnpm quality:web-build && /,
    );
    expect(packageJson.scripts['release:packaged-webview']).toMatch(
      /^pnpm build && /,
    );
  });

  it('keeps packaged code-block interaction on the real Win32 input path', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const acceptanceScript = await readFile(
      join(
        process.cwd(),
        'scripts',
        'release',
        'verify-packaged-code-block.mjs',
      ),
      'utf8',
    );

    expect(packageJson.scripts['release:packaged-code-block']).toBe(
      'pnpm build && node scripts/release/verify-packaged-code-block.mjs',
    );
    expect(packageJson.scripts['release:packaged-parity-gaps']).toMatch(
      /^pnpm release:packaged-code-block &&/,
    );
    expect(packageJson.scripts['release:packaged-parity-gaps']).toContain(
      'verify-packaged-table-caret.mjs',
    );
    expect(packageJson.scripts['release:packaged-parity-gaps']).toContain(
      'verify-packaged-media-caret.mjs',
    );
    expect(acceptanceScript).toContain('ClientToScreen');
    expect(acceptanceScript).toContain('SendInput');
    expect(acceptanceScript).toContain('SetThreadDpiAwarenessContext');
    expect(acceptanceScript).toContain('GetDpiForWindow');
    expect(acceptanceScript).toContain('GetForegroundWindow');
    expect(acceptanceScript).toContain('Get-Process -Id $ProcessId');
    expect(acceptanceScript).toContain('Last native input error:');
    expect(acceptanceScript).toContain(
      'Only a real OS click may acquire foreground before keyboard input.',
    );
    expect(acceptanceScript).toContain(
      'The native click did not foreground spawned process',
    );
    expect(acceptanceScript).toContain('$expectedActionCount');
    expect(acceptanceScript).toContain(
      '$actions = @($decodedActions)',
    );
    expect(acceptanceScript).not.toContain('$actions = if (');
    expect(acceptanceScript).toContain('SetWindowPos');
    expect(acceptanceScript).toContain('HWND_TOPMOST');
    expect(acceptanceScript).toContain('WindowFromPoint');
    expect(acceptanceScript).toContain('GetWindowThreadProcessId');
    expect(acceptanceScript).toContain('GetClientRect');
    expect(acceptanceScript).toContain('expected client bounds');
    expect(acceptanceScript).toContain('ShowWindowAsync($windowHandle, 9)');
    expect(acceptanceScript).toContain('IsWindowVisible');
    expect(acceptanceScript).toContain('IsIconic');
    expect(acceptanceScript).toContain('DwmGetWindowAttribute');
    expect(acceptanceScript).toContain('cloaked');
    expect(acceptanceScript).toContain('lumamark-native-input.ps1');
    expect(acceptanceScript).toContain("'-File'");
    expect(acceptanceScript).not.toContain("'-EncodedCommand'");
    expect(acceptanceScript).toContain(
      'const completedMarkdown = `${initialMarkdown}\\n\\n',
    );
    expect(acceptanceScript).toContain("'CTRL_END'");
    expect(acceptanceScript).toContain(
      'snapshot.selectionHead === snapshot.bodyClickHead',
    );
    expect(acceptanceScript).toContain(
      'bodyPosition < 0 ? null : pointAt(bodyPosition + 3)',
    );
    expect(acceptanceScript).toContain(
      'tailPoint: openingPosition < 0 ? pointAt(source.length) : null',
    );
    expect(acceptanceScript).not.toContain(
      "openingPosition + '```ts\\n'.length",
    );
    expect(acceptanceScript).not.toContain("row.paddingTop !== '0px'");
    expect(acceptanceScript).toContain(
      "start instanceof HTMLElement ? getComputedStyle(start, '::before') : null",
    );
    expect(acceptanceScript).not.toContain(
      'start instanceof HTMLElement ? getComputedStyle(start) : null',
    );
    expect(acceptanceScript).not.toContain('LUMAMARK_EXECUTABLE');
    expect(acceptanceScript).not.toMatch(
      /page\.(?:mouse|keyboard)|\.(?:check|click|dispatchEvent|fill|focus|hover|press|selectOption|setInputFiles|tap|type|uncheck)\(|GetWindowRect|mouse_event|Get-Process\s+lumamark/,
    );
  });
});
