import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertAlreadyExitedAcceptanceChild,
  assertClipboardCleanupReady,
  assertCurrentCommandOwnedClipboardMetadata,
  assertOwnedClipboardMutation,
  assertNoExistingImageProcess,
  assertOwnedClipboardMetadata,
  assertExplicitReleaseExecutable,
  assertUnifiedProjectVersion,
  accessErrorMeansPathMissing,
  buildWin32PointerBridgeSource,
  classifyClipboardFormats,
  clipboardTextMatches,
  classifyWin32BridgeFailure,
  cssPointToScreen,
  decodeClipboardTextFromBridge,
  encodeClipboardTextForBridge,
  isSafeAcceptanceTempDirectory,
  isHorizontalMenuLayout,
  resolveTrustedWindowsToolPaths,
  summarizeVerifierProcessOutcome,
  summarizeClipboardMetadataForEvidence,
} from './installedMenuContextOsHelpers.mjs';

describe('installed menu/context OS acceptance helpers', () => {
  it('uses one line-ending contract for clipboard ownership and Cut evidence', async () => {
    expect(clipboardTextMatches('first\r\nsecond\r\n', 'first\nsecond\n')).toBe(
      true,
    );
    expect(clipboardTextMatches('first\r\nchanged', 'first\nsecond')).toBe(
      false,
    );

    const source = await readFile(
      join(process.cwd(), 'scripts', 'release', 'verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    expect(source).toContain(
      'const cutClipboardMatchesCompleteSelection = clipboardTextMatches(',
    );
    expect(source).toContain(
      "requireCheck('editor-cut-executed', cutClipboardMatchesCompleteSelection",
    );
    expect(source).not.toContain("requireCheck('editor-cut-executed', true");
  });

  it('converts WebView CSS coordinates from the client origin using DPR', () => {
    expect(
      cssPointToScreen({
        clientOrigin: { x: 104, y: 73 },
        cssPoint: { x: 210.25, y: 96.5 },
        devicePixelRatio: 1.5,
      }),
    ).toEqual({ x: 419, y: 218 });
  });

  it('builds a Win32 bridge with client coordinates and real left/right mouse flags', () => {
    const source = buildWin32PointerBridgeSource();

    expect(source).toContain('SetProcessDpiAwarenessContext');
    expect(source).toContain('GetThreadDpiAwarenessContext');
    expect(source).toContain('AreDpiAwarenessContextsEqual');
    expect(source).toContain('GetDpiForWindow');
    expect(source).toContain('ClientToScreen');
    expect(source).toContain('GetClientRect');
    expect(source).toContain('GetCursorPos');
    expect(source).toContain('WindowFromPoint');
    expect(source).toContain('SendMessageTimeout');
    expect(source).toContain('SMTO_ERRORONEXIT');
    expect(source).toContain('ProbeWindowResponse');
    expect(source).toContain('Marshal.GetLastWin32Error');
    expect(source).toContain('SetLastError(0)');
    expect(source).toContain('WindowResponseState');
    expect(source).toContain('TimedOut');
    expect(source).toContain('InvalidWindow');
    expect(source).toContain('ProbeFailed');
    expect(source).toContain('mainWindowResponsive');
    expect(source).toContain('mainWindowResponsiveness');
    expect(source).toContain('OpenInputDesktop');
    expect(source).toContain('GetUserObjectInformationW');
    expect(source).toContain('GetThreadDesktop');
    expect(source).toContain('inputDesktopName');
    expect(source).toContain('threadDesktopName');
    expect(source).toContain('foregroundProcessName');
    expect(source).not.toContain('AttachThreadInput');
    expect(source).not.toContain('SetActiveWindow');
    expect(source).not.toContain('SetFocus');
    expect(source).not.toContain('SetForegroundWindow');
    expect(source).not.toContain('SetWindowPos');
    expect(source).not.toContain('HWND_TOPMOST');
    expect(source).not.toContain('ReleaseTopmost');
    expect(source).not.toContain('ShowWindowAsync');
    expect(source).toContain('IsWindowVisible');
    expect(source).toContain('IsIconic');
    expect(source).toContain('SendInput');
    expect(source).toContain('SendMouseButton');
    expect(source).not.toContain('mouse_event');
    expect(source).toContain('0x0002');
    expect(source).toContain('0x0004');
    expect(source).toContain('0x0008');
    expect(source).toContain('0x0010');
    expect(source).not.toContain('SetProcessDPIAware');
    expect(source).not.toContain('GetWindowRect');
    expect(source).toContain('LM_STAGE=pointer.preflight.enter');
    expect(source).toContain('LM_STAGE=pointer.inject.enter');
    expect(source).toContain('LM_STAGE=pointer.inject.exit');
    expect(source).toContain('LM_STAGE=pointer.postflight.enter');
    expect(source).toContain('LM_STAGE=pointer.postflight.exit');

    const pointerBlock = source.indexOf("if ($Action -eq 'pointer')");
    const prePointerResponsivenessGate = source.indexOf(
      "Assert-WindowResponseState $mainHandle 'before-pointer'",
      pointerBlock,
    );
    const visibleWindowGate = source.indexOf(
      'IsWindowVisible($mainHandle)',
      pointerBlock,
    );
    const minimizedWindowGate = source.indexOf(
      'IsIconic($mainHandle)',
      visibleWindowGate,
    );
    const finalIdentityGate = source.indexOf(
      '$finalTargetProcess = Assert-TargetProcessIdentity',
      pointerBlock,
    );
    const finalDesktopGate = source.indexOf(
      '$finalInputDesktopName',
      finalIdentityGate,
    );
    const clipboardSequenceGate = source.indexOf(
      '[LumaMarkAcceptanceNative]::GetClipboardSequenceNumber() -ne $ExpectedClipboardSequence',
      finalDesktopGate,
    );
    const requestedPointHitTest = source.indexOf(
      'WindowFromPoint($requestedPoint)',
      clipboardSequenceGate,
    );
    const cursorMove = source.indexOf(
      'SetCursorPos($X, $Y)',
      requestedPointHitTest,
    );
    const actualCursorProbe = source.indexOf(
      '[LumaMarkAcceptanceNative]::GetCursorPos([ref]$actualCursorPoint)',
      cursorMove,
    );
    const actualCursorHitTest = source.indexOf(
      'WindowFromPoint($actualCursorPoint)',
      actualCursorProbe,
    );
    const mouseDown = source.indexOf('SendMouseButton($down)', actualCursorHitTest);
    const buttonDownRecorded = source.indexOf('$buttonDown = $true', mouseDown);
    const releaseFinally = source.indexOf('} finally {', buttonDownRecorded);
    const guardedMouseUp = source.indexOf('if ($buttonDown)', releaseFinally);
    const mouseUp = source.indexOf('SendMouseButton($up)', guardedMouseUp);
    const finalMetricsRead = source.indexOf(
      '$metrics = Get-ClientMetrics $mainHandle',
      mouseUp,
    );
    const postPointerResponsivenessGate = source.indexOf(
      "Assert-WindowResponseStateName $metrics.mainWindowResponsiveness 'after-pointer'",
      finalMetricsRead,
    );
    const naturalForegroundGate = source.indexOf(
      '$metrics.foreground.hWnd -ne $mainHandle.ToInt64()',
      postPointerResponsivenessGate,
    );

    expect(pointerBlock).toBeGreaterThan(-1);
    expect(prePointerResponsivenessGate).toBeGreaterThan(pointerBlock);
    expect(visibleWindowGate).toBeGreaterThan(prePointerResponsivenessGate);
    expect(minimizedWindowGate).toBeGreaterThan(visibleWindowGate);
    expect(finalIdentityGate).toBeGreaterThan(pointerBlock);
    expect(finalDesktopGate).toBeGreaterThan(finalIdentityGate);
    expect(clipboardSequenceGate).toBeGreaterThan(finalDesktopGate);
    expect(requestedPointHitTest).toBeGreaterThan(clipboardSequenceGate);
    expect(cursorMove).toBeGreaterThan(requestedPointHitTest);
    expect(actualCursorProbe).toBeGreaterThan(cursorMove);
    expect(actualCursorHitTest).toBeGreaterThan(actualCursorProbe);
    expect(mouseDown).toBeGreaterThan(actualCursorHitTest);
    expect(buttonDownRecorded).toBeGreaterThan(mouseDown);
    expect(source.indexOf('$buttonDown = $false', pointerBlock)).toBeLessThan(
      buttonDownRecorded,
    );
    expect(releaseFinally).toBeGreaterThan(buttonDownRecorded);
    expect(guardedMouseUp).toBeGreaterThan(releaseFinally);
    expect(mouseUp).toBeGreaterThan(guardedMouseUp);
    expect(finalMetricsRead).toBeGreaterThan(mouseUp);
    expect(postPointerResponsivenessGate).toBeGreaterThan(finalMetricsRead);
    expect(naturalForegroundGate).toBeGreaterThan(
      postPointerResponsivenessGate,
    );
    expect(source).not.toContain(
      "Assert-WindowResponseState $mainHandle 'after-pointer'",
    );
    expect(source).not.toContain(
      '$requestedHitProcessId -eq [uint32]$TargetProcessId',
    );
    expect(source).not.toContain(
      '$hitProcessId -eq [uint32]$TargetProcessId',
    );
    const finalCursorCriticalSection = source.slice(
      actualCursorProbe,
      mouseDown,
    );
    expect(finalCursorCriticalSection).not.toContain(
      'Assert-TargetProcessIdentity',
    );
    expect(finalCursorCriticalSection).not.toContain('GetInputDesktopName');
    expect(finalCursorCriticalSection).not.toContain(
      'GetClipboardSequenceNumber',
    );
    expect(finalCursorCriticalSection).not.toContain('Start-Sleep');
  });

  it('classifies distinct safe window response probe failures', () => {
    const source = buildWin32PointerBridgeSource();

    expect(source).toContain(
      'The target main window response probe timed out before pointer injection.',
    );
    expect(source).toContain(
      'The target main window became invalid before pointer injection.',
    );
    expect(source).toContain(
      'The target main window response probe failed before pointer injection.',
    );
    expect(source).toContain(
      'The target main window response probe timed out after pointer injection.',
    );
    expect(source).toContain(
      'The target main window became invalid after pointer injection.',
    );
    expect(source).toContain(
      'The target main window response probe failed after pointer injection.',
    );
    expect(source).not.toContain('Win32Exception');
    expect(source).not.toContain('GetLastWin32Error().ToString');
  });

  it('builds a clipboard bridge with format preflight and sequence-checked stdin restore', () => {
    const source = buildWin32PointerBridgeSource();

    expect(source).toContain('GetClipboardSequenceNumber');
    expect(source).toContain('GetClipboardOwner');
    expect(source).toContain('ownerBelongsToTarget');
    expect(source).toContain("$Action -eq 'clipboard-inspect'");
    expect(source).toContain("$Action -eq 'clipboard-read-text'");
    expect(source).toContain("$Action -eq 'clipboard-restore'");
    expect(source).toContain('[Console]::In.ReadToEnd()');
    expect(source).toContain('[Convert]::FromBase64String');
    expect(source).toContain('[Text.Encoding]::Unicode.GetString');
    expect(source).toContain('[Text.Encoding]::Unicode.GetBytes');
    expect(source).not.toContain('[ordered]@{ sequence = $sequence; text = $text }');
    expect(source).toContain('$ExpectedClipboardSequence');
    expect(source).toContain('$GuardClipboardSequence');
    expect(source).toContain(
      '[LumaMarkAcceptanceNative]::GetClipboardSequenceNumber() -ne $ExpectedClipboardSequence',
    );
    expect(source).toContain('CreateWindowExW');
    expect(source).toContain('HWND_MESSAGE');
    expect(source).toContain('OpenClipboard(ownerWindow)');
    expect(source).not.toContain('OpenClipboard(IntPtr.Zero)');
    expect(source).toContain('$RestoreHadText');
    expect(source).toContain('if (hadText)');
    const clipboardReadAction = source.indexOf(
      "if ($Action -eq 'clipboard-read-text')",
    );
    const clipboardReadPreGuard = source.indexOf(
      '$sequenceBefore -ne $ExpectedClipboardSequence',
      clipboardReadAction,
    );
    const clipboardGetText = source.indexOf(
      '[System.Windows.Forms.Clipboard]::GetText()',
      clipboardReadAction,
    );
    const clipboardReadPostGuard = source.indexOf(
      '$sequence -ne $ExpectedClipboardSequence',
      clipboardGetText,
    );
    const clipboardReadBase64 = source.indexOf(
      '$textUtf16Base64 =',
      clipboardGetText,
    );
    expect(clipboardReadPreGuard).toBeGreaterThan(clipboardReadAction);
    expect(clipboardReadPreGuard).toBeLessThan(clipboardGetText);
    expect(clipboardReadPostGuard).toBeGreaterThan(clipboardGetText);
    expect(clipboardReadPostGuard).toBeLessThan(clipboardReadBase64);
    const restoreFunction = source.indexOf('RestorePlainTextIfSequence');
    const clipboardSet = source.indexOf('SetClipboardData(CF_UNICODETEXT', restoreFunction);
    const ownResultingSequence = source.indexOf(
      'resultingSequence = GetClipboardSequenceNumber();',
      clipboardSet,
    );
    const clipboardCloseFinally = source.indexOf('} finally {', clipboardSet);
    expect(ownResultingSequence).toBeGreaterThan(clipboardSet);
    expect(ownResultingSequence).toBeLessThan(clipboardCloseFinally);
    expect(
      source.match(/\$sequenceBefore = \[LumaMarkAcceptanceNative\]::GetClipboardSequenceNumber\(\)/g),
    ).toHaveLength(2);
    expect(source.match(/\$sequenceBefore -eq \$sequence/g)).toHaveLength(2);
    expect(source).not.toContain("$Action -eq 'clipboard-write'");
  });

  it.runIf(process.platform === 'win32')(
    'loads the generated bridge in Windows PowerShell',
    async () => {
      const { powershellPath } = await resolveTrustedWindowsToolPaths();
      const directory = await mkdtemp(join(tmpdir(), 'lumamark-pointer-bridge-test-'));
      const bridgePath = join(directory, 'bridge.ps1');
      try {
        await writeFile(bridgePath, buildWin32PointerBridgeSource(), 'utf8');
        const output = execFileSync(
          powershellPath,
          [
            '-NoProfile',
            '-STA',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            bridgePath,
            '-Action',
            'probe',
          ],
          { encoding: 'utf8', timeout: 15_000, windowsHide: true },
        );

        expect(JSON.parse(output.trim())).toMatchObject({
          clientCoordinates: true,
          clipboardOwnerWindow: true,
          clipboardSequence: true,
          dpiAwareness: 'per-monitor-v2',
          inputDesktopInspection: true,
          loaded: true,
          realMouseFlags: true,
          windowHitTesting: true,
        });

        const clipboardInspectOutput = execFileSync(
          powershellPath,
          [
            '-NoProfile',
            '-STA',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            bridgePath,
            '-Action',
            'clipboard-inspect',
            '-TargetProcessId',
            String(process.pid),
          ],
          { encoding: 'utf8', timeout: 15_000, windowsHide: true },
        );
        const clipboardInspect = JSON.parse(clipboardInspectOutput.trim()) as {
          formats: unknown;
        };
        expect(Array.isArray(clipboardInspect.formats)).toBe(true);

        const fileVersionOutput = execFileSync(
          powershellPath,
          [
            '-NoProfile',
            '-STA',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            bridgePath,
            '-Action',
            'file-version',
            '-Value',
            process.execPath,
          ],
          { encoding: 'utf8', timeout: 15_000, windowsHide: true },
        );
        const fileVersion = JSON.parse(fileVersionOutput.trim()) as {
          fileVersion: string;
          productVersion: string;
        };
        expect(fileVersion.fileVersion).toMatch(/\d+\.\d+\.\d+/);
        expect(fileVersion.productVersion).toMatch(/\d+\.\d+\.\d+/);

        const processInfoOutput = execFileSync(
          powershellPath,
          [
            '-NoProfile',
            '-STA',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            bridgePath,
            '-Action',
            'process-info',
            '-TargetProcessId',
            String(process.pid),
          ],
          { encoding: 'utf8', timeout: 15_000, windowsHide: true },
        );
        const processInfo = JSON.parse(processInfoOutput.trim()) as {
          executablePath: string;
          exists: boolean;
          processId: number;
        };
        expect(processInfo).toMatchObject({
          exists: true,
          processId: process.pid,
        });
        expect(processInfo.executablePath.toLocaleLowerCase('en-US')).toBe(
          process.execPath.toLocaleLowerCase('en-US'),
        );

        const processTreeOutput = execFileSync(
          powershellPath,
          [
            '-NoProfile',
            '-STA',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            bridgePath,
            '-Action',
            'process-tree-probe',
            '-TargetProcessId',
            String(process.pid),
          ],
          { encoding: 'utf8', timeout: 15_000, windowsHide: true },
        );
        expect(JSON.parse(processTreeOutput.trim())).toMatchObject({
          belongsToTarget: true,
          targetProcessId: process.pid,
        });
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
    20_000,
  );

  it.runIf(process.platform === 'win32')(
    'resolves PowerShell and tasklist only from the canonical System32 tree',
    async () => {
      const tools = await resolveTrustedWindowsToolPaths();

      expect(isAbsolute(tools.powershellPath)).toBe(true);
      expect(isAbsolute(tools.tasklistPath)).toBe(true);
      expect(basename(tools.powershellPath).toLocaleLowerCase('en-US')).toBe(
        'powershell.exe',
      );
      expect(basename(tools.tasklistPath).toLocaleLowerCase('en-US')).toBe(
        'tasklist.exe',
      );
      await expect(
        resolveTrustedWindowsToolPaths({
          systemRoot: 'C:\\Windows',
          windowsDirectory: 'D:\\Windows',
        }),
      ).rejects.toThrow('Windows system directory identity');
    },
  );

  it('accepts only a horizontal, non-wrapping menu geometry', () => {
    expect(
      isHorizontalMenuLayout({
        contentWidth: 304,
        itemHeight: 38,
        itemWidth: 288,
        labelWhiteSpace: 'nowrap',
        labelWritingMode: 'horizontal-tb',
      }),
    ).toBe(true);
    expect(
      isHorizontalMenuLayout({
        contentWidth: 40,
        itemHeight: 96,
        itemWidth: 38,
        labelWhiteSpace: 'normal',
        labelWritingMode: 'vertical-rl',
      }),
    ).toBe(false);
  });

  it('accepts empty or recoverable plain-text clipboard formats only', () => {
    expect(classifyClipboardFormats({ formats: [], hasText: false })).toEqual({
      recoverable: true,
      reason: 'empty',
    });
    expect(
      classifyClipboardFormats({
        formats: ['UnicodeText', 'Text', 'System.String', 'Locale'],
        hasText: true,
      }),
    ).toEqual({ recoverable: true, reason: 'plain-text' });
    expect(
      classifyClipboardFormats({
        formats: ['UnicodeText', 'HTML Format'],
        hasText: true,
      }),
    ).toEqual({ recoverable: false, reason: 'unsupported-formats' });
    expect(
      classifyClipboardFormats({ formats: ['FileDrop'], hasText: false }),
    ).toEqual({ recoverable: false, reason: 'unsupported-formats' });
  });

  it('permits clipboard recovery only after input, CDP, and the native writer are quiescent', () => {
    for (let mask = 0; mask < 8; mask += 1) {
      const state = {
        inputStopped: (mask & 1) !== 0,
        cdpDisconnected: (mask & 2) !== 0,
        childExitVerified: (mask & 4) !== 0,
      };
      if (mask === 7) {
        expect(() => assertClipboardCleanupReady(state)).not.toThrow();
      } else {
        expect(() => assertClipboardCleanupReady(state)).toThrow(/quiescent/i);
      }
    }
  });

  it('claims a clipboard mutation only when sequence, formats, and expected content agree', () => {
    const metadata = {
      formats: ['System.String', 'UnicodeText', 'Text'],
      hasText: true,
      ownerBelongsToTarget: true,
      ownerHWnd: 123,
      ownerProcessId: 456,
      sequence: 42,
    };

    expect(
      assertOwnedClipboardMutation({
        actualText: 'expected command output',
        expectedText: 'expected command output',
        metadata,
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toBe(42);
    expect(
      assertOwnedClipboardMutation({
        actualText: 'first line\r\nsecond line\r\n',
        expectedText: 'first line\nsecond line\n',
        metadata,
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toBe(42);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'first line\r\nchanged line\r\n',
        expectedText: 'first line\nsecond line\n',
        metadata,
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toThrow(/ownership/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'external clipboard change',
        expectedText: 'expected command output',
        metadata,
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toThrow(/ownership/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected command output',
        expectedText: 'expected command output',
        metadata: { ...metadata, sequence: 41 },
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toThrow(/sequence/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected command output',
        expectedText: 'expected command output',
        metadata: { ...metadata, ownerBelongsToTarget: false },
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toThrow(/owner|writer/i);

    const webViewMetadata = {
      ...metadata,
      formats: [
        'UnicodeText',
        'Chromium internal source RFH token',
        'Chromium internal source URL',
        'Locale',
        'Text',
        'OEMText',
      ],
    };
    expect(
      assertOwnedClipboardMutation({
        actualText: 'expected command output',
        expectedText: 'expected command output',
        metadata: webViewMetadata,
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toBe(42);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected command output',
        expectedText: 'expected command output',
        metadata: {
          ...webViewMetadata,
          formats: [...webViewMetadata.formats, 'HTML Format'],
        },
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toThrow(/format/i);
  });

  it('rejects external clipboard ownership before any command content is needed', () => {
    expect(() =>
      assertOwnedClipboardMetadata({
        metadata: {
          formats: ['UnicodeText'],
          hasText: true,
          ownerBelongsToTarget: false,
          sequence: 42,
        },
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toThrow(/owner/i);
    expect(
      assertOwnedClipboardMetadata({
        metadata: {
          formats: ['UnicodeText'],
          hasText: true,
          ownerBelongsToTarget: true,
          ownerHWnd: 123,
          ownerProcessId: 456,
          sequence: 42,
        },
        previousSequence: 41,
        writerKind: 'webview-text',
      }),
    ).toBe(42);
  });

  it('accepts ownerless official Tauri text writes only under the explicit native contract', () => {
    const nativeOwnerlessMetadata = {
      formats: ['UnicodeText', 'Locale', 'Text', 'OEMText'],
      hasText: true,
      ownerBelongsToTarget: false,
      ownerHWnd: 0,
      ownerProcessId: 0,
      sequence: 42,
    };

    expect(
      assertOwnedClipboardMutation({
        actualText: 'expected native output',
        expectedText: 'expected native output',
        metadata: nativeOwnerlessMetadata,
        previousSequence: 41,
        writerKind: 'tauri-native-text',
      }),
    ).toBe(42);
    expect(
      assertCurrentCommandOwnedClipboardMetadata({
        expectedSequence: 42,
        metadata: nativeOwnerlessMetadata,
        writerKind: 'tauri-native-text',
      }),
    ).toBe(42);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected native output',
        expectedText: 'expected native output',
        metadata: nativeOwnerlessMetadata,
        previousSequence: 41,
      }),
    ).toThrow(/owner|writer/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected native output',
        expectedText: 'expected native output',
        metadata: {
          ...nativeOwnerlessMetadata,
          ownerBelongsToTarget: true,
          ownerHWnd: 123,
          ownerProcessId: 456,
        },
        previousSequence: 41,
        writerKind: 'tauri-native-text',
      }),
    ).toThrow(/owner|writer/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected native output',
        expectedText: 'expected native output',
        metadata: {
          ...nativeOwnerlessMetadata,
          ownerHWnd: 99,
          ownerProcessId: 100,
        },
        previousSequence: 41,
        writerKind: 'tauri-native-text',
      }),
    ).toThrow(/owner/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected native output',
        expectedText: 'expected native output',
        metadata: {
          ...nativeOwnerlessMetadata,
          ownerHWnd: null,
          ownerProcessId: false,
        },
        previousSequence: 41,
        writerKind: 'tauri-native-text',
      }),
    ).toThrow(/owner|writer/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'expected native output',
        expectedText: 'expected native output',
        metadata: {
          ...nativeOwnerlessMetadata,
          formats: [
            ...nativeOwnerlessMetadata.formats,
            'Chromium internal source URL',
          ],
        },
        previousSequence: 41,
        writerKind: 'tauri-native-text',
      }),
    ).toThrow(/format/i);
    expect(() =>
      assertOwnedClipboardMutation({
        actualText: 'external output',
        expectedText: 'expected native output',
        metadata: nativeOwnerlessMetadata,
        previousSequence: 41,
        writerKind: 'tauri-native-text',
      }),
    ).toThrow(/ownership/i);
  });

  it('accepts current command-owned WebView text metadata and rejects unsafe variants', () => {
    const metadata = {
      formats: [
        'UnicodeText',
        'Chromium internal source RFH token',
        'Chromium internal source URL',
        'Locale',
        'Text',
      ],
      hasText: true,
      ownerBelongsToTarget: true,
      ownerHWnd: 123,
      ownerProcessId: 456,
      sequence: 42,
    };

    expect(
      assertCurrentCommandOwnedClipboardMetadata({
        expectedSequence: 42,
        metadata,
        writerKind: 'webview-text',
      }),
    ).toBe(42);
    expect(() =>
      assertCurrentCommandOwnedClipboardMetadata({
        expectedSequence: 41,
        metadata,
        writerKind: 'webview-text',
      }),
    ).toThrow(/sequence/i);
    expect(() =>
      assertCurrentCommandOwnedClipboardMetadata({
        expectedSequence: 42,
        metadata: { ...metadata, ownerBelongsToTarget: false },
        writerKind: 'webview-text',
      }),
    ).toThrow(/owner/i);
    expect(() =>
      assertCurrentCommandOwnedClipboardMetadata({
        expectedSequence: 42,
        metadata: {
          ...metadata,
          ownerBelongsToTarget: false,
          ownerHWnd: 0,
          ownerProcessId: 0,
        },
        writerKind: 'webview-text',
      }),
    ).toThrow(/owner|writer/i);
    expect(() =>
      assertCurrentCommandOwnedClipboardMetadata({
        expectedSequence: 42,
        metadata: {
          ...metadata,
          ownerHWnd: 0,
          ownerProcessId: 0,
        },
        writerKind: 'webview-text',
      }),
    ).toThrow(/owner|writer/i);
    expect(() =>
      assertCurrentCommandOwnedClipboardMetadata({
        expectedSequence: 42,
        metadata: { ...metadata, formats: [...metadata.formats, 'HTML Format'] },
        writerKind: 'webview-text',
      }),
    ).toThrow(/format/i);
  });

  it('records only allowlisted clipboard metadata before content verification', async () => {
    const summary = summarizeClipboardMetadataForEvidence({
      formats: ['UnicodeText', 'private-format-C:\\Users\\secret'],
      hasText: true,
      ownerBelongsToTarget: false,
      ownerHWnd: 0,
      ownerProcessId: 0,
      sequence: 42,
    });

    expect(summary).toEqual({
      formatCount: 2,
      hasText: true,
      ownerBelongsToTarget: false,
      ownerBelongsToTargetIsBoolean: true,
      ownerHWnd: 0,
      ownerProcessId: 0,
      recognizedFormats: ['unicodetext'],
      sequence: 42,
      unrecognizedFormatCount: 1,
    });
    expect(JSON.stringify(summary)).not.toContain('private-format');
    expect(JSON.stringify(summary)).not.toContain('Users');
    const verifierSource = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    expect(verifierSource).not.toContain('formats: clipboardMetadata.formats');
    expect(verifierSource).not.toContain('failure.stack');
    expect(verifierSource).toContain('summarizeClipboardMetadataForEvidence(');
  });

  it('round-trips clipboard Unicode as UTF-16LE base64 without command-line text', () => {
    const original = '简体中文 — emoji 🧪 — empty next: \0';
    const encoded = encodeClipboardTextForBridge(original);

    expect(encoded).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(encoded).not.toContain('简体中文');
    expect(decodeClipboardTextFromBridge(encoded)).toBe(original);
    expect(decodeClipboardTextFromBridge(encodeClipboardTextForBridge(''))).toBe('');
  });

  it('classifies only allowlisted Win32 bridge failures without exposing stderr', async () => {
    const classified = classifyWin32BridgeFailure('pointer', {
      signal: null,
      status: 1,
      stderr: Buffer.from(
        "At bridge.ps1:951 char:7\r\nWindowFromPoint at the actual cursor did not resolve to the target application.\r\nsecret-user-path",
        'utf8',
      ),
    });

    expect(classified).toEqual({
      action: 'pointer',
      code: 'target-hit-test-mismatch',
      signal: null,
      status: 1,
    });
    expect(JSON.stringify(classified)).not.toContain('secret-user-path');
    expect(
      classifyWin32BridgeFailure('pointer', {
        signal: null,
        status: 1,
        stderr:
          'The target main window response probe failed after pointer injection.\r\nprivate-details',
      }),
    ).toEqual({
      action: 'pointer',
      code: 'target-window-response-probe-failed-after-pointer',
      signal: null,
      status: 1,
    });
    const timedOut = classifyWin32BridgeFailure('pointer', {
      signal: null,
      status: 1,
      stderr:
        'The target main window response probe timed out before pointer injection.\r\nprivate-worktree-and-window-details',
    });
    expect(timedOut).toEqual({
      action: 'pointer',
      code: 'target-window-response-timeout-before-pointer',
      signal: null,
      status: 1,
    });
    expect(JSON.stringify(timedOut)).not.toContain('private-worktree');
    expect(
      classifyWin32BridgeFailure('pointer', {
        code: 'ETIMEDOUT',
        signal: 'SIGTERM',
        status: null,
        stderr: 'LM_STAGE=pointer.preflight.enter\r\nprivate-details',
      }),
    ).toEqual({
      action: 'pointer',
      code: 'pointer-preflight-process-timeout',
      signal: 'SIGTERM',
      status: null,
    });
    expect(
      classifyWin32BridgeFailure('pointer', {
        code: 'ETIMEDOUT',
        signal: 'SIGTERM',
        status: null,
        stderr:
          'LM_STAGE=pointer.preflight.enter\r\nLM_STAGE=pointer.inject.enter\r\nprivate-details',
      }),
    ).toEqual({
      action: 'pointer',
      code: 'pointer-injection-process-timeout',
      signal: 'SIGTERM',
      status: null,
    });
    expect(
      classifyWin32BridgeFailure('pointer', {
        code: 'ETIMEDOUT',
        signal: 'SIGTERM',
        status: null,
        stderr:
          'LM_STAGE=pointer.inject.exit\r\nLM_STAGE=pointer.postflight.enter\r\nprivate-details',
      }),
    ).toEqual({
      action: 'pointer',
      code: 'pointer-postflight-process-timeout',
      signal: 'SIGTERM',
      status: null,
    });
    expect(
      classifyWin32BridgeFailure('pointer', {
        code: 'ETIMEDOUT',
        signal: 'SIGTERM',
        status: null,
        stderr: 'private-details-before-any-stage',
      }),
    ).toEqual({
      action: 'pointer',
      code: 'pointer-bridge-process-timeout',
      signal: 'SIGTERM',
      status: null,
    });
    expect(
      classifyWin32BridgeFailure('pointer', {
        signal: 'SIGTERM',
        status: null,
        stderr: 'unexpected private diagnostic',
      }),
    ).toEqual({
      action: 'pointer',
      code: 'unclassified',
      signal: 'SIGTERM',
      status: null,
    });

    const source = await readFile(
      join(process.cwd(), 'scripts', 'release', 'verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    expect(source).toContain(
      'const failure = classifyWin32BridgeFailure(action, error)',
    );
    expect(source).not.toContain('error.stderr');
  });

  it('requires the explicit executable to be the current worktree release binary', () => {
    const root = 'D:\\example-repos\\LumaMark\\.worktrees\\feature-menu';
    const expected = join(root, 'src-tauri', 'target', 'release', 'lumamark.exe');

    expect(assertExplicitReleaseExecutable(expected, root)).toBe(expected);
    expect(() => assertExplicitReleaseExecutable('', root)).toThrow(
      /LUMAMARK_EXECUTABLE/,
    );
    expect(() =>
      assertExplicitReleaseExecutable(
        'C:\\Program Files\\LumaMark\\lumamark.exe',
        root,
      ),
    ).toThrow(/current worktree release binary/);
  });

  it('fails closed when the existing-process preflight cannot complete', () => {
    expect(
      assertNoExistingImageProcess(
        { error: undefined, signal: null, status: 0, stdout: 'INFO: no tasks' },
        'lumamark.exe',
      ),
    ).toBe(true);
    expect(() =>
      assertNoExistingImageProcess(
        { error: undefined, signal: null, status: 1, stderr: 'sensitive', stdout: '' },
        'lumamark.exe',
      ),
    ).toThrow(/unable to prove/i);
    expect(() =>
      assertNoExistingImageProcess(
        { error: undefined, signal: 'SIGTERM', status: null, stdout: '' },
        'lumamark.exe',
      ),
    ).toThrow(/unable to prove/i);
    expect(() =>
      assertNoExistingImageProcess(
        { error: undefined, signal: null, status: 0, stdout: '"lumamark.exe"' },
        'lumamark.exe',
      ),
    ).toThrow(/already running/i);
  });

  it('requires package, Cargo, lockfile, and Tauri versions to agree', () => {
    expect(
      assertUnifiedProjectVersion({
        cargoLock: '0.2.28',
        cargoToml: '0.2.28',
        packageJson: '0.2.28',
        tauriConfig: '0.2.28',
      }),
    ).toBe('0.2.28');
    expect(() =>
      assertUnifiedProjectVersion({
        cargoLock: '0.2.27',
        cargoToml: '0.2.28',
        packageJson: '0.2.28',
        tauriConfig: '0.2.28',
      }),
    ).toThrow(/version mismatch/i);
  });

  it('only permits cleanup of its own temporary directory prefix', () => {
    const systemTemp = tmpdir();
    expect(
      isSafeAcceptanceTempDirectory(
        join(systemTemp, 'lumamark-menu-context-os-123'),
        systemTemp,
      ),
    ).toBe(true);
    expect(isSafeAcceptanceTempDirectory(systemTemp, systemTemp)).toBe(false);
    expect(
      isSafeAcceptanceTempDirectory(
        join(systemTemp, 'unrelated-directory'),
        systemTemp,
      ),
    ).toBe(false);
  });

  it('treats only missing-path access failures as absence', () => {
    expect(accessErrorMeansPathMissing({ code: 'ENOENT' })).toBe(true);
    expect(accessErrorMeansPathMissing({ code: 'ENOTDIR' })).toBe(true);
    expect(() => accessErrorMeansPathMissing({ code: 'EACCES' })).toThrow(
      /unable to determine/i,
    );
    expect(() => accessErrorMeansPathMissing(new Error('unknown'))).toThrow(
      /unable to determine/i,
    );
  });

  it('matches editor menu actions when accessible names include visible shortcuts', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    expect(source).toContain("cut: /^(?:Cut|剪切)(?:\\s|$)/,");
    expect(source).toContain("copy: /^(?:Copy|复制)(?:\\s|$)/,");
    expect(source).toContain("paste: /^(?:Paste|粘贴)(?:\\s|$)/,");
    expect(source).toContain("selectAll: /^(?:Select All|全选)(?:\\s|$)/,");
    expect(source).toContain("copyTable: /^(?:Copy table|复制表格)(?:\\s|$)/i,");
    expect(source).toContain("deleteTable: /^(?:Delete table|删除表格)(?:\\s|$)/i,");
  });

  it('rechecks the complete editor selection and fixture before copying it', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    const selectionProof = source.indexOf(
      "'editor-context-menu-preserves-complete-selection'",
    );
    const clipboardMutation = source.indexOf(
      "beginClipboardMutation('editor.selection.copy', selectionAtCopy.doc)",
    );
    expect(selectionProof).toBeGreaterThan(0);
    expect(clipboardMutation).toBeGreaterThan(selectionProof);
  });

  it('compares copied image paths against the workspace-resolved fixture path', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    const imageMutation = source.indexOf(
      "beginClipboardMutation(\n    'editor.image.copy-path',",
    );
    const expectedPath = source.indexOf(
      "join(workspaceRoot, 'acceptance.svg')",
      imageMutation,
    );
    const compareAsPath = source.indexOf(
      '{ compareAsPath: true }',
      expectedPath,
    );
    const mutationEnd = source.indexOf("await osPointer(copyImageItem", compareAsPath);
    const tracker = source.indexOf(
      "trackOwnedClipboardMutation('editor.image.copy-path')",
      mutationEnd,
    );

    expect(imageMutation).toBeGreaterThan(0);
    expect(expectedPath).toBeGreaterThan(imageMutation);
    expect(compareAsPath).toBeGreaterThan(expectedPath);
    expect(mutationEnd).toBeGreaterThan(compareAsPath);
    expect(tracker).toBeGreaterThan(mutationEnd);
    expect(source.slice(imageMutation, mutationEnd)).not.toContain(
      '\n    IMAGE_SOURCE,',
    );
  });

  it('records an explicit image-action layout check before locating an image command', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    const imageMenu = source.indexOf(
      "openContextMenu(image, 'editor-image')",
    );
    const layoutCheck = source.indexOf(
      "requireCheck('editor-image-context-contains-image-actions'",
      imageMenu,
    );
    const imageCommandLookup = source.indexOf(
      "findVisibleRole('menuitem', LABELS.copyImagePath)",
      imageMenu,
    );

    expect(imageMenu).toBeGreaterThan(0);
    expect(layoutCheck).toBeGreaterThan(imageMenu);
    expect(imageCommandLookup).toBeGreaterThan(layoutCheck);
  });

  it('keeps the installed acceptance on OS input instead of Playwright actions', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    expect(source).toContain('osPointer');
    expect(source).toContain("button: 'right'");
    expect(source).toContain('cssPointToScreen');
    expect(source).toContain('pointer-dpr-and-input-desktop-match');
    expect(source).not.toMatch(
      /\.(?:click|dblclick|press|fill|tap|hover|dragTo|setChecked|selectOption)\s*\(/,
    );
    expect(source).not.toMatch(/(?:page|locator)\.type\s*\(/);
    expect(source).not.toContain('page.keyboard');
    expect(source).not.toContain('GetWindowRect');
  });

  it('registers a dedicated installed OS acceptance command', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const runnerSource = await readFile(
      join(process.cwd(), 'scripts/release/run-installed-menu-context-os.mjs'),
      'utf8',
    );

    expect(packageJson.scripts['release:installed-menu-context-os']).toBe(
      'node scripts/release/run-installed-menu-context-os.mjs',
    );
    expect(runnerSource).toContain('spawnSync(process.execPath, [verifierSourcePath]');
    expect(runnerSource).toContain('observedExitCode: verifierProcess.status');
    expect(runnerSource).toContain('observedSignal: verifierProcess.signal');
    expect(runnerSource).toContain('runnerOutcome');
    expect(runnerSource).toContain("join(artifactDirectory, 'result.json')");
    expect(runnerSource).toContain('process.exitCode = runnerOutcome.runnerExitCode');
  });

  it('requires current-run evidence before accepting a verifier result', async () => {
    const [runnerSource, verifierSource] = await Promise.all([
      readFile(
        join(process.cwd(), 'scripts/release/run-installed-menu-context-os.mjs'),
        'utf8',
      ),
      readFile(
        join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
        'utf8',
      ),
    ]);

    expect(runnerSource).toContain('randomUUID()');
    expect(runnerSource).toContain('LUMAMARK_ACCEPTANCE_RUN_ID: acceptanceRunId');
    expect(runnerSource).toContain('resultFresh');
    expect(runnerSource).toContain('if (resultFresh)');
    expect(verifierSource).toContain(
      'const acceptanceRunId = process.env.LUMAMARK_ACCEPTANCE_RUN_ID',
    );
    expect(verifierSource).toContain('acceptanceRunId,');
  });

  it('does not treat a missing browser handle as proof of CDP disconnect', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    const browserSkip = source.indexOf('if (!browser) {');
    const missingHandleGuard = source.indexOf(
      'if (cdpConnectionEstablished)',
      browserSkip,
    );
    const disconnectedProof = source.indexOf('cdpDisconnected: true', browserSkip);

    expect(browserSkip).toBeGreaterThan(0);
    expect(missingHandleGuard).toBeGreaterThan(browserSkip);
    expect(disconnectedProof).toBeGreaterThan(missingHandleGuard);
  });

  it('derives the runner exit from the observed verifier code and signal', () => {
    expect(
      summarizeVerifierProcessOutcome({
        observedExitCode: 0,
        observedSignal: null,
        plannedExitCode: 0,
      }),
    ).toEqual({
      matchesPlannedExitCode: true,
      observedExitCode: 0,
      observedSignal: null,
      plannedExitCode: 0,
      runnerExitCode: 0,
    });
    expect(
      summarizeVerifierProcessOutcome({
        observedExitCode: 1,
        observedSignal: null,
        plannedExitCode: 1,
      }),
    ).toMatchObject({ matchesPlannedExitCode: true, runnerExitCode: 1 });
    expect(
      summarizeVerifierProcessOutcome({
        observedExitCode: null,
        observedSignal: 'SIGTERM',
        plannedExitCode: 1,
      }),
    ).toMatchObject({ matchesPlannedExitCode: false, runnerExitCode: 1 });
    expect(
      summarizeVerifierProcessOutcome({
        observedExitCode: 0,
        observedSignal: null,
        plannedExitCode: 1,
      }),
    ).toMatchObject({ matchesPlannedExitCode: false, runnerExitCode: 1 });
  });

  it('observes a real verifier child and rejects mismatched or stale results', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lumamark-runner-test-'));
    const helperPath = join(directory, 'helper.mjs');
    const verifierPath = join(directory, 'verifier.mjs');
    const fakeVerifier = `
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
if (process.env.LUMAMARK_FAKE_WRITE_RESULT !== '0') {
  const startedAt = new Date().toISOString();
  const result = {
    acceptanceRunId: process.env.LUMAMARK_ACCEPTANCE_RUN_ID,
    acceptanceSourceIdentity: {
      helperSha256: await sha256(process.env.LUMAMARK_FAKE_HELPER_PATH),
      verifierSha256: await sha256(process.argv[1]),
    },
    finishedAt: new Date().toISOString(),
    mode: 'installed-win32-os-pointer',
    plannedExitCode: Number(process.env.LUMAMARK_FAKE_PLANNED_EXIT_CODE ?? '0'),
    schemaVersion: 2,
    startedAt,
    summary: { passed: process.env.LUMAMARK_FAKE_SUMMARY_PASSED === '1' },
  };
  await writeFile(join(process.env.LUMAMARK_ACCEPTANCE_ARTIFACTS, 'result.json'), JSON.stringify(result));
}
process.exit(Number(process.env.LUMAMARK_FAKE_EXIT_CODE ?? '0'));
`;

    try {
      await writeFile(helperPath, 'export const fixture = true;\n', 'utf8');
      await writeFile(verifierPath, fakeVerifier, 'utf8');
      const { executeInstalledAcceptanceRunner } = await import(
        './run-installed-menu-context-os.mjs'
      );
      const stdout = { write: () => true };
      const baseEnvironment = {
        ...process.env,
        LUMAMARK_FAKE_HELPER_PATH: helperPath,
        LUMAMARK_FAKE_PLANNED_EXIT_CODE: '0',
        LUMAMARK_FAKE_SUMMARY_PASSED: '1',
      };
      const success = await executeInstalledAcceptanceRunner({
        artifactDirectory: join(directory, 'success'),
        environment: { ...baseEnvironment, LUMAMARK_FAKE_EXIT_CODE: '0' },
        helperPath,
        stdout,
        verifierPath,
      });
      expect(success).toMatchObject({
        resultFresh: true,
        runnerOutcome: {
          matchesPlannedExitCode: true,
          observedExitCode: 0,
          resultFresh: true,
          runnerExitCode: 0,
        },
      });

      const mismatch = await executeInstalledAcceptanceRunner({
        artifactDirectory: join(directory, 'mismatch'),
        environment: { ...baseEnvironment, LUMAMARK_FAKE_EXIT_CODE: '7' },
        helperPath,
        stdout,
        verifierPath,
      });
      expect(mismatch).toMatchObject({
        resultFresh: true,
        runnerOutcome: {
          matchesPlannedExitCode: false,
          observedExitCode: 7,
          runnerExitCode: 7,
        },
      });

      const staleDirectory = join(directory, 'stale');
      await mkdir(staleDirectory, { recursive: true });
      const staleResult = JSON.stringify({
        acceptanceRunId: 'stale-run',
        finishedAt: '2026-08-14T00:00:01.000Z',
        plannedExitCode: 0,
        startedAt: '2026-08-14T00:00:00.000Z',
        summary: { passed: true },
      });
      const staleResultPath = join(staleDirectory, 'result.json');
      await writeFile(staleResultPath, staleResult, 'utf8');
      const stale = await executeInstalledAcceptanceRunner({
        artifactDirectory: staleDirectory,
        environment: {
          ...baseEnvironment,
          LUMAMARK_FAKE_EXIT_CODE: '1',
          LUMAMARK_FAKE_WRITE_RESULT: '0',
        },
        helperPath,
        stdout,
        verifierPath,
      });
      expect(stale).toMatchObject({
        resultFresh: false,
        runnerOutcome: { observedExitCode: 1, runnerExitCode: 1 },
      });
      expect(await readFile(staleResultPath, 'utf8')).toBe(staleResult);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('proves an already-exited acceptance child from immutable identity and termination facts', () => {
    const baseline = Object.freeze({
      executablePath: 'C:\\Program Files\\LumaMark\\lumamark.exe',
      processId: 321,
      startTimeUtc: '2026-08-15T03:00:00.000Z',
    });
    const valid = {
      after: { exists: false, processId: 321 },
      baseline,
      before: { exists: false, processId: 321 },
      termination: { code: 0, kind: 'exit', signal: null },
    };

    expect(assertAlreadyExitedAcceptanceChild(valid)).toEqual({
      alreadyExited: true,
      processId: 321,
      termination: valid.termination,
    });
    expect(() =>
      assertAlreadyExitedAcceptanceChild({
        ...valid,
        after: { exists: true, processId: 321 },
      }),
    ).toThrow(/quiescent/i);
    expect(() =>
      assertAlreadyExitedAcceptanceChild({
        ...valid,
        before: { exists: false, processId: 999 },
      }),
    ).toThrow(/identity/i);
    expect(() =>
      assertAlreadyExitedAcceptanceChild({
        ...valid,
        termination: { kind: 'spawn-error' },
      }),
    ).toThrow(/termination/i);
  });

  it('isolates Tauri settings via an IPC-verifiable override and protects clipboard ownership', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    expect(source).toContain('LUMAMARK_ACCEPTANCE_SETTINGS_CONFIG_DIR');
    expect(source).toContain(
      'LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR',
    );
    expect(source).toContain("LUMAMARK_ACCEPTANCE_MODE: '1'");
    expect(source).toContain(
      'LUMAMARK_ACCEPTANCE_ALLOW_PLAINTEXT_CLIPBOARD_RESTORE',
    );
    expect(source).toContain("classification.reason === 'empty'");
    expect(source).toContain('allowPlainTextClipboardRestore');
    expect(source).toContain("'settings_acceptance_config_dir'");
    expect(source).toContain("'settings_acceptance_write_barrier_dir'");
    expect(source).not.toContain('APPDATA: isolatedAppDataDirectory');
    expect(source).not.toContain('LOCALAPPDATA: isolatedLocalAppDataDirectory');
    expect(source).toContain("name: 'system-clipboard-restored'");
    expect(source).toContain('expectedClipboardSequence');
    expect(source).toContain('input: encodeClipboardTextForBridge(originalClipboardText)');
    expect(source).toContain('restoreHadText: originalClipboardHadText');
    expect(source).toContain('interactive-input-desktop-is-default-${phase}');
    expect(source).toContain('beginClipboardMutation');
    expect(source).toContain('ownerBelongsToTarget');
    expect(source).toContain("process.on('SIGINT'");
    expect(source).toContain("process.on('SIGTERM'");
    expect(source).toContain("process.removeListener('SIGINT'");
    expect(source).toContain("process.removeListener('SIGTERM'");
    expect(source).toContain('throwIfInterrupted');
    expect(source).toContain('!interruptionSignal');
    expect(source).not.toContain('clipboardFingerprint');
    expect(source).not.toContain('initialSha256');
    expect(source).not.toContain('restoredSha256');
    expect(source).not.toContain('initialClipboardState.text)');
    expect(source).toContain("originalClipboardText.includes('\\0')");
    expect(source).not.toContain('navigator.clipboard.readText');
    expect(source).not.toMatch(/pollUntil\([\s\S]{0,120}readClipboard/);
    expect(source).not.toContain('JSON.stringify(lastValue)');
    expect(source).toContain('clipboardSequenceGuard: expectedClipboardSequence');
    expect(source).toContain('markClipboardPrivacyRisk');
    expect(source).toContain('failureScreenshotSkippedForClipboardPrivacy');
    expect(source).toContain('let safeFixtureVisible = false');
    expect(source).toContain('safeFixtureVisible &&');
    expect(source).toContain('async function readFixtureLoadState');
    expect(source).toContain(
      'safeFixtureVisible = loadedFixtureState.markerMatches.every(Boolean)',
    );
    const launchFunction = source.indexOf(
      'async function launchAcceptanceApplication',
    );
    expect(source.indexOf('readFixtureLoadState', launchFunction)).toBeLessThan(
      source.indexOf('readRootEditorState', launchFunction),
    );
    const pasteMetadataValidator = source.indexOf(
      'function assertPasteClipboardMetadata(pasteClipboardMetadata, stage)',
    );
    const pasteMetadataOwnershipCheck = source.indexOf(
      'assertCurrentCommandOwnedClipboardMetadata({',
      pasteMetadataValidator,
    );
    expect(pasteMetadataOwnershipCheck).toBeGreaterThan(pasteMetadataValidator);
    expect(
      source.indexOf(
        'expectedSequence: expectedClipboardSequence',
        pasteMetadataOwnershipCheck,
      ),
    ).toBeGreaterThan(pasteMetadataOwnershipCheck);
    expect(
      source.indexOf('metadata: pasteClipboardMetadata', pasteMetadataOwnershipCheck),
    ).toBeGreaterThan(pasteMetadataOwnershipCheck);
    expect(
      source.indexOf(
        'writerKind: INSTALLED_TEXT_WRITER_KIND',
        pasteMetadataOwnershipCheck,
      ),
    ).toBeGreaterThan(pasteMetadataOwnershipCheck);
    const clipboardTextReader = source.indexOf(
      'function readBridgeClipboardText(sequence)',
    );
    expect(
      source.indexOf('expectedClipboardSequence: sequence', clipboardTextReader),
    ).toBeGreaterThan(clipboardTextReader);
    expect(source).toContain('async function waitForPasteFixture');
    expect(source).toContain('async function readRootEditorMatch');
    const pasteWait = source.indexOf('async function waitForPasteFixture');
    const pasteMetadataBefore = source.indexOf(
      'inspectBridgeClipboard()',
      pasteWait,
    );
    const pasteStateProbe = source.indexOf(
      'readRootEditorMatch(expectedMarkdown)',
      pasteMetadataBefore,
    );
    const pasteMetadataAfter = source.indexOf(
      'inspectBridgeClipboard()',
      pasteStateProbe,
    );
    expect(pasteMetadataBefore).toBeGreaterThan(pasteWait);
    expect(pasteStateProbe).toBeGreaterThan(pasteMetadataBefore);
    expect(pasteMetadataAfter).toBeGreaterThan(pasteStateProbe);
    const mutationTracker = source.indexOf('async function trackOwnedClipboardMutation');
    const mutationTrackerEnd = source.indexOf(
      'async function invokeTauriCommand',
      mutationTracker,
    );
    const mutationTrackerSource = source.slice(mutationTracker, mutationTrackerEnd);
    expect(mutationTrackerSource).toContain(
      'async function trackOwnedClipboardMutation(name)',
    );
    expect(mutationTrackerSource).toContain(
      'const pending = pendingClipboardMutation;',
    );
    expect(
      source.indexOf('assertOwnedClipboardMetadata({', mutationTracker),
    ).toBeLessThan(source.indexOf('readBridgeClipboardText(metadata.sequence)', mutationTracker));
    expect(mutationTrackerSource).toContain('compareAsPath: pending.compareAsPath');
    expect(mutationTrackerSource).toContain('expectedText: pending.expectedText');
    expect(mutationTrackerSource).toContain('writerKind: pending.writerKind');
    expect(mutationTrackerSource).toContain(
      "recordClipboardMetadataObservation(name, 'after-command-sequence', metadata)",
    );
    expect(
      mutationTrackerSource.indexOf('recordClipboardMetadataObservation('),
    ).toBeLessThan(
      mutationTrackerSource.indexOf('assertOwnedClipboardMetadata({'),
    );
    expect(source.match(/await trackOwnedClipboardMutation\(/g)).toHaveLength(6);
    expect(source).not.toMatch(
      /await trackOwnedClipboardMutation\(\s*(?:`[^`]+`|'[^']+')\s*,/,
    );
    expect(source).toContain(
      'const INSTALLED_TEXT_WRITER_KIND = \'tauri-native-text\'',
    );
    expect(source).toContain(
      'beginClipboardMutation(`${scenario.name}.copy-path`, scenario.expectedPath',
    );
    expect(source).toContain('expectedText: pending.expectedText');
    expect(source.indexOf('restoreMetadataIsSafeToRead')).toBeLessThan(
      source.indexOf('readBridgeClipboardText(restoredMetadata.sequence)'),
    );
    expect(source).toContain('acceptanceSourceIdentity');
    expect(source).toContain('verifierSha256: await sha256File(verifierSourcePath)');
    expect(source).toContain('helperSha256: await sha256File(helperSourcePath)');
    expect(source).toContain(
      'evidence.plannedExitCode = evidence.summary.passed ? 0 : 1',
    );
    expect(source.indexOf('evidence.plannedExitCode =')).toBeLessThan(
      source.indexOf('await writeFile(resultPath'),
    );
  });

  it('quiesces the acceptance-owned writer before resolving pending clipboard state or restoring', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    const cleanupStart = source.indexOf('} finally {');
    const inputStop = source.indexOf(
      'inputInjectionPermitted = false;',
      cleanupStart,
    );
    const browserDisconnect = source.indexOf(
      "runCleanupStage('browser-disconnect'",
      inputStop,
    );
    const childExit = source.indexOf(
      "runCleanupStage('owned-child-process-exit'",
      browserDisconnect,
    );
    const clipboardRestore = source.indexOf(
      "runCleanupStage('clipboard-restore'",
      childExit,
    );
    const clipboardRestoreEnd = source.indexOf(
      "runCleanupStage('temporary-directory-remove'",
      clipboardRestore,
    );
    const browserDisconnectSource = source.slice(browserDisconnect, childExit);
    const childExitSource = source.slice(childExit, clipboardRestore);
    const clipboardRestoreSource = source.slice(
      clipboardRestore,
      clipboardRestoreEnd,
    );

    expect(inputStop).toBeGreaterThan(cleanupStart);
    expect(browserDisconnect).toBeGreaterThan(inputStop);
    expect(childExit).toBeGreaterThan(browserDisconnect);
    expect(clipboardRestore).toBeGreaterThan(childExit);
    expect(source).toContain('inputInjectionPermitted = false');
    expect(source).toContain("action === 'pointer' && !inputInjectionPermitted");
    expect(browserDisconnectSource).toContain('browser.isConnected()');
    const browserClose = browserDisconnectSource.indexOf('await browser.close()');
    expect(browserClose).toBeGreaterThan(0);
    expect(browserClose).toBeLessThan(
      browserDisconnectSource.indexOf('cdpDisconnected: true', browserClose),
    );
    const earlyExitProof = childExitSource.indexOf(
      'assertAlreadyExitedAcceptanceChild({',
    );
    const earlyExitVerified = childExitSource.indexOf(
      'childExitVerified: true',
      earlyExitProof,
    );
    const unexpectedEarlyExit = childExitSource.indexOf(
      "throw new Error('The acceptance-owned child exited before cleanup.')",
      earlyExitVerified,
    );
    const activeExitProbe = childExitSource.indexOf(
      'if (after.exists)',
      earlyExitVerified,
    );
    const activeExitVerified = childExitSource.indexOf(
      'childExitVerified: true',
      activeExitProbe,
    );
    expect(earlyExitProof).toBeLessThan(earlyExitVerified);
    expect(earlyExitVerified).toBeLessThan(unexpectedEarlyExit);
    expect(activeExitProbe).toBeLessThan(activeExitVerified);
    expect(childExitSource).not.toContain('skipped: true, writerQuiesced: true');
    expect(clipboardRestoreSource).toContain(
      'assertClipboardCleanupReady(clipboardCleanupState)',
    );
    expect(clipboardRestoreSource.indexOf('if (!clipboardCaptured)')).toBeLessThan(
      clipboardRestoreSource.indexOf(
        'assertClipboardCleanupReady(clipboardCleanupState)',
      ),
    );
    expect(
      clipboardRestoreSource.indexOf(
        'assertClipboardCleanupReady(clipboardCleanupState)',
      ),
    ).toBeLessThan(clipboardRestoreSource.indexOf('if (pendingClipboardMutation)'));
    expect(source).toContain('let activeChildBaseline');
    expect(source).toContain('activeChildBaseline = Object.freeze({');
    expect(childExitSource).toContain('if (!before.exists)');
    expect(childExitSource).toContain('assertAlreadyExitedAcceptanceChild({');
  });

  it('uses command-owned metadata checks for paste while keeping capture and restore strict', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    expect(
      source.match(/assertCurrentCommandOwnedClipboardMetadata\(\{/g),
    ).toHaveLength(2);
    expect(source.match(/classifyClipboardFormats\(/g)).toHaveLength(2);

    const pastePreflight = source.indexOf(
      'const pasteClipboardPreflight = inspectBridgeClipboard()',
    );
    const preflightOwnershipCheck = source.indexOf(
      'assertCurrentCommandOwnedClipboardMetadata({',
      pastePreflight,
    );
    const pastePointer = source.indexOf(
      "await osPointer(pasteItem, 'editor.empty.paste'",
      preflightOwnershipCheck,
    );
    const pasteWaitValidator = source.indexOf(
      'function assertPasteClipboardMetadata',
    );
    const waitOwnershipCheck = source.indexOf(
      'assertCurrentCommandOwnedClipboardMetadata({',
      pasteWaitValidator,
    );

    expect(preflightOwnershipCheck).toBeGreaterThan(pastePreflight);
    expect(pastePointer).toBeGreaterThan(preflightOwnershipCheck);
    expect(waitOwnershipCheck).toBeGreaterThan(pasteWaitValidator);
  });

  it('waits for the packaged WebView Tauri IPC runtime before invoking acceptance commands', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    const launchFunction = source.indexOf(
      'async function launchAcceptanceApplication',
    );
    const runtimeReady = source.indexOf(
      'await waitForTauriInvokeReady(phase)',
      launchFunction,
    );
    const firstAcceptanceInvoke = source.indexOf(
      "'settings_acceptance_config_dir'",
      launchFunction,
    );

    expect(runtimeReady).toBeGreaterThan(launchFunction);
    expect(runtimeReady).toBeLessThan(firstAcceptanceInvoke);
    expect(source).toContain(
      "typeof window.__TAURI_INTERNALS__?.invoke === 'function'",
    );
    expect(source).toContain('tauri-invoke-ready-${phase}');
  });

  it('waits for every table in the acceptance fixture without a strict locator', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    expect(source).toContain("page.locator('.tbl-table-widget').count()");
    expect(source).toContain(
      'count === ACCEPTANCE_TABLE_WIDGET_COUNT',
    );
    expect(source).not.toContain(
      "page.locator('.tbl-table-widget').waitFor",
    );
    expect(source).toContain("'| Target                  | Value |'");
    expect(source).toContain("'| ----------------------- | ----- |'");
    expect(source).toContain("'| Other                          | Value    |'");
    expect(source).toContain("'| ------------------------------ | -------- |'");
  });

  it('resolves the exact fixture table range before any table command runs', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );

    const tableFrom = source.indexOf(
      'const tableFrom = beforeTableCopy.doc.indexOf(TABLE_SOURCE);',
    );
    const tableTo = source.indexOf(
      'const tableTo = tableFrom + TABLE_SOURCE.length;',
      tableFrom,
    );
    const rangeCheck = source.indexOf(
      "'table-copy-target-range-resolves-exact-fixture'",
      tableTo,
    );
    const nonnegativeProof = source.indexOf('tableFrom >= 0', rangeCheck);
    const exactSourceProof = source.indexOf(
      'beforeTableCopy.doc.slice(tableFrom, tableTo) === TABLE_SOURCE',
      rangeCheck,
    );
    const markerProof = source.indexOf(
      'beforeTableCopy.doc.slice(tableFrom, tableTo).includes(TABLE_MARKER)',
      rangeCheck,
    );
    const firstTableCommand = source.indexOf(
      "menu = await openContextMenu(tableCell, 'editor-table-copy')",
      rangeCheck,
    );

    expect(tableFrom).toBeGreaterThan(0);
    expect(tableTo).toBeGreaterThan(tableFrom);
    expect(rangeCheck).toBeGreaterThan(tableTo);
    expect(nonnegativeProof).toBeGreaterThan(rangeCheck);
    expect(exactSourceProof).toBeGreaterThan(rangeCheck);
    expect(markerProof).toBeGreaterThan(rangeCheck);
    expect(firstTableCommand).toBeGreaterThan(markerProof);
    expect(source).not.toContain("indexOf('| Target | Value |')");
  });

  it('proves Delete Table is the exact target-range edit and reduces widgets from two to one', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    const deleteStart = source.indexOf(
      "await osPointer(plainLine, 'editor.plain.before-table-delete')",
    );
    const deleteEnd = source.indexOf(
      "await captureScreenshot('editor-after-table-delete')",
      deleteStart,
    );
    const deleteSource = source.slice(deleteStart, deleteEnd);
    const beforeState = deleteSource.indexOf(
      'const beforeTableDelete = await readRootEditorState();',
    );
    const targetFrom = deleteSource.indexOf(
      'const deleteTableFrom = beforeTableDelete.doc.indexOf(TABLE_SOURCE);',
    );
    const targetTo = deleteSource.indexOf(
      'const deleteTableTo = deleteTableFrom + TABLE_SOURCE.length;',
    );
    const expectedDocument = deleteSource.indexOf(
      'const expectedAfterTableDelete =',
    );
    const targetRangeProof = deleteSource.indexOf(
      "'table-delete-target-range-resolves-exact-fixture'",
    );
    const selectionProof = deleteSource.indexOf(
      "'table-delete-starts-with-selection-outside-target'",
    );
    const widgetsBefore = deleteSource.indexOf(
      'const beforeTableWidgetCount = await tableWidgets.count();',
    );
    const menuOpen = deleteSource.indexOf(
      "menu = await openContextMenu(tableCell, 'editor-table-delete')",
    );

    expect(deleteStart).toBeGreaterThan(0);
    expect(deleteEnd).toBeGreaterThan(deleteStart);
    expect(targetFrom).toBeGreaterThan(beforeState);
    expect(targetTo).toBeGreaterThan(targetFrom);
    expect(expectedDocument).toBeGreaterThan(targetTo);
    expect(deleteSource).toContain('beforeTableDelete.doc.slice(0, deleteTableFrom) +');
    expect(deleteSource).toContain('beforeTableDelete.doc.slice(deleteTableTo);');
    expect(targetRangeProof).toBeGreaterThan(expectedDocument);
    expect(deleteSource).toContain(
      'beforeTableDelete.doc.slice(deleteTableFrom, deleteTableTo) === TABLE_SOURCE',
    );
    expect(selectionProof).toBeGreaterThan(targetRangeProof);
    expect(deleteSource).toContain(
      'beforeTableDelete.selection.to <= deleteTableFrom ||',
    );
    expect(deleteSource).toContain(
      'beforeTableDelete.selection.from >= deleteTableTo',
    );
    expect(widgetsBefore).toBeGreaterThan(selectionProof);
    expect(deleteSource).toContain('beforeTableWidgetCount === 2');
    expect(menuOpen).toBeGreaterThan(widgetsBefore);
    expect(deleteSource).toContain('state.doc === expectedAfterTableDelete');
    expect(deleteSource).toContain('tableWidgetCount === 1');
    expect(deleteSource).toContain(
      'afterTableDelete.doc === expectedAfterTableDelete',
    );
    expect(deleteSource).toContain(
      'beforeTableWidgetCount === 2 && afterTableWidgetCount === 1',
    );
  });

  it('registers the acceptance config-dir IPC command in the Tauri handler', async () => {
    const [commandSource, libSource] = await Promise.all([
      readFile(
        join(process.cwd(), 'src-tauri/src/commands/settings.rs'),
        'utf8',
      ),
      readFile(join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8'),
    ]);
    const testModuleStart = commandSource.indexOf('#[cfg(test)]\nmod tests');
    expect(testModuleStart).toBeGreaterThan(0);
    const productionCommandSource = commandSource.slice(0, testModuleStart);

    expect(commandSource).toContain('pub fn settings_acceptance_config_dir()');
    expect(commandSource).toContain(
      'pub fn settings_acceptance_write_barrier_dir()',
    );
    expect(commandSource).toContain(
      'pub async fn settings_acceptance_mark_close_entered()',
    );
    expect(commandSource).toContain('LUMAMARK_ACCEPTANCE_MODE');
    expect(productionCommandSource).toContain('settings.acceptance_mode_invalid');
    expect(productionCommandSource).toContain(
      'ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR_ENV',
    );
    expect(productionCommandSource).toContain(
      'save_settings_with_acceptance_write_barrier',
    );
    expect(libSource).toContain('settings_acceptance_config_dir,');
    expect(libSource).toContain('settings_acceptance_write_barrier_dir,');
    expect(libSource).toContain('settings_acceptance_mark_close_entered,');
    expect(libSource).toContain('acceptance_settings_config_dir_from_environment');
    expect(libSource).toContain('should_register_single_instance(');
    expect(libSource).toContain('acceptance_config_dir.as_deref()');
    expect(libSource).toContain('let builder = if register_single_instance');
    expect(libSource).not.toContain('.ok().flatten()');
    expect(libSource).toContain('Err(error) => panic!');
  });

  it('removes native folder-dialog automation and documents the dedicated VM boundary', async () => {
    const [source, documentation] = await Promise.all([
      readFile(
        join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
        'utf8',
      ),
      readFile(join(process.cwd(), 'docs/release/WINDOWS_V1_BUILD.md'), 'utf8'),
    ]);

    expect(source).not.toContain("action: 'select-folder'");
    expect(source).toContain('__LUMAMARK_E2E_WORKSPACE__');
    expect(documentation).toMatch(/原生文件夹.*(?:专用账号|虚拟机)/);
    expect(documentation).toMatch(/剪贴板历史记录.*关闭/);
    expect(documentation).toContain(
      'LUMAMARK_ACCEPTANCE_ALLOW_PLAINTEXT_CLIPBOARD_RESTORE',
    );
    expect(documentation).toContain(
      'LUMAMARK_ACCEPTANCE_SETTINGS_WRITE_BARRIER_DIR',
    );
    expect(documentation).toMatch(/marker.*时间阈值/);
  });

  it('records executable identity, startup diagnostics, and verified cleanup', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    const bridgeSource = buildWin32PointerBridgeSource();

    expect(source).toContain('executableSha256');
    expect(source).toContain('fileVersion');
    expect(source).toContain('productVersion');
    expect(source).toContain("page.on('pageerror'");
    expect(source).toContain("page.on('crash'");
    expect(source).toContain("cdpSession.send('Log.enable')");
    expect(source).toContain("cdpSession.on('Log.entryAdded'");
    expect(source).toContain('verifyOwnedChildProcess');
    expect(source).toContain("args.push('-TargetExecutablePath'");
    expect(source).toContain("args.push('-TargetStartTimeUtc'");
    expect(bridgeSource).toContain('$TargetExecutablePath');
    expect(bridgeSource).toContain('$TargetStartTimeUtc');
    expect(bridgeSource).toContain('Assert-TargetProcessIdentity');
    expect(source).toContain('resolveTrustedWindowsToolPaths');
    expect(source).toContain('systemTools.powershellPath');
    expect(source).toContain('systemTools.tasklistPath');
    expect(source).not.toContain("execFileSync('powershell'");
    expect(source).not.toContain("spawnSync('tasklist'");
    expect(source).toContain("child.kill('SIGKILL')");
    expect(source).not.toContain("spawnSync('taskkill'");
    expect(source).toContain('temporary-directory-removed');
    expect(source).toContain("join(artifactDirectory, 'app-stdout.log')");
    expect(source.indexOf('const childProcess = await Promise.race')).toBeLessThan(
      source.indexOf('waitForDebugEndpoint(debugPort)'),
    );
    expect(source.indexOf("runCleanupStage('write-process-logs-last'")).toBeGreaterThan(
      source.indexOf("runCleanupStage('temporary-directory-remove'"),
    );
  });

  it('requires an error-free final runtime and a live identity-matched child before cleanup', async () => {
    const source = await readFile(
      join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
      'utf8',
    );
    const summaryStart = source.indexOf('evidence.summary = {');
    const summaryEnd = source.indexOf('\n  };', summaryStart);
    const summarySource = source.slice(summaryStart, summaryEnd);
    const cleanupStart = source.indexOf(
      "runCleanupStage('owned-child-process-exit'",
    );
    const cleanupEnd = source.indexOf(
      "runCleanupStage('temporary-directory-remove'",
      cleanupStart,
    );
    const cleanupSource = source.slice(cleanupStart, cleanupEnd);
    const processProbe = cleanupSource.indexOf(
      "invokeBridge({ action: 'process-info', timeout: 5_000 })",
    );
    const identityProof = cleanupSource.indexOf(
      'verifyOwnedChildProcess(before, baseline, executablePath);',
    );
    const ownedTermination = cleanupSource.indexOf(
      'terminationAttempt = stopOwnedChild(app);',
    );

    expect(summaryStart).toBeGreaterThan(0);
    expect(summaryEnd).toBeGreaterThan(summaryStart);
    expect(summarySource).toContain('evidence.pageErrors.length === 0');
    expect(summarySource).toContain('evidence.consoleErrors.length === 0');
    expect(summarySource).toContain('evidence.pageCrashes.length === 0');
    expect(processProbe).toBeGreaterThan(0);
    expect(identityProof).toBeGreaterThan(processProbe);
    expect(ownedTermination).toBeGreaterThan(identityProof);
    expect(cleanupSource).not.toContain('if (before.exists)');
    expect(cleanupSource).toContain('terminationAttempt.accepted !== true');
  });

  it('uses an acceptance-only Rust write barrier to prove OS close awaits the theme save', async () => {
    const [source, bridgeSource] = await Promise.all([
      readFile(
        join(process.cwd(), 'scripts/release/verify-installed-menu-context-os.mjs'),
        'utf8',
      ),
      Promise.resolve(buildWin32PointerBridgeSource()),
    ]);

    expect(source).toContain("join(settingsConfigDirectory, 'settings.json')");
    expect(source).toContain("await launchAcceptanceApplication('initial')");
    expect(source).toContain("await launchAcceptanceApplication('settings-restart')");
    expect(source).toContain('join(tempDirectory, `webview-${phase}`)');
    expect(source).toContain("'settings-restart-uses-fresh-webview-profile'");
    expect(source).toContain("join(webviewProfile, 'EBWebView')");
    expect(source).toContain('profileStartedAbsent');
    expect(source).toContain('webview-runtime-created-profile-${phase}');
    expect(source).toContain('readPersistedSettingsFile');
    expect(source).toContain('closeCurrentApplicationNormally');
    expect(source).toContain("'settings-v2-written-inside-isolated-config'");
    expect(source).toContain("'settings-pre-close-baseline-is-light'");
    expect(source).toContain("'settings-write-barrier-entered-before-close'");
    expect(source).toContain("'settings-close-coordinator-entered-write-barrier'");
    expect(source).toContain("'settings-remains-light-while-close-is-blocked'");
    expect(source).toContain("'settings-process-alive-while-write-is-blocked'");
    expect(source).toContain(
      "'settings-main-window-remains-open-while-close-awaits-settings'",
    );
    expect(source).toContain("'settings-write-barrier-markers-consumed'");
    expect(source).toContain("'settings-immediate-close-flushed-theme-menu-change'");
    expect(source).toContain("'settings-persistence-restart-restored-ui'");
    expect(source).toContain('LABELS.autoCheckUpdates');
    expect(source).toContain(
      "dialog.getByRole('switch', { name: LABELS.autoCheckUpdates })",
    );
    expect(source).toContain(
      "dialog.getByRole('switch', {\n    name: LABELS.autoCheckUpdates,",
    );
    expect(source).not.toContain(
      "getByRole('checkbox', { name: LABELS.autoCheckUpdates",
    );
    expect(source).toContain('LABELS.themeSystem');
    expect(source).toContain(
      "await findVisibleRole('radio', LABELS.themeSystem)",
    );
    expect(source).toContain(
      "() => restoredSystemTheme.getAttribute('aria-checked')",
    );
    expect(source).toContain(
      "const restoredThemeChecked = restoredThemeAriaChecked === 'true';",
    );
    expect(source).not.toContain('() => restoredSystemTheme.isChecked()');
    expect(source).not.toContain(
      "dialog.getByRole('button', {\n    name: LABELS.themeSystem,",
    );
    expect(source).not.toContain(
      "() => restoredSystemTheme.getAttribute('aria-pressed')",
    );
    expect(source).toContain("join(tempDirectory, 'settings-write-barrier')");
    expect(source).toContain("createSettingsWriteBarrierMarker('arm')");
    expect(source).toContain("waitForSettingsWriteBarrierMarker('entered')");
    expect(source).toContain(
      "waitForSettingsWriteBarrierMarker('close-entered')",
    );
    expect(source).toContain("createSettingsWriteBarrierMarker('release')");
    expect(source).not.toContain('millisecondsFromThemeActionToClosePointer');
    const themeMenuMutation = source.indexOf(
      "openTopMenu(LABELS.theme, 'settings-persistence.theme-menu')",
    );
    const barrierArm = source.indexOf(
      "createSettingsWriteBarrierMarker('arm')",
    );
    const barrierEntered = source.indexOf(
      "waitForSettingsWriteBarrierMarker('entered')",
      themeMenuMutation,
    );
    const immediateClose = source.indexOf(
      "'settings-theme-menu-immediate-close'",
      barrierEntered,
    );
    const restart = source.indexOf(
      "launchAcceptanceApplication('settings-restart')",
      immediateClose,
    );
    expect(themeMenuMutation).toBeGreaterThan(0);
    expect(immediateClose).toBeGreaterThan(themeMenuMutation);
    expect(barrierArm).toBeLessThan(themeMenuMutation);
    expect(barrierEntered).toBeGreaterThan(themeMenuMutation);
    expect(barrierEntered).toBeLessThan(immediateClose);
    expect(restart).toBeGreaterThan(immediateClose);
    const closeHelperStart = source.indexOf(
      'async function closeCurrentApplicationNormally',
    );
    const closeHelperEnd = source.indexOf(
      'async function verifyTopChromeAndDragging',
      closeHelperStart,
    );
    const closeHelper = source.slice(closeHelperStart, closeHelperEnd);
    expect(closeHelper.indexOf('await osPointer')).toBeLessThan(
      closeHelper.indexOf('await afterClosePointer'),
    );
    expect(closeHelper.indexOf('await afterClosePointer')).toBeLessThan(
      closeHelper.indexOf('await Promise.race'),
    );
    const postCloseCallback = source.slice(immediateClose, restart);
    expect(
      postCloseCallback.indexOf(
        "waitForSettingsWriteBarrierMarker('close-entered')",
      ),
    ).toBeLessThan(postCloseCallback.indexOf('readClientMetrics()'));
    expect(postCloseCallback.indexOf('readClientMetrics()')).toBeLessThan(
      postCloseCallback.indexOf("createSettingsWriteBarrierMarker('release')"),
    );
    expect(bridgeSource).toContain('$AllowTargetExit');
  });

  it('signals close-entered only after settings flush starts and before destroy', async () => {
    const [coordinatorSource, hookSource] = await Promise.all([
      readFile(
        join(process.cwd(), 'src/app/controllers/appCloseCoordinator.ts'),
        'utf8',
      ),
      readFile(
        join(process.cwd(), 'src/app/controllers/useAppCloseCoordinator.ts'),
        'utf8',
      ),
    ]);
    const flushStart = coordinatorSource.indexOf('flushSettings()');
    const closeSignal = coordinatorSource.indexOf(
      'markAcceptanceCloseEntered()',
      flushStart,
    );
    const destroy = coordinatorSource.indexOf('await destroy()', closeSignal);

    expect(flushStart).toBeGreaterThan(0);
    expect(closeSignal).toBeGreaterThan(flushStart);
    expect(destroy).toBeGreaterThan(closeSignal);
    expect(hookSource).toContain('markSettingsAcceptanceCloseEntered');
  });
});
