/**
 * Installed/equivalent WebView acceptance for live-preview click selection.
 *
 * Issue #19 stayed visible after the first fix because a real hand moves the
 * pointer a few physical pixels while the button is held: CodeMirror's built-in
 * mouse selection then painted a short range that only collapsed on release.
 * CDP only observes editor/DOM state, while every gesture is a Win32 SendInput
 * press-move-release against the exact child PID, with CSS coordinates
 * converted from the WebView client origin reported by ClientToScreen.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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

const SOURCE = [
  '# 标题一级文本',
  '',
  '前缀文本 **加粗内容** 与 [链接文本](https://example.com) 后缀文字',
  '',
  '第二段落普通文字内容用于对照观察',
].join('\n');
const TARGETS = ['标题一级文本', '加粗内容', '链接文本', '第二段落普通文字'];
const JITTERS = [0, 3];
const ASSERTIONS = [
  'native presses never paint a range while the button is held',
  'native presses keep the caret at the press position through release',
  'native presses land inside the clicked text',
  'pointer gestures preserve Markdown source and clean document state',
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
        jitters: JITTERS,
        source: SOURCE,
        targets: TARGETS,
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
      'Live-preview click acceptance requires an interactive Windows desktop.',
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
  let documentPath;
  const processOutput = { stderr: [], stdout: [] };
  const evidence = {
    assertions: {},
    coordinateConversion: 'GetClientRect + ClientToScreen',
    executablePath: absoluteExecutablePath,
    gestures: [],
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
      join(tmpdir(), 'lumamark-menu-context-os-preview-click-'),
    );
    documentPath = join(tempDirectory, 'preview-click-selection-os.md');
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
        const content = document.querySelector(
          '.lm-editor-live-preview-mode .cm-content',
        );
        const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
        return view?.state.doc.toString() === source;
      },
      SOURCE,
      { timeout: 20_000 },
    );

    if (!Number.isInteger(app.pid)) {
      throw new Error('Spawned LumaMark did not expose an exact child PID.');
    }
    const runNativeProbe = (action, values = {}) =>
      invokeNativeProbe({ action, childPid: app.pid, probePath, values });
    const initialNative = runNativeProbe('State');
    assertExactExecutable(initialNative.executablePath, absoluteExecutablePath);
    const foregroundNative = runNativeProbe('PlaceNormal', {
      Height: initialNative.clientRect.height,
      Left: initialNative.clientRect.left,
      Top: initialNative.clientRect.top,
      Width: initialNative.clientRect.width,
    });
    assertExactChild(foregroundNative, app.pid);
    const dpr = await assertWebviewMatchesClient(page, foregroundNative);
    evidence.native = {
      clientOrigin: {
        x: foregroundNative.clientRect.left,
        y: foregroundNative.clientRect.top,
      },
      clientRect: foregroundNative.clientRect,
      dpi: foregroundNative.dpi,
      dpr,
      hwnd: foregroundNative.hwnd,
      targetPid: foregroundNative.targetPid,
      targetVerifiedBeforeInput: true,
    };

    await installPressObserver(page);
    const baseline = await readObservation(page);
    assertCleanSource(baseline, 'baseline');
    evidence.baseline = baseline;

    for (const text of TARGETS) {
      for (const jitter of JITTERS) {
        const parked = TARGETS.find((candidate) => candidate !== text);
        await parkCaret(page, runNativeProbe, parked, app.pid);
        const target = await readTextMidpoint(page, text);
        await clearPressSamples(page);
        const nativePoint = await toNativePoint(
          page,
          runNativeProbe,
          target.point,
          app.pid,
        );
        const nativeResult = runNativeProbe('JitterClick', {
          EndX: nativePoint.x + jitter,
          EndY: nativePoint.y,
          X: nativePoint.x,
          Y: nativePoint.y,
        });
        assertExactChild(nativeResult, app.pid);
        await waitForCollapsedSelectionInside(page, target.from, target.to);

        const samples = await readPressSamples(page);
        const final = await readObservation(page);
        assertPressStayedCollapsed(samples, { jitter, text });
        assertCaretHeldThroughRelease(samples, final, { jitter, text });
        assertCleanSource(final, `${text} jitter ${jitter}`);
        evidence.gestures.push({
          final,
          jitter,
          kind: 'native-jitter-click',
          nativePoint,
          nativeResult,
          samples,
          target,
          targetVerifiedBeforeInput: true,
          text,
        });
      }
    }

    const final = await readObservation(page);
    const diskSource = await readFile(documentPath, 'utf8');
    evidence.final = final;
    evidence.assertions = {
      dirtyUnchanged: !baseline.dirty && !final.dirty,
      diskSourceUnchanged: diskSource === SOURCE,
      sourceUnchanged: baseline.source === SOURCE && final.source === SOURCE,
    };
    if (!Object.values(evidence.assertions).every(Boolean)) {
      throw new Error(`Source/dirty invariant failed: ${JSON.stringify(evidence.assertions)}`);
    }
    evidence.passed = true;
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      [
        '[release:installed-preview-click-selection-os] FAILED',
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

/**
 * Window-level bubble listeners run after CodeMirror's own document handlers,
 * so each sample is the state the compositor would paint for that event.
 */
