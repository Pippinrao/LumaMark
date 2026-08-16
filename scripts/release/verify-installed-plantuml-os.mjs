/**
 * Installed Windows acceptance for local PlantUML preview.
 *
 * CDP is observation-only. Pointer, Unicode, undo, and save actions are
 * delivered to the spawned process through the shared Win32 SendInput helper.
 */
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const acceptanceName = 'release:installed-plantuml-os';
const helperProducer = join(
  dirname(fileURLToPath(import.meta.url)),
  'verify-installed-media-caret-os.mjs',
);
const offlineResolverRule =
  '--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE localhost,EXCLUDE 127.0.0.1,EXCLUDE tauri.localhost';
const beforeLine = 'plantuml acceptance before';
const afterLine = 'plantuml acceptance after';
const sequenceSource = [
  '@startuml',
  'Alice -> Bob : Hello',
  'Bob --> Alice : Hi',
  '@enduml',
].join('\n');
const invalidSource = [
  '@startuml',
  'this is not valid plantuml syntax !!!',
  '@enduml',
].join('\n');
const initialMarkdown = [
  beforeLine,
  '',
  '```plantuml',
  sequenceSource,
  '```',
  '',
  afterLine,
  '',
  '```plantuml',
  invalidSource,
  '```',
].join('\n');

if (process.platform !== 'win32') {
  failFast('Windows and a freshly installed executable are required.');
}

const executableEnvironment = process.env.LUMAMARK_EXECUTABLE?.trim();
if (!executableEnvironment) {
  failFast(
    'LUMAMARK_EXECUTABLE must point to the freshly installed lumamark.exe.',
  );
}

const executablePath = resolve(executableEnvironment);
const acceptanceAbort = new AbortController();
const acceptanceDeadline = Date.now() + 240_000;
const watchdog = setTimeout(() => {
  acceptanceAbort.abort(
    new Error(`[${acceptanceName}] Global watchdog expired after 240 seconds.`),
  );
}, Math.max(0, acceptanceDeadline - Date.now()));
const evidence = {
  actions: [],
  executablePath,
  featureObservations: null,
  offline: {
    hostResolverRule: offlineResolverRule,
    remoteRequests: [],
  },
  pid: null,
  savedMarkdownExact: false,
  screenshot: null,
};
const processOutput = { stderr: [], stdout: [] };
let app;
let appExit;
let browser;
let documentPath;
let page;
let tempDirectory;
let win32HelperPath;

