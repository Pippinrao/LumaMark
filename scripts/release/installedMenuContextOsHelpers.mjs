import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const RECOVERABLE_TEXT_FORMATS = new Set([
  'locale',
  'oemtext',
  'system.string',
  'text',
  'unicodetext',
]);

const COMMAND_OWNED_TEXT_FORMATS = new Set([
  ...RECOVERABLE_TEXT_FORMATS,
  'chromium internal source rfh token',
  'chromium internal source url',
]);
const TAURI_NATIVE_TEXT_WRITER = 'tauri-native-text';
const WEBVIEW_TEXT_WRITER = 'webview-text';

function normalizedWindowsPath(value) {
  return String(value)
    .replaceAll('\\', '/')
    .replace(/\/$/, '')
    .toLocaleLowerCase('en-US');
}

export async function resolveTrustedWindowsToolPaths({
  systemRoot = process.env.SystemRoot,
  windowsDirectory = process.env.WINDIR ?? process.env.SystemRoot,
} = {}) {
  if (
    typeof systemRoot !== 'string' ||
    typeof windowsDirectory !== 'string' ||
    !isAbsolute(systemRoot) ||
    !isAbsolute(windowsDirectory) ||
    normalizedWindowsPath(resolve(systemRoot)) !==
      normalizedWindowsPath(resolve(windowsDirectory))
  ) {
    throw new Error('Windows system directory identity could not be proven.');
  }

  try {
    const resolvedSystemRoot = resolve(systemRoot);
    const canonicalSystemRoot = await realpath(resolvedSystemRoot);
    if (
      normalizedWindowsPath(canonicalSystemRoot) !==
      normalizedWindowsPath(resolvedSystemRoot)
    ) {
      throw new Error('canonical root mismatch');
    }

    const expectedPowershellPath = join(
      canonicalSystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const expectedTasklistPath = join(
      canonicalSystemRoot,
      'System32',
      'tasklist.exe',
    );
    const [powershellPath, tasklistPath, powershellStats, tasklistStats] =
      await Promise.all([
        realpath(expectedPowershellPath),
        realpath(expectedTasklistPath),
        stat(expectedPowershellPath),
        stat(expectedTasklistPath),
      ]);
    if (
      normalizedWindowsPath(powershellPath) !==
        normalizedWindowsPath(expectedPowershellPath) ||
      normalizedWindowsPath(tasklistPath) !==
        normalizedWindowsPath(expectedTasklistPath) ||
      !powershellStats.isFile() ||
      !tasklistStats.isFile()
    ) {
      throw new Error('canonical tool mismatch');
    }
    return Object.freeze({ powershellPath, tasklistPath });
  } catch {
    throw new Error('Trusted Windows system tools could not be verified.');
  }
}

export function accessErrorMeansPathMissing(error) {
  if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return true;
  throw new Error('Unable to determine whether the acceptance path exists.');
}

const POINTER_BRIDGE_FAILURE_CODES = new Map([
  [
    'OS pointer injection requires the interactive Default input desktop.',
    'input-desktop-not-default',
  ],
  [
    'The target main window is not visible before pointer injection.',
    'target-window-not-visible',
  ],
  [
    'The target main window is minimized before pointer injection.',
    'target-window-minimized',
  ],
  ['SetCursorPos failed.', 'cursor-position-set-failed'],
  [
    'The target main window changed before pointer injection.',
    'target-window-changed',
  ],
  [
    'The interactive input desktop changed before pointer injection.',
    'input-desktop-changed',
  ],
  [
    'Clipboard ownership changed before the guarded pointer command.',
    'clipboard-sequence-changed',
  ],
  [
    'GetCursorPos failed immediately before pointer injection.',
    'cursor-position-read-failed',
  ],
  [
    'The actual cursor position moved away from the requested target.',
    'cursor-position-moved',
  ],
  [
    'WindowFromPoint at the requested target did not resolve to the target application.',
    'target-obscured-before-cursor-move',
  ],
  [
    'WindowFromPoint at the actual cursor did not resolve to the target application.',
    'target-hit-test-mismatch',
  ],
  [
    'SetCursorPos failed during the drag gesture.',
    'drag-cursor-position-set-failed',
  ],
  [
    'The target main window response probe timed out before pointer injection.',
    'target-window-response-timeout-before-pointer',
  ],
  [
    'The target main window became invalid before pointer injection.',
    'target-window-invalid-before-pointer',
  ],
  [
    'The target main window response probe failed before pointer injection.',
    'target-window-response-probe-failed-before-pointer',
  ],
  [
    'The target main window response probe timed out after pointer injection.',
    'target-window-response-timeout-after-pointer',
  ],
  [
    'The target main window became invalid after pointer injection.',
    'target-window-invalid-after-pointer',
  ],
  [
    'The target main window response probe failed after pointer injection.',
    'target-window-response-probe-failed-after-pointer',
  ],
  [
    'The target window did not become the foreground window after pointer injection.',
    'target-not-foreground-after-pointer',
  ],
  [
    'SendInput failed while pressing the mouse button.',
    'pointer-button-down-injection-failed',
  ],
  [
    'SendInput failed while releasing the mouse button.',
    'pointer-button-up-injection-failed',
  ],
]);

export function classifyWin32BridgeFailure(action, error) {
  const stderr = Buffer.isBuffer(error?.stderr)
    ? error.stderr.toString('utf8')
    : typeof error?.stderr === 'string'
      ? error.stderr
      : '';
  let code = 'unclassified';
  if (action === 'pointer') {
    for (const [marker, markerCode] of POINTER_BRIDGE_FAILURE_CODES) {
      if (stderr.includes(marker)) {
        code = markerCode;
        break;
      }
    }
    if (code === 'unclassified' && error?.code === 'ETIMEDOUT') {
      if (
        stderr.includes('LM_STAGE=pointer.postflight.enter') &&
        !stderr.includes('LM_STAGE=pointer.postflight.exit')
      ) {
        code = 'pointer-postflight-process-timeout';
      } else if (
        stderr.includes('LM_STAGE=pointer.inject.enter') &&
        !stderr.includes('LM_STAGE=pointer.inject.exit')
      ) {
        code = 'pointer-injection-process-timeout';
      } else if (
        stderr.includes('LM_STAGE=pointer.preflight.enter') &&
        !stderr.includes('LM_STAGE=pointer.inject.enter')
      ) {
        code = 'pointer-preflight-process-timeout';
      } else {
        code = 'pointer-bridge-process-timeout';
      }
    }
  }
  return Object.freeze({
    action: String(action),
    code,
    signal: typeof error?.signal === 'string' ? error.signal : null,
    status: Number.isInteger(error?.status) ? error.status : null,
  });
}

export function assertNoExistingImageProcess(result, imageName) {
  if (
    !result ||
    result.error ||
    result.signal != null ||
    result.status !== 0 ||
    typeof result.stdout !== 'string'
  ) {
    throw new Error('Unable to prove that no existing LumaMark process is running.');
  }
  const escapedImageName = String(imageName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`"${escapedImageName}"`, 'i').test(result.stdout)) {
    throw new Error(
      `An existing ${imageName} process is already running. Close it before this isolated acceptance.`,
    );
  }
  return true;
}

