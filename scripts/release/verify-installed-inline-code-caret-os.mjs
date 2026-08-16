/**
 * Installed/equivalent WebView acceptance for inline-code pointer geometry.
 *
 * CDP only observes editor/DOM state and installs event observers. The test
 * document is supplied through argv, while every caret-changing gesture is a
 * Win32 SendInput action against the exact child PID. CSS coordinates are
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
  '异行锚点',
  '',
  '前缀文本 `alphaBeta` 中间中文 `gamma_delta` 后缀文字',
].join('\n');
const WORDS = ['alphaBeta', 'gamma_delta'];
const FOLLOWING_TEXT = [
  { word: 'alphaBeta', text: '中间中文' },
];
const ASSERTIONS = [
  'native single clicks place a collapsed caret at each inline-code midpoint',
  'native single clicks on following text stay collapsed instead of selecting a word',
  'native system double clicks select only each inline-code word',
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
        source: SOURCE,
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
      'Inline-code OS-pointer acceptance requires an interactive Windows desktop.',
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
    tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-menu-context-os-inline-code-os-'));
    documentPath = join(tempDirectory, 'inline-code-caret-os.md');
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
    await assertWebviewMatchesClient(page, foregroundNative);
    const dpr = await page.evaluate(() => window.devicePixelRatio);
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

    await installPointerObserver(page);
    const baseline = await readObservation(page);
    assertCleanSource(baseline, 'baseline');
    evidence.baseline = baseline;

    for (const word of WORDS) {
      const otherWord = WORDS.find((candidate) => candidate !== word);
      await establishNativeCaret(page, runNativeProbe, otherWord, app.pid);
      const target = await readInlineCodeMidpoint(page, word);
      await clearObservedEvents(page);
      const nativePoint = await toNativePoint(
        page,
        runNativeProbe,
        target.point,
        app.pid,
      );
      const nativeResult = runNativeProbe('Click', {
        X: nativePoint.x,
        Y: nativePoint.y,
      });
      assertExactChild(nativeResult, app.pid);
      const final = await waitForSelection(page, {
        anchor: target.expectedCaret,
        head: target.expectedCaret,
      });
      const events = await readObservedEvents(page);
      assertGestureEvents(events, 'click');
      assertCleanSource(final, `${word} single click`);
      evidence.gestures.push({
        events,
        final,
        kind: 'single-click',
        nativePoint,
        nativeResult,
        target,
        targetVerifiedBeforeInput: true,
        word,
      });
    }

    for (const { word, text } of FOLLOWING_TEXT) {
      const otherWord = WORDS.find((candidate) => candidate !== word);
      await establishNativeCaret(page, runNativeProbe, otherWord, app.pid);
      await delay(600);
      const following = await readFollowingTextPoint(page, text);
      await clearObservedEvents(page);
      const followingPoint = await toNativePoint(
        page,
        runNativeProbe,
        following.point,
        app.pid,
      );
      const followingClick = runNativeProbe('Click', {
        X: followingPoint.x,
        Y: followingPoint.y,
      });
      assertExactChild(followingClick, app.pid);
      await waitForCollapsedSelectionInside(
        page,
        following.from,
        following.to,
      );
      const final = await readObservation(page);
      if (!final.selection || final.selectedSource !== '' || final.domSelectedText !== '') {
        throw new Error(
          `${text} following-text click selected a word: ${JSON.stringify(final)}`,
        );
      }
      if (
        final.selection.head < following.from ||
        final.selection.head > following.to
      ) {
        throw new Error(
          `${text} following-text click jumped away: ${JSON.stringify(final)}`,
        );
      }
      assertCleanSource(final, `${text} following-text click`);
      evidence.gestures.push({
        events: await readObservedEvents(page),
        final,
        kind: 'following-text-click',
        nativePoint: followingPoint,
        nativeResult: followingClick,
        target: following,
        targetVerifiedBeforeInput: true,
        word: text,
      });
    }

    for (const word of WORDS) {
      const otherWord = WORDS.find((candidate) => candidate !== word);
      await establishNativeCaret(page, runNativeProbe, otherWord, app.pid);
      const target = await readInlineCodeMidpoint(page, word);
      await clearObservedEvents(page);
      const nativePoint = await toNativePoint(
        page,
        runNativeProbe,
        target.point,
        app.pid,
      );
      const nativeResult = runNativeProbe('DoubleClick', {
        X: nativePoint.x,
        Y: nativePoint.y,
      });
      assertExactChild(nativeResult, app.pid);
      const final = await waitForSelection(page, {
        anchor: target.contentFrom,
        head: target.contentTo,
      });
      const events = await readObservedEvents(page);
      assertGestureEvents(events, 'dblclick');
      if (final.selectedSource !== word || final.domSelectedText !== word) {
        throw new Error(
          `${word} native double click selected adjacent Markdown: ${JSON.stringify(final)}`,
        );
      }
      assertCleanSource(final, `${word} double click`);
      evidence.gestures.push({
        events,
        final,
        kind: 'system-double-click',
        nativePoint,
        nativeResult,
        target,
        targetVerifiedBeforeInput: true,
        word,
      });
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
        '[release:installed-inline-code-caret-os] FAILED',
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

async function installPointerObserver(page) {
  await page.evaluate(() => {
    const observation = { events: [] };
    window.__lumamarkInlineCodePointerObservation = observation;
    const eventNames = ['mousedown', 'mouseup', 'click', 'dblclick'];
    for (const eventName of eventNames) {
      document.addEventListener(
        eventName,
        (event) => {
          const content = document.querySelector(
            '.lm-editor-live-preview-mode .cm-content',
          );
          const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
          if (!view) return;
          const selection = view.state.selection.main;
          const target = event.target instanceof Element ? event.target : null;
          const owner = target?.closest('[data-lm-inline-owner-from]') ?? null;
          const ownerRect = owner?.getBoundingClientRect();
          const domSelection = document.getSelection();
          const caretRect = view.coordsAtPos(selection.head);
          observation.events.push({
            coordsAtPos: caretRect
              ? {
                  bottom: caretRect.bottom,
                  left: caretRect.left,
                  right: caretRect.right,
                  top: caretRect.top,
                }
              : null,
            detail: event.detail,
            domSelection: domSelection
              ? {
                  anchorOffset: domSelection.anchorOffset,
                  focusOffset: domSelection.focusOffset,
                  text: domSelection.toString(),
                }
              : null,
            owner: owner
              ? {
                  from: Number(owner.getAttribute('data-lm-inline-owner-from')),
                  rect: ownerRect
                    ? {
                        bottom: ownerRect.bottom,
                        left: ownerRect.left,
                        right: ownerRect.right,
                        top: ownerRect.top,
                      }
                    : null,
                  to: Number(owner.getAttribute('data-lm-inline-owner-to')),
                }
              : null,
            posAtCoords: view.posAtCoords({ x: event.clientX, y: event.clientY }),
            selection: { anchor: selection.anchor, head: selection.head },
            type: event.type,
          });
        },
        true,
      );
    }
  });
}

async function clearObservedEvents(page) {
  await page.evaluate(() => {
    window.__lumamarkInlineCodePointerObservation.events.length = 0;
  });
}

async function readObservedEvents(page) {
  return page.evaluate(() => [
    ...window.__lumamarkInlineCodePointerObservation.events,
  ]);
}

async function establishNativeCaret(page, runNativeProbe, word, expectedPid) {
  const target = await readInlineCodeMidpoint(page, word);
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
  await waitForCollapsedSelectionInside(page, target.contentFrom, target.contentTo);
}

async function readInlineCodeMidpoint(page, word) {
  return page.evaluate((targetWord) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) throw new Error('Unable to resolve live-preview EditorView.');
    const source = view.state.doc.toString();
    const ownerSource = `\`${targetWord}\``;
    const from = source.indexOf(ownerSource);
    if (from < 0) throw new Error(`Missing inline-code source: ${targetWord}`);
    const to = from + ownerSource.length;
    const contentFrom = from + 1;
    const contentTo = to - 1;
    const selector =
      `[data-lm-inline-owner-from="${from}"]` +
      `[data-lm-inline-owner-to="${to}"]`;
    const owners = [...view.contentDOM.querySelectorAll(selector)];
    if (owners.length === 0) {
      throw new Error(`Missing inline-code owner DOM for ${targetWord}.`);
    }
    const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
    let textNode = null;
    let wordOffset = -1;
    while (walker.nextNode()) {
      const candidate = walker.currentNode;
      const parent = candidate.parentElement;
      if (!parent?.closest(selector)) continue;
      const offset = candidate.data.indexOf(targetWord);
      if (offset >= 0) {
        textNode = candidate;
        wordOffset = offset;
        break;
      }
    }
    if (!textNode) throw new Error(`Missing visible inline-code text for ${targetWord}.`);
    const characterIndex = Math.floor(targetWord.length / 2);
    const range = document.createRange();
    range.setStart(textNode, wordOffset + characterIndex);
    range.setEnd(textNode, wordOffset + characterIndex + 1);
    const characterRect = range.getBoundingClientRect();
    const point = {
      x: characterRect.left + characterRect.width * 0.25,
      y: characterRect.top + characterRect.height / 2,
    };
    const expectedCaret = contentFrom + characterIndex;
    const ownerRects = owners.map((owner) => owner.getBoundingClientRect());
    const ownerRect = {
      bottom: Math.max(...ownerRects.map((rect) => rect.bottom)),
      left: Math.min(...ownerRects.map((rect) => rect.left)),
      right: Math.max(...ownerRects.map((rect) => rect.right)),
      top: Math.min(...ownerRects.map((rect) => rect.top)),
    };
    return {
      contentFrom,
      contentTo,
      expectedCaret,
      ownerRect,
      point,
      preClickCoordsAtPos: view.coordsAtPos(expectedCaret),
      preClickPosAtCoords: view.posAtCoords(point),
      sourceFrom: from,
      sourceTo: to,
      word: targetWord,
    };
  }, word);
}

async function readFollowingTextPoint(page, targetText) {
  return page.evaluate((text) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) throw new Error('Unable to resolve live-preview EditorView.');
    const source = view.state.doc.toString();
    const from = source.indexOf(text);
    if (from < 0) throw new Error(`Missing following text: ${text}`);
    const to = from + text.length;
    const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
    let textNode = null;
    let wordOffset = -1;
    while (walker.nextNode()) {
      const candidate = walker.currentNode;
      const parent = candidate.parentElement;
      if (parent?.closest('[data-lm-inline-owner-from]')) continue;
      const offset = candidate.data.indexOf(text);
      if (offset >= 0) {
        textNode = candidate;
        wordOffset = offset;
        break;
      }
    }
    if (!textNode) throw new Error(`Missing visible following text: ${text}`);
    const characterIndex = Math.floor(text.length / 2);
    const range = document.createRange();
    range.setStart(textNode, wordOffset + characterIndex);
    range.setEnd(textNode, wordOffset + characterIndex + 1);
    const characterRect = range.getBoundingClientRect();
    const point = {
      x: characterRect.left + characterRect.width * 0.25,
      y: characterRect.top + characterRect.height / 2,
    };
    return {
      from,
      point,
      to,
      word: text,
    };
  }, targetText);
}

async function toNativePoint(page, runNativeProbe, cssPoint, expectedPid) {
  const nativeState = runNativeProbe('State');
  const viewport = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  assertExactChild(nativeState, expectedPid);
  if (
    Math.abs(nativeState.clientRect.width - viewport.width * viewport.dpr) > 3 ||
    Math.abs(nativeState.clientRect.height - viewport.height * viewport.dpr) > 3
  ) {
    throw new Error(
      `WebView/client geometry mismatch: ${JSON.stringify({ nativeState, viewport })}`,
    );
  }
  return {
    clientRect: nativeState.clientRect,
    css: cssPoint,
    dpr: viewport.dpr,
    x: nativeState.clientRect.left + Math.round(cssPoint.x * viewport.dpr),
    y: nativeState.clientRect.top + Math.round(cssPoint.y * viewport.dpr),
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
      `Initial WebView/client geometry mismatch: ${JSON.stringify({ nativeState, viewport })}`,
    );
  }
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

async function waitForSelection(page, expected) {
  await page.waitForFunction(
    (target) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      const selection = view?.state.selection.main;
      if (!selection) return false;
      const forward = selection.anchor === target.anchor && selection.head === target.head;
      const backward = selection.anchor === target.head && selection.head === target.anchor;
      return forward || backward;
    },
    expected,
    { timeout: 5_000 },
  );
  return readObservation(page);
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

function assertGestureEvents(events, expectedFinalEvent) {
  const types = events.map((event) => event.type);
  for (const required of ['mousedown', 'mouseup', 'click']) {
    if (!types.includes(required)) {
      throw new Error(`Native gesture omitted ${required}: ${JSON.stringify(events)}`);
    }
  }
  if (expectedFinalEvent === 'dblclick') {
    const doubleClick = events.find((event) => event.type === 'dblclick');
    if (!doubleClick || doubleClick.detail !== 2) {
      throw new Error(`Native system double click was not observed: ${JSON.stringify(events)}`);
    }
  } else if (types.includes('dblclick')) {
    throw new Error(`Native single click became a double click: ${JSON.stringify(events)}`);
  }
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
