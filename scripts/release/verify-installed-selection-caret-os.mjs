/**
 * Installed/equivalent WebView acceptance for hiding the native caret while a
 * non-empty selection exists (issue #33).
 *
 * CDP is observation-only. The drag that creates the range is a Win32
 * SendInput gesture against the exact child PID. Samples of caret-color and
 * the hidden-caret class are taken from window-level mouse listeners during
 * the press, not only after release.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createAcceptanceSettingsEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const SOURCE = '前缀文本 第二段落普通文字 后缀文字';
const TARGET = '第二段落普通文字';
const HIDDEN_CLASS = 'lm-editor-selection-caret-hidden';
const ASSERTIONS = [
  'native drag paints a range while the button is held',
  'caret-color is transparent during the held range and after release',
  'collapsing the range restores a visible caret',
];

const options = parseArguments(process.argv.slice(2));
const executablePath =
  options.executablePath ||
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  fileURLToPath(
    new URL('../../src-tauri/target/release/lumamark.exe', import.meta.url),
  );

if (options.plan) {
  process.stdout.write(
    `${JSON.stringify(
      {
        assertions: ASSERTIONS,
        coordinateConversion: 'GetClientRect + ClientToScreen',
        executablePath,
        inputApi: 'SendInput',
        source: SOURCE,
        target: TARGET,
      },
      null,
      2,
    )}\n`,
  );
} else {
  await runAcceptance();
}

async function runAcceptance() {
  if (process.platform !== 'win32') {
    throw new Error(
      'Selection-caret acceptance requires an interactive Windows desktop.',
    );
  }

  const absoluteExecutablePath = resolve(executablePath);
  if (!existsSync(absoluteExecutablePath)) {
    throw new Error(`LumaMark executable does not exist: ${absoluteExecutablePath}`);
  }
  const probePath = fileURLToPath(
    new URL('./windows-window-chrome-probe.ps1', import.meta.url),
  );
  if (!existsSync(probePath)) {
    throw new Error(`Win32 input probe does not exist: ${probePath}`);
  }

  let app;
  let appExit;
  let appStartError;
  let browser;
  let page;
  let tempDirectory;
  const processOutput = { stderr: [], stdout: [] };
  const evidence = {
    assertions: {},
    coordinateConversion: 'GetClientRect + ClientToScreen',
    executablePath: absoluteExecutablePath,
    inputApi: 'SendInput',
    pid: null,
    source: SOURCE,
  };

  try {
    const executableStats = await stat(absoluteExecutablePath);
    evidence.executable = {
      modifiedAt: executableStats.mtime.toISOString(),
      size: executableStats.size,
    };
    const debugPort = await reserveDebugPort(options.debugPort);
    tempDirectory = await mkdtemp(
      join(tmpdir(), 'lumamark-menu-context-os-selection-caret-'),
    );
    const documentPath = join(tempDirectory, 'selection-caret-os.md');
    await writeFile(documentPath, SOURCE, 'utf8');

    app = spawn(absoluteExecutablePath, [documentPath], {
      cwd: dirname(absoluteExecutablePath),
      env: await createAcceptanceSettingsEnvironment({
        baseEnvironment: process.env,
        debugPort,
        tempDirectory,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    evidence.pid = app.pid ?? null;
    appExit = new Promise((resolveExit) => {
      app.once('exit', resolveExit);
      app.once('error', (error) => {
        appStartError = error;
        resolveExit();
      });
    });
    app.stdout?.on('data', (chunk) => processOutput.stdout.push(String(chunk)));
    app.stderr?.on('data', (chunk) => processOutput.stderr.push(String(chunk)));

    await waitForDebugEndpoint(debugPort, () => ({
      error: appStartError,
      exitCode: app.exitCode,
    }));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const context = browser.contexts()[0];
    page =
      context.pages()[0] ??
      (await context.waitForEvent('page', { timeout: 5_000 }));
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await page.waitForFunction(
      (source) => {
        const content = document.querySelector('.lm-editor-live-preview-mode .cm-content');
        const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
        return view?.state.doc.toString() === source;
      },
      SOURCE,
      { timeout: 20_000 },
    );

    await installPressObserver(page);
    const start = await readTextPoint(page, TARGET, 0.15);
    const end = await readTextPoint(page, TARGET, 0.85);
    const runNativeProbe = (action, values = {}) =>
      invokeNativeProbe({
        action,
        childPid: app.pid,
        probePath,
        values,
      });
    const nativeStart = await toNativePoint(page, runNativeProbe, start, app.pid);
    const nativeEnd = await toNativePoint(page, runNativeProbe, end, app.pid);
    const nativeResult = runNativeProbe('Drag', {
      EndX: nativeEnd.x,
      EndY: nativeEnd.y,
      X: nativeStart.x,
      Y: nativeStart.y,
    });
    assertExactChild(nativeResult, app.pid);

    const samples = await readPressSamples(page);
    const held = samples.filter(
      (sample) => sample.type === 'mousemove' && sample.selectedText.length > 0,
    );
    const released = await readCaretObservation(page);
    if (held.length === 0) {
      throw new Error(`Native drag never painted a range: ${JSON.stringify(samples)}`);
    }
    const opaqueHeld = held.filter((sample) => !isTransparentCaret(sample.caretColor));
    if (opaqueHeld.length > 0 || !held.every((sample) => sample.hiddenClass)) {
      throw new Error(
        `Native drag kept a visible caret: ${JSON.stringify({ held, opaqueHeld })}`,
      );
    }
    if (
      released.selectedText.length === 0 ||
      !released.hiddenClass ||
      !isTransparentCaret(released.caretColor)
    ) {
      throw new Error(`Caret still visible after release: ${JSON.stringify(released)}`);
    }

    runNativeProbe('Click', {
      X: nativeEnd.x,
      Y: nativeEnd.y,
    });
    await page.waitForFunction(
      () => {
        const content = document.querySelector('.lm-editor-live-preview-mode .cm-content');
        const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
        return view?.state.selection.main.empty === true;
      },
      null,
      { timeout: 5_000 },
    );
    const collapsed = await readCaretObservation(page);
    if (
      collapsed.selectedText.length > 0 ||
      collapsed.hiddenClass ||
      isTransparentCaret(collapsed.caretColor)
    ) {
      throw new Error(`Caret stayed hidden after collapse: ${JSON.stringify(collapsed)}`);
    }

    evidence.assertions = {
      collapsedRestoredCaret: true,
      heldRangeHiddenCaret: true,
      releasedRangeHiddenCaret: true,
    };
    evidence.collapsed = collapsed;
    evidence.held = held;
    evidence.nativeResult = nativeResult;
    evidence.released = released;
    evidence.passed = true;
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      [
        '[release:installed-selection-caret-os] FAILED',
        error instanceof Error ? error.stack ?? error.message : String(error),
        `partial evidence: ${JSON.stringify(evidence)}`,
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
}

async function installPressObserver(page) {
  await page.evaluate((hiddenClass) => {
    const samples = [];
    window.__lumamarkSelectionCaretSamples = samples;
    const record = (type) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      if (!content || !view) return;
      const selection = view.state.selection.main;
      samples.push({
        caretColor: getComputedStyle(content).caretColor,
        hiddenClass: content.classList.contains(hiddenClass),
        selectedText: view.state.sliceDoc(selection.from, selection.to),
        type,
      });
    };
    for (const type of ['mousedown', 'mousemove', 'mouseup']) {
      window.addEventListener(type, (event) => {
        if (type === 'mousemove' && event.buttons === 0) return;
        record(type);
      });
    }
  }, HIDDEN_CLASS);
}

async function readPressSamples(page) {
  return page.evaluate(() => [...window.__lumamarkSelectionCaretSamples]);
}

async function readCaretObservation(page) {
  return page.evaluate((hiddenClass) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!content || !view) {
      throw new Error('Unable to resolve live-preview EditorView.');
    }
    const selection = view.state.selection.main;
    return {
      caretColor: getComputedStyle(content).caretColor,
      hiddenClass: content.classList.contains(hiddenClass),
      selectedText: view.state.sliceDoc(selection.from, selection.to),
    };
  }, HIDDEN_CLASS);
}

async function readTextPoint(page, targetText, fraction) {
  return page.evaluate(
    ({ fraction: horizontalFraction, text }) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      if (!view) throw new Error('Unable to resolve live-preview EditorView.');
      const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const candidate = walker.currentNode;
        const offset = candidate.data.indexOf(text);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(candidate, offset);
        range.setEnd(candidate, offset + text.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width * horizontalFraction,
          y: rect.top + rect.height / 2,
        };
      }
      throw new Error(`Missing rendered text: ${text}`);
    },
    { fraction, text: targetText },
  );
}

async function toNativePoint(page, runNativeProbe, cssPoint, expectedPid) {
  const nativeState = runNativeProbe('State');
  assertExactChild(nativeState, expectedPid);
  const viewport = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  if (
    Math.abs(nativeState.clientRect.width - viewport.width * viewport.dpr) > 3 ||
    Math.abs(nativeState.clientRect.height - viewport.height * viewport.dpr) > 3
  ) {
    throw new Error(
      `WebView/client geometry mismatch: ${JSON.stringify({ nativeState, viewport })}`,
    );
  }
  return {
    x: nativeState.clientRect.left + Math.round(cssPoint.x * viewport.dpr),
    y: nativeState.clientRect.top + Math.round(cssPoint.y * viewport.dpr),
  };
}

function isTransparentCaret(color) {
  const normalized = String(color).replaceAll(' ', '').toLowerCase();
  return (
    normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === '#0000' ||
    normalized === '#00000000'
  );
}

function assertExactChild(state, childPid) {
  if (state.targetPid !== childPid || state.hwnd <= 0) {
    throw new Error(
      `Win32 probe is not bound to exact child PID ${childPid}: ${JSON.stringify(state)}`,
    );
  }
}

function invokeNativeProbe({ action, childPid, probePath, values }) {
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    probePath,
    '-TargetProcessId',
    String(childPid),
    '-Action',
    action,
  ];
  for (const [name, value] of Object.entries(values)) {
    args.push(`-${name}`, String(value));
  }
  const result = spawnSync('powershell.exe', args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Win32 ${action} failed: ${result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`}`,
      result.error ? { cause: result.error } : undefined,
    );
  }
  return JSON.parse(result.stdout.trim());
}

async function waitForDebugEndpoint(debugPort, getProcessState) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = getProcessState();
    if (state.error) {
      throw new Error(`Unable to start LumaMark: ${state.error.message}`, {
        cause: state.error,
      });
    }
    if (state.exitCode !== null) {
      throw new Error(
        `Exact LumaMark child exited before WebView2 opened (exit ${state.exitCode}).`,
      );
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) return;
    } catch {
      // Poll only the remote-debugging port assigned to the exact child.
    }
    await delay(500);
  }
  throw new Error(`WebView2 debug endpoint did not open on port ${debugPort}.`);
}

function parseArguments(args) {
  const parsed = { debugPort: undefined, executablePath: undefined, plan: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan') {
      parsed.plan = true;
      continue;
    }
    if (argument === '--executable' || argument === '--debug-port') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === '--executable') {
        parsed.executablePath = value;
      } else {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          throw new Error(`--debug-port must be a valid port; received ${value}.`);
        }
        parsed.debugPort = port;
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}