try {
  await runAcceptance();
  process.stdout.write(
    `${JSON.stringify({ installedPlantumlOs: true, ...evidence }, null, 2)}\n`,
  );
} catch (error) {
  await captureScreenshot('failed');
  process.stderr.write(
    [
      `[${acceptanceName}] FAILED`,
      error instanceof Error ? error.stack ?? error.message : String(error),
      JSON.stringify({ ...evidence, processOutput }, null, 2),
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  const cleanupFailures = [];
  if (browser) {
    await browser.close().catch((closeError) => {
      cleanupFailures.push(`browser: ${String(closeError)}`);
    });
  }
  if (app?.pid && isProcessRunning(app.pid)) {
    try {
      terminateProcessTree(app.pid);
    } catch (killError) {
      cleanupFailures.push(`process: ${String(killError)}`);
    }
  }
  if (appExit) {
    await withTimeout(appExit, 10_000, 'App exit').catch((exitError) => {
      cleanupFailures.push(`exit: ${String(exitError)}`);
    });
  }
  if (tempDirectory) {
    await removePackagedWebviewTempDirectory(tempDirectory).catch((removeError) => {
      cleanupFailures.push(`temp: ${String(removeError)}`);
    });
  }
  if (cleanupFailures.length > 0) {
    process.stderr.write(
      `[${acceptanceName}] Cleanup failed:\n${cleanupFailures.join('\n')}\n`,
    );
  }
}

async function runAcceptance() {
  await access(executablePath);
  const executableStats = await stat(executablePath);
  evidence.executable = {
    modifiedAt: executableStats.mtime.toISOString(),
    size: executableStats.size,
  };

  const port = await reserveDebugPort(
    parseRequestedPort(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT),
  );
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-plantuml-os-'));
  documentPath = join(tempDirectory, 'installed-plantuml.md');
  win32HelperPath = join(tempDirectory, 'lumamark-win32-input.ps1');
  await writeFile(documentPath, initialMarkdown, 'utf8');
  execFileSync(
    process.execPath,
    [helperProducer, '--write-win32-helper', win32HelperPath],
    {
      cwd: dirname(helperProducer),
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    },
  );
  await access(win32HelperPath);

  const webviewEnvironment = createPackagedWebviewEnvironment({
    baseEnvironment: process.env,
    debugPort: port,
    tempDirectory,
  });
  webviewEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [
    webviewEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
    offlineResolverRule,
  ]
    .filter(Boolean)
    .join(' ');

  app = spawn(executablePath, [documentPath], {
    cwd: tempDirectory,
    env: webviewEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  evidence.pid = app.pid;
  let appStartError;
  appExit = new Promise((resolveExit) => {
    app.once('exit', resolveExit);
    app.once('error', (error) => {
      appStartError = error;
      resolveExit();
    });
  });
  app.stdout?.on('data', (chunk) => processOutput.stdout.push(String(chunk)));
  app.stderr?.on('data', (chunk) => processOutput.stderr.push(String(chunk)));

  await waitForDebugEndpoint(port, () => appStartError);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page =
    context.pages()[0] ??
    (await context.waitForEvent('page', { timeout: 5_000 }));

  const diagnostics = { requests: [] };
  context.on('request', (request) => diagnostics.requests.push(request.url()));

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page
    .locator('.lm-editor-title', { hasText: basename(documentPath) })
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lm-editor-live-preview-mode .cm-content').waitFor({
    state: 'visible',
    timeout: 20_000,
  });

  const successPreview = page.locator('.lm-plantuml-preview[data-status="success"]').first();
  await successPreview.waitFor({ state: 'visible', timeout: 60_000 });
  await page
    .locator('.lm-plantuml-preview[data-status="error"]')
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 });

  const liveState = await readRootState();
  if (liveState.source !== initialMarkdown) {
    throw new Error(
      `PlantUML preview changed surrounding Markdown.\nExpected:\n${initialMarkdown}\nActual:\n${liveState.source}`,
    );
  }

  const remoteRequests = diagnostics.requests.filter((url) => isRemoteRequest(url));
  evidence.offline.remoteRequests = remoteRequests;
  if (remoteRequests.length > 0) {
    throw new Error(`PlantUML acceptance observed remote requests: ${remoteRequests.join(', ')}`);
  }

  await successPreview.hover();
  const editButton = page.getByRole('button', { name: /^(?:编辑源码|Edit source)$/ }).first();
  await editButton.waitFor({ state: 'visible', timeout: 10_000 });
  await clickLocatorWithWin32(editButton, 'edit-plantuml-source');
  await page.locator('.lm-plantuml-preview-editing').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  invokeWin32('Unicode', { text: 'Carol -> Dave : ping' });
  await acceptanceDelay(300);
  const editedState = await readRootState();
  if (!editedState.source.includes('Carol -> Dave : ping')) {
    throw new Error(
      `OS Unicode input did not edit PlantUML source: ${JSON.stringify(editedState)}`,
    );
  }
  invokeWin32('Undo');
  await acceptanceDelay(300);
  const undoneState = await readRootState();
  if (undoneState.source !== initialMarkdown) {
    throw new Error(
      `Undo did not restore the original PlantUML document.\nExpected:\n${initialMarkdown}\nActual:\n${undoneState.source}`,
    );
  }

  const afterLineLocator = page.locator('.cm-line', { hasText: afterLine }).first();
  await clickLocatorWithWin32(afterLineLocator, 'focus-after-line');
  const sourceBeforePreviewClick = (await readRootState()).source;
  const selectionBeforePreviewClick = (await readRootState()).selection;
  await clickLocatorWithWin32(successPreview, 'click-plantuml-preview', {
    xRatio: 0.2,
  });
  await acceptanceDelay(200);
  const afterPreviewClick = await readRootState();
  if (
    afterPreviewClick.source !== sourceBeforePreviewClick ||
    JSON.stringify(afterPreviewClick.selection) !==
      JSON.stringify(selectionBeforePreviewClick)
  ) {
    throw new Error(
      `Clicking the PlantUML preview changed source or selection: ${JSON.stringify({
        afterPreviewClick,
        selectionBeforePreviewClick,
        sourceBeforePreviewClick,
      })}`,
    );
  }

  const viewMenu = page.getByRole('menuitem', {
    exact: true,
    name: /^(?:视图|View)$/,
  });
  await clickLocatorWithWin32(viewMenu, 'open-view-menu');
  await page.waitForFunction(
    () =>
      document.querySelector('[role="menuitem"][data-state="open"]')
        ?.textContent?.match(/视图|View/) != null,
    undefined,
    { timeout: 5_000 },
  );
  const readingModeItem = page.getByRole('menuitemradio', {
    name: /^(?:阅读模式|Reading Mode)/,
  });
  await clickLocatorWithWin32(readingModeItem, 'enter-reading-mode');
  await page
    .locator('.cm-editor.lm-editor-reading-mode')
    .waitFor({ state: 'visible', timeout: 10_000 });

  const readingPreview = page.locator('.lm-plantuml-preview[data-status="success"]').first();
  await readingPreview.hover();
  if (
    (await page.locator('.lm-plantuml-edit-source').count()) !== 0 ||
    (await page.locator('.lm-plantuml-delete').count()) !== 0
  ) {
    throw new Error('Reading mode still exposed PlantUML Edit/Delete controls.');
  }
  const expandButton = page.getByRole('button', {
    name: /^(?:展开查看|Expand preview)$/,
  }).first();
  await expandButton.waitFor({ state: 'visible', timeout: 10_000 });
  await clickLocatorWithWin32(expandButton, 'expand-plantuml');
  await page.locator('.lm-media-viewer-dialog svg').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  const viewerClose = page
    .locator('.lm-media-viewer-dialog')
    .getByRole('button', { name: /^(?:关闭|Close)$/ })
    .first();
  await clickLocatorWithWin32(viewerClose, 'close-plantuml-viewer');
  await page.locator('.lm-media-viewer-dialog').waitFor({
    state: 'hidden',
    timeout: 10_000,
  });

  const themeMenu = page.getByRole('menuitem', {
    exact: true,
    name: /^(?:主题|Theme)$/,
  });
  await clickLocatorWithWin32(themeMenu, 'open-theme-menu');
  const darkThemeItem = page.getByRole('menuitemradio', {
    name: /^(?:深色|Dark)/,
  });
  await clickLocatorWithWin32(darkThemeItem, 'set-dark-theme');
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'dark',
    undefined,
    { timeout: 10_000 },
  );
  await acceptanceDelay(500);
  const darkSvg = await page.evaluate(() => {
    const svg = document.querySelector('.lm-plantuml-preview[data-status="success"] svg');
    return svg?.outerHTML ?? '';
  });
  if (!darkSvg.includes('svg')) {
    throw new Error('Dark theme did not keep a rendered PlantUML SVG.');
  }

  const errorText = await page.locator('.lm-plantuml-error').first().textContent();
  if (
    !errorText ||
    !/PlantUML render failed|PlantUML 渲染失败/u.test(errorText) ||
    /[A-Za-z]:\\|\\\\|src-tauri|plantuml\.jar/u.test(errorText)
  ) {
    throw new Error(`PlantUML error leaked a backend path or was not localized: ${errorText}`);
  }

  invokeWin32('Save');
  const savedMarkdown = await waitForExactFile(
    documentPath,
    initialMarkdown,
    acceptanceDelay,
  );
  evidence.savedMarkdownExact = savedMarkdown === initialMarkdown;
  if (!evidence.savedMarkdownExact) {
    throw new Error(
      `Saved Markdown differs from the original PlantUML document.\nExpected:\n${initialMarkdown}\nActual:\n${savedMarkdown}`,
    );
  }

  evidence.featureObservations = {
    darkSvgPresent: darkSvg.includes('svg'),
    errorLocalized: true,
    readingControlsHidden: true,
    remoteRequests: remoteRequests.length,
    sourceUnchanged: true,
    undoRestoredSource: true,
  };
}

