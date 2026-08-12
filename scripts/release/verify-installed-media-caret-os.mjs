/**
 * Installed Windows acceptance for media block click -> caret geometry.
 *
 * Playwright/CDP is observation-only in this script. Every pointer, wheel,
 * text-input, save-shortcut, and window-resize action crosses the Win32
 * boundary and is delivered with SendInput to the window owned by app.pid.
 */
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const helperOutputArgument = process.argv.indexOf('--write-win32-helper');
if (helperOutputArgument >= 0) {
  const helperOutputPath = process.argv[helperOutputArgument + 1];
  if (!helperOutputPath) {
    throw new Error('--write-win32-helper requires an output path.');
  }
  await writeFile(helperOutputPath, getWin32HelperSource(), 'ascii');
  process.exit(0);
}

const lineNames = {
  beforeMedia: 'media before line',
  afterImage: 'image after line',
  afterMermaid: 'mermaid after line',
  eof: 'document eof line',
};
const markers = {
  beforeMedia: '甲',
  afterImage: '乙',
  afterMermaid: '丙',
  eof: '丁',
  afterWideResize: '宽',
  afterScrollBack: '回',
};
const imageSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="640">',
  '<rect width="1600" height="640" fill="#3f7fbc"/>',
  '<circle cx="400" cy="320" r="192" fill="#d9edff"/>',
  '</svg>',
].join('');
const imageUrl = `data:image/svg+xml;base64,${Buffer.from(imageSvg).toString('base64')}`;
const initialMarkdown = [
  lineNames.beforeMedia,
  '',
  `![geometry probe](${imageUrl})`,
  '',
  lineNames.afterImage,
  '',
  '```mermaid',
  'flowchart TD',
  '  A0 --> A1',
  '  A1 --> A2',
  '  A2 --> A3',
  '  A3 --> A4',
  '  A4 --> A5',
  '  A5 --> A6',
  '  A6 --> A7',
  '```',
  '',
  lineNames.afterMermaid,
  '',
  ...Array.from({ length: 36 }, (_, index) => `tail filler ${index + 1}`),
  '',
  lineNames.eof,
].join('\n');

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:installed-media-caret-os] Windows and a real installed executable are required.\n',
  );
  process.exit(1);
}

const executableEnvironment = process.env.LUMAMARK_EXECUTABLE?.trim();
if (!executableEnvironment) {
  process.stderr.write(
    '[release:installed-media-caret-os] LUMAMARK_EXECUTABLE must point to the freshly installed lumamark.exe.\n',
  );
  process.exit(1);
}

const executablePath = resolve(executableEnvironment);
const processOutput = { stderr: [], stdout: [] };
const evidence = {
  actions: [],
  executablePath,
  geometry: [],
  memoryMarkdownExact: false,
  pid: null,
  savedMarkdownExact: false,
  screenshot: null,
  win32: {
    clientToScreen: true,
    dpiAware: false,
    pidBoundMainWindow: true,
    sendInput: true,
    virtualScreen: true,
  },
};

let app;
let appExit;
let appStartError;
let browser;
let documentPath;
let expectedMarkdown = initialMarkdown;
let page;
let successOutput;
let tempDirectory;
let win32HelperPath;
const acceptanceAbort = new AbortController();
const acceptanceDeadline = Date.now() + 240_000;
const acceptanceWatchdogFailure = new Promise((_, reject) => {
  acceptanceAbort.signal.addEventListener(
    'abort',
    () => reject(acceptanceAbort.signal.reason),
    { once: true },
  );
});
const acceptanceWatchdog = setTimeout(() => {
  evidence.watchdogExpired = true;
  acceptanceAbort.abort(
    new Error(
      '[release:installed-media-caret-os] Global watchdog expired after 240 seconds.',
    ),
  );
}, Math.max(0, acceptanceDeadline - Date.now()));

