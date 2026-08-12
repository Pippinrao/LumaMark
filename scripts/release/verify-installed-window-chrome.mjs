/**
 * Installed Windows acceptance for the frameless titlebar contract.
 *
 * CDP is used only to locate semantic targets and observe DOM state. Every
 * titlebar/menu interaction is delivered by Win32 SendInput after converting
 * WebView client coordinates with GetClientRect + ClientToScreen.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const ASSERTIONS = [
  'single click preserves normal placement',
  'single drag moves the normal window',
  'double click maximizes to the monitor work area without clipping',
  'double click restores the saved normal placement',
  'dragging from maximized restores and moves the window',
  'double click maximizes again after dragging from maximized',
  'maximize button toggles native state and its accessible label',
  'theme, language, and About portal items accept real OS clicks',
];

const options = parseArguments(process.argv.slice(2));
const executablePath =
  options.executablePath ||
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  join(process.env.LOCALAPPDATA ?? '', 'LumaMark', 'lumamark.exe');

if (options.plan) {
  process.stdout.write(
    `${JSON.stringify(
      {
        assertions: ASSERTIONS,
        coordinateConversion: 'GetClientRect + ClientToScreen',
        executablePath,
        expectedDpi: options.expectedDpi ?? null,
        inputApi: 'SendInput',
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
      'Installed window-chrome acceptance requires an interactive Windows desktop.',
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
  let evidence;
  let page;
  let tempDirectory;
  const processOutput = { stderr: [], stdout: [] };

  try {
    assertNoExistingLumaMarkProcesses();
    const debugPort = await reserveDebugPort(options.debugPort);
    tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-window-chrome-'));
    app = spawn(absoluteExecutablePath, [], {
      cwd: dirname(absoluteExecutablePath),
      env: createPackagedWebviewEnvironment({
        baseEnvironment: process.env,
        debugPort,
        tempDirectory,
      }),
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

    const initial = probe('State');
    assertExactExecutable(initial.executablePath, absoluteExecutablePath);
    if (options.expectedDpi !== undefined && initial.dpi !== options.expectedDpi) {
      throw new Error(
        `DPI mismatch: expected ${options.expectedDpi}, received ${initial.dpi}.`,
      );
    }

    const placement = chooseNormalPlacement(initial.workArea, initial.dpi);
    const knownNormal = probe('PlaceNormal', placement);
    assertNormalPlacement(knownNormal, 'known normal placement');
    await assertWebviewMatchesClient(page, knownNormal, 'known normal placement');
    await waitForWindowControlState(
      page,
      false,
      'initial maximize button state',
    );

    evidence = {
      childPid,
      dpi: knownNormal.dpi,
      executablePath: absoluteExecutablePath,
      normalPlacement: knownNormal.clientRect,
      assertions: {},
    };

    let stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'blank titlebar strip',
    );
    await assertBlankNativeStrip(page, stripPoint.css);
    probe('Click', { X: stripPoint.x, Y: stripPoint.y });
    const afterSingleClick = await waitForWindowState(
      probe,
      (state) => !state.zoomed,
      'single click to remain normal',
    );
    assertPlacementNear(
      afterSingleClick.clientRect,
      knownNormal.clientRect,
      1,
      'Single click changed the normal placement.',
    );
    evidence.assertions.singleClick = {
      passed: true,
      placement: afterSingleClick.clientRect,
    };

    const resetNormal = probe('PlaceNormal', placement);
    assertPlacementNear(
      resetNormal.clientRect,
      knownNormal.clientRect,
      2,
      'Unable to restore the known normal placement before double-click.',
    );

    stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'blank titlebar strip',
    );
    probe('DoubleClick', { X: stripPoint.x, Y: stripPoint.y });
    const maximized = await waitForWindowState(
      probe,
      (state) => state.zoomed,
      'double click to maximize',
    );
    const maximizeGeometry = assertMaximizedGeometry(
      maximized,
      'first double-click maximize',
    );
    await assertWebviewMatchesClient(page, maximized, 'first maximized state');
    evidence.assertions.doubleClickMaximize = {
      geometry: maximizeGeometry,
      passed: true,
    };
    await waitForWindowControlState(
      page,
      true,
      'maximize button after native double-click',
    );

    stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'maximized blank titlebar strip',
    );
    probe('DoubleClick', { X: stripPoint.x, Y: stripPoint.y });
    const restored = await waitForWindowState(
      probe,
      (state) => !state.zoomed,
      'second double click to restore',
    );
    assertPlacementNear(
      restored.clientRect,
      resetNormal.clientRect,
      3,
      'Double-click restore did not return to the saved normal placement.',
    );
    await waitForWindowControlState(
      page,
      false,
      'maximize button after native double-click restore',
    );
    evidence.assertions.doubleClickRestore = {
      passed: true,
      placement: restored.clientRect,
    };

    stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'restored blank titlebar strip before normal drag',
    );
    const normalDragEnd = chooseDragEnd(
      stripPoint,
      restored.workArea,
      restored.dpi,
      180,
      120,
    );
    probe('Drag', {
      EndX: normalDragEnd.x,
      EndY: normalDragEnd.y,
      X: stripPoint.x,
      Y: stripPoint.y,
    });
    const afterNormalDrag = await waitForWindowState(
      probe,
      (state) =>
        !state.zoomed &&
        placementDistance(state.clientRect, resetNormal.clientRect) >=
          Math.round((40 * state.dpi) / 96),
      'normal window drag to move the client rect',
    );
    assertSameClientSize(
      afterNormalDrag.clientRect,
      resetNormal.clientRect,
      2,
      'Normal drag changed the client size.',
    );
    evidence.assertions.normalDrag = {
      passed: true,
      placement: afterNormalDrag.clientRect,
    };

    const resetAfterNormalDrag = probe('PlaceNormal', placement);
    assertPlacementNear(
      resetAfterNormalDrag.clientRect,
      resetNormal.clientRect,
      2,
      'Unable to restore the known normal placement after normal drag.',
    );

    stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'restored blank titlebar strip',
    );
    probe('DoubleClick', { X: stripPoint.x, Y: stripPoint.y });
    const beforeMaximizedDrag = await waitForWindowState(
      probe,
      (state) => state.zoomed,
      'maximize before drag-out',
    );
    assertMaximizedGeometry(beforeMaximizedDrag, 'maximize before drag-out');

    stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'maximized strip before drag-out',
    );
    const maximizedDragEnd = chooseDragEnd(
      stripPoint,
      beforeMaximizedDrag.workArea,
      beforeMaximizedDrag.dpi,
      220,
      180,
    );
    probe('Drag', {
      EndX: maximizedDragEnd.x,
      EndY: maximizedDragEnd.y,
      X: stripPoint.x,
      Y: stripPoint.y,
    });
    const afterMaximizedDrag = await waitForWindowState(
      probe,
      (state) =>
        !state.zoomed &&
        state.clientRect.width < state.workArea.width - 8 &&
        state.clientRect.height < state.workArea.height - 8 &&
        placementDistance(state.clientRect, resetNormal.clientRect) >=
          Math.round((40 * state.dpi) / 96),
      'dragging from maximized to restore and move',
    );
    assertNormalPlacement(afterMaximizedDrag, 'maximized drag-out placement');
    await waitForWindowControlState(
      page,
      false,
      'maximize button after dragging out of maximized',
    );
    assertSameClientSize(
      afterMaximizedDrag.clientRect,
      resetNormal.clientRect,
      3,
      'Dragging from maximized did not restore the saved normal size.',
    );
    evidence.assertions.maximizedDragOut = {
      passed: true,
      placement: afterMaximizedDrag.clientRect,
    };

    stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'dragged-out blank titlebar strip',
    );
    probe('DoubleClick', { X: stripPoint.x, Y: stripPoint.y });
    const remaximized = await waitForWindowState(
      probe,
      (state) => state.zoomed,
      'double click after maximized drag-out',
    );
    const remaximizeGeometry = assertMaximizedGeometry(
      remaximized,
      'double-click after maximized drag-out',
    );
    await assertWebviewMatchesClient(page, remaximized, 'remaximized state');
    await waitForWindowControlState(
      page,
      true,
      'maximize button after remaximizing',
    );
    evidence.assertions.doubleClickAfterDragOut = {
      geometry: remaximizeGeometry,
      passed: true,
    };

    stripPoint = await nativePointForLocator(
      page,
      page.locator('.lm-titlebar-drag'),
      probe,
      'remaximized blank titlebar strip',
    );
    probe('DoubleClick', { X: stripPoint.x, Y: stripPoint.y });
    const restoredBeforeInteractiveChecks = await waitForWindowState(
      probe,
      (state) => !state.zoomed,
      'restore before portal menu checks',
    );
    await waitForWindowControlState(
      page,
      false,
      'maximize button after final native restore',
    );

    evidence.assertions.maximizeButton = await verifyMaximizeButtonWithOsMouse(
      page,
      probe,
      restoredBeforeInteractiveChecks,
    );

    evidence.assertions.portalMenus = await verifyPortalMenusWithOsMouse(
      page,
      probe,
    );

    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      [
        '[release:installed-window-chrome] FAILED',
        error instanceof Error ? error.stack ?? error.message : String(error),
        `partial evidence: ${JSON.stringify(evidence ?? null)}`,
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

async function verifyMaximizeButtonWithOsMouse(page, probe, normalState) {
  assertNormalPlacement(normalState, 'normal state before maximize button check');
  await clickLocatorWithOsMouse(
    page,
    probe,
    page.getByRole('button', {
      name: /^(最大化窗口|Maximize window)$/,
    }),
    'maximize window button',
  );
  const maximized = await waitForWindowState(
    probe,
    (state) => state.zoomed,
    'maximize button to maximize',
  );
  const geometry = assertMaximizedGeometry(maximized, 'maximize button maximize');
  await assertWebviewMatchesClient(page, maximized, 'maximize button maximized state');
  await waitForWindowControlState(
    page,
    true,
    'restore label after maximize button click',
  );

  await clickLocatorWithOsMouse(
    page,
    probe,
    page.getByRole('button', {
      name: /^(还原窗口|Restore window)$/,
    }),
    'restore window button',
  );
  const restored = await waitForWindowState(
    probe,
    (state) => !state.zoomed,
    'maximize button to restore',
  );
  assertPlacementNear(
    restored.clientRect,
    normalState.clientRect,
    3,
    'Maximize button restore did not return to the saved normal placement.',
  );
  await waitForWindowControlState(
    page,
    false,
    'maximize label after restore button click',
  );

  return {
    geometry,
    passed: true,
    restoredPlacement: restored.clientRect,
  };
}

async function verifyPortalMenusWithOsMouse(page, probe) {
  const themeBefore = await page.locator('html').getAttribute('data-theme');
  await openTopMenuWithOsMouse(page, probe, /^(主题|Theme)$/);
  const themeTarget =
    themeBefore === 'dark'
      ? { expected: 'light', name: /^(亮色|Light)$/ }
      : { expected: 'dark', name: /^(暗色|Dark)$/ };
  await clickLocatorWithOsMouse(
    page,
    probe,
    page.getByRole('menuitemradio', { name: themeTarget.name }),
    `${themeTarget.expected} theme portal item`,
  );
  await page
    .locator(`html[data-theme="${themeTarget.expected}"]`)
    .waitFor({ state: 'attached', timeout: 5_000 });

  const languageBefore = await page.locator('html').getAttribute('lang');
  await openTopMenuWithOsMouse(page, probe, /^(语言|Language)$/);
  const languageTarget =
    languageBefore === 'en'
      ? { expected: 'zh-CN', name: '简体中文' }
      : { expected: 'en', name: 'English' };
  await clickLocatorWithOsMouse(
    page,
    probe,
    page.getByRole('menuitemradio', { name: languageTarget.name }),
    `${languageTarget.expected} language portal item`,
  );
  await page
    .locator(`html[lang="${languageTarget.expected}"]`)
    .waitFor({ state: 'attached', timeout: 5_000 });

  await openTopMenuWithOsMouse(page, probe, /^(帮助|Help)$/);
  await clickLocatorWithOsMouse(
    page,
    probe,
    page.getByRole('menuitem', { name: /^(关于 LumaMark|About LumaMark)$/ }),
    'About portal item',
  );
  const aboutDialog = page.getByRole('dialog', {
    name: /^(关于 LumaMark|About LumaMark)$/,
  });
  await aboutDialog.waitFor({ state: 'visible', timeout: 5_000 });
  await clickLocatorWithOsMouse(
    page,
    probe,
    aboutDialog.getByRole('button', { name: /^(关闭|Close)$/ }),
    'About close button',
  );
  await aboutDialog.waitFor({ state: 'hidden', timeout: 5_000 });

  return {
    aboutDialogOpened: true,
    languageChangedFrom: languageBefore,
    languageChangedTo: languageTarget.expected,
    passed: true,
    themeChangedFrom: themeBefore,
    themeChangedTo: themeTarget.expected,
  };
}

async function openTopMenuWithOsMouse(page, probe, name) {
  const trigger = page.getByRole('menuitem', { exact: true, name });
  await clickLocatorWithOsMouse(page, probe, trigger, `${name} menu trigger`);
  await waitForAttribute(trigger, 'data-state', 'open', 'top menu to open');
}

async function waitForWindowControlState(page, maximized, label) {
  const name = maximized
    ? /^(还原窗口|Restore window)$/
    : /^(最大化窗口|Maximize window)$/;
  await page
    .getByRole('button', { name })
    .waitFor({ state: 'visible', timeout: 5_000 })
    .catch(async (error) => {
      const ariaLabels = await page
        .locator('.lm-window-controls button')
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute('aria-label')),
        );
      throw new Error(
        `${label} did not expose the expected accessible name: ${JSON.stringify({ ariaLabels })}`,
        { cause: error },
      );
    });
}

async function clickLocatorWithOsMouse(page, probe, locator, label) {
  const point = await nativePointForLocator(page, locator, probe, label);
  probe('Click', { X: point.x, Y: point.y });
}

async function nativePointForLocator(page, locator, probe, label) {
  await locator.waitFor({ state: 'visible', timeout: 5_000 });
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

async function assertBlankNativeStrip(page, cssPoint) {
  const hitContract = await page.evaluate(({ x, y }) => {
    const strip = document.querySelector('.lm-titlebar-drag');
    const hit = document.elementFromPoint(x, y);
    return {
      hitClass: hit instanceof Element ? hit.className : null,
      isNativeStrip:
        strip instanceof Element &&
        hit instanceof Element &&
        hit.closest('[data-tauri-drag-region]') === strip,
      isInteractive:
        hit instanceof Element &&
        Boolean(
          hit.closest(
            '[data-lm-window-interactive], [role="menu"], [role^="menuitem"], .lm-menu-content',
          ),
        ),
    };
  }, cssPoint);
  if (!hitContract.isNativeStrip || hitContract.isInteractive) {
    throw new Error(
      `The chosen titlebar point is not an isolated native drag strip: ${JSON.stringify(
        hitContract,
      )}`,
    );
  }
}

async function assertWebviewMatchesClient(page, state, label) {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement.getBoundingClientRect();
    return {
      devicePixelRatio: window.devicePixelRatio,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      rootBottom: root.bottom,
      rootRight: root.right,
    };
  });
  const physicalWidth = metrics.innerWidth * metrics.devicePixelRatio;
  const physicalHeight = metrics.innerHeight * metrics.devicePixelRatio;
  if (
    Math.abs(physicalWidth - state.clientRect.width) > 2 ||
    Math.abs(physicalHeight - state.clientRect.height) > 2 ||
    metrics.rootRight > metrics.innerWidth + 0.5 ||
    metrics.rootBottom > metrics.innerHeight + 0.5
  ) {
    throw new Error(
      `${label} WebView/client geometry mismatch: ${JSON.stringify({ metrics, state })}`,
    );
  }
}

function assertMaximizedGeometry(state, label) {
  if (!state.zoomed) {
    throw new Error(`${label} is not reported by IsZoomed.`);
  }
  const edgeDelta = {
    bottom: state.clientRect.bottom - state.workArea.bottom,
    left: state.clientRect.left - state.workArea.left,
    right: state.clientRect.right - state.workArea.right,
    top: state.clientRect.top - state.workArea.top,
  };
  const staysInsideWorkArea =
    edgeDelta.left >= 0 &&
    edgeDelta.left <= 1 &&
    edgeDelta.top >= 0 &&
    edgeDelta.top <= 1 &&
    edgeDelta.right >= -1 &&
    edgeDelta.right <= 0 &&
    edgeDelta.bottom >= -1 &&
    edgeDelta.bottom <= 0;
  if (!staysInsideWorkArea) {
    throw new Error(
      `${label} does not cover the monitor work area: ${JSON.stringify({ edgeDelta, state })}`,
    );
  }
  return {
    clientRect: state.clientRect,
    edgeDelta,
    noBottomClipping: edgeDelta.bottom >= -1 && edgeDelta.bottom <= 0,
    noRightClipping: edgeDelta.right >= -1 && edgeDelta.right <= 0,
    workArea: state.workArea,
  };
}

function assertNormalPlacement(state, label) {
  if (state.zoomed) {
    throw new Error(`${label} is unexpectedly maximized.`);
  }
  const rect = state.clientRect;
  const work = state.workArea;
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.left < work.left ||
    rect.top < work.top ||
    rect.right > work.right ||
    rect.bottom > work.bottom
  ) {
    throw new Error(`${label} is not a reasonable normal rect: ${JSON.stringify(state)}`);
  }
}

function assertPlacementNear(actual, expected, tolerance, message) {
  for (const edge of ['bottom', 'left', 'right', 'top']) {
    if (Math.abs(actual[edge] - expected[edge]) > tolerance) {
      throw new Error(
        `${message} edge=${edge}, actual=${JSON.stringify(actual)}, expected=${JSON.stringify(
          expected,
        )}`,
      );
    }
  }
}

function assertSameClientSize(actual, expected, tolerance, message) {
  if (
    Math.abs(actual.width - expected.width) > tolerance ||
    Math.abs(actual.height - expected.height) > tolerance
  ) {
    throw new Error(
      `${message} actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)}`,
    );
  }
}

function placementDistance(actual, expected) {
  return Math.hypot(actual.left - expected.left, actual.top - expected.top);
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

function chooseDragEnd(point, workArea, dpi, horizontalDip, verticalDip) {
  const horizontal = Math.round((horizontalDip * dpi) / 96);
  const vertical = Math.round((verticalDip * dpi) / 96);
  const candidateX = point.x + horizontal;
  const x =
    candidateX < workArea.right - horizontal / 2
      ? candidateX
      : point.x - horizontal;
  return {
    x: Math.max(workArea.left + 20, Math.min(workArea.right - 20, x)),
    y: Math.max(
      workArea.top + 80,
      Math.min(workArea.bottom - 80, point.y + vertical),
    ),
  };
}

async function waitForWindowState(probe, predicate, label) {
  const deadline = Date.now() + 7_000;
  let latest;
  do {
    latest = probe('State');
    if (predicate(latest)) {
      return latest;
    }
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out. Last native state: ${JSON.stringify(latest)}`);
}

async function waitForAttribute(locator, name, expected, label) {
  const deadline = Date.now() + 5_000;
  let latest;
  do {
    latest = await locator.getAttribute(name);
    if (latest === expected) {
      return;
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out: expected ${name}=${expected}, received ${latest}.`);
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
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(
      `Win32 ${action} returned invalid JSON: ${result.stdout.trim()}`,
      { cause: error },
    );
  }
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
  if (!Array.isArray(existing)) {
    throw new Error(
      `Existing-process preflight returned invalid JSON: ${result.stdout.trim()}`,
    );
  }
  if (existing.length > 0) {
    throw new Error(
      `Close existing LumaMark processes before installed acceptance: ${JSON.stringify(
        existing,
      )}`,
    );
  }
}

function assertExactExecutable(actual, expected) {
  if (resolve(actual).toLowerCase() !== resolve(expected).toLowerCase()) {
    throw new Error(
      `Native HWND belongs to a different executable: expected ${expected}, received ${actual}.`,
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
    if (processState.exitCode !== null) {
      throw new Error(
        `Installed LumaMark child exited before WebView2 opened (exit ${processState.exitCode}). ` +
          'Close any pre-existing LumaMark instance and retry.',
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
      // Keep polling until the exact child exposes its WebView2 endpoint.
    }
    await delay(500);
  }
  throw new Error(`WebView2 debug endpoint did not open on port ${debugPort}.`);
}

function parseArguments(args) {
  const parsed = {
    debugPort: undefined,
    executablePath: undefined,
    expectedDpi: undefined,
    plan: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan') {
      parsed.plan = true;
      continue;
    }
    if (
      argument === '--executable' ||
      argument === '--expected-dpi' ||
      argument === '--debug-port'
    ) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === '--executable') {
        parsed.executablePath = value;
      } else if (argument === '--expected-dpi') {
        parsed.expectedDpi = parsePositiveInteger(value, argument);
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