async function clickLocatorWithWin32(locator, label, { xRatio = 0.5 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`${label} has no usable WebView bounding box.`);
  }
  const viewport = await page.evaluate(() => ({
    dpr: window.devicePixelRatio,
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  const result = invokeWin32('Click', {
    cssX: box.x + box.width * xRatio,
    cssY: box.y + box.height / 2,
    dpr: viewport.dpr,
    label,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  });
  evidence.actions.push({ ...result, label });
  return result;
}

async function readRootState() {
  return page.evaluate(() => {
    const content = document.querySelector(
      '.cm-editor.lm-editor-live-preview-mode > .cm-scroller > .cm-content, .cm-editor.lm-editor-reading-mode > .cm-scroller > .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve the root CodeMirror EditorView.');
    }
    return {
      hasFocus: view.hasFocus,
      readOnly: view.state.readOnly,
      selection: view.state.selection.toJSON(),
      source: view.state.doc.toString(),
    };
  });
}

function invokeWin32(action, options = {}) {
  acceptanceAbort.signal.throwIfAborted();
  if (!app?.pid || !win32HelperPath) {
    throw new Error('Win32 input requested before the installed app started.');
  }
  const payload = options.text
    ? Buffer.from(options.text, 'utf16le').toString('base64')
    : '';
  const stdout = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      win32HelperPath,
      '-TargetProcessId',
      String(app.pid),
      '-Action',
      action,
      '-CssX',
      String(options.cssX ?? 0),
      '-CssY',
      String(options.cssY ?? 0),
      '-Dpr',
      String(options.dpr ?? 1),
      '-WheelDelta',
      '0',
      '-Payload',
      payload,
      '-Width',
      '0',
      '-Height',
      '0',
      '-DeadlineUnixMilliseconds',
      String(acceptanceDeadline),
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  ).trim();
  const parsed = JSON.parse(stdout);
  if (parsed.processId !== app.pid || parsed.action !== action) {
    throw new Error(`Win32 helper returned mismatched ownership: ${stdout}`);
  }
  if (
    action === 'Click' &&
    (parsed.targetVerifiedBeforeInput !== true ||
      parsed.pointIsInTargetWindow !== true)
  ) {
    throw new Error(
      `OS pointer was not verified over the spawned LumaMark window: ${stdout}`,
    );
  }
  if (parsed.perMonitorV2 !== true || !Number.isFinite(parsed.dpi)) {
    throw new Error(`Win32 helper is not per-monitor-v2 DPI aware: ${stdout}`);
  }
  if (options.dpr !== undefined) {
    const dpiScale = parsed.dpi / 96;
    if (Math.abs(dpiScale - options.dpr) > 0.05) {
      throw new Error(
        `WebView DPR and Win32 DPI disagree: ${JSON.stringify({ options, parsed })}`,
      );
    }
  }
  if (
    options.viewportWidth !== undefined &&
    options.viewportHeight !== undefined
  ) {
    const expectedWidth = options.viewportWidth * options.dpr;
    const expectedHeight = options.viewportHeight * options.dpr;
    if (
      Math.abs(parsed.clientSize.width - expectedWidth) > 2 ||
      Math.abs(parsed.clientSize.height - expectedHeight) > 2
    ) {
      throw new Error(
        `WebView viewport and Win32 client size disagree: ${JSON.stringify({ options, parsed })}`,
      );
    }
  }
  if (
    ['Click', 'Unicode', 'Save', 'Undo'].includes(action) &&
    parsed.foregroundProcessId !== app.pid
  ) {
    throw new Error(`Foreground window is not owned by spawned PID: ${stdout}`);
  }
  evidence.actions.push({ ...parsed, label: options.label ?? action });
  return parsed;
}