async function runAcceptance() {
  await access(executablePath);
  acceptanceAbort.signal.throwIfAborted();
  const executableStats = await stat(executablePath);
  acceptanceAbort.signal.throwIfAborted();
  evidence.executable = {
    modifiedAt: executableStats.mtime.toISOString(),
    size: executableStats.size,
  };

  const port = await reserveDebugPort(
    parseRequestedPort(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT),
  );
  acceptanceAbort.signal.throwIfAborted();
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-installed-media-os-'));
  acceptanceAbort.signal.throwIfAborted();
  documentPath = join(tempDirectory, 'installed-media-caret.md');
  win32HelperPath = join(tempDirectory, 'lumamark-win32-input.ps1');
  await Promise.all([
    writeFile(documentPath, initialMarkdown, 'utf8'),
    writeFile(win32HelperPath, getWin32HelperSource(), 'ascii'),
  ]);
  acceptanceAbort.signal.throwIfAborted();

  acceptanceAbort.signal.throwIfAborted();
  app = spawn(executablePath, [documentPath], {
    cwd: tempDirectory,
    env: createPackagedWebviewEnvironment({
      baseEnvironment: process.env,
      debugPort: port,
      tempDirectory,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  evidence.pid = app.pid;
  appExit = new Promise((resolveExit) => {
    app.once('exit', resolveExit);
    app.once('error', (error) => {
      appStartError = error;
      resolveExit();
    });
  });
  app.stdout?.on('data', (chunk) => {
    processOutput.stdout.push(chunk.toString());
  });
  app.stderr?.on('data', (chunk) => {
    processOutput.stderr.push(chunk.toString());
  });

  await waitForDebugEndpoint(port, () => appStartError);
  acceptanceAbort.signal.throwIfAborted();
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  acceptanceAbort.signal.throwIfAborted();
  const context = browser.contexts()[0];
  page =
    context.pages()[0] ??
    (await context.waitForEvent('page', { timeout: 5_000 }));
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lm-editor-title', { hasText: basename(documentPath) }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await page.locator('.lm-editor-live-preview-mode .cm-content').waitFor({
    state: 'visible',
    timeout: 20_000,
  });

  const inputProbe = invokeWin32('Probe');
  evidence.actions.push({ ...inputProbe, action: 'probe' });
  const resizeDpr = await page.evaluate(() => window.devicePixelRatio);

  await waitForLineVisible(lineNames.beforeMedia, -720);
  await insertMarkerAtLine(lineNames.beforeMedia, markers.beforeMedia, 'before-media');

  const narrowResizeEvidence = invokeWin32('Resize', {
    dpr: resizeDpr,
    height: 720,
    width: 620,
  });
  evidence.actions.push({
    ...narrowResizeEvidence,
    action: 'resize',
    phase: 'narrow',
  });
  await acceptanceDelay(600);

  await waitForLineVisible(lineNames.afterImage, -720);
  await waitForImageReady();
  evidence.imageChrome = await readImageChrome();
  assertZeroVerticalChrome('image', evidence.imageChrome);
  const narrowLayout = await readResponsiveMediaLayout();
  await insertMarkerAtLine(lineNames.afterImage, markers.afterImage, 'after-image');

  await waitForLineVisible(lineNames.afterMermaid, -720);
  await waitForMermaidReady();
  evidence.mermaidChrome = await readMermaidChrome();
  assertZeroVerticalChrome('mermaid', evidence.mermaidChrome);
  assertNoInnerClipping(evidence.mermaidChrome);
  await insertMarkerAtLine(
    lineNames.afterMermaid,
    markers.afterMermaid,
    'after-mermaid',
  );

  const wideResizeEvidence = invokeWin32('Resize', {
    dpr: resizeDpr,
    height: 720,
    width: 1120,
  });
  evidence.actions.push({
    ...wideResizeEvidence,
    action: 'resize',
    phase: 'wide',
  });
  await acceptanceDelay(600);
  await waitForLineVisible(lineNames.afterImage, 720);
  await waitForImageReady();
  const wideLayout = await readResponsiveMediaLayout();
  assertResponsiveResize(narrowLayout, wideLayout);
  evidence.responsiveResize = { narrow: narrowLayout, wide: wideLayout };
  await insertMarkerAtLine(
    lineNames.afterImage,
    markers.afterWideResize,
    'after-wide-resize',
  );

  await waitForLineVisible(lineNames.eof, -720);
  await insertMarkerAtLine(lineNames.eof, markers.eof, 'document-eof');

  // Return through the already-resized and asynchronously measured widgets.
  // This verifies that the same line maps correctly after both scroll directions.
  await waitForLineVisible(lineNames.afterMermaid, 720);
  await waitForMermaidReady();
  await insertMarkerAtLine(
    lineNames.afterMermaid,
    markers.afterScrollBack,
    'after-scroll-back',
  );

  const wheelDirections = new Set(
    evidence.actions
      .filter((action) => action.action === 'wheel')
      .map((action) => action.direction),
  );
  if (!wheelDirections.has('down') || !wheelDirections.has('up')) {
    throw new Error(
      `The installed media matrix did not exercise OS wheel input in both directions: ${JSON.stringify([...wheelDirections])}`,
    );
  }

  const finalState = await readEditorState();
  if (finalState.source !== expectedMarkdown) {
    throw new Error(
      `In-memory Markdown differs from exact expected source.\nExpected:\n${expectedMarkdown}\nActual:\n${finalState.source}`,
    );
  }
  evidence.memoryMarkdownExact = true;

  const saveEvidence = invokeWin32('Save');
  evidence.actions.push({ ...saveEvidence, action: 'save' });
  await waitForSavedStatus();
  const savedMarkdown = await waitForExactSavedMarkdown();
  if (savedMarkdown !== expectedMarkdown) {
    throw new Error(
      `Saved Markdown differs from exact expected source.\nExpected:\n${expectedMarkdown}\nActual:\n${savedMarkdown}`,
    );
  }
  evidence.savedMarkdownExact = true;
  evidence.finalSelection = (await readEditorState()).selection;

  successOutput = { installedMediaCaretOs: true, ...evidence };
}

const runAcceptancePromise = runAcceptance();
try {
  await Promise.race([runAcceptancePromise, acceptanceWatchdogFailure]);
} catch (error) {
  const failureState = evidence.watchdogExpired
    ? { observationSkipped: 'Global watchdog expired.' }
    : await withTimeout(
        collectFailureState(),
        5_000,
        'Failure-state observation',
      ).catch((observationError) => ({
        observationError: String(observationError),
      }));
  if (page && !evidence.watchdogExpired) {
    const screenshotDirectory = join(process.cwd(), 'test-results');
    await mkdir(screenshotDirectory, { recursive: true }).catch(() => {});
    const screenshotPath = join(
      screenshotDirectory,
      `installed-media-caret-os-${Date.now()}.png`,
    );
    try {
      await withTimeout(
        page.screenshot({ fullPage: true, path: screenshotPath }),
        5_000,
        'Failure screenshot',
      );
      evidence.screenshot = screenshotPath;
    } catch (screenshotError) {
      evidence.screenshotError = String(screenshotError);
    }
  }
  process.stderr.write(
    [
      '[release:installed-media-caret-os] FAILED',
      error instanceof Error ? error.stack ?? error.message : String(error),
      JSON.stringify(
        {
          ...evidence,
          failureState,
          processOutput,
        },
        null,
        2,
      ),
    ].join('\n'),
  );
  process.stderr.write('\n');
  process.exitCode = 1;
} finally {
  clearTimeout(acceptanceWatchdog);
  const cleanupFailures = [];
  if (app?.pid && app.exitCode === null) {
    try {
      terminateProcessTree(app.pid);
    } catch (error) {
      if (isProcessRunning(app.pid)) {
        cleanupFailures.push(`process tree termination: ${String(error)}`);
      }
    }
    if (appExit) {
      await Promise.race([appExit, delay(5_000)]);
    }
    if (app.exitCode === null && isProcessRunning(app.pid)) {
      cleanupFailures.push(`spawned process ${app.pid} did not exit`);
    }
  }
  await awaitRunAcceptanceShutdown(runAcceptancePromise, cleanupFailures);
  if (browser) {
    try {
      await Promise.race([
        browser.close(),
        delay(5_000).then(() => {
          throw new Error('CDP browser.close exceeded 5 seconds.');
        }),
      ]);
    } catch (error) {
      cleanupFailures.push(`CDP close: ${String(error)}`);
    }
  }
  if (tempDirectory) {
    try {
      await removePackagedWebviewTempDirectory(tempDirectory);
    } catch (error) {
      cleanupFailures.push(`temporary directory removal: ${String(error)}`);
    }
  }
  if (cleanupFailures.length > 0) {
    process.stderr.write(
      `[release:installed-media-caret-os] Cleanup failed:\n${cleanupFailures.join('\n')}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  successOutput &&
  !evidence.watchdogExpired &&
  process.exitCode !== 1
) {
  process.stdout.write(`${JSON.stringify(successOutput, null, 2)}\n`);
}

function acceptanceDelay(milliseconds) {
  return delay(milliseconds, undefined, { signal: acceptanceAbort.signal });
}

async function awaitRunAcceptanceShutdown(runPromise, cleanupFailures) {
  if (!evidence.watchdogExpired) {
    return;
  }
  try {
    await withTimeout(
      runPromise.catch(() => undefined),
      10_000,
      'Aborted acceptance shutdown',
    );
  } catch (error) {
    cleanupFailures.push(`acceptance shutdown: ${String(error)}`);
  }
}

async function withTimeout(promise, milliseconds, label) {
  let timeout;
  const timeoutFailure = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} exceeded ${milliseconds} ms.`));
    }, milliseconds);
  });
  try {
    return await Promise.race([promise, timeoutFailure]);
  } finally {
    clearTimeout(timeout);
  }
}