export function assertExplicitReleaseExecutable(executablePath, workspaceRoot) {
  if (typeof executablePath !== 'string' || executablePath.trim().length === 0) {
    throw new Error(
      'LUMAMARK_EXECUTABLE must explicitly name the current worktree release binary.',
    );
  }
  const actual = resolve(executablePath.trim());
  const expected = resolve(
    workspaceRoot,
    'src-tauri',
    'target',
    'release',
    'lumamark.exe',
  );
  if (actual.toLocaleLowerCase('en-US') !== expected.toLocaleLowerCase('en-US')) {
    throw new Error(
      `LUMAMARK_EXECUTABLE must be the current worktree release binary: ${expected}`,
    );
  }
  return actual;
}

export function assertUnifiedProjectVersion(versions) {
  const entries = Object.entries(versions ?? {});
  const unique = new Set(entries.map(([, version]) => version));
  const version = entries[0]?.[1];
  if (
    entries.length !== 4 ||
    unique.size !== 1 ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(version)
  ) {
    throw new Error(
      `Project version mismatch: ${entries
        .map(([source, sourceVersion]) => `${source}=${String(sourceVersion)}`)
        .join(', ')}`,
    );
  }
  return version;
}

export function classifyClipboardFormats({ formats, hasText }) {
  const normalizedFormats = Array.isArray(formats)
    ? formats.map((format) => String(format).toLocaleLowerCase('en-US'))
    : [];
  if (normalizedFormats.length === 0 && hasText === false) {
    return { recoverable: true, reason: 'empty' };
  }
  if (
    hasText === true &&
    normalizedFormats.length > 0 &&
    normalizedFormats.every((format) => RECOVERABLE_TEXT_FORMATS.has(format))
  ) {
    return { recoverable: true, reason: 'plain-text' };
  }
  return { recoverable: false, reason: 'unsupported-formats' };
}

export function encodeClipboardTextForBridge(value) {
  return Buffer.from(String(value), 'utf16le').toString('base64');
}

export function decodeClipboardTextFromBridge(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Clipboard bridge returned invalid base64 text.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length % 2 !== 0) {
    throw new Error('Clipboard bridge returned invalid UTF-16LE text.');
  }
  return bytes.toString('utf16le');
}

export function assertOwnedClipboardMutation({
  actualText,
  compareAsPath = false,
  expectedText,
  metadata,
  previousSequence,
  writerKind,
}) {
  assertOwnedClipboardMetadata({ metadata, previousSequence, writerKind });
  const normalizedActualText = normalizeClipboardLineEndings(actualText);
  const normalizedExpectedText = normalizeClipboardLineEndings(expectedText);
  const contentMatches = clipboardTextMatches(actualText, expectedText, {
    compareAsPath,
  });
  if (!contentMatches) {
    let firstDifferenceIndex = 0;
    const sharedLength = Math.min(
      normalizedActualText.length,
      normalizedExpectedText.length,
    );
    while (
      firstDifferenceIndex < sharedLength &&
      normalizedActualText[firstDifferenceIndex] ===
        normalizedExpectedText[firstDifferenceIndex]
    ) {
      firstDifferenceIndex += 1;
    }
    throw new Error(
      'Clipboard mutation ownership could not be proven from command output ' +
        `(normalizedLengthDelta=${normalizedActualText.length - normalizedExpectedText.length}, ` +
        `firstDifferenceIndex=${firstDifferenceIndex}).`,
    );
  }
  return metadata.sequence;
}

export function assertClipboardCleanupReady({
  cdpDisconnected,
  childExitVerified,
  inputStopped,
}) {
  if (
    inputStopped !== true ||
    cdpDisconnected !== true ||
    childExitVerified !== true
  ) {
    throw new Error(
      'Clipboard recovery requires the acceptance writer to be fully quiescent.',
    );
  }
}

export function assertAlreadyExitedAcceptanceChild({
  after,
  baseline,
  before,
  termination,
}) {
  if (
    !Object.isFrozen(baseline) ||
    !Number.isInteger(baseline?.processId) ||
    baseline.processId <= 0 ||
    typeof baseline?.executablePath !== 'string' ||
    typeof baseline?.startTimeUtc !== 'string' ||
    before?.processId !== baseline.processId ||
    after?.processId !== baseline.processId
  ) {
    throw new Error('The exited acceptance child identity could not be proven.');
  }
  if (before.exists !== false || after.exists !== false) {
    throw new Error('The acceptance child was not proven quiescent.');
  }
  if (termination?.kind !== 'exit') {
    throw new Error('The acceptance child termination could not be proven.');
  }
  return {
    alreadyExited: true,
    processId: baseline.processId,
    termination,
  };
}

