import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = join(
  process.cwd(),
  'scripts',
  'release',
  'verify-installed-window-chrome.mjs',
);
const nativeProbePath = join(
  process.cwd(),
  'scripts',
  'release',
  'windows-window-chrome-probe.ps1',
);

describe.skipIf(process.platform !== 'win32')(
  'installed Windows titlebar acceptance script',
  () => {
    it('publishes the native event and geometry contract without launching the app', () => {
      const result = spawnSync(
        'node',
        [
          scriptPath,
          '--plan',
          '--executable',
          String.raw`C:\probe\lumamark.exe`,
          '--expected-dpi',
          '144',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
        },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const plan = JSON.parse(result.stdout) as {
        assertions: string[];
        coordinateConversion: string;
        executablePath: string;
        expectedDpi: number;
        inputApi: string;
      };

      expect(plan).toMatchObject({
        coordinateConversion: 'GetClientRect + ClientToScreen',
        executablePath: String.raw`C:\probe\lumamark.exe`,
        expectedDpi: 144,
        inputApi: 'SendInput',
      });
      expect(plan.assertions).toEqual([
        'single click preserves normal placement',
        'single drag moves the normal window',
        'double click maximizes to the monitor work area without clipping',
        'double click restores the saved normal placement',
        'dragging from maximized restores and moves the window',
        'double click maximizes again after dragging from maximized',
        'maximize button toggles native state and its accessible label',
        'theme, language, and About portal items accept real OS clicks',
      ]);
    });

    it('uses physical client coordinates and SendInput without legacy pointer shortcuts', () => {
      const script = readFileSync(scriptPath, 'utf8');
      const nativeProbe = readFileSync(nativeProbePath, 'utf8');

      expect(nativeProbe).toContain('GetClientRect');
      expect(nativeProbe).toContain('ClientToScreen');
      expect(nativeProbe).toContain('SendInput');
      expect(nativeProbe).toContain('IsZoomed');
      expect(nativeProbe).toContain('GetDpiForWindow');
      expect(nativeProbe).toContain('SetThreadDpiAwarenessContext');
      expect(nativeProbe).toContain('WindowFromPoint');
      expect(nativeProbe).not.toContain('GetWindowRect');
      expect(nativeProbe).not.toContain('mouse_event');
      expect(nativeProbe).not.toContain('SetCursorPos');
      expect(nativeProbe).not.toContain('[Nullable[int]]$HitX');
      expect(nativeProbe).toContain('SetThreadDpiAwarenessContext failed.');
      expect(nativeProbe).not.toContain('SendInput(1, inputs');
      expect(nativeProbe).toContain('AssertInputTarget(expectedWindow');
      expect(script).toContain('verifyPortalMenusWithOsMouse');
      expect(script).toContain('verifyMaximizeButtonWithOsMouse');
      expect(script).toContain('waitForWindowControlState');
      expect(script).toContain('partial evidence:');
      expect(script).toContain('ariaLabels');
      expect(script).toContain('assertNoExistingLumaMarkProcesses');
      expect(script).toContain('edgeDelta.right <= 0');
      expect(script).toContain('edgeDelta.bottom <= 0');
      expect(script).toContain(
        'placementDistance(state.clientRect, resetNormal.clientRect)',
      );
    });
  },
);