async function insertMarkerAtLine(lineName, marker, phase) {
  const probe = await waitForStableGeometry(lineName);
  const clickEvidence = invokeWin32('Click', {
    cssX: probe.click.x,
    cssY: probe.click.y,
    dpr: probe.dpr,
    viewportHeight: probe.viewportHeight,
    viewportWidth: probe.viewportWidth,
  });
  evidence.actions.push({
    ...clickEvidence,
    action: 'click',
    expectedPosition: probe.from,
    lineName,
    phase,
  });

  await page.waitForFunction(
    ({ expectedPosition }) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      return view?.state.selection.main.head === expectedPosition;
    },
    { expectedPosition: probe.from },
    { timeout: 5_000 },
  );

  const typeEvidence = invokeWin32('Unicode', { text: marker });
  evidence.actions.push({ ...typeEvidence, action: 'unicode', marker, phase });
  expectedMarkdown = `${expectedMarkdown.slice(0, probe.from)}${marker}${expectedMarkdown.slice(probe.from)}`;

  await page.waitForFunction(
    ({ expectedPosition, marker, source }) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      return (
        view?.state.selection.main.head === expectedPosition + marker.length &&
        view?.state.doc.toString() === source
      );
    },
    { expectedPosition: probe.from, marker, source: expectedMarkdown },
    { timeout: 5_000 },
  );
  evidence.geometry.push({ ...probe, marker, phase });
}

async function waitForStableGeometry(lineName) {
  let latest;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    latest = await probeLine(lineName);
    if (
      latest.visible &&
      Number.isFinite(latest.drift) &&
      Math.abs(latest.drift) <= 0.75 &&
      Math.abs(latest.heightDrift) <= 2 &&
      latest.posAtCoords === latest.from
    ) {
      return latest;
    }
    await acceptanceDelay(150);
  }
  throw new Error(
    `CodeMirror geometry did not settle for "${lineName}": ${JSON.stringify(latest)}`,
  );
}

async function probeLine(lineName) {
  return page.evaluate((name) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve live-preview EditorView.');
    }
    const source = view.state.doc.toString();
    const nameIndex = source.indexOf(name);
    if (nameIndex < 0) {
      throw new Error(`Missing source line: ${name}`);
    }
    const line = view.state.doc.lineAt(nameIndex);
    const lineElement = [...view.contentDOM.querySelectorAll('.cm-line')].find(
      (node) => node.textContent?.endsWith(name),
    );
    const contentRect = view.contentDOM.getBoundingClientRect();
    const docTop = contentRect.top + view.viewState.paddingTop;
    const heightDrift =
      contentRect.height -
      view.viewState.paddingTop -
      view.viewState.paddingBottom -
      view.viewState.docHeight;
    if (!(lineElement instanceof HTMLElement)) {
      return {
        dpr: window.devicePixelRatio,
        from: line.from,
        heightDrift,
        lineName: name,
        scrollTop: view.scrollDOM.scrollTop,
        visible: false,
      };
    }
    const rect = lineElement.getBoundingClientRect();
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const targetPosition = name === 'media before line' ? line.to : line.from;
    const caret =
      view.coordsAtPos(targetPosition, targetPosition === line.to ? -1 : 1) ??
      view.coordsAtPos(targetPosition);
    if (!caret) {
      throw new Error(`No caret coordinates for source line: ${name}`);
    }
    const click = {
      x: caret.left + (targetPosition === line.to ? -0.25 : 0.25),
      y: rect.top + rect.height / 2,
    };
    const posAtCoords = view.posAtCoords(click);
    const block = view.lineBlockAt(line.from);
    return {
      blockTop: block.top,
      click,
      docTop,
      dpr: window.devicePixelRatio,
      drift: rect.top - docTop - block.top,
      from: targetPosition,
      heightDrift,
      lineName: name,
      lineRect: {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
      },
      posAtCoords,
      scrollTop: view.scrollDOM.scrollTop,
      selection: view.state.selection.toJSON(),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      visible:
        rect.bottom > scrollerRect.top + 2 &&
        rect.top < scrollerRect.bottom - 2,
    };
  }, lineName);
}

async function waitForLineVisible(lineName, wheelDelta) {
  let latest;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    latest = await probeLine(lineName);
    if (latest.visible) {
      return latest;
    }
    const pointer = await readEditorPointer();
    const wheelEvidence = invokeWin32('Wheel', {
      cssX: pointer.x,
      cssY: pointer.y,
      dpr: pointer.dpr,
      viewportHeight: pointer.viewportHeight,
      viewportWidth: pointer.viewportWidth,
      wheelDelta,
    });
    evidence.actions.push({
      ...wheelEvidence,
      action: 'wheel',
      direction: wheelDelta < 0 ? 'down' : 'up',
      lineName,
    });
    await acceptanceDelay(180);
  }
  throw new Error(
    `OS wheel did not reveal "${lineName}": ${JSON.stringify(latest)}`,
  );
}

async function readEditorPointer() {
  return page.evaluate(() => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve live-preview EditorView.');
    }
    const rect = view.scrollDOM.getBoundingClientRect();
    return {
      dpr: window.devicePixelRatio,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      x: rect.left + rect.width / 2,
      y: rect.top + Math.min(rect.height - 8, Math.max(8, rect.height / 2)),
    };
  });
}

async function waitForImageReady() {
  await page.waitForFunction(() => {
    const image = document.querySelector('.lm-image-preview img');
    return image instanceof HTMLImageElement && image.complete && image.naturalHeight > 0;
  }, undefined, { timeout: 20_000 });
}

async function waitForMermaidReady() {
  await page.waitForFunction(() => {
    const mermaid = document.querySelector('.lm-mermaid-preview');
    return mermaid?.getAttribute('data-status') === 'success';
  }, undefined, { timeout: 30_000 });
}

async function readImageChrome() {
  return page.evaluate(() => {
    const root = document.querySelector('.lm-image-preview');
    if (!(root instanceof HTMLElement)) {
      throw new Error('Image widget is not mounted.');
    }
    const style = getComputedStyle(root);
    return {
      marginBottom: style.marginBottom,
      marginTop: style.marginTop,
      paddingBottom: style.paddingBottom,
      paddingTop: style.paddingTop,
    };
  });
}

async function readMermaidChrome() {
  return page.evaluate(() => {
    const root = document.querySelector('.lm-mermaid-preview');
    const svg = root?.querySelector('.lm-mermaid-svg');
    if (!(root instanceof HTMLElement) || !(svg instanceof HTMLElement)) {
      throw new Error('Mermaid widget is not mounted.');
    }
    const rootStyle = getComputedStyle(root);
    const svgStyle = getComputedStyle(svg);
    return {
      marginBottom: rootStyle.marginBottom,
      marginTop: rootStyle.marginTop,
      overflow: rootStyle.overflow,
      paddingBottom: rootStyle.paddingBottom,
      paddingTop: rootStyle.paddingTop,
      svgOverflow: svgStyle.overflow,
      svgPaddingBottom: svgStyle.paddingBottom,
      svgPaddingTop: svgStyle.paddingTop,
    };
  });
}

