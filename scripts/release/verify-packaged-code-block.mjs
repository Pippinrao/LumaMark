/**
 * Packaged Windows acceptance for fenced-code completion and focus geometry.
 *
 * CDP is observation-only in this gate. Every click and keystroke travels
 * through Win32 SendInput, with CSS viewport coordinates converted from the
 * spawned window's client-area origin via ClientToScreen.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const execFileAsync = promisify(execFile);
const root = new URL('../..', import.meta.url);
const executablePath = fileURLToPath(
  new URL('src-tauri/target/release/lumamark.exe', root),
);
const fileName = 'code-block-os-probe.md';
const initialMarkdown = '# Code block OS acceptance\n\nfence-target';
const completedMarkdown = `${initialMarkdown}\n\n\`\`\`ts\n\n\`\`\``;
const completedCaret = `${initialMarkdown}\n\n\`\`\`ts\n`.length;
const bodyMarkdown = `${initialMarkdown}\n\n\`\`\`ts\nconst n = 1;\n\`\`\``;
const exitedMarkdown = `${bodyMarkdown}\n\nafter`;

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:packaged-code-block] Windows WebView2 only; skipping.\n',
  );
  process.exit(0);
}

const processOutput = { stderr: [], stdout: [] };
let app;
let appExit;
let appStartError;
let browser;
let page;
let tempDirectory;

try {
  const debugPort = await reserveDebugPort(
    parseRequestedPort(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT),
  );
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-packaged-code-block-'));
  const documentPath = join(tempDirectory, fileName);
  await writeFile(documentPath, initialMarkdown, 'utf8');

  app = spawn(executablePath, [documentPath], {
    cwd: tempDirectory,
    env: createPackagedWebviewEnvironment({
      baseEnvironment: process.env,
      debugPort,
      tempDirectory,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  if (!Number.isInteger(app.pid)) {
    throw new Error('Packaged LumaMark did not expose its spawned process id.');
  }

  appExit = new Promise((resolve) => {
    app.once('exit', (code, signal) => resolve({ code, signal }));
    app.once('error', (error) => {
      appStartError = error;
      resolve({ code: null, signal: null });
    });
  });
  app.stdout?.on('data', (chunk) => {
    processOutput.stdout.push(chunk.toString());
  });
  app.stderr?.on('data', (chunk) => {
    processOutput.stderr.push(chunk.toString());
  });

  await waitForDebugEndpoint(debugPort, () => ownedProcessFailure(app));
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  page =
    context.pages()[0] ??
    (await context.waitForEvent('page', { timeout: 5_000 }));

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lm-editor-title', { hasText: fileName }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await page
    .locator('.lm-editor-live-preview-mode .cm-content')
    .waitFor({ state: 'visible', timeout: 15_000 });

  const ownedWindow = await waitForOwnedMainWindow(app);
  const initial = await waitForSnapshot(
    page,
    (snapshot) => snapshot.source === initialMarkdown && snapshot.tailPoint,
    'the argv document and its final-line coordinate',
  );

  await sendOwnedInput(app.pid, [
    clickAction(initial.tailPoint, initial.devicePixelRatio),
    { kind: 'delay', milliseconds: 150 },
    { kind: 'key', name: 'END' },
  ]);
  await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.source === initialMarkdown &&
      snapshot.selectionHead === initialMarkdown.length &&
      snapshot.focused,
    'the real pointer click to focus the final source position',
  );

  await sendOwnedInput(app.pid, [
    { kind: 'key', name: 'ENTER' },
    { kind: 'text', value: '```ts' },
    { kind: 'key', name: 'ENTER' },
  ]);
  const completed = await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.source === completedMarkdown &&
      snapshot.selectionHead === completedCaret,
    'fenced-code completion from real keyboard input',
  );

  await sendOwnedInput(app.pid, [{ kind: 'chord', name: 'CTRL_Z' }]);
  await waitForSnapshot(
    page,
    (snapshot) => snapshot.source === `${initialMarkdown}\n\n\`\`\`ts`,
    'single-step undo of fenced-code completion',
  );
  await sendOwnedInput(app.pid, [{ kind: 'chord', name: 'CTRL_Y' }]);
  await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.source === completedMarkdown &&
      snapshot.selectionHead === completedCaret &&
      snapshot.selectionLine === '',
    'single-step redo of fenced-code completion',
  );

  await sendOwnedInput(app.pid, [
    { kind: 'text', value: 'const n = 1;' },
  ]);
  const withBody = await waitForSnapshot(
    page,
    (snapshot) => snapshot.source === bodyMarkdown && snapshot.bodyPoint,
    'the code body typed through real keyboard input',
  );

  await sendOwnedInput(app.pid, [
    clickAction(withBody.anchorPoint, withBody.devicePixelRatio),
  ]);
  const inactive = await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.source === bodyMarkdown &&
      snapshot.activeCodeLineCount === 0 &&
      snapshot.selectionLine === 'fence-target',
    'the inactive code-block geometry',
  );

  await sendOwnedInput(app.pid, [
    clickAction(inactive.bodyPoint, inactive.devicePixelRatio),
  ]);
  const active = await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.source === bodyMarkdown &&
      snapshot.activeCodeLineCount === 3 &&
      snapshot.editorDescription === 'TypeScript' &&
      snapshot.language === 'TypeScript' &&
      snapshot.pseudoContent.includes('TypeScript') &&
      snapshot.selectionLine === 'const n = 1;' &&
      snapshot.selectionHead === snapshot.bodyClickHead,
    'the active code-block language and focus decoration',
  );

  const geometry = compareGeometry(inactive, active);
  if (!geometry.stable) {
    throw new Error(
      `Code-block activation changed editor geometry: ${JSON.stringify(geometry)}`,
    );
  }
  if (!geometry.visualFocusChanged) {
    throw new Error('Code-block activation did not expose a distinct focus visual.');
  }
  assertNoInventedVerticalHitArea(inactive);
  assertNoInventedVerticalHitArea(active);

  await sendOwnedInput(app.pid, [
    { kind: 'chord', name: 'CTRL_END' },
    { kind: 'key', name: 'ENTER' },
    { kind: 'text', value: 'after' },
  ]);
  await waitForSnapshot(
    page,
    (snapshot) =>
      snapshot.source === exitedMarkdown && snapshot.selectionLine === 'after',
    'typing ordinary Markdown after exiting the closing fence',
  );
  await sendOwnedInput(app.pid, [{ kind: 'chord', name: 'CTRL_S' }]);
  await waitForFileContents(documentPath, exitedMarkdown);

  process.stdout.write(
    JSON.stringify(
      {
        packagedCodeBlock: true,
        autoClose: {
          caretBetweenFences:
            completed.selectionHead === completedCaret,
          redo: true,
          undo: true,
        },
        accessibleDescription: active.editorDescription,
        exitedFence: true,
        geometry,
        inputPath: {
          clientOrigin: [ownedWindow.clientLeft, ownedWindow.clientTop],
          coordinateOrigin: 'ClientToScreen',
          devicePixelRatio: active.devicePixelRatio,
          processId: app.pid,
          sender: 'SendInput',
          windowDpi: ownedWindow.windowDpi,
          windowHandle: ownedWindow.windowHandle,
        },
        language: active.language,
        savedRoundTrip: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(
    [
      '[release:packaged-code-block] FAILED',
      error instanceof Error ? error.stack ?? error.message : String(error),
      `stdout: ${processOutput.stdout.join('')}`,
      `stderr: ${processOutput.stderr.join('')}`,
    ].join('\n'),
  );
  process.stderr.write('\n');
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (app?.exitCode === null && !app.killed) {
    app.kill('SIGKILL');
    if (appExit) {
      await Promise.race([appExit, delay(3_000)]);
    }
  }
  if (tempDirectory) {
    await removePackagedWebviewTempDirectory(tempDirectory);
  }
}

function clickAction(point, devicePixelRatio) {
  if (!point) {
    throw new Error('A readable CSS viewport point is required for OS input.');
  }
  return {
    devicePixelRatio,
    kind: 'click',
    x: point.x,
    y: point.y,
  };
}

function ownedProcessFailure(ownedApp) {
  if (appStartError) {
    return appStartError;
  }
  if (ownedApp.exitCode !== null || ownedApp.signalCode !== null) {
    return new Error(
      `Spawned LumaMark process ${ownedApp.pid} exited before acceptance; ` +
        'another single-instance owner may already be running.',
    );
  }
  return null;
}

async function waitForOwnedMainWindow(ownedApp) {
  let lastNativeInputError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const failure = ownedProcessFailure(ownedApp);
    if (failure) {
      throw failure;
    }
    try {
      return await sendOwnedInput(ownedApp.pid, []);
    } catch (error) {
      lastNativeInputError = error;
      if (attempt === 59) {
        const detail =
          lastNativeInputError instanceof Error
            ? lastNativeInputError.message
            : String(lastNativeInputError);
        throw new Error(
          `Spawned process ${ownedApp.pid} never exposed its own main window. ` +
            'Refusing to fall back to another LumaMark process. ' +
            `Last native input error: ${detail}`,
          { cause: error },
        );
      }
      await delay(250);
    }
  }
  throw new Error('Unreachable owned-window wait state.');
}

async function sendOwnedInput(processId, actions) {
  if (!Number.isInteger(processId) || processId < 1) {
    throw new Error(`Invalid spawned process id: ${processId}`);
  }
  if (!tempDirectory) {
    throw new Error('Native input requires the owned acceptance directory.');
  }
  const encodedActions = Buffer.from(JSON.stringify(actions), 'utf8').toString(
    'base64',
  );
  const command = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class LumaMarkNativeInput {
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public const uint INPUT_MOUSE = 0;
  public const uint INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
  public const uint MOUSEEVENTF_MOVE = 0x0001;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
  public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_SHOWWINDOW = 0x0040;

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION U;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint inputCount, INPUT[] inputs, int inputSize);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool ClientToScreen(IntPtr windowHandle, ref POINT point);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetClientRect(IntPtr windowHandle, out RECT rectangle);

  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int index);

  [DllImport("user32.dll")]
  public static extern uint GetDpiForWindow(IntPtr windowHandle);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr windowHandle);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr windowHandle, int command);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr windowHandle);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr windowHandle);

  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(
    IntPtr windowHandle,
    int attribute,
    out int value,
    int valueSize
  );

  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(POINT point);

  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr windowHandle, uint flags);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(
    IntPtr windowHandle,
    out uint processId
  );

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(
    IntPtr windowHandle,
    IntPtr insertAfter,
    int x,
    int y,
    int width,
    int height,
    uint flags
  );

  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

  private static void Submit(INPUT[] inputs) {
    int inputSize = Marshal.SizeOf(typeof(INPUT));
    int expectedInputSize = IntPtr.Size == 8 ? 40 : 28;
    if (inputSize != expectedInputSize) {
      throw new InvalidOperationException(
        "Unexpected Win32 INPUT size: " + inputSize + "; expected " + expectedInputSize + "."
      );
    }
    uint sent = SendInput((uint)inputs.Length, inputs, inputSize);
    if (sent != inputs.Length) {
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Win32 input injection was incomplete.");
    }
  }

  private static INPUT Mouse(int x, int y, uint flags) {
    int virtualLeft = GetSystemMetrics(76);
    int virtualTop = GetSystemMetrics(77);
    int virtualWidth = GetSystemMetrics(78);
    int virtualHeight = GetSystemMetrics(79);
    if (virtualWidth < 2 || virtualHeight < 2) {
      throw new InvalidOperationException("The virtual desktop geometry is unavailable.");
    }
    int normalizedX = (int)Math.Round((x - virtualLeft) * 65535.0 / (virtualWidth - 1));
    int normalizedY = (int)Math.Round((y - virtualTop) * 65535.0 / (virtualHeight - 1));
    return new INPUT {
      type = INPUT_MOUSE,
      U = new INPUTUNION {
        mi = new MOUSEINPUT {
          dx = normalizedX,
          dy = normalizedY,
          dwFlags = flags | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK
        }
      }
    };
  }

  private static INPUT Key(ushort virtualKey, ushort scanCode, uint flags) {
    return new INPUT {
      type = INPUT_KEYBOARD,
      U = new INPUTUNION {
        ki = new KEYBDINPUT {
          wVk = virtualKey,
          wScan = scanCode,
          dwFlags = flags
        }
      }
    };
  }

  public static void Click(int x, int y) {
    Submit(new[] {
      Mouse(x, y, MOUSEEVENTF_MOVE),
      Mouse(x, y, MOUSEEVENTF_LEFTDOWN),
      Mouse(x, y, MOUSEEVENTF_LEFTUP)
    });
  }

  public static void StageWindowForClick(IntPtr windowHandle) {
    if (!SetWindowPos(
      windowHandle,
      HWND_TOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    )) {
      throw new Win32Exception(
        Marshal.GetLastWin32Error(),
        "Could not stage the owned window for a real OS click."
      );
    }
  }

  public static void AssertOwnedPoint(
    IntPtr expectedRoot,
    uint expectedProcessId,
    int x,
    int y
  ) {
    POINT point = new POINT { X = x, Y = y };
    IntPtr hitWindow = WindowFromPoint(point);
    IntPtr hitRoot = GetAncestor(hitWindow, 2);
    uint hitProcessId;
    GetWindowThreadProcessId(hitRoot, out hitProcessId);
    if (hitRoot != expectedRoot || hitProcessId != expectedProcessId) {
      RECT clientRectangle;
      if (!GetClientRect(expectedRoot, out clientRectangle)) {
        throw new Win32Exception(
          Marshal.GetLastWin32Error(),
          "Could not read expected client bounds after a native hit mismatch."
        );
      }
      POINT clientTopLeft = new POINT {
        X = clientRectangle.Left,
        Y = clientRectangle.Top
      };
      POINT clientBottomRight = new POINT {
        X = clientRectangle.Right,
        Y = clientRectangle.Bottom
      };
      if (
        !ClientToScreen(expectedRoot, ref clientTopLeft) ||
        !ClientToScreen(expectedRoot, ref clientBottomRight)
      ) {
        throw new Win32Exception(
          Marshal.GetLastWin32Error(),
          "Could not convert expected client bounds after a native hit mismatch."
        );
      }
      bool visible = IsWindowVisible(expectedRoot);
      bool iconic = IsIconic(expectedRoot);
      int cloaked;
      int cloakedResult = DwmGetWindowAttribute(
        expectedRoot,
        14,
        out cloaked,
        sizeof(int)
      );
      throw new InvalidOperationException(
        "Native click target mismatch at (" + x + ", " + y + "): hit HWND " +
        hitWindow.ToInt64() + ", root HWND " + hitRoot.ToInt64() +
        ", process " + hitProcessId + "; expected root HWND " +
        expectedRoot.ToInt64() + ", process " + expectedProcessId +
        ", expected client bounds (" + clientTopLeft.X + ", " +
        clientTopLeft.Y + ")-(" + clientBottomRight.X + ", " +
        clientBottomRight.Y + "), visible " + visible + ", iconic " +
        iconic + ", cloaked " + cloaked + " (HRESULT " +
        cloakedResult + ")."
      );
    }
  }

  public static void ReleaseWindowAfterClick(IntPtr windowHandle) {
    if (!SetWindowPos(
      windowHandle,
      HWND_NOTOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE
    )) {
      throw new Win32Exception(
        Marshal.GetLastWin32Error(),
        "Could not release the owned window after a real OS click."
      );
    }
  }

  public static void TypeText(string text) {
    foreach (char character in text) {
      Submit(new[] {
        Key(0, character, KEYEVENTF_UNICODE),
        Key(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)
      });
    }
  }

  public static void PressKey(ushort virtualKey) {
    Submit(new[] {
      Key(virtualKey, 0, 0),
      Key(virtualKey, 0, KEYEVENTF_KEYUP)
    });
  }

  public static void PressChord(ushort modifier, ushort virtualKey) {
    Submit(new[] {
      Key(modifier, 0, 0),
      Key(virtualKey, 0, 0),
      Key(virtualKey, 0, KEYEVENTF_KEYUP),
      Key(modifier, 0, KEYEVENTF_KEYUP)
    });
  }
}
"@

$previousDpiContext = [LumaMarkNativeInput]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($previousDpiContext -eq [IntPtr]::Zero) {
  throw [ComponentModel.Win32Exception]::new(
    [Runtime.InteropServices.Marshal]::GetLastWin32Error(),
    'Could not enter per-monitor-v2 DPI awareness.'
  )
}
$ProcessId = ${processId}
$process = Get-Process -Id $ProcessId -ErrorAction Stop
$process.Refresh()
$windowHandle = $process.MainWindowHandle
if ($windowHandle -eq [IntPtr]::Zero) {
  throw "Spawned process $ProcessId has no main window handle."
}
$windowDpi = [LumaMarkNativeInput]::GetDpiForWindow($windowHandle)
if ($windowDpi -eq 0) {
  throw "Could not read the DPI for spawned process $ProcessId."
}

$clientOrigin = New-Object LumaMarkNativeInput+POINT
$clientOrigin.X = 0
$clientOrigin.Y = 0
if (-not [LumaMarkNativeInput]::ClientToScreen($windowHandle, [ref]$clientOrigin)) {
  throw "Client-area coordinate conversion failed for spawned process $ProcessId."
}

[void][LumaMarkNativeInput]::ShowWindowAsync($windowHandle, 9)
[void][LumaMarkNativeInput]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 100
$actionsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedActions}'))
$expectedActionCount = ${actions.length}
$decodedActions = $actionsJson | ConvertFrom-Json
$actions = if ($expectedActionCount -eq 0) { @() } else { @($decodedActions) }
if ($actions.Count -ne $expectedActionCount) {
  throw "Native input action count changed while decoding: expected $expectedActionCount, received $($actions.Count)."
}

function Assert-OwnedForeground {
  if ([LumaMarkNativeInput]::GetForegroundWindow() -ne $windowHandle) {
    throw 'Only a real OS click may acquire foreground before keyboard input.'
  }
}

if (
  $actions.Count -gt 0 -and
  [string]$actions[0].kind -ne 'click'
) {
  Assert-OwnedForeground
}
foreach ($action in $actions) {
  switch ([string]$action.kind) {
    'click' {
      $windowScale = [double]$windowDpi / 96.0
      if ([Math]::Abs($windowScale - [double]$action.devicePixelRatio) -gt 0.02) {
        throw "WebView DPR $($action.devicePixelRatio) disagrees with window DPI $windowDpi."
      }
      $screenX = [int]($clientOrigin.X + [Math]::Round([double]$action.x * [double]$action.devicePixelRatio))
      $screenY = [int]($clientOrigin.Y + [Math]::Round([double]$action.y * [double]$action.devicePixelRatio))
      [LumaMarkNativeInput]::StageWindowForClick($windowHandle)
      try {
        [LumaMarkNativeInput]::AssertOwnedPoint($windowHandle, [uint32]$ProcessId, $screenX, $screenY)
        [LumaMarkNativeInput]::Click($screenX, $screenY)
        Start-Sleep -Milliseconds 150
      } finally {
        [LumaMarkNativeInput]::ReleaseWindowAfterClick($windowHandle)
      }
      $foregroundHandle = [LumaMarkNativeInput]::GetForegroundWindow()
      if ($foregroundHandle -ne $windowHandle) {
        throw "The native click did not foreground spawned process $ProcessId; expected HWND $($windowHandle.ToInt64()), actual HWND $($foregroundHandle.ToInt64())."
      }
    }
    'text' {
      Assert-OwnedForeground
      [LumaMarkNativeInput]::TypeText([string]$action.value)
    }
    'key' {
      Assert-OwnedForeground
      switch ([string]$action.name) {
        'END' { [LumaMarkNativeInput]::PressKey(0x23) }
        'ENTER' { [LumaMarkNativeInput]::PressKey(0x0D) }
        default { throw "Unsupported key action: $($action.name)" }
      }
    }
    'chord' {
      Assert-OwnedForeground
      switch ([string]$action.name) {
        'CTRL_END' { [LumaMarkNativeInput]::PressChord(0x11, 0x23) }
        'CTRL_S' { [LumaMarkNativeInput]::PressChord(0x11, 0x53) }
        'CTRL_Y' { [LumaMarkNativeInput]::PressChord(0x11, 0x59) }
        'CTRL_Z' { [LumaMarkNativeInput]::PressChord(0x11, 0x5A) }
        default { throw "Unsupported chord action: $($action.name)" }
      }
    }
    'delay' {
      Start-Sleep -Milliseconds ([int]$action.milliseconds)
    }
    default { throw "Unsupported native input action: $($action.kind)" }
  }
  Start-Sleep -Milliseconds 70
}

[PSCustomObject]@{
  clientLeft = $clientOrigin.X
  clientTop = $clientOrigin.Y
  processId = $ProcessId
  windowDpi = $windowDpi
  windowHandle = $windowHandle.ToInt64()
} | ConvertTo-Json -Compress
`;
  const nativeInputHelperPath = join(
    tempDirectory,
    'lumamark-native-input.ps1',
  );
  await writeFile(nativeInputHelperPath, command, 'utf8');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      nativeInputHelperPath,
    ],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
      windowsHide: true,
    },
  );
  const resultLine = stdout
    .trim()
    .split(/\r?\n/)
    .findLast((line) => line.trim().startsWith('{'));
  if (!resultLine) {
    throw new Error(`Native input helper returned no evidence: ${stdout}`);
  }
  const evidence = JSON.parse(resultLine);
  if (evidence.processId !== processId) {
    throw new Error(
      `Native input targeted process ${evidence.processId}, expected ${processId}.`,
    );
  }
  return evidence;
}

async function waitForSnapshot(currentPage, predicate, description) {
  let lastSnapshot = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    lastSnapshot = await readEditorSnapshot(currentPage);
    if (predicate(lastSnapshot)) {
      return lastSnapshot;
    }
    await delay(125);
  }
  throw new Error(
    `Timed out waiting for ${description}. Last snapshot: ${JSON.stringify(lastSnapshot)}`,
  );
}

async function readEditorSnapshot(currentPage) {
  return currentPage.evaluate(() => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    if (!(content instanceof HTMLElement)) {
      throw new Error('Expected the live-preview CodeMirror content element.');
    }
    const tile = content.cmTile;
    const view = tile?.root?.view ?? tile?.view;
    if (!view) {
      throw new Error('Expected the root CodeMirror EditorView.');
    }

    const source = view.state.doc.toString();
    const selectionHead = view.state.selection.main.head;
    const contentRect = view.contentDOM.getBoundingClientRect();
    const docTop = contentRect.top + view.viewState.paddingTop;
    const codeLines = [
      ...content.querySelectorAll('.lm-md-code-block-line'),
    ];
    const rows = codeLines.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const position = view.posAtDOM(element, 0);
      const block = view.lineBlockAt(position);
      const style = getComputedStyle(element);
      return {
        blockTop: block.top,
        drift: rect.top - docTop - block.top,
        height: rect.height,
        index,
        lineHeight: style.lineHeight,
        marginBottom: style.marginBottom,
        marginTop: style.marginTop,
        paddingBottom: style.paddingBottom,
        paddingTop: style.paddingTop,
        top: rect.top,
      };
    });
    const start = content.querySelector('.lm-md-code-block-start');
    const startStyle =
      start instanceof HTMLElement ? getComputedStyle(start) : null;
    const tailPosition = source.indexOf('fence-target');
    const openingPosition = source.indexOf('```ts');
    const bodyPosition = source.indexOf('const n = 1;');
    const anchorLine = [...content.querySelectorAll('.cm-line')].find((line) =>
      line.textContent?.includes('fence-target'),
    );
    const anchorStyle =
      anchorLine instanceof HTMLElement ? getComputedStyle(anchorLine) : null;

    function pointAt(position) {
      if (position < 0) {
        return null;
      }
      const coords =
        view.coordsAtPos(position, 1) ??
        view.coordsAtPos(position, -1) ??
        view.coordsAtPos(position);
      return coords
        ? { x: coords.left + 1, y: (coords.top + coords.bottom) / 2 }
        : null;
    }

    return {
      activeCodeLineCount: codeLines.filter((line) =>
        line.classList.contains('lm-md-code-block-active'),
      ).length,
      anchorPoint: pointAt(
        tailPosition < 0 ? -1 : tailPosition + 'fence-target'.length,
      ),
      bodyPoint: pointAt(
        bodyPosition >= 0
          ? bodyPosition + 3
          : openingPosition < 0
            ? -1
            : openingPosition + '```ts\n'.length,
      ),
      bodyClickHead: bodyPosition < 0 ? null : bodyPosition + 3,
      devicePixelRatio: window.devicePixelRatio,
      docHeight: view.viewState.docHeight,
      editorDescription: content.getAttribute('aria-description'),
      focused:
        document.activeElement === content ||
        content.contains(document.activeElement),
      language:
        start instanceof HTMLElement
          ? start.getAttribute('data-lm-code-language')
          : null,
      pseudoContent:
        start instanceof HTMLElement
          ? getComputedStyle(start, '::after').content
          : '',
      referencePadding: {
        bottom: anchorStyle?.paddingBottom ?? '',
        top: anchorStyle?.paddingTop ?? '',
      },
      rows,
      selectionHead,
      selectionLine: view.state.doc.lineAt(selectionHead).text,
      source,
      startBackground: startStyle?.backgroundColor ?? '',
      startShadow: startStyle?.boxShadow ?? '',
      tailPoint: pointAt(source.length),
    };
  });
}

function compareGeometry(inactive, active) {
  const rowDeltas = inactive.rows.map((row, index) => {
    const activeRow = active.rows[index];
    return {
      blockTop: activeRow ? activeRow.blockTop - row.blockTop : Number.POSITIVE_INFINITY,
      height: activeRow ? activeRow.height - row.height : Number.POSITIVE_INFINITY,
      index,
      paddingStable:
        activeRow?.paddingTop === row.paddingTop &&
        activeRow?.paddingBottom === row.paddingBottom,
      top: activeRow ? activeRow.top - row.top : Number.POSITIVE_INFINITY,
    };
  });
  const stable =
    inactive.rows.length === 3 &&
    active.rows.length === inactive.rows.length &&
    Math.abs(active.docHeight - inactive.docHeight) <= 0.5 &&
    inactive.rows.every((row) => Math.abs(row.drift) <= 1) &&
    active.rows.every((row) => Math.abs(row.drift) <= 1) &&
    rowDeltas.every(
      (delta) =>
        Math.abs(delta.blockTop) <= 0.5 &&
        Math.abs(delta.height) <= 0.5 &&
        delta.paddingStable &&
        Math.abs(delta.top) <= 0.5,
    );
  return {
    docHeightDelta: active.docHeight - inactive.docHeight,
    rowDeltas,
    stable,
    visualFocusChanged:
      active.startBackground !== inactive.startBackground ||
      active.startShadow !== inactive.startShadow,
  };
}

function assertNoInventedVerticalHitArea(snapshot) {
  const invalidRow = snapshot.rows.find(
    (row) =>
      row.marginTop !== '0px' ||
      row.marginBottom !== '0px' ||
      row.paddingTop !== snapshot.referencePadding.top ||
      row.paddingBottom !== snapshot.referencePadding.bottom,
  );
  if (invalidRow) {
    throw new Error(
      `Code-block line introduced an untracked vertical hit area: ${JSON.stringify(invalidRow)}`,
    );
  }
}

async function waitForFileContents(path, expected) {
  let lastContents = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    lastContents = await readFile(path, 'utf8');
    if (lastContents === expected) {
      return;
    }
    await delay(200);
  }
  throw new Error(
    `Ctrl+S did not preserve the exact Markdown source. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(lastContents)}.`,
  );
}

function parseRequestedPort(value) {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return Number(value);
}

async function waitForDebugEndpoint(debugPort, getStartFailure) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const startFailure = getStartFailure();
    if (startFailure) {
      throw new Error(
        `Unable to start the owned packaged LumaMark process: ${startFailure.message}`,
        { cause: startFailure },
      );
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling only while the process spawned by this script stays alive.
    }
    await delay(500);
  }

  throw new Error(
    `WebView2 debug endpoint did not open on port ${debugPort} for spawned process ${app?.pid}.`,
  );
}