async function installPressObserver(page) {
  await page.evaluate(() => {
    const samples = [];
    window.__lumamarkPreviewClickSamples = samples;
    const record = (type, phase) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      if (!view) return;
      const selection = view.state.selection.main;
      const domSelection = document.getSelection();
      samples.push({
        anchor: selection.anchor,
        domCollapsed: domSelection ? domSelection.isCollapsed : true,
        domText: domSelection ? domSelection.toString() : '',
        head: selection.head,
        phase,
        selectedSource: view.state.sliceDoc(selection.from, selection.to),
        type,
      });
    };
    for (const type of ['mousedown', 'mousemove', 'mouseup']) {
      window.addEventListener(type, (event) => {
        if (type === 'mousemove' && event.buttons === 0) return;
        record(type, 'sync');
        queueMicrotask(() => record(type, 'microtask'));
      });
    }
  });
}

async function clearPressSamples(page) {
  await page.evaluate(() => {
    window.__lumamarkPreviewClickSamples.length = 0;
  });
}

async function readPressSamples(page) {
  return page.evaluate(() => [...window.__lumamarkPreviewClickSamples]);
}

function assertPressStayedCollapsed(samples, context) {
  if (!samples.some((sample) => sample.type === 'mousedown')) {
    throw new Error(
      `Native press produced no mousedown sample: ${JSON.stringify({ context, samples })}`,
    );
  }
  const painted = samples.filter(
    (sample) =>
      sample.anchor !== sample.head ||
      sample.selectedSource !== '' ||
      !sample.domCollapsed ||
      sample.domText !== '',
  );
  if (painted.length > 0) {
    throw new Error(
      `Native press painted a selection: ${JSON.stringify({ context, painted, samples })}`,
    );
  }
}

function assertCaretHeldThroughRelease(samples, final, context) {
  const pressed = samples.find(
    (sample) => sample.type === 'mousedown' && sample.phase === 'sync',
  );
  if (!pressed) {
    throw new Error(
      `Missing mousedown sample: ${JSON.stringify({ context, samples })}`,
    );
  }
  if (pressed.head !== final.selection.head) {
    throw new Error(
      `Caret moved between press and release: ${JSON.stringify({ context, final, pressed })}`,
    );
  }
}

async function parkCaret(page, runNativeProbe, text, expectedPid) {
  const target = await readTextMidpoint(page, text);
  const nativePoint = await toNativePoint(
    page,
    runNativeProbe,
    target.point,
    expectedPid,
  );
  const nativeResult = runNativeProbe('Click', {
    X: nativePoint.x,
    Y: nativePoint.y,
  });
  assertExactChild(nativeResult, expectedPid);
  await waitForCollapsedSelectionInside(page, target.from, target.to);
  await delay(400);
}