async function readResponsiveMediaLayout() {
  return page.evaluate(() => {
    const image = document.querySelector('.lm-image-preview');
    if (!(image instanceof HTMLElement)) {
      throw new Error('Responsive image widget is not mounted.');
    }
    const imageRect = image.getBoundingClientRect();
    return {
      dpr: window.devicePixelRatio,
      imageHeight: imageRect.height,
      imageWidth: imageRect.width,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
}

function assertResponsiveResize(narrow, wide) {
  if (
    !Number.isFinite(narrow.viewportWidth) ||
    !Number.isFinite(wide.viewportWidth) ||
    wide.viewportWidth < narrow.viewportWidth + 150
  ) {
    throw new Error(
      `Native resize did not materially change the WebView viewport: ${JSON.stringify({ narrow, wide })}`,
    );
  }
  if (
    !Number.isFinite(narrow.imageHeight) ||
    !Number.isFinite(wide.imageHeight) ||
    wide.imageHeight < narrow.imageHeight + 40
  ) {
    throw new Error(
      `Native resize did not materially change responsive image height: ${JSON.stringify({ narrow, wide })}`,
    );
  }
}

function assertZeroVerticalChrome(kind, chrome) {
  for (const property of [
    'marginBottom',
    'marginTop',
    'paddingBottom',
    'paddingTop',
  ]) {
    if (chrome[property] !== '0px') {
      throw new Error(
        `${kind} widget invents vertical ${property}: ${JSON.stringify(chrome)}`,
      );
    }
  }
}

function assertNoInnerClipping(chrome) {
  const safeOverflow = new Set(['visible', 'clip visible', 'visible clip']);
  if (!safeOverflow.has(chrome.overflow) || !safeOverflow.has(chrome.svgOverflow)) {
    throw new Error(`Mermaid widget clips or scrolls internally: ${JSON.stringify(chrome)}`);
  }
  if (chrome.svgPaddingTop !== '0px' || chrome.svgPaddingBottom !== '0px') {
    throw new Error(`Mermaid SVG invents vertical padding: ${JSON.stringify(chrome)}`);
  }
}

async function readEditorState() {
  return page.evaluate(() => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve live-preview EditorView.');
    }
    return {
      scrollTop: view.scrollDOM.scrollTop,
      selection: view.state.selection.toJSON(),
      source: view.state.doc.toString(),
    };
  });
}

async function waitForSavedStatus() {
  await page.waitForFunction(() => {
    const status = document.querySelector('[role="status"]')?.textContent ?? '';
    const title = document.querySelector('.lm-editor-title')?.textContent ?? '';
    return /Saved|已保存/.test(status) && !title.includes('*');
  }, undefined, { timeout: 15_000 });
}

async function waitForExactSavedMarkdown() {
  let saved = '';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    saved = await readFile(documentPath, 'utf8');
    if (saved === expectedMarkdown) {
      return saved;
    }
    await acceptanceDelay(100);
  }
  return saved;
}

async function collectFailureState() {
  if (!page) {
    return null;
  }
  return page
    .evaluate((names) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      if (!view) {
        return { dpr: window.devicePixelRatio, editorFound: false };
      }
      const contentRect = view.contentDOM.getBoundingClientRect();
      const docTop = contentRect.top + view.viewState.paddingTop;
      const rows = Object.values(names).map((name) => {
        const index = view.state.doc.toString().indexOf(name);
        if (index < 0) {
          return { name, sourceFound: false };
        }
        const line = view.state.doc.lineAt(index);
        const element = [...view.contentDOM.querySelectorAll('.cm-line')].find(
          (node) => node.textContent?.endsWith(name),
        );
        if (!(element instanceof HTMLElement)) {
          return { from: line.from, name, sourceFound: true, visible: false };
        }
        const rect = element.getBoundingClientRect();
        const block = view.lineBlockAt(line.from);
        return {
          drift: rect.top - docTop - block.top,
          from: line.from,
          name,
          posAtCoords: view.posAtCoords({
            x: rect.left + 0.25,
            y: rect.top + rect.height / 2,
          }),
          sourceFound: true,
          visible: true,
        };
      });
      return {
        docHeight: view.viewState.docHeight,
        dpr: window.devicePixelRatio,
        editorFound: true,
        rows,
        scrollTop: view.scrollDOM.scrollTop,
        selection: view.state.selection.toJSON(),
        source: view.state.doc.toString(),
      };
    }, lineNames)
    .catch((error) => ({ observationError: String(error) }));
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
      String(options.wheelDelta ?? 0),
      '-Payload',
      payload,
      '-Width',
      String(options.width ?? 0),
      '-Height',
      String(options.height ?? 0),
      '-DeadlineUnixMilliseconds',
      String(acceptanceDeadline),
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  ).trim();
  const parsed = JSON.parse(stdout);
  evidence.lastWin32Attempt = parsed;
  if (parsed.processId !== app.pid || parsed.action !== action) {
    throw new Error(`Win32 helper returned mismatched ownership: ${stdout}`);
  }
  if (
    (action === 'Click' || action === 'Wheel') &&
    parsed.targetVerifiedBeforeInput !== true
  ) {
    throw new Error(
      `OS pointer is not over the spawned LumaMark window; the interactive desktop may be locked or covered: ${stdout}`,
    );
  }
  if (parsed.perMonitorV2 !== true || !Number.isFinite(parsed.dpi)) {
    throw new Error(`Win32 helper is not per-monitor-v2 DPI aware: ${stdout}`);
  }
  evidence.win32.dpiAware = true;

  if (options.dpr !== undefined) {
    const dpiScale = parsed.dpi / 96;
    if (Math.abs(dpiScale - options.dpr) > 0.05) {
      throw new Error(
        `WebView DPR and Win32 window DPI disagree: ${JSON.stringify({ dpiScale, options, parsed })}`,
      );
    }
  }
  if (
    options.viewportWidth !== undefined &&
    options.viewportHeight !== undefined
  ) {
    const expectedClientWidth = options.viewportWidth * options.dpr;
    const expectedClientHeight = options.viewportHeight * options.dpr;
    if (
      Math.abs(parsed.clientSize.width - expectedClientWidth) > 2 ||
      Math.abs(parsed.clientSize.height - expectedClientHeight) > 2
    ) {
      throw new Error(
        `WebView viewport and Win32 client size disagree: ${JSON.stringify({ expectedClientHeight, expectedClientWidth, options, parsed })}`,
      );
    }
  }
  return parsed;
}

function terminateProcessTree(processId) {
  execFileSync(
    'taskkill.exe',
    ['/PID', String(processId), '/T', '/F'],
    { encoding: 'utf8', timeout: 15_000 },
  );
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

async function waitForDebugEndpoint(debugPort, getStartError) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const startError = getStartError();
    if (startError) {
      throw new Error(`Unable to start installed LumaMark: ${startError.message}`, {
        cause: startError,
      });
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // The installed WebView2 endpoint is expected to appear asynchronously.
    }
    await acceptanceDelay(500);
  }
  throw new Error(
    [
      `WebView2 debug endpoint did not open on port ${debugPort}.`,
      `stdout: ${processOutput.stdout.join('')}`,
      `stderr: ${processOutput.stderr.join('')}`,
    ].join('\n'),
  );
}