export function summarizeVerifierProcessOutcome({
  observedExitCode,
  observedSignal,
  plannedExitCode,
}) {
  const normalizedExitCode = Number.isInteger(observedExitCode)
    ? observedExitCode
    : null;
  const normalizedSignal =
    typeof observedSignal === 'string' && observedSignal.length > 0
      ? observedSignal
      : null;
  const normalizedPlannedExitCode = Number.isInteger(plannedExitCode)
    ? plannedExitCode
    : null;
  const matchesPlannedExitCode =
    normalizedSignal === null &&
    normalizedExitCode !== null &&
    normalizedExitCode === normalizedPlannedExitCode;
  return {
    matchesPlannedExitCode,
    observedExitCode: normalizedExitCode,
    observedSignal: normalizedSignal,
    plannedExitCode: normalizedPlannedExitCode,
    runnerExitCode:
      matchesPlannedExitCode && normalizedExitCode === 0
        ? 0
        : normalizedExitCode && normalizedExitCode > 0
          ? normalizedExitCode
          : 1,
  };
}

export function clipboardTextMatches(
  actualText,
  expectedText,
  { compareAsPath = false } = {},
) {
  if (compareAsPath) {
    return (
      normalizeClipboardPath(actualText) ===
      normalizeClipboardPath(expectedText)
    );
  }

  return (
    normalizeClipboardLineEndings(actualText) ===
    normalizeClipboardLineEndings(expectedText)
  );
}

function normalizeClipboardLineEndings(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

function normalizeClipboardPath(value) {
  return String(value)
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/$/, '')
    .toLocaleLowerCase('en-US');
}

export function summarizeClipboardMetadataForEvidence(metadata) {
  const formats = Array.isArray(metadata?.formats) ? metadata.formats : [];
  const recognizedFormats = [
    ...new Set(
      formats
        .filter((format) => typeof format === 'string')
        .map((format) => format.toLocaleLowerCase('en-US'))
        .filter((format) => COMMAND_OWNED_TEXT_FORMATS.has(format)),
    ),
  ].sort();
  return {
    formatCount: formats.length,
    hasText: metadata?.hasText === true,
    ownerBelongsToTarget: metadata?.ownerBelongsToTarget === true,
    ownerBelongsToTargetIsBoolean:
      typeof metadata?.ownerBelongsToTarget === 'boolean',
    ownerHWnd: Number.isInteger(metadata?.ownerHWnd) ? metadata.ownerHWnd : null,
    ownerProcessId: Number.isInteger(metadata?.ownerProcessId)
      ? metadata.ownerProcessId
      : null,
    recognizedFormats,
    sequence: Number.isInteger(metadata?.sequence) ? metadata.sequence : null,
    unrecognizedFormatCount: formats.length - recognizedFormats.length,
  };
}

function assertCommandOwnedClipboardPayload(metadata, writerKind) {
  let allowedFormats;
  if (writerKind === TAURI_NATIVE_TEXT_WRITER) {
    if (
      metadata?.ownerBelongsToTarget !== false ||
      metadata?.ownerHWnd !== 0 ||
      metadata?.ownerProcessId !== 0
    ) {
      throw new Error(
        'Clipboard mutation owner does not match the ownerless native writer contract.',
      );
    }
    allowedFormats = RECOVERABLE_TEXT_FORMATS;
  } else if (writerKind === WEBVIEW_TEXT_WRITER) {
    if (
      metadata?.ownerBelongsToTarget !== true ||
      !Number.isInteger(metadata?.ownerHWnd) ||
      metadata.ownerHWnd <= 0 ||
      !Number.isInteger(metadata?.ownerProcessId) ||
      metadata.ownerProcessId <= 0
    ) {
      throw new Error('Clipboard mutation owner is outside the acceptance process tree.');
    }
    allowedFormats = COMMAND_OWNED_TEXT_FORMATS;
  } else {
    throw new Error('Clipboard writer kind is unsupported.');
  }
  const normalizedFormats = Array.isArray(metadata.formats)
    ? metadata.formats.map((format) => String(format).toLocaleLowerCase('en-US'))
    : [];
  if (
    metadata.hasText !== true ||
    normalizedFormats.length === 0 ||
    !normalizedFormats.every((format) => allowedFormats.has(format))
  ) {
    throw new Error('Clipboard mutation ownership requires command-owned text formats.');
  }
}

export function assertCurrentCommandOwnedClipboardMetadata({
  expectedSequence,
  metadata,
  writerKind,
}) {
  if (
    !Number.isInteger(expectedSequence) ||
    !Number.isInteger(metadata?.sequence) ||
    metadata.sequence !== expectedSequence
  ) {
    throw new Error('Clipboard sequence no longer matches the command-owned value.');
  }
  assertCommandOwnedClipboardPayload(metadata, writerKind);
  return metadata.sequence;
}

export function assertOwnedClipboardMetadata({
  metadata,
  previousSequence,
  writerKind,
}) {
  if (
    !Number.isInteger(previousSequence) ||
    !Number.isInteger(metadata?.sequence) ||
    metadata.sequence === previousSequence
  ) {
    throw new Error('Clipboard sequence did not prove a new command-owned mutation.');
  }
  assertCommandOwnedClipboardPayload(metadata, writerKind);
  return metadata.sequence;
}

export function isSafeAcceptanceTempDirectory(candidate, systemTempDirectory) {
  if (typeof candidate !== 'string' || typeof systemTempDirectory !== 'string') {
    return false;
  }
  const resolvedCandidate = resolve(candidate);
  const resolvedTemp = resolve(systemTempDirectory);
  return (
    dirname(resolvedCandidate).toLocaleLowerCase('en-US') ===
      resolvedTemp.toLocaleLowerCase('en-US') &&
    basename(resolvedCandidate).startsWith('lumamark-menu-context-os-')
  );
}