async function readTextMidpoint(page, targetText) {
  return page.evaluate((text) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) throw new Error('Unable to resolve live-preview EditorView.');
    const source = view.state.doc.toString();
    const from = source.indexOf(text);
    if (from < 0) throw new Error(`Missing source text: ${text}`);
    const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
    let textNode = null;
    let textOffset = -1;
    while (walker.nextNode()) {
      const candidate = walker.currentNode;
      const offset = candidate.data.indexOf(text);
      if (offset >= 0) {
        textNode = candidate;
        textOffset = offset;
        break;
      }
    }
    if (!textNode) throw new Error(`Missing rendered text: ${text}`);
    const characterIndex = Math.floor(text.length / 2);
    const range = document.createRange();
    range.setStart(textNode, textOffset + characterIndex);
    range.setEnd(textNode, textOffset + characterIndex + 1);
    const characterRect = range.getBoundingClientRect();
    return {
      from,
      point: {
        x: characterRect.left + characterRect.width * 0.25,
        y: characterRect.top + characterRect.height / 2,
      },
      preClickPosAtCoords: view.posAtCoords({
        x: characterRect.left + characterRect.width * 0.25,
        y: characterRect.top + characterRect.height / 2,
      }),
      text,
      to: from + text.length,
    };
  }, targetText);
}

async function toNativePoint(page, runNativeProbe, cssPoint, expectedPid) {
  const nativeState = runNativeProbe('State');
  assertExactChild(nativeState, expectedPid);
  const dpr = await assertWebviewMatchesClient(page, nativeState);
  return {
    clientRect: nativeState.clientRect,
    css: cssPoint,
    dpr,
    x: nativeState.clientRect.left + Math.round(cssPoint.x * dpr),
    y: nativeState.clientRect.top + Math.round(cssPoint.y * dpr),
  };
}

async function assertWebviewMatchesClient(page, nativeState) {
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
  return viewport.dpr;
}

async function waitForCollapsedSelectionInside(page, from, to) {
  await page.waitForFunction(
    ({ from: contentFrom, to: contentTo }) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      const selection = view?.state.selection.main;
      return (
        selection?.empty === true &&
        selection.head >= contentFrom &&
        selection.head <= contentTo
      );
    },
    { from, to },
    { timeout: 5_000 },
  );
}

async function readObservation(page) {
  return page.evaluate(() => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) throw new Error('Unable to resolve live-preview EditorView.');
    const selection = view.state.selection.main;
    const title = document.querySelector('.lm-editor-title')?.textContent ?? '';
    const status = document.querySelector('[role="status"]')?.textContent ?? '';
    return {
      dirty: title.includes('*') || /unsaved|未保存/iu.test(status),
      domSelectedText: document.getSelection()?.toString() ?? '',
      selectedSource: view.state.sliceDoc(selection.from, selection.to),
      selection: {
        anchor: selection.anchor,
        from: selection.from,
        head: selection.head,
        to: selection.to,
      },
      source: view.state.doc.toString(),
      status,
      title,
    };
  });
}

function assertCleanSource(observation, label) {
  if (observation.source !== SOURCE || observation.dirty) {
    throw new Error(`${label} changed source/dirty state: ${JSON.stringify(observation)}`);
  }
}

function assertExactChild(state, childPid) {
  if (state.targetPid !== childPid || state.hwnd <= 0) {
    throw new Error(
      `Win32 probe is not bound to exact child PID ${childPid}: ${JSON.stringify(state)}`,
    );
  }
}

function assertExactExecutable(actual, expected) {
  if (resolve(actual).toLowerCase() !== resolve(expected).toLowerCase()) {
    throw new Error(
      `Native HWND executable mismatch: expected ${expected}, received ${actual}.`,
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
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(`Win32 ${action} returned invalid JSON: ${result.stdout}`, {
      cause: error,
    });
  }
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