function getWin32HelperSource() {
  return String.raw`
param(
  [Parameter(Mandatory = $true)][int]$TargetProcessId,
  [Parameter(Mandatory = $true)]
  [ValidateSet('Probe', 'Click', 'Wheel', 'Unicode', 'Save', 'Resize')]
  [string]$Action,
  [double]$CssX = 0,
  [double]$CssY = 0,
  [double]$Dpr = 1,
  [int]$WheelDelta = 0,
  [string]$Payload = '',
  [int]$Width = 0,
  [int]$Height = 0,
  [long]$DeadlineUnixMilliseconds = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class LumaMarkWin32Input {
  public static bool TargetVerifiedBeforeInput { get; private set; }
  private static long DeadlineUnixMilliseconds;
  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  public const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_WHEEL = 0x0800;
  private const uint MOUSEEVENTF_MOVE = 0x0001;
  private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
  private const int SM_XVIRTUALSCREEN = 76;
  private const int SM_YVIRTUALSCREEN = 77;
  private const int SM_CXVIRTUALSCREEN = 78;
  private const int SM_CYVIRTUALSCREEN = 79;
  private const uint GA_ROOT = 2;
  private const uint DESKTOP_SWITCHDESKTOP = 0x0100;
  private const int WTS_CONNECT_STATE = 8;
  private const int WTS_ACTIVE = 0;
  private const int VK_LBUTTON = 0x01;
  private const int VK_SHIFT = 0x10;
  private const int VK_CONTROL = 0x11;
  private const int VK_MENU = 0x12;
  private const int VK_S = 0x53;
  private const int VK_LWIN = 0x5B;
  private const int VK_RWIN = 0x5C;
  private const uint SWP_NOMOVE = 0x0002;
  private const uint SWP_NOSIZE = 0x0001;
  private const uint SWP_NOZORDER = 0x0004;
  private const uint SWP_SHOWWINDOW = 0x0040;
  private const int SW_RESTORE = 9;
  private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

  public static void ConfigureDeadline(long deadlineUnixMilliseconds) {
    if (deadlineUnixMilliseconds <= 0) {
      throw new ArgumentOutOfRangeException(
        "deadlineUnixMilliseconds",
        "An absolute input deadline is required."
      );
    }
    DeadlineUnixMilliseconds = deadlineUnixMilliseconds;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
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
    public INPUTUNION data;
  }

  public sealed class WindowInfo {
    public long Hwnd { get; set; }
    public int ClientX { get; set; }
    public int ClientY { get; set; }
    public int ClientWidth { get; set; }
    public int ClientHeight { get; set; }
    public uint Dpi { get; set; }
    public bool PerMonitorV2 { get; set; }
    public int VirtualX { get; set; }
    public int VirtualY { get; set; }
    public int VirtualWidth { get; set; }
    public int VirtualHeight { get; set; }
  }

  private static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 =
    new IntPtr(-4);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

  [DllImport("user32.dll")]
  private static extern IntPtr GetThreadDpiAwarenessContext();

  [DllImport("user32.dll")]
  private static extern bool AreDpiAwarenessContextsEqual(
    IntPtr first,
    IntPtr second
  );

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetClientRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll")]
  private static extern uint GetDpiForWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern int GetSystemMetrics(int index);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, INPUT[] inputs, int size);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool ShowWindow(IntPtr hWnd, int command);

  [DllImport("user32.dll")]
  private static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);

  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  private static extern IntPtr WindowFromPoint(POINT point);

  [DllImport("user32.dll")]
  private static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);

  [DllImport("user32.dll")]
  private static extern bool IsChild(IntPtr parent, IntPtr child);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr OpenInputDesktop(
    uint flags,
    bool inherit,
    uint desiredAccess
  );

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SwitchDesktop(IntPtr desktop);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool CloseDesktop(IntPtr desktop);

  [DllImport("user32.dll")]
  private static extern short GetAsyncKeyState(int virtualKey);

  [DllImport("user32.dll")]
  private static extern bool GetCursorPos(out POINT point);

  [DllImport("Wtsapi32.dll", SetLastError = true)]
  private static extern bool WTSQuerySessionInformation(
    IntPtr server,
    int sessionId,
    int infoClass,
    out IntPtr buffer,
    out int bytesReturned
  );

  [DllImport("Wtsapi32.dll")]
  private static extern void WTSFreeMemory(IntPtr buffer);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetWindowPos(
    IntPtr hWnd,
    IntPtr insertAfter,
    int x,
    int y,
    int width,
    int height,
    uint flags
  );

  public static WindowInfo GetWindowInfo(int processId) {
    EnableDpiAwareness();
    IntPtr hwnd = WaitForMainWindow(processId);
    uint ownerProcess;
    GetWindowThreadProcessId(hwnd, out ownerProcess);
    if (ownerProcess != processId) {
      throw new InvalidOperationException(
        "MainWindowHandle belongs to process " + ownerProcess +
        ", expected " + processId + "."
      );
    }
    POINT origin = new POINT { X = 0, Y = 0 };
    if (!ClientToScreen(hwnd, ref origin)) {
      throw new InvalidOperationException(
        "ClientToScreen failed with Win32 error " + Marshal.GetLastWin32Error()
      );
    }
    RECT clientRect;
    if (!GetClientRect(hwnd, out clientRect)) {
      throw new InvalidOperationException(
        "GetClientRect failed with Win32 error " + Marshal.GetLastWin32Error()
      );
    }
    uint dpi = GetDpiForWindow(hwnd);
    if (dpi == 0) {
      throw new InvalidOperationException("GetDpiForWindow returned zero.");
    }
    int virtualWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    int virtualHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if (virtualWidth <= 0 || virtualHeight <= 0) {
      throw new InvalidOperationException("Virtual screen metrics are invalid.");
    }
    return new WindowInfo {
      Hwnd = hwnd.ToInt64(),
      ClientX = origin.X,
      ClientY = origin.Y,
      ClientWidth = clientRect.Right - clientRect.Left,
      ClientHeight = clientRect.Bottom - clientRect.Top,
      Dpi = dpi,
      PerMonitorV2 = IsPerMonitorV2(),
      VirtualX = GetSystemMetrics(SM_XVIRTUALSCREEN),
      VirtualY = GetSystemMetrics(SM_YVIRTUALSCREEN),
      VirtualWidth = virtualWidth,
      VirtualHeight = virtualHeight,
    };
  }

  public static void Probe(int processId) {
    EnableDpiAwareness();
    IntPtr hwnd = WaitForMainWindow(processId);
    EnsureInputReady(processId, hwnd);
    try {
      FocusTarget(processId, hwnd);
    } finally {
      RestoreZOrder(hwnd);
    }
  }

  public static int Click(int processId, double cssX, double cssY, double dpr) {
    WindowInfo info = GetWindowInfo(processId);
    IntPtr hwnd = new IntPtr(info.Hwnd);
    EnsureInputReady(processId, hwnd);
    try {
      FocusTarget(processId, hwnd);
      POINT absolute = ToAbsolutePoint(info, cssX, cssY, dpr);
      POINT physical = ToPhysicalPoint(info, cssX, cssY, dpr);
      MoveAndVerify(processId, hwnd, absolute, physical);
      EnsureInputReady(processId, hwnd);
      VerifyTargetForPoint(processId, hwnd, physical);
      INPUT[] inputs = new INPUT[] {
        Mouse(absolute.X, absolute.Y, 0, MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK),
        Mouse(absolute.X, absolute.Y, 0, MOUSEEVENTF_LEFTUP | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK),
      };
      SendExact(inputs, new INPUT[] { Mouse(0, 0, 0, MOUSEEVENTF_LEFTUP) });
      Thread.Sleep(100);
    } finally {
      RestoreZOrder(hwnd);
    }
    return 3;
  }

  public static int Wheel(
    int processId,
    double cssX,
    double cssY,
    double dpr,
    int wheelDelta
  ) {
    WindowInfo info = GetWindowInfo(processId);
    IntPtr hwnd = new IntPtr(info.Hwnd);
    EnsureInputReady(processId, hwnd);
    try {
      FocusTarget(processId, hwnd);
      POINT absolute = ToAbsolutePoint(info, cssX, cssY, dpr);
      POINT physical = ToPhysicalPoint(info, cssX, cssY, dpr);
      MoveAndVerify(processId, hwnd, absolute, physical);
      EnsureInputReady(processId, hwnd);
      VerifyTargetForPoint(processId, hwnd, physical);
      SendExact(
        new INPUT[] {
          Mouse(0, 0, unchecked((uint)wheelDelta), MOUSEEVENTF_WHEEL),
        },
        new INPUT[0]
      );
    } finally {
      RestoreZOrder(hwnd);
    }
    return 2;
  }

  public static int Unicode(int processId, string text) {
    IntPtr hwnd = WaitForMainWindow(processId);
    EnsureInputReady(processId, hwnd);
    List<INPUT> inputs = new List<INPUT>();
    List<INPUT> releases = new List<INPUT>();
    foreach (char character in text) {
      inputs.Add(Key(0, character, KEYEVENTF_UNICODE));
      inputs.Add(Key(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
      releases.Add(Key(0, character, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
    }
    INPUT[] array = inputs.ToArray();
    try {
      FocusTarget(processId, hwnd);
      EnsureInputReady(processId, hwnd);
      VerifyForegroundTarget(processId, hwnd);
      SendExact(array, releases.ToArray());
    } finally {
      RestoreZOrder(hwnd);
    }
    return array.Length;
  }

  public static int Save(int processId) {
    IntPtr hwnd = WaitForMainWindow(processId);
    EnsureInputReady(processId, hwnd);
    INPUT[] inputs = new INPUT[] {
      Key(0x11, (char)0, 0),
      Key(VK_S, (char)0, 0),
      Key(VK_S, (char)0, KEYEVENTF_KEYUP),
      Key(0x11, (char)0, KEYEVENTF_KEYUP),
    };
    try {
      FocusTarget(processId, hwnd);
      EnsureInputReady(processId, hwnd);
      VerifyForegroundTarget(processId, hwnd);
      SendExact(
        inputs,
        new INPUT[] {
          Key(VK_S, (char)0, KEYEVENTF_KEYUP),
          Key(0x11, (char)0, KEYEVENTF_KEYUP),
        }
      );
    } finally {
      RestoreZOrder(hwnd);
    }
    return inputs.Length;
  }

  public static void Resize(
    int processId,
    int width,
    int height,
    double dpr
  ) {
    IntPtr hwnd = WaitForMainWindow(processId);
    if (width <= 0 || height <= 0) {
      throw new ArgumentOutOfRangeException("width", "Resize dimensions must be positive.");
    }
    if (dpr <= 0 || Double.IsNaN(dpr) || Double.IsInfinity(dpr)) {
      throw new ArgumentOutOfRangeException("dpr", "DPR must be finite and positive.");
    }
    int physicalWidth = (int)Math.Round(width * dpr);
    int physicalHeight = (int)Math.Round(height * dpr);
    if (!SetWindowPos(
      hwnd,
      IntPtr.Zero,
      0,
      0,
      physicalWidth,
      physicalHeight,
      SWP_NOMOVE | SWP_NOZORDER
    )) {
      throw new InvalidOperationException(
        "SetWindowPos failed with Win32 error " + Marshal.GetLastWin32Error()
      );
    }
  }

  private static void EnableDpiAwareness() {
    SetThreadDpiAwarenessContext(DpiAwarenessContextPerMonitorAwareV2);
    if (!IsPerMonitorV2()) {
      throw new InvalidOperationException(
        "Unable to enter per-monitor-v2 DPI awareness; Win32 error " +
        Marshal.GetLastWin32Error()
      );
    }
  }

  private static bool IsPerMonitorV2() {
    return AreDpiAwarenessContextsEqual(
      GetThreadDpiAwarenessContext(),
      DpiAwarenessContextPerMonitorAwareV2
    );
  }

  private static IntPtr WaitForMainWindow(int processId) {
    Process process = Process.GetProcessById(processId);
    for (int attempt = 0; attempt < 100; attempt++) {
      if (process.HasExited) {
        throw new InvalidOperationException("Installed app exited before input delivery.");
      }
      process.Refresh();
      if (process.MainWindowHandle != IntPtr.Zero) {
        return process.MainWindowHandle;
      }
      Thread.Sleep(100);
    }
    throw new InvalidOperationException(
      "Spawned process " + processId + " has no MainWindowHandle."
    );
  }

  private static void EnsureInputReady(int processId, IntPtr hwnd) {
    Process target = Process.GetProcessById(processId);
    Process current = Process.GetCurrentProcess();
    if (target.SessionId != current.SessionId) {
      throw new InvalidOperationException(
        "Input helper session " + current.SessionId +
        " does not match target session " + target.SessionId + "."
      );
    }
    uint ownerProcess;
    GetWindowThreadProcessId(hwnd, out ownerProcess);
    if (ownerProcess != processId) {
      throw new InvalidOperationException(
        "Input target window belongs to process " + ownerProcess +
        ", expected " + processId + "."
      );
    }

    IntPtr stateBuffer;
    int stateBytes;
    if (!WTSQuerySessionInformation(
      IntPtr.Zero,
      target.SessionId,
      WTS_CONNECT_STATE,
      out stateBuffer,
      out stateBytes
    )) {
      throw new InvalidOperationException(
        "Unable to query Windows session state; Win32 error " +
        Marshal.GetLastWin32Error()
      );
    }
    try {
      if (stateBytes < sizeof(int) || Marshal.ReadInt32(stateBuffer) != WTS_ACTIVE) {
        throw new InvalidOperationException(
          "The Windows session is not active; unlock and reconnect before rerunning OS input acceptance."
        );
      }
    } finally {
      WTSFreeMemory(stateBuffer);
    }

    int foregroundProcessId = GetForegroundProcessId();
    string foregroundName = GetProcessName(foregroundProcessId);
    if (
      String.Equals(foregroundName, "LockApp", StringComparison.OrdinalIgnoreCase) ||
      String.Equals(foregroundName, "LogonUI", StringComparison.OrdinalIgnoreCase)
    ) {
      throw new InvalidOperationException(
        "The Windows interactive desktop is locked by " + foregroundName +
        "; unlock it before rerunning OS input acceptance."
      );
    }

    IntPtr inputDesktop = OpenInputDesktop(0, false, DESKTOP_SWITCHDESKTOP);
    if (inputDesktop == IntPtr.Zero) {
      throw new InvalidOperationException(
        "Unable to open the active input desktop; unlock Windows before rerunning OS input acceptance."
      );
    }
    try {
      if (!SwitchDesktop(inputDesktop)) {
        throw new InvalidOperationException(
          "The active input desktop is a secure or locked desktop; unlock Windows before rerunning OS input acceptance."
        );
      }
    } finally {
      CloseDesktop(inputDesktop);
    }

    EnsurePhysicalInputsReleased();
  }

  private static void EnsurePhysicalInputsReleased() {
    int[] keys = new int[] {
      VK_LBUTTON,
      VK_SHIFT,
      VK_CONTROL,
      VK_MENU,
      VK_S,
      VK_LWIN,
      VK_RWIN,
    };
    foreach (int key in keys) {
      if ((GetAsyncKeyState(key) & 0x8000) != 0) {
        throw new InvalidOperationException(
          "Physical input key " + key +
          " is currently pressed; release it before OS input acceptance."
        );
      }
    }
  }

  private static void FocusTarget(int processId, IntPtr hwnd) {
    RaiseForPointer(hwnd);
    int stableSamples = 0;
    for (int attempt = 0; attempt < 50; attempt++) {
      if (ForegroundBelongsToTarget(processId, hwnd)) {
        stableSamples++;
        if (stableSamples >= 2) {
          return;
        }
      } else {
        stableSamples = 0;
        BringWindowToTop(hwnd);
        SwitchToThisWindow(hwnd, true);
        SetForegroundWindow(hwnd);
      }
      Thread.Sleep(100);
    }
    int foregroundProcessId = GetForegroundProcessId();
    throw new InvalidOperationException(
      "Unable to focus the spawned LumaMark window without sending input; foreground process is " +
      foregroundProcessId + " (" + GetProcessName(foregroundProcessId) + ")."
    );
  }

  private static bool ForegroundBelongsToTarget(int processId, IntPtr hwnd) {
    IntPtr foreground = GetForegroundWindow();
    if (foreground == IntPtr.Zero) {
      return false;
    }
    if (foreground == hwnd || IsChild(hwnd, foreground)) {
      return true;
    }
    uint foregroundProcess;
    GetWindowThreadProcessId(foreground, out foregroundProcess);
    return foregroundProcess == processId;
  }

  private static void VerifyForegroundTarget(int processId, IntPtr hwnd) {
    if (!ForegroundBelongsToTarget(processId, hwnd)) {
      throw new InvalidOperationException(
        "Spawned LumaMark lost foreground ownership before SendInput."
      );
    }
  }

  private static void MoveAndVerify(
    int processId,
    IntPtr hwnd,
    POINT absolute,
    POINT physical
  ) {
    EnsureInputReady(processId, hwnd);
    VerifyForegroundTarget(processId, hwnd);
    SendExact(
      new INPUT[] {
        Mouse(
          absolute.X,
          absolute.Y,
          0,
          MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK
        ),
      },
      new INPUT[0]
    );
    Thread.Sleep(50);
    POINT cursor;
    if (!GetCursorPos(out cursor)) {
      throw new InvalidOperationException(
        "GetCursorPos failed with Win32 error " + Marshal.GetLastWin32Error()
      );
    }
    if (Math.Abs(cursor.X - physical.X) > 2 || Math.Abs(cursor.Y - physical.Y) > 2) {
      throw new InvalidOperationException(
        "SendInput cursor move landed at " + cursor.X + "," + cursor.Y +
        " instead of " + physical.X + "," + physical.Y + "."
      );
    }
    VerifyTargetForPoint(processId, hwnd, cursor);
  }

  private static void VerifyTargetForPoint(
    int processId,
    IntPtr hwnd,
    POINT point
  ) {
    VerifyForegroundTarget(processId, hwnd);
    if (!PointBelongsToTarget(hwnd, point)) {
      throw new InvalidOperationException(
        "The physical pointer is not over the spawned LumaMark window; no click or wheel input was sent."
      );
    }
    TargetVerifiedBeforeInput = true;
  }

  private static bool PointBelongsToTarget(IntPtr target, POINT point) {
    IntPtr hit = WindowFromPoint(point);
    return hit == target || IsChild(target, hit);
  }

  private static void RaiseForPointer(IntPtr hwnd) {
    ShowWindow(hwnd, SW_RESTORE);
    if (!SetWindowPos(
      hwnd,
      HWND_TOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
    )) {
      throw new InvalidOperationException(
        "Unable to raise MainWindowHandle; Win32 error " +
        Marshal.GetLastWin32Error()
      );
    }
    BringWindowToTop(hwnd);
    SwitchToThisWindow(hwnd, true);
    SetForegroundWindow(hwnd);
  }

  private static void RestoreZOrder(IntPtr hwnd) {
    SetWindowPos(
      hwnd,
      HWND_NOTOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
    );
  }

  public static int GetForegroundProcessId() {
    IntPtr foreground = GetForegroundWindow();
    if (foreground == IntPtr.Zero) {
      return 0;
    }
    uint foregroundProcess;
    GetWindowThreadProcessId(foreground, out foregroundProcess);
    return unchecked((int)foregroundProcess);
  }

  public static string GetProcessName(int processId) {
    if (processId <= 0) {
      return "";
    }
    try {
      return Process.GetProcessById(processId).ProcessName;
    } catch {
      return "";
    }
  }

  public static int GetPointRootProcessId(
    int processId,
    double cssX,
    double cssY,
    double dpr
  ) {
    WindowInfo info = GetWindowInfo(processId);
    POINT point = new POINT {
      X = (int)Math.Round(info.ClientX + cssX * dpr),
      Y = (int)Math.Round(info.ClientY + cssY * dpr),
    };
    IntPtr hit = WindowFromPoint(point);
    IntPtr root = hit == IntPtr.Zero ? IntPtr.Zero : GetAncestor(hit, GA_ROOT);
    if (root == IntPtr.Zero) {
      return 0;
    }
    uint rootProcess;
    GetWindowThreadProcessId(root, out rootProcess);
    return unchecked((int)rootProcess);
  }

  public static bool PointIsInTargetWindow(
    int processId,
    double cssX,
    double cssY,
    double dpr
  ) {
    WindowInfo info = GetWindowInfo(processId);
    POINT point = new POINT {
      X = (int)Math.Round(info.ClientX + cssX * dpr),
      Y = (int)Math.Round(info.ClientY + cssY * dpr),
    };
    IntPtr target = new IntPtr(info.Hwnd);
    IntPtr hit = WindowFromPoint(point);
    return hit == target || IsChild(target, hit);
  }

  private static POINT ToPhysicalPoint(
    WindowInfo info,
    double cssX,
    double cssY,
    double dpr
  ) {
    if (dpr <= 0 || Double.IsNaN(dpr) || Double.IsInfinity(dpr)) {
      throw new ArgumentOutOfRangeException("dpr", "DPR must be finite and positive.");
    }
    return new POINT {
      X = (int)Math.Round(info.ClientX + cssX * dpr),
      Y = (int)Math.Round(info.ClientY + cssY * dpr),
    };
  }

  private static POINT ToAbsolutePoint(
    WindowInfo info,
    double cssX,
    double cssY,
    double dpr
  ) {
    if (dpr <= 0 || Double.IsNaN(dpr) || Double.IsInfinity(dpr)) {
      throw new ArgumentOutOfRangeException("dpr", "DPR must be finite and positive.");
    }
    int screenX = (int)Math.Round(info.ClientX + cssX * dpr);
    int screenY = (int)Math.Round(info.ClientY + cssY * dpr);
    int normalizedX = Normalize(screenX, info.VirtualX, info.VirtualWidth);
    int normalizedY = Normalize(screenY, info.VirtualY, info.VirtualHeight);
    return new POINT { X = normalizedX, Y = normalizedY };
  }

  public static POINT GetPhysicalPoint(
    int processId,
    double cssX,
    double cssY,
    double dpr
  ) {
    WindowInfo info = GetWindowInfo(processId);
    return ToPhysicalPoint(info, cssX, cssY, dpr);
  }

  private static int Normalize(int value, int origin, int size) {
    double normalized = (value - origin) * 65535.0 / Math.Max(1, size - 1);
    return Math.Max(0, Math.Min(65535, (int)Math.Round(normalized)));
  }

  private static INPUT Mouse(int x, int y, uint data, uint flags) {
    return new INPUT {
      type = INPUT_MOUSE,
      data = new INPUTUNION {
        mi = new MOUSEINPUT {
          dx = x,
          dy = y,
          mouseData = data,
          dwFlags = flags,
          time = 0,
          dwExtraInfo = UIntPtr.Zero,
        },
      },
    };
  }

  private static INPUT Key(ushort virtualKey, char scan, uint flags) {
    return new INPUT {
      type = INPUT_KEYBOARD,
      data = new INPUTUNION {
        ki = new KEYBDINPUT {
          wVk = virtualKey,
          wScan = scan,
          dwFlags = flags,
          time = 0,
          dwExtraInfo = UIntPtr.Zero,
        },
      },
    };
  }

  private static void SendExact(INPUT[] inputs, INPUT[] emergencyReleases) {
    if (inputs.Length == 0) {
      return;
    }
    EnsureBeforeDeadline();
    uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
    if (sent != inputs.Length) {
      if (emergencyReleases.Length > 0) {
        SendInput(
          (uint)emergencyReleases.Length,
          emergencyReleases,
          Marshal.SizeOf(typeof(INPUT))
        );
      }
      throw new InvalidOperationException(
        "SendInput sent " + sent + " of " + inputs.Length +
        " events; Win32 error " + Marshal.GetLastWin32Error()
      );
    }
  }

  private static void EnsureBeforeDeadline() {
    if (
      DeadlineUnixMilliseconds <= 0 ||
      DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() >= DeadlineUnixMilliseconds
    ) {
      throw new InvalidOperationException(
        "The absolute OS input acceptance deadline expired before SendInput."
      );
    }
  }
}
'@

[LumaMarkWin32Input]::ConfigureDeadline($DeadlineUnixMilliseconds)
$info = [LumaMarkWin32Input]::GetWindowInfo($TargetProcessId)
$physical = [LumaMarkWin32Input]::GetPhysicalPoint(
  $TargetProcessId,
  $CssX,
  $CssY,
  $Dpr
)
$sent = 0

switch ($Action) {
  'Probe' {
    [LumaMarkWin32Input]::Probe($TargetProcessId)
  }
  'Click' {
    $sent = [LumaMarkWin32Input]::Click($TargetProcessId, $CssX, $CssY, $Dpr)
  }
  'Wheel' {
    $sent = [LumaMarkWin32Input]::Wheel(
      $TargetProcessId,
      $CssX,
      $CssY,
      $Dpr,
      $WheelDelta
    )
  }
  'Unicode' {
    $text = [Text.Encoding]::Unicode.GetString(
      [Convert]::FromBase64String($Payload)
    )
    $sent = [LumaMarkWin32Input]::Unicode($TargetProcessId, $text)
  }
  'Save' {
    $sent = [LumaMarkWin32Input]::Save($TargetProcessId)
  }
  'Resize' {
    [LumaMarkWin32Input]::Resize(
      $TargetProcessId,
      $Width,
      $Height,
      $Dpr
    )
  }
}

$foregroundProcessId = [LumaMarkWin32Input]::GetForegroundProcessId()
$pointRootProcessId = [LumaMarkWin32Input]::GetPointRootProcessId(
  $TargetProcessId,
  $CssX,
  $CssY,
  $Dpr
)

[ordered]@{
  action = $Action
  processId = $TargetProcessId
  hwnd = $info.Hwnd
  css = [ordered]@{ x = $CssX; y = $CssY }
  dpr = $Dpr
  clientOrigin = [ordered]@{ x = $info.ClientX; y = $info.ClientY }
  clientSize = [ordered]@{
    width = $info.ClientWidth
    height = $info.ClientHeight
  }
  dpi = $info.Dpi
  perMonitorV2 = $info.PerMonitorV2
  foregroundProcessId = $foregroundProcessId
  foregroundProcessName = [LumaMarkWin32Input]::GetProcessName($foregroundProcessId)
  pointRootProcessId = $pointRootProcessId
  pointRootProcessName = [LumaMarkWin32Input]::GetProcessName($pointRootProcessId)
  pointIsInTargetWindow = [LumaMarkWin32Input]::PointIsInTargetWindow(
    $TargetProcessId,
    $CssX,
    $CssY,
    $Dpr
  )
  targetVerifiedBeforeInput = [LumaMarkWin32Input]::TargetVerifiedBeforeInput
  screen = [ordered]@{ x = $physical.X; y = $physical.Y }
  virtualScreen = [ordered]@{
    x = $info.VirtualX
    y = $info.VirtualY
    width = $info.VirtualWidth
    height = $info.VirtualHeight
  }
  sent = $sent
} | ConvertTo-Json -Depth 5 -Compress
`;
}