export function cssPointToScreen({
  clientOrigin,
  cssPoint,
  devicePixelRatio,
}) {
  if (
    !Number.isFinite(clientOrigin?.x) ||
    !Number.isFinite(clientOrigin?.y) ||
    !Number.isFinite(cssPoint?.x) ||
    !Number.isFinite(cssPoint?.y) ||
    !Number.isFinite(devicePixelRatio) ||
    devicePixelRatio <= 0
  ) {
    throw new Error('Client origin, CSS point, and DPR must be finite.');
  }

  return {
    x: Math.round(clientOrigin.x + cssPoint.x * devicePixelRatio),
    y: Math.round(clientOrigin.y + cssPoint.y * devicePixelRatio),
  };
}

export function isHorizontalMenuLayout({
  contentWidth,
  itemHeight,
  itemWidth,
  labelWhiteSpace,
  labelWritingMode,
}) {
  return (
    Number.isFinite(contentWidth) &&
    Number.isFinite(itemHeight) &&
    Number.isFinite(itemWidth) &&
    contentWidth >= 180 &&
    itemWidth >= itemHeight * 3 &&
    labelWhiteSpace === 'nowrap' &&
    String(labelWritingMode).startsWith('horizontal')
  );
}

/**
 * Generated PowerShell keeps every Win32 pointer invocation on one audited
 * path. Each process opts into PMv2 before resolving client coordinates.
 */
