/**
 * Installed Windows acceptance for MathJax offline rendering and math
 * click-to-caret geometry.
 *
 * CDP is observation-only. Pointer, wheel, Unicode, resize, and save actions
 * are delivered to the exact spawned process through the shared Win32
 * SendInput helper used by the installed media acceptance.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  createAcceptanceSettingsEnvironment,
  isRemoteDesktopRequest,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const acceptanceName = 'release:installed-math-caret-os';
const thirdPartyLicenseFileName = 'THIRD_PARTY_LICENSES.txt';
const expectedThirdPartyLicenseSha256 =
  'D379E06DC0733CF4EC6D36C3FC6C8C864CA7DE26E11F94F12B64190387D47C8D';
const apacheLicenseHeading = /Apache\s+License\s+Version 2\.0, January 2004/u;
const helperProducer = join(
  dirname(fileURLToPath(import.meta.url)),
  'verify-installed-media-caret-os.mjs',
);
const offlineResolverRule =
  '--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE localhost,EXCLUDE 127.0.0.1,EXCLUDE tauri.localhost,EXCLUDE ipc.localhost';
const helperContracts = [
  'ClientToScreen',
  'SendInput',
  'SetThreadDpiAwarenessContext',
  'GetDpiForWindow',
  'GetForegroundWindow',
  'GetWindowThreadProcessId',
  'GetClientRect',
  'WindowFromPoint',
  'SetWindowPos',
  'Process.GetProcessById',
];
const inlineSource = 'e^{i\\pi}+1=0';
const blockSource = '\\int_0^\\infty e^{-x^2}\\,dx=\\frac{\\sqrt{\\pi}}{2}';
const rareGlyphSource = '\\text{é}';
const mhchemSource = '\\ce{H2O + CO2 -> H2CO3}';
const physicsSource = '\\qty{x}';
const lineNames = {
  afterBlock: 'math acceptance after block',
  beforeInline: 'math acceptance before inline',
};
const initialMarkdown = [
  lineNames.beforeInline,
  '',
  `Inline formula $${inlineSource}$ keeps surrounding text selectable.`,
  '',
  `Rare NewCM glyph $${rareGlyphSource}$ must render offline.`,
  '',
  `mhchem $${mhchemSource}$ must render offline.`,
  '',
  `Physics stays disabled by default: $${physicsSource}$.`,
  '',
  ...Array.from({ length: 42 }, (_, index) => `math filler before ${index + 1}`),
  '',
  '$$',
  blockSource,
  '$$',
  '',
  lineNames.afterBlock,
  '',
  ...Array.from({ length: 42 }, (_, index) => `math filler after ${index + 1}`),
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
  assets: null,
  diagnostics: null,
  executablePath,
  featureObservations: null,
  geometry: [],
  memoryMarkdownExact: false,
  offline: {
    hostResolverRule: offlineResolverRule,
    remoteRequests: [],
  },
  pid: null,
  savedMarkdownExact: false,
  screenshot: null,
  thirdPartyLicense: null,
};
const processOutput = { stderr: [], stdout: [] };
let app;
let appExit;
let browser;
let documentPath;
let expectedMarkdown = initialMarkdown;
let page;
let tempDirectory;
let win32HelperPath;

try {
  await runAcceptance();
  process.stdout.write(
    `${JSON.stringify({ installedMathCaretOs: true, ...evidence }, null, 2)}\n`,
  );
} catch (error) {
  await captureScreenshot('failed');
  const failureState = await collectFailureState().catch((observationError) => ({
    observationError: String(observationError),
  }));
  process.stderr.write(
    [
      `[${acceptanceName}] FAILED`,
      error instanceof Error ? error.stack ?? error.message : String(error),
      JSON.stringify({ ...evidence, failureState, processOutput }, null, 2),
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  const cleanupFailures = [];
  if (browser) {
    await withTimeout(browser.close(), 5_000, 'CDP browser close').catch(
      (error) => cleanupFailures.push(`CDP close: ${String(error)}`),
    );
  }
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
  }
  if (tempDirectory) {
    await removePackagedWebviewTempDirectory(tempDirectory).catch((error) =>
      cleanupFailures.push(`temporary directory removal: ${String(error)}`),
    );
  }
  if (cleanupFailures.length > 0) {
    process.stderr.write(
      `[${acceptanceName}] Cleanup failed:\n${cleanupFailures.join('\n')}\n`,
    );
    process.exitCode = 1;
  }
}

async function runAcceptance() {
  await access(executablePath);
  const executableStats = await stat(executablePath);
  evidence.executable = {
    modifiedAt: executableStats.mtime.toISOString(),
    size: executableStats.size,
  };
  evidence.thirdPartyLicense = await verifyInstalledThirdPartyLicense();

  const port = await reserveDebugPort(
    parseRequestedPort(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT),
  );
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-menu-context-os-installed-math-os-'));
  documentPath = join(tempDirectory, 'installed-math-caret.md');
  win32HelperPath = join(tempDirectory, 'lumamark-native-input.ps1');
  await writeFile(documentPath, initialMarkdown, 'utf8');
  execFileSync(
    process.execPath,
    [helperProducer, '--write-win32-helper', win32HelperPath],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  );
  await assertSharedWin32HelperContract();

  const webviewEnvironment = await createAcceptanceSettingsEnvironment({
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
  app.stdout?.on('data', (chunk) => processOutput.stdout.push(chunk.toString()));
  app.stderr?.on('data', (chunk) => processOutput.stderr.push(chunk.toString()));

  await waitForDebugEndpoint(port, () => appStartError);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page =
    context.pages()[0] ??
    (await context.waitForEvent('page', { timeout: 5_000 }));

  const diagnostics = { console: [], pageErrors: [], requestFailures: [], requests: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      diagnostics.console.push(`[${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  context.on('request', (request) => diagnostics.requests.push(request.url()));
  context.on('requestfailed', (request) =>
    diagnostics.requestFailures.push({
      error: request.failure()?.errorText ?? 'unknown failure',
      url: request.url(),
    }),
  );

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page
    .locator('.lm-editor-title', { hasText: basename(documentPath) })
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lm-editor-live-preview-mode .cm-content').waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await waitForMathRender('inline', inlineSource);
  await waitForMathRender('inline', rareGlyphSource);
  await waitForMathRender('inline', mhchemSource);
  evidence.assets = await assertOfflineMathAssets(diagnostics.requests);
  evidence.featureObservations = await assertOfflineFeatureObservations(
    evidence.assets,
  );
  await waitForMathRender('block', blockSource);

  const probeEvidence = invokeWin32('Probe');
  evidence.actions.push({ ...probeEvidence, action: 'probe' });

  await scrollFormulaIntoView('inline', inlineSource, 720);
  const firstInline = await clickFormula('inline', inlineSource, 'inline-initial');
  await insertUnicode(firstInline.expectedHead, 'θ', 'inline-source');
  const editedInlineSource = `θ${inlineSource}`;

  const narrowDpr = await page.evaluate(() => window.devicePixelRatio);
  evidence.actions.push({
    ...invokeWin32('Resize', { dpr: narrowDpr, height: 720, width: 800 }),
    action: 'resize',
    phase: 'narrow',
  });
  await waitForViewport(800, 720);
  await scrollFormulaIntoView('block', blockSource, -720);
  const narrowBlockLayout = await readFormulaLayout('block');

  const blockClick = await clickFormula('block', blockSource, 'block-narrow');
  await assertActiveBlockPreview(blockSource, blockClick.expectedHead);
  await insertUnicode(blockClick.expectedHead, 'λ', 'block-source');
  const editedBlockSource = `λ${blockSource}`;
  await waitForMathRender('block', editedBlockSource);
  await assertActiveBlockPreview(editedBlockSource, blockClick.expectedHead + 1);

  const wideDpr = await page.evaluate(() => window.devicePixelRatio);
  evidence.actions.push({
    ...invokeWin32('Resize', { dpr: wideDpr, height: 720, width: 1_080 }),
    action: 'resize',
    phase: 'wide',
  });
  await waitForViewport(1_080, 720);
  const wideBlockLayout = await readFormulaLayout('block');
  assertResponsiveFormulaLayout(narrowBlockLayout, wideBlockLayout);
  evidence.responsiveLayout = { narrow: narrowBlockLayout, wide: wideBlockLayout };

  await scrollLineIntoView(lineNames.afterBlock, -720);
  const afterBlockProbe = await clickSourceLine(
    lineNames.afterBlock,
    'after-block-resize',
  );
  await insertUnicode(afterBlockProbe.expectedHead, '界', 'after-block-source');

  await scrollFormulaIntoView('inline', editedInlineSource, 720);
  await clickFormula('inline', editedInlineSource, 'inline-after-scroll-resize');

  const wheelDirections = new Set(
    evidence.actions
      .filter((action) => action.action === 'wheel')
      .map((action) => action.direction),
  );
  if (!wheelDirections.has('down') || !wheelDirections.has('up')) {
    throw new Error(
      `OS wheel did not traverse the math document both ways: ${JSON.stringify([...wheelDirections])}`,
    );
  }

  const finalState = await readEditorState();
  if (finalState.source !== expectedMarkdown) {
    throw new Error(
      `In-memory Markdown differs from expected bytes.\nExpected:\n${expectedMarkdown}\nActual:\n${finalState.source}`,
    );
  }
  evidence.memoryMarkdownExact = true;

  evidence.actions.push({ ...invokeWin32('Save'), action: 'save' });
  await waitForSavedStatus();
  const savedMarkdown = await waitForExactSavedMarkdown();
  if (savedMarkdown !== expectedMarkdown) {
    throw new Error(
      `Saved Markdown differs from expected bytes.\nExpected:\n${expectedMarkdown}\nActual:\n${savedMarkdown}`,
    );
  }
  evidence.savedMarkdownExact = true;

  await acceptanceDelay(200);
  evidence.diagnostics = assertCleanDiagnostics(diagnostics);
  await captureScreenshot('passed');
}

async function verifyInstalledThirdPartyLicense() {
  const licensePath = join(dirname(executablePath), thirdPartyLicenseFileName);
  const license = await readFile(licensePath);
  const sha256 = createHash('sha256')
    .update(license)
    .digest('hex')
    .toUpperCase();
  if (sha256 !== expectedThirdPartyLicenseSha256) {
    throw new Error(
      `Installed ${thirdPartyLicenseFileName} SHA-256 mismatch: ${sha256}`,
    );
  }

  const notice = license.toString('utf8');
  for (const marker of [
    '@mathjax/src 4.1.3',
    '@mathjax/mathjax-newcm-font 4.1.3',
    'License: Apache-2.0',
    'Canonical license SHA-256: CFC7749B96F63BD31C3C42B5C471BF756814053E847C10F3EB003417BC523D30',
  ]) {
    if (!notice.includes(marker)) {
      throw new Error(
        `Installed ${thirdPartyLicenseFileName} is missing ${JSON.stringify(marker)}.`,
      );
    }
  }
  if (!apacheLicenseHeading.test(notice)) {
    throw new Error(
      `Installed ${thirdPartyLicenseFileName} is missing the canonical Apache-2.0 heading.`,
    );
  }

  return {
    path: licensePath,
    readable: true,
    sha256,
    size: license.length,
  };
}

async function assertSharedWin32HelperContract() {
  const helperSource = await readFile(win32HelperPath, 'ascii');
  const missing = helperContracts.filter((contract) => !helperSource.includes(contract));
  if (missing.length > 0) {
    throw new Error(
      `Shared Win32 helper is missing required contracts: ${missing.join(', ')}`,
    );
  }
}

async function assertOfflineMathAssets(observedRequests) {
  await page.evaluate(() => document.fonts.ready);
  const snapshot = await page.waitForFunction(() => {
    const style = document.querySelector('[data-lm-math-style]');
    const stylesheet = style?.textContent ?? '';
    const fontUrls = [...stylesheet.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map(
      (match) => new URL(match[1], location.href).href,
    );
    const fontFaceCount = stylesheet.match(/@font-face/g)?.length ?? 0;
    const resources = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name);
    return {
      appOrigin: location.origin,
      fontFaceCount,
      fontUrls,
      resources,
      workerUrls: resources.filter((url) => url.includes('mathDocumentWorker')),
      woffRequests: resources.filter((url) => url.includes('.woff2')),
    };
  }, undefined, { timeout: 20_000 });
  const assets = await snapshot.jsonValue();
  assets.workerUrls = [
    ...new Set([
      ...assets.workerUrls,
      ...page.workers().map((worker) => worker.url()),
    ]),
  ];

  const uniqueFontUrls = new Set(assets.fontUrls);
  if (assets.fontFaceCount <= 0) {
    throw new Error(
      'The rendered MathJax stylesheet did not declare any NewCM font faces.',
    );
  }
  if (uniqueFontUrls.size !== assets.fontFaceCount) {
    throw new Error(
      `Expected one unique packaged WOFF2 URL per active NewCM font face: ${JSON.stringify({ fontFaceCount: assets.fontFaceCount, uniqueFontUrlCount: uniqueFontUrls.size })}`,
    );
  }
  if (assets.workerUrls.length === 0 || assets.woffRequests.length === 0) {
    throw new Error(
      `MathJax worker/font requests were not observed: ${JSON.stringify(assets)}`,
    );
  }
  const assetUrls = [
    ...assets.fontUrls,
    ...assets.workerUrls,
    ...assets.woffRequests,
  ];
  const remoteAssets = assetUrls.filter((url) => isRemoteDesktopRequest(url, assets.appOrigin));
  if (remoteAssets.length > 0) {
    throw new Error(`Math assets escaped the app origin: ${remoteAssets.join(', ')}`);
  }
  if (assets.workerUrls.some((url) => url.startsWith('blob:'))) {
    throw new Error('MathJax worker was started through a blob URL.');
  }

  const allRequests = [...new Set([...assets.resources, ...observedRequests])];
  const remoteRequests = allRequests.filter((url) =>
    isRemoteDesktopRequest(url, assets.appOrigin),
  );
  evidence.offline.remoteRequests = remoteRequests;
  if (remoteRequests.length > 0) {
    throw new Error(`Offline acceptance observed remote requests: ${remoteRequests.join(', ')}`);
  }

  return assets;
}

async function assertOfflineFeatureObservations(assets) {
  await revealMathSource(`$${physicsSource}$`);
  const dom = await page.evaluate(
    ({ mhchemSource, physicsSource, rareGlyphSource }) => {
      const mathNodes = [...document.querySelectorAll('[role="math"]')];
      const hasRenderedMath = (source) => {
        const math = mathNodes.find(
          (candidate) => candidate.getAttribute('aria-label') === source,
        );
        return math?.querySelector('mjx-container') !== null;
      };
      const editorText =
        document.querySelector('.lm-editor-live-preview-mode .cm-content')
          ?.textContent ?? '';
      const physicsErrors = [
        ...document.querySelectorAll(
          '.lm-math-render-error, .lm-math-source-error',
        ),
      ].map((error) => error.textContent ?? '');

      return {
        mhchemRendered: hasRenderedMath(mhchemSource),
        physicsDisabledByDefault: physicsErrors.some((error) =>
          /Undefined control sequence|未定义/u.test(error),
        ),
        physicsErrorText: physicsErrors,
        rareGlyphRendered: hasRenderedMath(rareGlyphSource),
        sourceIncludesPhysics: editorText.includes(`$${physicsSource}$`),
      };
    },
    { mhchemSource, physicsSource, rareGlyphSource },
  );

  if (
    !dom.rareGlyphRendered ||
    !dom.mhchemRendered ||
    !dom.physicsDisabledByDefault
  ) {
    throw new Error(
      `Installed offline math feature observations failed: ${JSON.stringify(dom)}`,
    );
  }

  return {
    coldOffline: {
      resolverRule: offlineResolverRule,
      startedBeforeApplication: true,
    },
    mhchem: { rendered: dom.mhchemRendered, source: mhchemSource },
    moduleWorker: {
      observed: assets.workerUrls.length > 0,
      urls: assets.workerUrls,
    },
    physicsDisabledByDefault: {
      observed: dom.physicsDisabledByDefault,
      source: physicsSource,
    },
    rareGlyph: { rendered: dom.rareGlyphRendered, source: rareGlyphSource },
    woff2: {
      declared: assets.fontFaceCount,
      observedRequests: assets.woffRequests,
    },
  };
}

async function clickFormula(kind, source, phase) {
  const probe = await waitForStableFormulaGeometry(kind, source);
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
    expectedPosition: probe.expectedHead,
    kind,
    phase,
  });
  await waitForSelection(probe.expectedHead);
  evidence.geometry.push({ ...probe, phase });
  return probe;
}

async function clickSourceLine(lineName, phase) {
  const probe = await waitForStableLineGeometry(lineName);
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
    expectedPosition: probe.expectedHead,
    lineName,
    phase,
  });
  await waitForSelection(probe.expectedHead);
  evidence.geometry.push({ ...probe, phase });
  return probe;
}

async function insertUnicode(position, text, phase) {
  const typeEvidence = invokeWin32('Unicode', { text });
  evidence.actions.push({ ...typeEvidence, action: 'unicode', phase, text });
  expectedMarkdown = `${expectedMarkdown.slice(0, position)}${text}${expectedMarkdown.slice(position)}`;
  await page.waitForFunction(
    ({ head, source }) => {
      const view = resolveRootEditorView();
      return (
        view?.state.selection.main.head === head &&
        view?.state.doc.toString() === source
      );

      function resolveRootEditorView() {
        const content = document.querySelector(
          '.lm-editor-live-preview-mode .cm-content',
        );
        return content?.cmTile?.root?.view ?? content?.cmTile?.view;
      }
    },
    { head: position + text.length, source: expectedMarkdown },
    { timeout: 8_000 },
  );
}

async function waitForSelection(expectedHead) {
  await page.waitForFunction(
    (head) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      return view?.state.selection.main.head === head;
    },
    expectedHead,
    { timeout: 8_000 },
  );
}

async function assertActiveBlockPreview(source, expectedHead) {
  await page.waitForFunction(
    ({ head, source }) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      const preview = document.querySelector('.lm-math-block-render');
      const rawSource = [...document.querySelectorAll('.cm-line')].some((line) =>
        line.textContent?.includes(source),
      );
      return (
        view?.state.selection.main.head === head &&
        preview instanceof HTMLElement &&
        rawSource
      );
    },
    { head: expectedHead, source },
    { timeout: 12_000 },
  );
}

async function waitForMathRender(kind, source) {
  const wrapped = kind === 'inline' ? `$${source}$` : `$$\n${source}\n$$`;
  await revealMathSource(wrapped);

  const selector = `.lm-math-${kind}-render`;
  await page.waitForFunction(
    ({ selector, source }) => {
      const math = [...document.querySelectorAll(selector)].find(
        (node) => node.getAttribute('aria-label') === source,
      );
      return (
        math instanceof HTMLElement &&
        math.getAttribute('role') === 'math' &&
        math.querySelector('mjx-container') !== null
      );
    },
    { selector, source },
    { timeout: 30_000 },
  );
}

async function revealMathSource(wrappedSource) {
  const revealed = await page.evaluate((wrapped) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve live-preview EditorView.');
    }
    const from = view.state.doc.toString().indexOf(wrapped);
    if (from < 0) {
      throw new Error(`Missing math source: ${wrapped}`);
    }
    view.dispatch({
      effects: view.constructor.scrollIntoView(from, { y: 'center' }),
    });
    const lineBlock = view.lineBlockAt(from);
    return {
      from,
      scrollHeight: view.scrollDOM.scrollHeight,
      scrollTop: view.scrollDOM.scrollTop,
      top: lineBlock.top,
    };
  }, wrappedSource);
  if (revealed.scrollTop === 0 && revealed.top > 48) {
    await page.evaluate((top) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      if (!view) {
        throw new Error('Unable to resolve live-preview EditorView.');
      }
      view.scrollDOM.scrollTop = Math.max(
        0,
        top - Math.max(24, view.scrollDOM.clientHeight / 3),
      );
    }, revealed.top);
  }
}

async function waitForStableFormulaGeometry(kind, source) {
  let latest;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    latest = await probeFormula(kind, source);
    if (
      latest.visible &&
      Math.abs(latest.heightDrift) <= 2 &&
      latest.rect.height > 0 &&
      latest.rect.width > 0
    ) {
      return latest;
    }
    await acceptanceDelay(150);
  }
  throw new Error(`Math geometry did not settle: ${JSON.stringify(latest)}`);
}

async function probeFormula(kind, source) {
  return page.evaluate(
    ({ kind, source }) => {
      const content = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      const selector = `.lm-math-${kind}-render`;
      const math = [...document.querySelectorAll(selector)].find(
        (node) => node.getAttribute('aria-label') === source,
      );
      if (!view || !(math instanceof HTMLElement)) {
        return { kind, source, visible: false };
      }
      const documentSource = view.state.doc.toString();
      const wrapped = kind === 'inline' ? `$${source}$` : `$$\n${source}\n$$`;
      const from = documentSource.indexOf(wrapped);
      if (from < 0) {
        throw new Error(`Missing ${kind} math source: ${wrapped}`);
      }
      const rect = math.getBoundingClientRect();
      const scrollerRect = view.scrollDOM.getBoundingClientRect();
      const contentRect = view.contentDOM.getBoundingClientRect();
      const click = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return {
        click,
        dpr: window.devicePixelRatio,
        expectedHead: from + (kind === 'inline' ? 1 : 3),
        from,
        heightDrift:
          contentRect.height -
          view.viewState.paddingTop -
          view.viewState.paddingBottom -
          view.viewState.docHeight,
        kind,
        posAtCoords: view.posAtCoords(click),
        rect: {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        },
        source,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        visible:
          rect.bottom > scrollerRect.top + 2 &&
          rect.top < scrollerRect.bottom - 2,
      };
    },
    { kind, source },
  );
}

async function waitForStableLineGeometry(lineName) {
  let latest;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    latest = await probeLine(lineName);
    if (
      latest.visible &&
      latest.posAtCoords === latest.expectedHead &&
      Math.abs(latest.drift) <= 0.75 &&
      Math.abs(latest.heightDrift) <= 2
    ) {
      return latest;
    }
    await acceptanceDelay(150);
  }
  throw new Error(`Line geometry did not settle: ${JSON.stringify(latest)}`);
}

async function probeLine(lineName) {
  return page.evaluate((lineName) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve live-preview EditorView.');
    }
    const source = view.state.doc.toString();
    const from = source.indexOf(lineName);
    if (from < 0) {
      throw new Error(`Missing source line: ${lineName}`);
    }
    const line = view.state.doc.lineAt(from);
    const lineElement = [...view.contentDOM.querySelectorAll('.cm-line')].find(
      (node) => node.textContent === lineName,
    );
    const contentRect = view.contentDOM.getBoundingClientRect();
    const heightDrift =
      contentRect.height -
      view.viewState.paddingTop -
      view.viewState.paddingBottom -
      view.viewState.docHeight;
    if (!(lineElement instanceof HTMLElement)) {
      return { expectedHead: line.from, heightDrift, lineName, visible: false };
    }
    const rect = lineElement.getBoundingClientRect();
    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const caret = view.coordsAtPos(line.from, 1) ?? view.coordsAtPos(line.from);
    if (!caret) {
      throw new Error(`No caret coordinates for source line: ${lineName}`);
    }
    const click = { x: caret.left + 0.25, y: rect.top + rect.height / 2 };
    const block = view.lineBlockAt(line.from);
    const docTop = contentRect.top + view.viewState.paddingTop;
    return {
      click,
      dpr: window.devicePixelRatio,
      drift: rect.top - docTop - block.top,
      expectedHead: line.from,
      heightDrift,
      lineName,
      posAtCoords: view.posAtCoords(click),
      rect: { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top },
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      visible:
        rect.bottom > scrollerRect.top + 2 &&
        rect.top < scrollerRect.bottom - 2,
    };
  }, lineName);
}

async function scrollFormulaIntoView(kind, source, wheelDelta) {
  return scrollUntilVisible(
    () => probeFormula(kind, source),
    `${kind} formula`,
    wheelDelta,
  );
}

async function scrollLineIntoView(lineName, wheelDelta) {
  return scrollUntilVisible(() => probeLine(lineName), lineName, wheelDelta);
}

async function scrollUntilVisible(probe, label, wheelDelta) {
  let latest;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    latest = await probe();
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
      label,
    });
    await acceptanceDelay(180);
  }
  throw new Error(`OS wheel did not reveal ${label}: ${JSON.stringify(latest)}`);
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

async function readFormulaLayout(kind) {
  return page.evaluate((kind) => {
    const math = document.querySelector(`.lm-math-${kind}-render`);
    if (!(math instanceof HTMLElement)) {
      throw new Error(`Missing ${kind} math widget.`);
    }
    const rect = math.getBoundingClientRect();
    return {
      dpr: window.devicePixelRatio,
      height: rect.height,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      width: rect.width,
    };
  }, kind);
}

function assertResponsiveFormulaLayout(narrow, wide) {
  if (wide.viewportWidth < narrow.viewportWidth + 250) {
    throw new Error(
      `Native resize did not change the WebView width: ${JSON.stringify({ narrow, wide })}`,
    );
  }
  if (wide.width < narrow.width + 150) {
    throw new Error(
      `Block formula did not follow the editor width: ${JSON.stringify({ narrow, wide })}`,
    );
  }
}

async function waitForViewport(width, height) {
  await page.waitForFunction(
    ({ height, width }) =>
      Math.abs(window.innerWidth - width) <= 48 &&
      Math.abs(window.innerHeight - height) <= 48,
    { height, width },
    { timeout: 10_000 },
  );
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
      selection: view.state.selection.toJSON(),
      source: view.state.doc.toString(),
    };
  });
}

async function waitForSavedStatus() {
  await page.waitForFunction(
    () => {
      const statuses = [...document.querySelectorAll('[role="status"]')].map(
        (status) => status.textContent ?? '',
      );
      const title = document.querySelector('.lm-editor-title')?.textContent ?? '';
      return statuses.some((status) => /Saved|已保存/.test(status)) && !title.includes('*');
    },
    undefined,
    { timeout: 15_000 },
  );
}

async function waitForExactSavedMarkdown() {
  let saved = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    saved = await readFile(documentPath, 'utf8');
    if (saved === expectedMarkdown) {
      return saved;
    }
    await acceptanceDelay(100);
  }
  return saved;
}

function assertCleanDiagnostics(diagnostics) {
  const appOrigin = evidence.assets?.appOrigin;
  const remoteRequests = diagnostics.requests.filter((url) =>
    isRemoteDesktopRequest(url, appOrigin),
  );
  evidence.offline.remoteRequests = [
    ...new Set([...evidence.offline.remoteRequests, ...remoteRequests]),
  ];
  if (
    diagnostics.console.length > 0 ||
    diagnostics.pageErrors.length > 0 ||
    diagnostics.requestFailures.length > 0 ||
    evidence.offline.remoteRequests.length > 0
  ) {
    throw new Error(`Installed math diagnostics are not clean: ${JSON.stringify(diagnostics)}`);
  }
  return diagnostics;
}

async function collectFailureState() {
  if (!page) {
    return null;
  }
  return page.evaluate(() => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
    return {
      blockMath: document.querySelectorAll('.lm-math-block-render').length,
      dpr: window.devicePixelRatio,
      editorFound: Boolean(view),
      inlineMath: document.querySelectorAll('.lm-math-inline-render').length,
      scroll: view
        ? {
            clientHeight: view.scrollDOM.clientHeight,
            scrollHeight: view.scrollDOM.scrollHeight,
            scrollTop: view.scrollDOM.scrollTop,
          }
        : null,
      selection: view?.state.selection.toJSON(),
      source: view?.state.doc.toString(),
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });
}

async function captureScreenshot(result) {
  if (!page) {
    return;
  }
  const screenshotDirectory = join(process.cwd(), 'test-results');
  await mkdir(screenshotDirectory, { recursive: true });
  const screenshotPath = join(
    screenshotDirectory,
    `installed-math-caret-os-${result}-${Date.now()}.png`,
  );
  await withTimeout(
    page.screenshot({ fullPage: true, path: screenshotPath }),
    5_000,
    'Math acceptance screenshot',
  );
  evidence.screenshot = screenshotPath;
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
    throw new Error(`Win32 helper returned mismatched PID/action: ${stdout}`);
  }
  if (
    (action === 'Click' || action === 'Wheel') &&
    parsed.targetVerifiedBeforeInput !== true
  ) {
    throw new Error(`Win32 helper did not verify the pointer target: ${stdout}`);
  }
  if (parsed.perMonitorV2 !== true || !Number.isFinite(parsed.dpi)) {
    throw new Error(`Win32 helper is not per-monitor-v2 DPI aware: ${stdout}`);
  }
  if (
    ['Click', 'Unicode', 'Save', 'Wheel'].includes(action) &&
    parsed.foregroundProcessId !== app.pid
  ) {
    throw new Error(`Foreground window is not owned by spawned PID: ${stdout}`);
  }
  if (options.dpr !== undefined) {
    const dpiScale = parsed.dpi / 96;
    if (Math.abs(dpiScale - options.dpr) > 0.05) {
      throw new Error(
        `WebView DPR and Win32 DPI disagree: ${JSON.stringify({ dpiScale, options, parsed })}`,
      );
    }
  }
  if (options.viewportWidth !== undefined && options.viewportHeight !== undefined) {
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
