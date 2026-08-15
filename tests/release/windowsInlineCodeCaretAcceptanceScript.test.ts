import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(
  process.cwd(),
  'scripts',
  'release',
  'verify-installed-inline-code-caret-os.mjs',
);
const nativeProbePath = join(
  process.cwd(),
  'scripts',
  'release',
  'windows-window-chrome-probe.ps1',
);

describe.skipIf(process.platform !== 'win32')(
  'installed Windows inline-code caret acceptance script',
  () => {
    it('publishes the native pointer contract without launching LumaMark', () => {
      const result = spawnSync(
        'node',
        [scriptPath, '--plan', '--executable', String.raw`C:\probe\lumamark.exe`],
        { cwd: process.cwd(), encoding: 'utf8' },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const plan = JSON.parse(result.stdout) as {
        assertions: string[];
        coordinateConversion: string;
        executablePath: string;
        inputApi: string;
        source: string;
      };

      expect(plan).toMatchObject({
        coordinateConversion: 'GetClientRect + ClientToScreen',
        executablePath: String.raw`C:\probe\lumamark.exe`,
        inputApi: 'SendInput',
      });
      expect(plan.source).toContain('`alphaBeta`');
      expect(plan.source).toContain('`gamma_delta`');
      expect(plan.assertions).toEqual([
        'native single clicks place a collapsed caret at each inline-code midpoint',
        'native system double clicks select only each inline-code word',
        'pointer gestures preserve Markdown source and clean document state',
      ]);
    });

    it('keeps CDP observation-only and delegates every pointer input to the Win32 probe', () => {
      expect(existsSync(scriptPath)).toBe(true);
      const script = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';
      const nativeProbe = readFileSync(nativeProbePath, 'utf8');
      const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      const installerSmoke = readFileSync(
        join(process.cwd(), 'scripts', 'release', 'windows-installer-smoke.ps1'),
        'utf8',
      );

      expect(packageJson.scripts['release:installed-inline-code-caret-os']).toBe(
        'node scripts/release/verify-installed-inline-code-caret-os.mjs',
      );
      expect(installerSmoke).toContain('verify-installed-inline-code-caret-os.mjs');
      expect(script).toContain('createPackagedWebviewEnvironment');
      expect(script).toContain('windows-window-chrome-probe.ps1');
      expect(script).toContain("runNativeProbe('Click'");
      expect(script).toContain("runNativeProbe('DoubleClick'");
      expect(script).toContain('posAtCoords');
      expect(script).toContain('coordsAtPos');
      expect(script).toContain('event.detail');
      expect(script).toContain('dblclick');
      expect(script).toContain('dirty');
      expect(script).toContain('sourceUnchanged');
      expect(script).not.toMatch(
        /page\.(?:mouse|keyboard)|Input\.dispatch|GetWindowRect|SetCursorPos|mouse_event/u,
      );

      expect(nativeProbe).toContain('GetClientRect');
      expect(nativeProbe).toContain('ClientToScreen');
      expect(nativeProbe).toContain('SendInput');
      expect(nativeProbe).not.toContain('GetWindowRect');
      expect(nativeProbe).not.toContain('SetCursorPos');
      expect(nativeProbe).not.toContain('mouse_event');
    });
  },
);