async function waitForDebugEndpoint(debugPort, getStartError) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    acceptanceAbort.signal.throwIfAborted();
    const startError = getStartError();
    if (startError) {
      throw new Error(`Unable to start installed LumaMark: ${startError.message}`);
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
      // The isolated WebView2 debugging endpoint starts asynchronously.
    }
    await acceptanceDelay(500);
  }
  throw new Error(
    `WebView2 debug endpoint did not open. stdout=${processOutput.stdout.join('')} stderr=${processOutput.stderr.join('')}`,
  );
}

async function waitForExactFile(path, expected, wait) {
  let actual = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    actual = await readFile(path, 'utf8');
    if (actual === expected) {
      return actual;
    }
    await wait(100);
  }
  return actual;
}

async function captureScreenshot(label) {
  if (!page) {
    return;
  }
  try {
    evidence.screenshot = await page.screenshot({
      path: join(tmpdir(), `installed-plantuml-os-${label}-${Date.now()}.png`),
      type: 'png',
    });
  } catch {
    evidence.screenshot = null;
  }
}

function isRemoteRequest(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname !== 'localhost' &&
      parsed.hostname !== '127.0.0.1' &&
      parsed.hostname !== 'tauri.localhost'
    );
  } catch {
    return true;
  }
}

function acceptanceDelay(milliseconds) {
  return delay(milliseconds, undefined, { signal: acceptanceAbort.signal });
}

async function withTimeout(promise, milliseconds, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds} ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function terminateProcessTree(processId) {
  execFileSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function isProcessRunning(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function parseRequestedPort(value) {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return Number(value);
}

function failFast(message) {
  process.stderr.write(`[${acceptanceName}] ${message}\n`);
  process.exit(1);
}
