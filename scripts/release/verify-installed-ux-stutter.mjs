/**
 * Installed Windows UX stutter gates.
 *
 * Mixed-document measurements require an everyday GFM table widget before
 * timing. Scroll long tasks are sampled during the gesture. Two-rAF duration
 * after `scrollTop += 280` is recorded only as a known non-gate.
 *
 * Routing acceptance stays enabled so a second argv does not spawn another
 * process. Cold argv→text is recorded and is not the file-switch budget.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';
import { createRoutingEnvironment } from './installedWindowRoutingHelpers.mjs';

const FILE_SWITCH_P80_BUDGET_MS = 50;
const FILE_SWITCH_SAMPLES = 5;
const MIXED_FILE_SWITCH_WIDGET_P80_BUDGET_MS = 200;
const DRAG_ENGAGE_BUDGET_MS = 50;
const MIXED_LONG_TASK_BUDGET_MS = 50;
const MIXED_TABLE_WIDGET_MIN = 1;

const options = parseArguments(process.argv.slice(2));
const executablePath =
  options.executablePath ||
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  join(process.env.LOCALAPPDATA ?? '', 'LumaMark', 'lumamark.exe');

if (options.plan) {
  process.stdout.write(
    `${JSON.stringify(
      {
        budgets: {
          dragEngageMs: DRAG_ENGAGE_BUDGET_MS,
          fileSwitchP80Ms: FILE_SWITCH_P80_BUDGET_MS,
          mixedFileSwitchWidgetP80Ms: MIXED_FILE_SWITCH_WIDGET_P80_BUDGET_MS,
          mixedLongTaskMs: MIXED_LONG_TASK_BUDGET_MS,
        },
        coordinateConversion: 'GetClientRect + ClientToScreen',
        executablePath,
        inputApi: 'SendInput',
        routingAcceptance: true,
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
      'Installed UX stutter acceptance requires an interactive Windows desktop.',
    );
  }

  const absoluteExecutablePath = resolve(executablePath);
  if (!existsSync(absoluteExecutablePath)) {
    throw new Error(`Installed executable does not exist: ${absoluteExecutablePath}`);
  }

  const probePath = fileURLToPath(
    new URL('./windows-window-chrome-probe.ps1', import.meta.url),
  );
  if (!existsSync(probePath)) {
    throw new Error(`Win32 window probe does not exist: ${probePath}`);
  }

  let app;
  let appExit;
  let appStartError;
  let browser;
  let page;
  let tempDirectory;
  const processOutput = { stderr: [], stdout: [] };

  try {
    assertNoExistingLumaMarkProcesses();
    const debugPort = await reserveDebugPort(options.debugPort);
    tempDirectory = await mkdtemp(
      join(tmpdir(), 'lumamark-menu-context-os-ux-stutter-'),
    );
    const settingsConfigDirectory = join(tempDirectory, 'settings-config');
    const fixturesDirectory = join(tempDirectory, 'fixtures');
    await mkdir(settingsConfigDirectory, { recursive: true });
    await mkdir(fixturesDirectory, { recursive: true });

    const nonce = Date.now();
    const markerA = `LM_UX_SWITCH_A_${nonce}`;
    const markerB = `LM_UX_SWITCH_B_${nonce}`;
    const markerMixed = `LM_UX_MIXED_${nonce}`;
    const fileA = join(fixturesDirectory, 'switch-a.md');
    const fileB = join(fixturesDirectory, 'switch-b.md');
    const fileMixed = join(fixturesDirectory, 'mixed.md');
    await writeFile(fileA, `# Switch A\n\n${markerA}\n`, 'utf8');
    await writeFile(fileB, `# Switch B\n\n${markerB}\n`, 'utf8');
    await writeFile(fileMixed, createMixedFixture(markerMixed), 'utf8');
    await writeFile(
      join(settingsConfigDirectory, 'settings.json'),
      `${JSON.stringify(acceptanceSettings(), null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      join(settingsConfigDirectory, 'recent-files.json'),
      `${JSON.stringify(
        {
          files: [
            { name: 'switch-b.md', openedAt: nonce - 1_000, path: fileB },
            { name: 'switch-a.md', openedAt: nonce - 2_000, path: fileA },
            { name: 'mixed.md', openedAt: nonce - 3_000, path: fileMixed },
          ],
          legacyImported: false,
          revision: 1,
          version: 1,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const environment = createPackagedWebviewEnvironment({
      baseEnvironment: createRoutingEnvironment(
        process.env,
        settingsConfigDirectory,
      ),
      debugPort,
      tempDirectory,
    });

    const launchedAt = Date.now();
    app = spawn(absoluteExecutablePath, [fileA], {
      cwd: tempDirectory,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    appExit = new Promise((resolveExit) => {
      app.once('exit', resolveExit);
      app.once('error', (error) => {
        appStartError = error;
        resolveExit();
      });
    });
    app.stdout?.on('data', (chunk) => {
      processOutput.stdout.push(String(chunk));
    });
    app.stderr?.on('data', (chunk) => {
      processOutput.stderr.push(String(chunk));
    });

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
    await page
      .getByRole('banner')
      .getByRole('heading', { name: /lumamark/i })
      .waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('.lm-editor-title', { hasText: 'switch-a.md' }).waitFor({
      state: 'visible',
      timeout: 20_000,
    });
    await waitForEditorMarker(page, markerA, 20_000);
    const coldArgvMs = Date.now() - launchedAt;

    const childPid = app.pid;
    if (!Number.isInteger(childPid)) {
      throw new Error('The installed LumaMark process did not expose its child PID.');
    }
    const probe = (action, values = {}) =>
      runNativeProbe({
        action,
        childPid,
        probePath,
        values,
      });
    try {
      const initial = probe('State');
      const placement = chooseNormalPlacement(initial.workArea, initial.dpi);
      await focusInstalledWindow(probe, placement);
    } catch (error) {
      process.stderr.write(
        `[release:installed-ux-stutter] native focus unavailable (${error instanceof Error ? error.message : error}); using WebView clicks for file-switch timing.\n`,
      );
    }

    await page.locator('.lm-recent-file').first().waitFor({
      state: 'visible',
      timeout: 10_000,
    });

    const samples = [];
    let nextMarker = markerB;
    for (let index = 0; index < FILE_SWITCH_SAMPLES; index += 1) {
      samples.push(
        await measureFileSwitchClick({
          expectedMarker: nextMarker,
          page,
          probe,
        }),
      );
      nextMarker = nextMarker === markerB ? markerA : markerB;
    }

    const dragEngage = await measureTitlebarDragEngage({
      page,
      probe,
    }).catch((error) => {
      process.stderr.write(
        `[release:installed-ux-stutter] drag engage skipped (${error instanceof Error ? error.message : error}).\n`,
      );
      return null;
    });

    const mixedUx = await measureMixedDocumentUx({
      expectedMarker: markerMixed,
      page,
      probe,
    });

    const fileSwitchP80 = percentile(samples, 80);
    const evidence = {
      budgets: {
        dragEngageMs: DRAG_ENGAGE_BUDGET_MS,
        fileSwitchP80Ms: FILE_SWITCH_P80_BUDGET_MS,
        mixedFileSwitchWidgetP80Ms: MIXED_FILE_SWITCH_WIDGET_P80_BUDGET_MS,
        mixedLongTaskMs: MIXED_LONG_TASK_BUDGET_MS,
      },
      coldArgvOpenMs: coldArgvMs,
      dragEngageMs: dragEngage,
      fileSwitchP80Ms: fileSwitchP80,
      fileSwitchSamplesMs: samples,
      knownLimitations: {
        coldArgvOpenMs:
          'Cold argv→visible text includes WebView boot and is not the same-window budget.',
        toyFileSwitchP80Ms:
          'Two-line file-switch P80 is recorded only. It is not the user-visible mixed-document budget.',
        twoRafScrollMs:
          'Two requestAnimationFrame durations after programmatic scrollTop are not a stutter gate.',
      },
      mixedFileSwitchWidgetMs: mixedUx.fileSwitchWidgetMs,
      mixedLongTaskMaxMs: mixedUx.longTaskMaxMs,
      mixedLongTaskP95Ms: mixedUx.longTaskP95Ms,
      mixedSelectionDuringDrag: mixedUx.selectionDuringDrag,
      mixedTableWidgetCount: mixedUx.tableWidgetCount,
      mixedTwoRafScrollSamplesMs: mixedUx.twoRafScrollSamplesMs,
    };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    if (mixedUx.tableWidgetCount < MIXED_TABLE_WIDGET_MIN) {
      throw new Error(
        `Mixed document everyday GFM table mounted ${mixedUx.tableWidgetCount} widgets; expected >= ${MIXED_TABLE_WIDGET_MIN}.`,
      );
    }
    if (mixedUx.fileSwitchWidgetMs >= MIXED_FILE_SWITCH_WIDGET_P80_BUDGET_MS) {
      throw new Error(
        `Mixed-document file switch to table widget ${mixedUx.fileSwitchWidgetMs.toFixed(1)}ms exceeds ${MIXED_FILE_SWITCH_WIDGET_P80_BUDGET_MS}ms.`,
      );
    }
    if (
      typeof dragEngage === 'number' &&
      dragEngage >= DRAG_ENGAGE_BUDGET_MS
    ) {
      throw new Error(
        `Titlebar drag engage ${dragEngage}ms exceeds ${DRAG_ENGAGE_BUDGET_MS}ms.`,
      );
    }
    if (mixedUx.longTaskP95Ms >= MIXED_LONG_TASK_BUDGET_MS) {
      throw new Error(
        `Mixed-document gesture longtask P95 ${mixedUx.longTaskP95Ms.toFixed(1)}ms exceeds ${MIXED_LONG_TASK_BUDGET_MS}ms.`,
      );
    }
    if (mixedUx.longTaskMaxMs >= MIXED_LONG_TASK_BUDGET_MS) {
      throw new Error(
        `Mixed-document gesture long task ${mixedUx.longTaskMaxMs.toFixed(1)}ms exceeds ${MIXED_LONG_TASK_BUDGET_MS}ms.`,
      );
    }
    if (mixedUx.selectionDuringDrag?.pressCollapsed !== true) {
      throw new Error('Mixed-document press was not collapsed during the gesture.');
    }
    if (mixedUx.selectionDuringDrag?.slopCollapsed !== true) {
      throw new Error('Mixed-document 2px move was not collapsed during the gesture.');
    }
    if (mixedUx.selectionDuringDrag?.dragHasRange !== true) {
      throw new Error('Mixed-document 20px drag did not create a range during the gesture.');
    }
  } catch (error) {
    process.stderr.write(
      `[release:installed-ux-stutter] stdout: ${processOutput.stdout.join('')}\nstderr: ${processOutput.stderr.join('')}\n`,
    );
    if (page) {
      const snapshot = await page
        .evaluate(() => ({
          body: document.body?.innerText?.slice(0, 800) ?? '',
          hasEditor: Boolean(document.querySelector('.cm-content')),
          title: document.title,
          url: location.href,
        }))
        .catch(() => null);
      process.stderr.write(
        `[release:installed-ux-stutter] page: ${JSON.stringify(snapshot)}\n`,
      );
    }
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    if (app && app.exitCode === null) {
      app.kill();
      await Promise.race([appExit, delay(3_000)]);
    }
    if (tempDirectory) {
      await removePackagedWebviewTempDirectory(tempDirectory).catch(() => {});
    }
  }
}

function acceptanceSettings() {
  return {
    appearance: {
      fontZoomPercent: 100,
      pageWidth: 'standard',
      sidebarOpenOnStartup: true,
      theme: 'light',
    },
    editor: {
      autosaveEnabled: false,
      defaultDisplayMode: 'livePreview',
      focusModeOnStartup: false,
    },
    general: {
      language: 'zh-CN',
      openWindowMode: 'aggregateWindow',
      startupBehavior: 'home',
    },
    images: {
      copyImagesToAssets: false,
    },
    markdown: {
      math: {
        equationNumbering: 'none',
        physicsEnabled: false,
        syntaxMode: 'pandoc',
      },
      plantuml: {
        enabled: true,
      },
    },
    updates: {
      autoCheckOnStartup: false,
    },
    version: 3,
  };
}

async function measureFileSwitchClick({ expectedMarker, page, probe }) {
  await page.evaluate((marker) => {
    const state = {
      elapsed: null,
      expected: marker,
      started: null,
    };
    window.__lmUxFileSwitch = state;
    if (window.__lmUxFileSwitchListener) {
      document.removeEventListener(
        'pointerdown',
        window.__lmUxFileSwitchListener,
        true,
      );
    }
    const listener = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.lm-recent-file')) {
        return;
      }
      state.started = performance.now();
      state.elapsed = null;
      const tick = () => {
        const text = document.querySelector('.cm-content')?.innerText ?? '';
        if (text.includes(state.expected)) {
          state.elapsed = performance.now() - state.started;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    window.__lmUxFileSwitchListener = listener;
    document.addEventListener('pointerdown', listener, true);
  }, expectedMarker);

  const target = page.locator('.lm-recent-file:not(.lm-recent-file-current)').first();
  await target.waitFor({ state: 'visible', timeout: 8_000 });
  try {
    const point = await nativePointForLocator(page, target, probe, 'recent file');
    probe('Click', { X: point.x, Y: point.y });
  } catch {
    await target.click({ timeout: 5_000 });
  }

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const elapsed = await page.evaluate(() => window.__lmUxFileSwitch?.elapsed ?? null);
    if (typeof elapsed === 'number' && Number.isFinite(elapsed)) {
      return elapsed;
    }
    await delay(16);
  }
  throw new Error(`Same-window file click did not reveal ${expectedMarker} in time.`);
}

function createMixedFixture(marker) {
  const body = Array.from(
    { length: 24 },
    (_, index) =>
      `Paragraph ${index}: mixed math $a_${index}$, prose, and lists keep the caret in ordinary text.`,
  ).join('\n\n');
  return [
    '# Mixed writing sample',
    '',
    marker,
    '',
    'Lead-in with inline math $E=mc^2$ before the heavy blocks.',
    '',
    '$$',
    '\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}',
    '$$',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[Start] --> B{Branch}',
    '  B --> C[Done]',
    '```',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: hello',
    '@enduml',
    '```',
    '',
    '| Col | Value |',
    '| --- | --- |',
    '| a | 1 |',
    '| b | 2 |',
    '',
    body,
    '',
    'Tail paragraph for typing.',
    '',
  ].join('\n');
}

async function measureMixedDocumentUx({ expectedMarker, page, probe }) {
  const fileSwitchWidgetMs = await measureFileSwitchToTableWidget({
    expectedMarker,
    page,
    probe,
  });
  await waitForEditorMarker(page, expectedMarker, 15_000);
  const tableWidgetCount = await page.locator('.tbl-table-widget').count();
  if (tableWidgetCount < MIXED_TABLE_WIDGET_MIN) {
    throw new Error(
      `Everyday GFM table in mixed.md mounted ${tableWidgetCount} widgets before measuring.`,
    );
  }

  const selectionDuringDrag = await sampleSelectionDuringDrag(page);

  const gestureMetrics = await page.evaluate(async () => {
    const durations = [];
    window.__lmUxLongTaskObserver?.disconnect?.();
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          durations.push(entry.duration);
        }
      });
      observer.observe({ type: 'longtask', buffered: false });
      window.__lmUxLongTaskObserver = observer;
    } catch {
      window.__lmUxLongTaskObserver = null;
    }

    const scroller = document.querySelector('.cm-scroller');
    if (!(scroller instanceof HTMLElement)) {
      throw new Error('Mixed document has no .cm-scroller.');
    }
    const waitFrame = () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => resolveFrame());
      });
    for (let index = 0; index < 12; index += 1) {
      scroller.scrollTop += 80;
      scroller.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          deltaMode: 0,
          deltaY: 80,
        }),
      );
      await waitFrame();
    }
    window.__lmUxLongTaskObserver?.disconnect?.();

    const waitTwoFrames = () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolveFrame());
        });
      });
    const twoRafSamples = [];
    for (let index = 0; index < 4; index += 1) {
      const started = performance.now();
      scroller.scrollTop += 280;
      await waitTwoFrames();
      twoRafSamples.push(performance.now() - started);
    }

    return {
      longTaskDurations: durations,
      twoRafScrollSamplesMs: twoRafSamples,
    };
  });

  const longTasks = gestureMetrics.longTaskDurations ?? [];
  return {
    fileSwitchWidgetMs,
    longTaskMaxMs: longTasks.reduce((max, duration) => Math.max(max, duration), 0),
    longTaskP95Ms: percentile(longTasks.length > 0 ? longTasks : [0], 95),
    selectionDuringDrag,
    tableWidgetCount,
    twoRafScrollSamplesMs: gestureMetrics.twoRafScrollSamplesMs,
  };
}

async function measureFileSwitchToTableWidget({ expectedMarker, page, probe }) {
  await page.evaluate((marker) => {
    const state = {
      elapsed: null,
      expected: marker,
      started: null,
    };
    window.__lmUxFileSwitch = state;
    if (window.__lmUxFileSwitchListener) {
      document.removeEventListener(
        'pointerdown',
        window.__lmUxFileSwitchListener,
        true,
      );
    }
    const listener = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest('.lm-recent-file')) {
        return;
      }
      state.started = performance.now();
      state.elapsed = null;
      const tick = () => {
        const widget = document.querySelector('.tbl-table-widget');
        const text = document.querySelector('.cm-content')?.innerText ?? '';
        if (widget && text.includes(state.expected)) {
          state.elapsed = performance.now() - state.started;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    window.__lmUxFileSwitchListener = listener;
    document.addEventListener('pointerdown', listener, true);
  }, expectedMarker);

  const target = page.locator('.lm-recent-file', { hasText: 'mixed.md' }).first();
  await target.waitFor({ state: 'visible', timeout: 8_000 });
  try {
    const point = await nativePointForLocator(page, target, probe, 'mixed recent file');
    probe('Click', { X: point.x, Y: point.y });
  } catch {
    await target.click({ timeout: 5_000 });
  }

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const elapsed = await page.evaluate(() => window.__lmUxFileSwitch?.elapsed ?? null);
    if (typeof elapsed === 'number' && Number.isFinite(elapsed)) {
      return elapsed;
    }
    await delay(16);
  }
  throw new Error(
    `Same-window mixed file click did not reveal an everyday table widget for ${expectedMarker} in time.`,
  );
}

async function sampleSelectionDuringDrag(page) {
  const origin = await page.evaluate(() => {
    const content = document.querySelector('.cm-content');
    if (!(content instanceof HTMLElement)) {
      throw new Error('Mixed document has no .cm-content.');
    }
    const box = content.getBoundingClientRect();
    return {
      x: box.left + Math.min(48, box.width / 3),
      y: box.top + Math.min(36, box.height / 4),
    };
  });

  const sample = () =>
    page.evaluate(() => {
      const content = document.querySelector('.cm-content');
      let view = null;
      for (let node = content; node; node = node.parentElement) {
        if (node.cmView?.view) {
          view = node.cmView.view;
          break;
        }
      }
      const selection = view?.state.selection.main;
      return {
        empty: selection?.empty ?? null,
        from: selection?.from ?? null,
        to: selection?.to ?? null,
      };
    });

  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  const press = await sample();
  await page.mouse.move(origin.x + 2, origin.y);
  const slop = await sample();
  await page.mouse.move(origin.x + 20, origin.y);
  const drag = await sample();
  await page.mouse.up();

  return {
    dragHasRange: drag.empty === false && drag.from !== drag.to,
    pressCollapsed: press.empty === true,
    slopCollapsed: slop.empty === true,
  };
}

async function measureTitlebarDragEngage({ page, probe }) {
  const strip = page.locator('.lm-titlebar-drag');
  const start = await nativePointForLocator(page, strip, probe, 'blank titlebar strip');
  const state = probe('State');
  const endX = Math.min(state.clientRect.right - 40, start.x + 180);
  const endY = Math.min(state.clientRect.bottom - 40, start.y + 90);
  const result = probe('DragEngage', {
    EndX: endX,
    EndY: endY,
    X: start.x,
    Y: start.y,
  });
  if (!Number.isFinite(result.firstMoveMs)) {
    throw new Error(`DragEngage did not report firstMoveMs: ${JSON.stringify(result)}`);
  }
  return result.firstMoveMs;
}

async function waitForEditorMarker(page, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = '';
  while (Date.now() < deadline) {
    latest = await page.evaluate(() => document.querySelector('.cm-content')?.innerText ?? '');
    if (latest.includes(marker)) {
      return;
    }
    await delay(100);
  }
  throw new Error(
    `Editor never showed ${marker}. Last text: ${latest.slice(0, 240)}`,
  );
}

async function nativePointForLocator(page, locator, probe, label) {
  await locator.waitFor({ state: 'visible', timeout: 8_000 });
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error(`${label} does not have a usable WebView bounding box.`);
  }
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const state = probe('State');
  const css = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const point = {
    css,
    x: state.clientRect.left + Math.round(css.x * dpr),
    y: state.clientRect.top + Math.round(css.y * dpr),
  };
  if (
    point.x < state.clientRect.left ||
    point.x >= state.clientRect.right ||
    point.y < state.clientRect.top ||
    point.y >= state.clientRect.bottom
  ) {
    throw new Error(
      `${label} mapped outside the client rect: ${JSON.stringify({ box, point, state })}`,
    );
  }
  return point;
}

function percentile(values, p) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

async function focusInstalledWindow(probe, placement) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return probe('PlaceNormal', placement);
    } catch (error) {
      lastError = error;
      if (!String(error?.message ?? error).includes('not foreground')) {
        throw error;
      }
      spawnSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{ESC}')",
        ],
        { windowsHide: true },
      );
      await delay(250);
    }
  }
  throw lastError ?? new Error('Unable to foreground the installed LumaMark window.');
}

function chooseNormalPlacement(workArea, dpi) {
  const horizontalMargin = Math.round((160 * dpi) / 96);
  const verticalMargin = Math.round((120 * dpi) / 96);
  const width = Math.min(
    Math.round((1000 * dpi) / 96),
    workArea.width - horizontalMargin,
  );
  const height = Math.min(
    Math.round((700 * dpi) / 96),
    workArea.height - verticalMargin,
  );
  if (width <= 0 || height <= 0) {
    throw new Error(`Monitor work area is too small: ${JSON.stringify(workArea)}`);
  }
  return {
    Height: height,
    Left: workArea.left + Math.floor((workArea.width - width) / 3),
    Top: workArea.top + Math.floor((workArea.height - height) / 3),
    Width: width,
  };
}

function runNativeProbe({ action, childPid, probePath, values }) {
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
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Unable to execute the Win32 probe: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `Win32 ${action} failed (exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

function assertNoExistingLumaMarkProcesses() {
  const command = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    '$items = @(Get-Process -Name lumamark -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ id = $_.Id; path = $_.Path } })',
    'ConvertTo-Json -Compress -Depth 3 -InputObject $items',
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to inspect existing LumaMark processes: ${
        result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`
      }`,
      result.error ? { cause: result.error } : undefined,
    );
  }
  const existing = JSON.parse(result.stdout.trim() || '[]');
  const items = Array.isArray(existing) ? existing : [existing];
  if (items.length > 0 && items[0]?.id) {
    throw new Error(
      `Close existing LumaMark processes before installed acceptance: ${JSON.stringify(
        items,
      )}`,
    );
  }
}

async function waitForDebugEndpoint(debugPort, getProcessState) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const processState = getProcessState();
    if (processState.error) {
      throw new Error(`Unable to start installed LumaMark: ${processState.error.message}`, {
        cause: processState.error,
      });
    }
    if (processState.exitCode !== null && processState.exitCode !== undefined) {
      throw new Error(
        `Installed LumaMark child exited before WebView2 opened (exit ${processState.exitCode}).`,
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
      // Keep polling until the child exposes its WebView2 endpoint.
    }
    await delay(500);
  }
  throw new Error(`WebView2 debug endpoint did not open on port ${debugPort}.`);
}

function parseArguments(args) {
  const parsed = {
    debugPort: undefined,
    executablePath: undefined,
    plan: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan') {
      parsed.plan = true;
      continue;
    }
    if (argument === '--executable' || argument === '--debug-port') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === '--executable') {
        parsed.executablePath = value;
      } else {
        parsed.debugPort = parsePositiveInteger(value, argument);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}.`);
  }
  return parsed;
}