export function buildWin32PointerBridgeSource() {
  return String.raw`param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('probe', 'metrics', 'pointer', 'clipboard-inspect', 'clipboard-read-text', 'clipboard-restore', 'file-version', 'process-info', 'process-tree-probe')]
  [string]$Action,
  [int]$TargetProcessId = 0,
  [string]$TargetExecutablePath = '',
  [string]$TargetStartTimeUtc = '',
  [int]$X = 0,
  [int]$Y = 0,
  [int]$ToX = 0,
  [int]$ToY = 0,
  [ValidateSet('left', 'right')]
  [string]$Button = 'left',
  [ValidateSet('click', 'drag')]
  [string]$Gesture = 'click',
  [string]$Value = '',
  [uint32]$ExpectedClipboardSequence = 0,
  [switch]$AllowTargetExit,
  [switch]$GuardClipboardSequence,
  [switch]$RestoreHadText,
  [int]$TimeoutMilliseconds = 10000
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class LumaMarkAcceptanceNative {
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint CF_UNICODETEXT = 13;
  private const uint DESKTOP_READOBJECTS = 0x0001;
  private const uint GMEM_MOVEABLE = 0x0002;
  private const int UOI_NAME = 2;
  private static readonly IntPtr HWND_MESSAGE = new IntPtr(-3);

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public UIntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT {
    public uint type;
    public INPUTUNION union;
  }

  public enum WindowResponseState {
    Responsive,
    TimedOut,
    InvalidWindow,
    ProbeFailed
  }

  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();
  [DllImport("user32.dll")] public static extern bool AreDpiAwarenessContextsEqual(IntPtr left, IntPtr right);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] private static extern void SetLastError(uint errorCode);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll")] private static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetUserObjectInformationW", SetLastError = true)]
  private static extern bool GetUserObjectInformationW(IntPtr handle, int index, StringBuilder information, uint length, out uint needed);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateWindowExW", SetLastError = true)]
  private static extern IntPtr CreateWindowExW(uint extendedStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool DestroyWindow(IntPtr window);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseClipboard();
  [DllImport("user32.dll", SetLastError = true)] private static extern bool EmptyClipboard();
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetClipboardData(uint format, IntPtr memory);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalFree(IntPtr memory);

  public static WindowResponseState ProbeWindowResponse(IntPtr hWnd) {
    const uint WM_NULL = 0x0000;
    const uint SMTO_BLOCK = 0x0001;
    const uint SMTO_ABORTIFHUNG = 0x0002;
    const uint SMTO_ERRORONEXIT = 0x0020;
    const int ERROR_INVALID_WINDOW_HANDLE = 1400;
    const int ERROR_TIMEOUT = 1460;
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) {
      return WindowResponseState.InvalidWindow;
    }
    SetLastError(0);
    UIntPtr result;
    IntPtr response = SendMessageTimeout(
      hWnd,
      WM_NULL,
      UIntPtr.Zero,
      IntPtr.Zero,
      SMTO_BLOCK | SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT,
      1000,
      out result
    );
    int errorCode = Marshal.GetLastWin32Error();
    if (response != IntPtr.Zero) return WindowResponseState.Responsive;
    if (errorCode == ERROR_INVALID_WINDOW_HANDLE || !IsWindow(hWnd)) {
      return WindowResponseState.InvalidWindow;
    }
    if (errorCode == ERROR_TIMEOUT) return WindowResponseState.TimedOut;
    return WindowResponseState.ProbeFailed;
  }

  public static bool SendMouseButton(uint flags) {
    INPUT input = new INPUT();
    input.type = 0;
    input.union.mouse.dwFlags = flags;
    return SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT))) == 1;
  }

  public static bool RestorePlainTextIfSequence(
    string value,
    bool hadText,
    uint expectedSequence,
    out uint observedSequence,
    out uint resultingSequence,
    out string error
  ) {
    IntPtr memory = IntPtr.Zero;
    bool clipboardOwnsMemory = false;
    observedSequence = 0;
    resultingSequence = 0;
    error = null;

    if (hadText) {
      char[] characters = (value + "\0").ToCharArray();
      memory = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)(characters.Length * sizeof(char)));
      if (memory == IntPtr.Zero) {
        error = "Unable to allocate clipboard memory.";
        return false;
      }
      IntPtr pointer = GlobalLock(memory);
      if (pointer == IntPtr.Zero) {
        GlobalFree(memory);
        error = "Unable to lock clipboard memory.";
        return false;
      }
      Marshal.Copy(characters, 0, pointer, characters.Length);
      GlobalUnlock(memory);
    }

    IntPtr ownerWindow = CreateClipboardOwnerWindow();
    if (ownerWindow == IntPtr.Zero) {
      if (memory != IntPtr.Zero) GlobalFree(memory);
      error = "Unable to create the clipboard owner window.";
      return false;
    }

    bool opened = false;
    for (int attempt = 0; attempt < 60 && !opened; attempt += 1) {
      opened = OpenClipboard(ownerWindow);
      if (!opened) Thread.Sleep(50);
    }
    if (!opened) {
      if (memory != IntPtr.Zero) GlobalFree(memory);
      DestroyWindow(ownerWindow);
      error = "The Windows clipboard remained unavailable while restoring.";
      return false;
    }

    try {
      observedSequence = GetClipboardSequenceNumber();
      if (observedSequence != expectedSequence) {
        error = "Clipboard ownership changed; restore was refused.";
        return false;
      }
      if (!EmptyClipboard()) {
        error = "Unable to clear the clipboard for restoration.";
        return false;
      }
      if (memory != IntPtr.Zero) {
        if (SetClipboardData(CF_UNICODETEXT, memory) == IntPtr.Zero) {
          error = "Unable to restore Unicode clipboard text.";
          return false;
        }
        clipboardOwnsMemory = true;
      }
      resultingSequence = GetClipboardSequenceNumber();
    } finally {
      CloseClipboard();
      if (memory != IntPtr.Zero && !clipboardOwnsMemory) GlobalFree(memory);
      DestroyWindow(ownerWindow);
    }
    return true;
  }

  public static bool ProbeClipboardOwnerWindow() {
    IntPtr ownerWindow = CreateClipboardOwnerWindow();
    return ownerWindow != IntPtr.Zero && DestroyWindow(ownerWindow);
  }

  public static string GetInputDesktopName() {
    IntPtr desktop = OpenInputDesktop(0, false, DESKTOP_READOBJECTS);
    if (desktop == IntPtr.Zero) return null;
    try {
      return GetUserObjectName(desktop);
    } finally {
      CloseDesktop(desktop);
    }
  }

  public static string GetCurrentThreadDesktopName() {
    IntPtr desktop = GetThreadDesktop(GetCurrentThreadId());
    return desktop == IntPtr.Zero ? null : GetUserObjectName(desktop);
  }

  private static string GetUserObjectName(IntPtr handle) {
    uint needed;
    GetUserObjectInformationW(handle, UOI_NAME, null, 0, out needed);
    if (needed < 2) return null;
    StringBuilder value = new StringBuilder((int)(needed / 2));
    return GetUserObjectInformationW(handle, UOI_NAME, value, needed, out needed)
      ? value.ToString()
      : null;
  }

  private static IntPtr CreateClipboardOwnerWindow() {
    return CreateWindowExW(
      0,
      "STATIC",
      "LumaMarkAcceptanceClipboardOwner",
      0,
      0,
      0,
      0,
      0,
      HWND_MESSAGE,
      IntPtr.Zero,
      IntPtr.Zero,
      IntPtr.Zero
    );
  }
}
"@

$pmv2 = [IntPtr](-4)
[void][LumaMarkAcceptanceNative]::SetProcessDpiAwarenessContext($pmv2)
$threadDpiContext = [LumaMarkAcceptanceNative]::GetThreadDpiAwarenessContext()
$isPerMonitorV2 = [LumaMarkAcceptanceNative]::AreDpiAwarenessContextsEqual($threadDpiContext, $pmv2)
if (-not $isPerMonitorV2) {
  throw 'The Win32 bridge could not enter per-monitor-v2 DPI awareness.'
}

if ($Action -eq 'probe') {
  $clipboardOwnerWindow = [LumaMarkAcceptanceNative]::ProbeClipboardOwnerWindow()
  if (-not $clipboardOwnerWindow) {
    throw 'The Win32 bridge could not create its message-only clipboard owner window.'
  }
  $inputDesktopName = [LumaMarkAcceptanceNative]::GetInputDesktopName()
  $threadDesktopName = [LumaMarkAcceptanceNative]::GetCurrentThreadDesktopName()
  if ([string]::IsNullOrWhiteSpace($inputDesktopName) -or [string]::IsNullOrWhiteSpace($threadDesktopName)) {
    throw 'The Win32 bridge could not inspect the input and thread desktops.'
  }
  [ordered]@{
    loaded = $true
    clientCoordinates = $true
    clipboardOwnerWindow = $clipboardOwnerWindow
    clipboardSequence = $true
    dpiAwareness = 'per-monitor-v2'
    inputDesktopInspection = $true
    inputDesktopName = $inputDesktopName
    threadDesktopName = $threadDesktopName
    realMouseFlags = $true
    windowHitTesting = $true
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'file-version') {
  $item = Get-Item -LiteralPath $Value -ErrorAction Stop
  [ordered]@{
    fileVersion = $item.VersionInfo.FileVersion
    productVersion = $item.VersionInfo.ProductVersion
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'process-info') {
  $targetProcess = Get-Process -Id $TargetProcessId -ErrorAction SilentlyContinue
  if ($null -eq $targetProcess) {
    [ordered]@{ exists = $false; processId = $TargetProcessId } | ConvertTo-Json -Compress
  } else {
    [ordered]@{
      exists = $true
      processId = $TargetProcessId
      executablePath = $targetProcess.Path
      startTimeUtc = $targetProcess.StartTime.ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress
  }
  exit 0
}

function Test-ProcessDescendsFrom([uint32]$CandidateProcessId, [uint32]$AncestorProcessId) {
  if ($CandidateProcessId -eq 0 -or $AncestorProcessId -eq 0) {
    return $false
  }
  [uint32]$currentProcessId = $CandidateProcessId
  $seen = @{}
  for ($depth = 0; $depth -lt 32; $depth += 1) {
    if ($currentProcessId -eq $AncestorProcessId) {
      return $true
    }
    $key = [string]$currentProcessId
    if ($seen.ContainsKey($key)) {
      return $false
    }
    $seen[$key] = $true
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $currentProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $process -or [uint32]$process.ParentProcessId -eq 0) {
      return $false
    }
    $currentProcessId = [uint32]$process.ParentProcessId
  }
  return $false
}

function Get-ClipboardOwnerMetadata {
  $ownerHandle = [LumaMarkAcceptanceNative]::GetClipboardOwner()
  [uint32]$ownerProcessId = 0
  if ($ownerHandle -ne [IntPtr]::Zero) {
    [void][LumaMarkAcceptanceNative]::GetWindowThreadProcessId($ownerHandle, [ref]$ownerProcessId)
  }
  return [ordered]@{
    hWnd = $ownerHandle.ToInt64()
    processId = $ownerProcessId
    belongsToTarget = Test-ProcessDescendsFrom $ownerProcessId ([uint32]$TargetProcessId)
  }
}

if ($Action -eq 'process-tree-probe') {
  [ordered]@{
    belongsToTarget = Test-ProcessDescendsFrom ([uint32]$PID) ([uint32]$TargetProcessId)
    candidateProcessId = $PID
    targetProcessId = $TargetProcessId
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'clipboard-inspect') {
  $deadline = [DateTime]::UtcNow.AddMilliseconds(3000)
  $inspected = $false
  while ([DateTime]::UtcNow -lt $deadline -and -not $inspected) {
    try {
      $sequenceBefore = [LumaMarkAcceptanceNative]::GetClipboardSequenceNumber()
      $data = [System.Windows.Forms.Clipboard]::GetDataObject()
      $formats = @()
      if ($null -ne $data) {
        $formats = @($data.GetFormats($false))
      }
      $hasText = [System.Windows.Forms.Clipboard]::ContainsText()
      $owner = Get-ClipboardOwnerMetadata
      $sequence = [LumaMarkAcceptanceNative]::GetClipboardSequenceNumber()
      $inspected = $sequenceBefore -eq $sequence
      if (-not $inspected) {
        Start-Sleep -Milliseconds 50
      }
    } catch [System.Runtime.InteropServices.ExternalException] {
      Start-Sleep -Milliseconds 50
    }
  }
  if (-not $inspected) {
    throw 'The Windows clipboard remained unavailable while inspecting formats.'
  }
  [ordered]@{
    formats = $formats
    hasText = $hasText
    ownerBelongsToTarget = $owner.belongsToTarget
    ownerHWnd = $owner.hWnd
    ownerProcessId = $owner.processId
    sequence = $sequence
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'clipboard-read-text') {
  $deadline = [DateTime]::UtcNow.AddMilliseconds(3000)
  $read = $false
  while ([DateTime]::UtcNow -lt $deadline -and -not $read) {
    try {
      $sequenceBefore = [LumaMarkAcceptanceNative]::GetClipboardSequenceNumber()
      if ($sequenceBefore -ne $ExpectedClipboardSequence) {
        throw 'Clipboard ownership changed before recoverable text could be read.'
      }
      $text = [System.Windows.Forms.Clipboard]::GetText()
      $sequence = [LumaMarkAcceptanceNative]::GetClipboardSequenceNumber()
      if ($sequence -ne $ExpectedClipboardSequence) {
        throw 'Clipboard ownership changed while recoverable text was read.'
      }
      $read = $sequenceBefore -eq $sequence
      if (-not $read) {
        Start-Sleep -Milliseconds 50
      }
    } catch [System.Runtime.InteropServices.ExternalException] {
      Start-Sleep -Milliseconds 50
    }
  }
  if (-not $read) {
    throw 'The Windows clipboard remained unavailable while reading recoverable text.'
  }
  $textUtf16Base64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
  [ordered]@{ sequence = $sequence; textUtf16Base64 = $textUtf16Base64 } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'clipboard-restore') {
  $textBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())
  if ($textBytes.Length % 2 -ne 0) {
    throw 'Clipboard restore input was not valid UTF-16LE.'
  }
  $text = [Text.Encoding]::Unicode.GetString($textBytes)
  [uint32]$observed = 0
  [uint32]$resulting = 0
  $restoreError = $null
  $restored = [LumaMarkAcceptanceNative]::RestorePlainTextIfSequence(
    $text,
    $RestoreHadText.IsPresent,
    $ExpectedClipboardSequence,
    [ref]$observed,
    [ref]$resulting,
    [ref]$restoreError
  )
  if (-not $restored) {
    throw $restoreError
  }
  [ordered]@{
    restored = $true
    observedSequence = $observed
    resultingSequence = $resulting
  } | ConvertTo-Json -Compress
  exit 0
}

function Assert-TargetProcessIdentity {
  if ($TargetProcessId -le 0) {
    throw 'A target process id is required for this action.'
  }
  if (
    [string]::IsNullOrWhiteSpace($TargetExecutablePath) -or
    [string]::IsNullOrWhiteSpace($TargetStartTimeUtc)
  ) {
    throw 'The target executable path and start time are required for this action.'
  }
  $targetProcess = Get-Process -Id $TargetProcessId -ErrorAction Stop
  $actualPath = [IO.Path]::GetFullPath($targetProcess.Path)
  $expectedPath = [IO.Path]::GetFullPath($TargetExecutablePath)
  $actualStartTimeUtc = $targetProcess.StartTime.ToUniversalTime().ToString('o')
  if (
    -not [StringComparer]::OrdinalIgnoreCase.Equals($actualPath, $expectedPath) -or
    $actualStartTimeUtc -ne $TargetStartTimeUtc
  ) {
    throw 'The target process identity no longer matches the acceptance launch.'
  }
  return $targetProcess
}

function Get-MainHandle {
  $targetProcess = Assert-TargetProcessIdentity
  $handle = $targetProcess.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) {
    throw "Process $TargetProcessId does not have a main window handle."
  }
  return $handle
}

function Get-WindowResponseStateName([IntPtr]$Handle) {
  $state = [LumaMarkAcceptanceNative]::ProbeWindowResponse($Handle)
  if ($state -eq [LumaMarkAcceptanceNative+WindowResponseState]::Responsive) {
    return 'responsive'
  }
  if ($state -eq [LumaMarkAcceptanceNative+WindowResponseState]::TimedOut) {
    return 'timed-out'
  }
  if ($state -eq [LumaMarkAcceptanceNative+WindowResponseState]::InvalidWindow) {
    return 'invalid-window'
  }
  return 'probe-failed'
}

function Assert-WindowResponseStateName([string]$State, [string]$Phase) {
  if ($State -eq 'responsive') {
    return
  }
  if ($Phase -eq 'before-pointer') {
    if ($State -eq 'timed-out') {
      throw 'The target main window response probe timed out before pointer injection.'
    }
    if ($State -eq 'invalid-window') {
      throw 'The target main window became invalid before pointer injection.'
    }
    throw 'The target main window response probe failed before pointer injection.'
  }
  if ($State -eq 'timed-out') {
    throw 'The target main window response probe timed out after pointer injection.'
  }
  if ($State -eq 'invalid-window') {
    throw 'The target main window became invalid after pointer injection.'
  }
  throw 'The target main window response probe failed after pointer injection.'
}

function Assert-WindowResponseState([IntPtr]$Handle, [string]$Phase) {
  $state = Get-WindowResponseStateName $Handle
  Assert-WindowResponseStateName $state $Phase
}

function Get-ClientMetrics([IntPtr]$Handle) {
  $mainWindowResponsiveness = Get-WindowResponseStateName $Handle
  $point = New-Object LumaMarkAcceptanceNative+POINT
  $point.X = 0
  $point.Y = 0
  if (-not [LumaMarkAcceptanceNative]::ClientToScreen($Handle, [ref]$point)) {
    throw 'ClientToScreen failed.'
  }
  $rect = New-Object LumaMarkAcceptanceNative+RECT
  if (-not [LumaMarkAcceptanceNative]::GetClientRect($Handle, [ref]$rect)) {
    throw 'GetClientRect failed.'
  }
  $dpi = [LumaMarkAcceptanceNative]::GetDpiForWindow($Handle)
  if ($dpi -eq 0) {
    throw 'GetDpiForWindow failed.'
  }
  $foregroundHandle = [LumaMarkAcceptanceNative]::GetForegroundWindow()
  [uint32]$foregroundProcessId = 0
  if ($foregroundHandle -ne [IntPtr]::Zero) {
    [void][LumaMarkAcceptanceNative]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
  }
  $foregroundProcessName = $null
  if ($foregroundProcessId -gt 0) {
    $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
    if ($null -ne $foregroundProcess) {
      $foregroundProcessName = $foregroundProcess.ProcessName
    }
  }
  $inputDesktopName = [LumaMarkAcceptanceNative]::GetInputDesktopName()
  $threadDesktopName = [LumaMarkAcceptanceNative]::GetCurrentThreadDesktopName()
  return [ordered]@{
    hWnd = $Handle.ToInt64()
    mainWindowResponsive = $mainWindowResponsiveness -eq 'responsive'
    mainWindowResponsiveness = $mainWindowResponsiveness
    clientOrigin = [ordered]@{ x = $point.X; y = $point.Y }
    clientSize = [ordered]@{ width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
    dpi = $dpi
    dpiScale = $dpi / 96.0
    dpiAwareness = 'per-monitor-v2'
    inputDesktop = [ordered]@{
      name = $inputDesktopName
      threadName = $threadDesktopName
      matchesThread =
        -not [string]::IsNullOrWhiteSpace($inputDesktopName) -and
        $inputDesktopName -eq $threadDesktopName
    }
    foreground = [ordered]@{
      hWnd = $foregroundHandle.ToInt64()
      processId = $foregroundProcessId
      processName = $foregroundProcessName
    }
  }
}

if ($Action -eq 'metrics') {
  $mainHandle = Get-MainHandle
  Get-ClientMetrics $mainHandle | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'pointer') {
  [Console]::Error.WriteLine('LM_STAGE=pointer.preflight.enter')
  [Console]::Error.Flush()
  $mainHandle = Get-MainHandle
  Assert-WindowResponseState $mainHandle 'before-pointer'
  if (-not [LumaMarkAcceptanceNative]::IsWindowVisible($mainHandle)) {
    throw 'The target main window is not visible before pointer injection.'
  }
  if ([LumaMarkAcceptanceNative]::IsIconic($mainHandle)) {
    throw 'The target main window is minimized before pointer injection.'
  }
  $pointerInputDesktopName = [LumaMarkAcceptanceNative]::GetInputDesktopName()
  $pointerThreadDesktopName = [LumaMarkAcceptanceNative]::GetCurrentThreadDesktopName()
  if (
    $pointerInputDesktopName -ne 'Default' -or
    $pointerThreadDesktopName -ne 'Default' -or
    $pointerInputDesktopName -ne $pointerThreadDesktopName
  ) {
    throw 'OS pointer injection requires the interactive Default input desktop.'
  }
  $buttonDown = $false
  $hitWindow = [IntPtr]::Zero
  [uint32]$hitProcessId = 0
  $hitBelongsToTarget = $false
  $down = if ($Button -eq 'right') { 0x0008 } else { 0x0002 }
  $up = if ($Button -eq 'right') { 0x0010 } else { 0x0004 }
  $finalTargetProcess = Assert-TargetProcessIdentity
  if ($finalTargetProcess.MainWindowHandle -ne $mainHandle) {
    throw 'The target main window changed before pointer injection.'
  }

  $finalInputDesktopName = [LumaMarkAcceptanceNative]::GetInputDesktopName()
  $finalThreadDesktopName = [LumaMarkAcceptanceNative]::GetCurrentThreadDesktopName()
  if (
    $finalInputDesktopName -ne 'Default' -or
    $finalThreadDesktopName -ne 'Default' -or
    $finalInputDesktopName -ne $finalThreadDesktopName
  ) {
    throw 'The interactive input desktop changed before pointer injection.'
  }
  if (
    $GuardClipboardSequence -and
    [LumaMarkAcceptanceNative]::GetClipboardSequenceNumber() -ne $ExpectedClipboardSequence
  ) {
    throw 'Clipboard ownership changed before the guarded pointer command.'
  }

  $requestedPoint = New-Object LumaMarkAcceptanceNative+POINT
  $requestedPoint.X = $X
  $requestedPoint.Y = $Y
  $requestedHitWindow = [LumaMarkAcceptanceNative]::WindowFromPoint($requestedPoint)
  $requestedHitBelongsToTarget =
    $requestedHitWindow -eq $mainHandle -or
    [LumaMarkAcceptanceNative]::IsChild($mainHandle, $requestedHitWindow)
  if (-not $requestedHitBelongsToTarget) {
    throw 'WindowFromPoint at the requested target did not resolve to the target application.'
  }
  if (-not [LumaMarkAcceptanceNative]::SetCursorPos($X, $Y)) {
    throw 'SetCursorPos failed.'
  }
  Start-Sleep -Milliseconds 45

  [Console]::Error.WriteLine('LM_STAGE=pointer.inject.enter')
  [Console]::Error.Flush()
  try {
    $actualCursorPoint = New-Object LumaMarkAcceptanceNative+POINT
    if (-not [LumaMarkAcceptanceNative]::GetCursorPos([ref]$actualCursorPoint)) {
      throw 'GetCursorPos failed immediately before pointer injection.'
    }
    if ($actualCursorPoint.X -ne $X -or $actualCursorPoint.Y -ne $Y) {
      throw 'The actual cursor position moved away from the requested target.'
    }
    $hitWindow = [LumaMarkAcceptanceNative]::WindowFromPoint($actualCursorPoint)
    if ($hitWindow -ne [IntPtr]::Zero) {
      [void][LumaMarkAcceptanceNative]::GetWindowThreadProcessId($hitWindow, [ref]$hitProcessId)
    }
    $hitBelongsToTarget =
      $hitWindow -eq $mainHandle -or
      [LumaMarkAcceptanceNative]::IsChild($mainHandle, $hitWindow)
    if (-not $hitBelongsToTarget) {
      throw 'WindowFromPoint at the actual cursor did not resolve to the target application.'
    }
    if (-not [LumaMarkAcceptanceNative]::SendMouseButton($down)) {
      throw 'SendInput failed while pressing the mouse button.'
    }
    $buttonDown = $true
    if ($Gesture -eq 'drag') {
      for ($step = 1; $step -le 8; $step += 1) {
        $nextX = [Math]::Round($X + (($ToX - $X) * $step / 8))
        $nextY = [Math]::Round($Y + (($ToY - $Y) * $step / 8))
        if (-not [LumaMarkAcceptanceNative]::SetCursorPos($nextX, $nextY)) {
          throw 'SetCursorPos failed during the drag gesture.'
        }
        Start-Sleep -Milliseconds 18
      }
    }
    Start-Sleep -Milliseconds 35
  } finally {
    $buttonReleaseFailed = $false
    if ($buttonDown) {
      $buttonReleaseFailed = -not [LumaMarkAcceptanceNative]::SendMouseButton($up)
      $buttonDown = $false
    }
    if ($buttonReleaseFailed) {
      throw 'SendInput failed while releasing the mouse button.'
    }
  }
  [Console]::Error.WriteLine('LM_STAGE=pointer.inject.exit')
  [Console]::Error.Flush()
  if ($AllowTargetExit) {
    [ordered]@{
      injected = [ordered]@{
        button = $Button
        gesture = $Gesture
        from = [ordered]@{ x = $X; y = $Y }
        targetExitAllowed = $true
      }
    } | ConvertTo-Json -Compress -Depth 4
    exit 0
  }
  [Console]::Error.WriteLine('LM_STAGE=pointer.postflight.enter')
  [Console]::Error.Flush()
  $metrics = Get-ClientMetrics $mainHandle
  Assert-WindowResponseStateName $metrics.mainWindowResponsiveness 'after-pointer'
  if ($metrics.foreground.hWnd -ne $mainHandle.ToInt64()) {
    throw 'The target window did not become the foreground window after pointer injection.'
  }
  [Console]::Error.WriteLine('LM_STAGE=pointer.postflight.exit')
  [Console]::Error.Flush()
  $metrics.injected = [ordered]@{
    naturalActivationVerified = $true
    button = $Button
    gesture = $Gesture
    from = [ordered]@{ x = $X; y = $Y }
    to = [ordered]@{ x = $(if ($Gesture -eq 'drag') { $ToX } else { $X }); y = $(if ($Gesture -eq 'drag') { $ToY } else { $Y }) }
    hitTest = [ordered]@{
      hWnd = $hitWindow.ToInt64()
      processId = $hitProcessId
      belongsToTarget = $hitBelongsToTarget
    }
  }
  $metrics | ConvertTo-Json -Compress -Depth 6
  exit 0
}

throw "Unsupported action: $Action"
`;
}
