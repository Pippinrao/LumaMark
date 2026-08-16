/**
 * Installed Windows acceptance for the reading-mode render lock.
 *
 * CDP is observation-only. Every click, text input, and save shortcut is
 * delivered through the maintained Win32 SendInput helper to app.pid.
 */
import { execFileSync, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createAcceptanceSettingsEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const liveMarker = 'X';
const blockedMarker = 'BLOCKED_OS';
const initialMarkdown = [
  'before reading table',
  '',
  '| Content | Other |',
  '| ------- | ----- |',
  '| cell    | value |',
  '',
  'after reading table',
].join('\n');
const mediaHelperScript = fileURLToPath(
  new URL('./verify-installed-media-caret-os.mjs', import.meta.url),
);

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:installed-reading-mode-os] Windows and a freshly installed executable are required.\n',
  );
  process.exitCode = 1;
} else {
  await runWithWatchdog();
}

async function runWithWatchdog() {
  const executableEnvironment = process.env.LUMAMARK_EXECUTABLE?.trim();
  if (!executableEnvironment) {
    process.stderr.write(
      '[release:installed-reading-mode-os] LUMAMARK_EXECUTABLE must point to the freshly installed lumamark.exe.\n',
    );
    process.exitCode = 1;
    return;
  }

  const executablePath = resolve(executableEnvironment);
  const evidence = {
    actions: [],
    executablePath,
    pid: null,
    savedMarkdownExact: false,
    selectionUnchangedAfterBlockedInput: false,
    sourceUnchangedAfterBlockedInput: false,
    undoHistoryNotMeasuredByInstalledScript: true,
    watchdogExpired: false,
    win32: {
      clientToScreen: true,
      pointIsInTargetWindow: false,
      sendInput: true,
      targetVerifiedBeforeInput: false,
    },
  };
  const processOutput = { stderr: [], stdout: [] };
  const acceptanceAbort = new AbortController();
  const acceptanceDeadline = Date.now() + 180_000;
  let app;
  let appExit;
  let appStartError;
  let browser;
  let documentPath;
  let page;
  let successOutput;
  let tempDirectory;
  let win32HelperPath;

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
        '[release:installed-reading-mode-os] Global watchdog expired after 180 seconds.',
      ),
    );
  }, Math.max(0, acceptanceDeadline - Date.now()));

  const acceptanceDelay = (milliseconds) =>
    delay(milliseconds, undefined, { signal: acceptanceAbort.signal });

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
    evidence.actions.push({ ...parsed, label: options.label ?? action });
    if (action === 'Click') {
      evidence.win32.pointIsInTargetWindow = true;
      evidence.win32.targetVerifiedBeforeInput = true;
    }
    return parsed;
  }

  async function clickLocatorWithWin32(
    locator,
    label,
    { xRatio = 0.5 } = {},
  ) {
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
    await locator.evaluate((element, pointerLabel) => {
      const observation = window.__lumamarkReadingModeOsObservation;
      if (!observation) {
        throw new Error('Reading-mode OS observation bridge is unavailable.');
      }
      observation.pendingPointer = { element, label: pointerLabel };
    }, label);
    const result = invokeWin32('Click', {
      cssX: box.x + box.width * xRatio,
      cssY: box.y + box.height / 2,
      dpr: viewport.dpr,
      label,
      viewportHeight: viewport.height,
      viewportWidth: viewport.width,
    });
    await page.waitForFunction(
      (pointerLabel) =>
        window.__lumamarkReadingModeOsObservation?.trustedPointers.some(
          (entry) =>
            entry.label === pointerLabel && entry.matchesExpectedTarget,
        ) ?? false,
      label,
      { timeout: 5_000 },
    );
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

  async function readTableLockState() {
    return page.evaluate(() => {
      const nested = [
        ...document.querySelectorAll('.tbl-cell-editor .cm-content'),
      ];
      const previews = [
        ...document.querySelectorAll('.tbl-table-widget .tbl-cell-view'),
      ];
      const nestedStates = nested.map((element) => {
        const view = element?.cmTile?.view;
        const editableFacet = view?.constructor?.editable;
        return {
          ariaReadOnly: element.getAttribute('aria-readonly'),
          contentEditable: element.getAttribute('contenteditable'),
          doc: view?.state.doc.toString() ?? null,
          editable:
            view && editableFacet ? view.state.facet(editableFacet) : null,
          hasFocus: view?.hasFocus ?? false,
          readOnly: view?.state.readOnly ?? null,
          selection: view?.state.selection.toJSON() ?? null,
        };
      });
      return {
        nestedStates,
        nestedContentEditable: nested.map((element) =>
          element.getAttribute('contenteditable'),
        ),
        nestedTotal: nested.length,
        nestedVisible: nested.filter(
          (element) =>
            element instanceof HTMLElement &&
            element.getClientRects().length > 0,
        ).length,
        previewAriaReadOnly: previews.map((element) =>
          element.getAttribute('aria-readonly'),
        ),
        previewContentEditable: previews.map((element) =>
          element.getAttribute('contenteditable'),
        ),
        previewTabIndex: previews.map((element) =>
          element.getAttribute('tabindex'),
        ),
      };
    });
  }

  async function installObservationBridge() {
    await page.evaluate(() => {
      const observation = {
        pendingPointer: null,
        readOnlyFlashCount: 0,
        trustedPointers: [],
      };
      window.__lumamarkReadingModeOsObservation = observation;
      document.addEventListener(
        'pointerdown',
        (event) => {
          const pending = observation.pendingPointer;
          if (!pending) {
            return;
          }
          const target = event.target;
          observation.trustedPointers.push({
            isTrusted: event.isTrusted,
            label: pending.label,
            matchesExpectedTarget:
              event.isTrusted &&
              target instanceof Node &&
              (target === pending.element || pending.element.contains(target)),
          });
          observation.pendingPointer = null;
        },
        true,
      );
      let flashActive = false;
      const observeReadOnlyFlash = () => {
        const active =
          document
            .querySelector('[data-testid="status-readonly"]')
            ?.classList.contains('lm-status-readonly-flash') ?? false;
        if (active && !flashActive) {
          observation.readOnlyFlashCount += 1;
        }
        flashActive = active;
      };
      new MutationObserver(observeReadOnlyFlash).observe(document.body, {
        attributeFilter: ['class'],
        attributes: true,
        childList: true,
        subtree: true,
      });
      observeReadOnlyFlash();
    });
  }

  async function readObservation() {
    return page.evaluate(() => {
      const observation = window.__lumamarkReadingModeOsObservation;
      if (!observation) {
        throw new Error('Reading-mode OS observation bridge is unavailable.');
      }
      return {
        readOnlyFlashCount: observation.readOnlyFlashCount,
        trustedPointers: observation.trustedPointers.map((entry) => ({
          ...entry,
        })),
      };
    });
  }

  async function runAcceptance() {
    await access(executablePath);
    acceptanceAbort.signal.throwIfAborted();
    const executableStats = await stat(executablePath);
    evidence.executable = {
      modifiedAt: executableStats.mtime.toISOString(),
      size: executableStats.size,
    };

    const port = await reserveDebugPort(
      parseRequestedPort(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT),
    );
    tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-menu-context-os-reading-mode-os-'));
    documentPath = join(tempDirectory, 'installed-reading-mode.md');
    win32HelperPath = join(tempDirectory, 'lumamark-win32-input.ps1');
    await writeFile(documentPath, initialMarkdown, 'utf8');
    acceptanceAbort.signal.throwIfAborted();
    execFileSync(
      process.execPath,
      [mediaHelperScript, '--write-win32-helper', win32HelperPath],
      {
        cwd: dirname(mediaHelperScript),
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
      },
    );
    await access(win32HelperPath);
    acceptanceAbort.signal.throwIfAborted();

    app = spawn(executablePath, [documentPath], {
      cwd: tempDirectory,
      env: await createAcceptanceSettingsEnvironment({
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
    app.stdout?.on('data', (chunk) => processOutput.stdout.push(String(chunk)));
    app.stderr?.on('data', (chunk) => processOutput.stderr.push(String(chunk)));

    await waitForDebugEndpoint(port, () => ({
      error: appStartError,
      exitCode: app.exitCode,
    }), acceptanceDelay);
    acceptanceAbort.signal.throwIfAborted();
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    page =
      context.pages()[0] ??
      (await context.waitForEvent('page', { timeout: 5_000 }));
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await page
      .locator('.lm-editor-title', { hasText: basename(documentPath) })
      .waitFor({ state: 'visible', timeout: 20_000 });
    await page
      .locator('.cm-editor.lm-editor-live-preview-mode')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await page
      .locator('.tbl-table-widget')
      .waitFor({ state: 'visible', timeout: 20_000 });
    await installObservationBridge();

    invokeWin32('Probe');

    const liveCellPreview = page
      .locator('.tbl-table-body .tbl-table-row')
      .first()
      .locator('.tbl-cell-view')
      .first();
    await clickLocatorWithWin32(
      liveCellPreview,
      'activate-live-table-cell',
      { xRatio: 0.9 },
    );
    const liveNestedContent = page.locator(
      '.tbl-cell-editor .cm-content:visible',
    );
    await liveNestedContent.waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const content = [
          ...document.querySelectorAll('.tbl-cell-editor .cm-content'),
        ].find(
          (element) =>
            element instanceof HTMLElement &&
            element.getClientRects().length > 0,
        );
        return content?.cmTile?.view?.hasFocus ?? false;
      },
      undefined,
      { timeout: 5_000 },
    );
    const liveTableBeforeInput = await readTableLockState();
    const liveRootBeforeInput = await readRootState();
    const liveActiveNestedBefore = liveTableBeforeInput.nestedStates.find(
      (state) => state.hasFocus,
    );
    if (
      !liveActiveNestedBefore ||
      liveTableBeforeInput.nestedTotal !== 1 ||
      liveActiveNestedBefore.readOnly !== false ||
      liveActiveNestedBefore.editable !== true ||
      typeof liveActiveNestedBefore.doc !== 'string' ||
      liveActiveNestedBefore.selection?.ranges?.length !== 1
    ) {
      throw new Error(
        `OS click did not activate the intended nested editor: ${JSON.stringify(liveTableBeforeInput)}`,
      );
    }
    const liveNestedRange = liveActiveNestedBefore.selection.ranges[0];
    if (
      liveNestedRange.anchor !== liveNestedRange.head ||
      liveNestedRange.head !== liveActiveNestedBefore.doc.length
    ) {
      throw new Error(
        `OS padding click did not place a collapsed caret at the active cell end: ${JSON.stringify(liveActiveNestedBefore)}`,
      );
    }
    const liveNestedFrom = Math.min(
      liveNestedRange.anchor,
      liveNestedRange.head,
    );
    const liveNestedTo = Math.max(liveNestedRange.anchor, liveNestedRange.head);
    const expectedNestedDocument = `${liveActiveNestedBefore.doc.slice(0, liveNestedFrom)}${liveMarker}${liveActiveNestedBefore.doc.slice(liveNestedTo)}`;
    const expectedNestedSelectionHead = liveNestedFrom + liveMarker.length;
    const rootCellStart = liveRootBeforeInput.source.indexOf(
      liveActiveNestedBefore.doc,
    );
    const rootPaddingPosition = rootCellStart + liveActiveNestedBefore.doc.length;
    if (
      liveMarker.length !== 1 ||
      rootCellStart < 0 ||
      liveRootBeforeInput.source.indexOf(
        liveActiveNestedBefore.doc,
        rootCellStart + 1,
      ) !== -1 ||
      liveRootBeforeInput.source[rootPaddingPosition] !== ' '
    ) {
      throw new Error(
        `The active cell is not uniquely mapped to one replaceable padding character: ${JSON.stringify({ liveActiveNestedBefore, liveRootBeforeInput })}`,
      );
    }
    const expectedRootDocument = `${liveRootBeforeInput.source.slice(0, rootPaddingPosition)}${liveMarker}${liveRootBeforeInput.source.slice(rootPaddingPosition + liveMarker.length)}`;
    invokeWin32('Unicode', { label: 'live-cell-unicode', text: liveMarker });
    await page.waitForFunction(
      (marker) => {
        const content = document.querySelector(
          '.cm-editor.lm-editor-live-preview-mode > .cm-scroller > .cm-content',
        );
        const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
        return view?.state.doc.toString().includes(marker) ?? false;
      },
      liveMarker,
      { timeout: 10_000 },
    );

    const liveEditedState = await readRootState();
    const liveTableAfterInput = await readTableLockState();
    const liveActiveNestedAfter = liveTableAfterInput.nestedStates.find(
      (state) => state.hasFocus,
    );
    const liveNestedAfterRange =
      liveActiveNestedAfter?.selection?.ranges?.[0] ?? null;
    if (
      liveEditedState.readOnly ||
      liveEditedState.source !== expectedRootDocument ||
      countOccurrences(liveEditedState.source, liveMarker) !== 1 ||
      liveActiveNestedAfter?.doc !== expectedNestedDocument ||
      liveActiveNestedAfter.readOnly !== false ||
      liveActiveNestedAfter.editable !== true ||
      liveTableAfterInput.nestedTotal !== 1 ||
      liveNestedAfterRange?.anchor !== expectedNestedSelectionHead ||
      liveNestedAfterRange.head !== expectedNestedSelectionHead
    ) {
      throw new Error(
        `Real OS input did not edit exactly the active table cell: ${JSON.stringify({ expectedNestedDocument, expectedNestedSelectionHead, expectedRootDocument, liveActiveNestedAfter, liveEditedState })}`,
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

    const readingState = await readRootState();
    if (
      !readingState.readOnly ||
      readingState.source !== liveEditedState.source ||
      !sameJson(readingState.selection, liveEditedState.selection)
    ) {
      throw new Error(
        `Entering reading mode changed source/selection or failed to lock: ${JSON.stringify({ liveEditedState, readingState })}`,
      );
    }

    const tableLockState = await readTableLockState();
    if (
      tableLockState.nestedTotal !== 1 ||
      tableLockState.nestedVisible !== 0 ||
      tableLockState.nestedStates.some(
        (state) =>
          state.ariaReadOnly !== 'true' ||
          state.contentEditable !== 'false' ||
          state.doc !== liveActiveNestedAfter.doc ||
          state.editable !== false ||
          state.readOnly !== true ||
          !sameJson(state.selection, liveActiveNestedAfter.selection),
      ) ||
      tableLockState.nestedContentEditable.some((value) => value !== 'false') ||
      tableLockState.previewAriaReadOnly.some((value) => value !== 'true') ||
      tableLockState.previewContentEditable.some((value) => value !== 'false') ||
      tableLockState.previewTabIndex.some((value) => value !== null)
    ) {
      throw new Error(
        `Installed table surfaces do not satisfy the reading lock: ${JSON.stringify(tableLockState)}`,
      );
    }
    evidence.tableLockState = tableLockState;

    const readingPreview = page
      .locator('.tbl-table-body .tbl-table-row')
      .first()
      .locator('.tbl-cell-view')
      .first();
    const feedbackBeforePreviewClick = (await readObservation())
      .readOnlyFlashCount;
    await clickLocatorWithWin32(readingPreview, 'click-locked-table-preview');
    const afterPreviewClick = await readRootState();
    const nestedAfterPreviewClick = await readTableLockState();
    const feedbackAfterPreviewClick = (await readObservation())
      .readOnlyFlashCount;
    if (
      afterPreviewClick.source !== readingState.source ||
      !sameJson(afterPreviewClick.selection, readingState.selection) ||
      !sameJson(nestedAfterPreviewClick.nestedStates, tableLockState.nestedStates) ||
      feedbackAfterPreviewClick !== feedbackBeforePreviewClick
    ) {
      throw new Error(
        `OS click on the locked preview changed editor state: ${JSON.stringify({ afterPreviewClick, nestedAfterPreviewClick })}`,
      );
    }

    const readingParagraph = page
      .locator('.cm-line')
      .filter({ hasText: 'after reading table' });
    await clickLocatorWithWin32(readingParagraph, 'focus-reading-root');
    await page.waitForFunction(
      () => {
        const content = document.querySelector(
          '.cm-editor.lm-editor-reading-mode > .cm-scroller > .cm-content',
        );
        const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
        return view?.hasFocus ?? false;
      },
      undefined,
      { timeout: 5_000 },
    );
    const focusedReadingState = await readRootState();
    const focusedNestedState = await readTableLockState();
    const feedbackBefore = (await readObservation()).readOnlyFlashCount;
    invokeWin32('Unicode', {
      label: 'blocked-reading-unicode',
      text: blockedMarker,
    });
    await page.waitForFunction(
      (previousCount) =>
        (window.__lumamarkReadingModeOsObservation?.readOnlyFlashCount ?? 0) >
        previousCount,
      feedbackBefore,
      { timeout: 5_000 },
    );

    const afterBlockedInput = await readRootState();
    const nestedAfterBlockedInput = await readTableLockState();
    evidence.sourceUnchangedAfterBlockedInput =
      afterBlockedInput.source === focusedReadingState.source &&
      !afterBlockedInput.source.includes(blockedMarker);
    evidence.selectionUnchangedAfterBlockedInput = sameJson(
      afterBlockedInput.selection,
      focusedReadingState.selection,
    );
    if (
      !evidence.sourceUnchangedAfterBlockedInput ||
      !evidence.selectionUnchangedAfterBlockedInput ||
      !afterBlockedInput.hasFocus ||
      !sameJson(
        nestedAfterBlockedInput.nestedStates,
        focusedNestedState.nestedStates,
      )
    ) {
      throw new Error(
        `Real OS input escaped the reading lock: ${JSON.stringify({ afterBlockedInput, focusedReadingState, nestedAfterBlockedInput })}`,
      );
    }
    evidence.observation = await readObservation();

    invokeWin32('Save');
    await page.waitForFunction(
      () => {
        const status =
          document.querySelector('[role="status"]')?.textContent ?? '';
        const title = document.querySelector('.lm-editor-title')?.textContent ?? '';
        return /Saved|已保存/.test(status) && !title.includes('*');
      },
      undefined,
      { timeout: 15_000 },
    );
    const savedMarkdown = await waitForExactFile(
      documentPath,
      readingState.source,
      acceptanceDelay,
    );
    evidence.savedMarkdownExact = savedMarkdown === readingState.source;
    if (!evidence.savedMarkdownExact) {
      throw new Error(
        `Saved Markdown differs from the locked in-memory source.\nExpected:\n${readingState.source}\nActual:\n${savedMarkdown}`,
      );
    }

    successOutput = {
      installedReadingModeOs: true,
      ...evidence,
      finalSelection: afterBlockedInput.selection,
    };
  }

  const runAcceptancePromise = runAcceptance();
  try {
    await Promise.race([runAcceptancePromise, acceptanceWatchdogFailure]);
  } catch (error) {
    const failureState = evidence.watchdogExpired
      ? { observationSkipped: 'Global watchdog expired.' }
      : page
      ? await Promise.race([
          Promise.all([readRootState(), readTableLockState()]).then(
            ([root, table]) => ({ root, table }),
          ),
          delay(5_000).then(() => ({ observationSkipped: 'timed out' })),
        ]).catch((observationError) => ({
          observationError: String(observationError),
        }))
      : null;
    if (page && !evidence.watchdogExpired) {
      const screenshotDirectory = join(process.cwd(), 'test-results');
      await mkdir(screenshotDirectory, { recursive: true }).catch(() => {});
      const screenshotPath = join(
        screenshotDirectory,
        `installed-reading-mode-os-${Date.now()}.png`,
      );
      await page
        .screenshot({ fullPage: true, path: screenshotPath, timeout: 5_000 })
        .then(() => {
          evidence.screenshot = screenshotPath;
        })
        .catch((screenshotError) => {
          evidence.screenshotError = String(screenshotError);
        });
    }
    process.stderr.write(
      [
        '[release:installed-reading-mode-os] FAILED',
        error instanceof Error ? error.stack ?? error.message : String(error),
        JSON.stringify({ evidence, failureState, processOutput }, null, 2),
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
    await awaitRunAcceptanceShutdown(
      runAcceptancePromise,
      cleanupFailures,
    );
    if (browser) {
      await Promise.race([
        browser.close(),
        delay(5_000).then(() => {
          throw new Error('CDP browser.close exceeded 5 seconds.');
        }),
      ]).catch((error) => {
        cleanupFailures.push(`CDP close: ${String(error)}`);
      });
    }
    if (tempDirectory) {
      await removePackagedWebviewTempDirectory(tempDirectory).catch((error) => {
        cleanupFailures.push(`temporary directory removal: ${String(error)}`);
      });
    }
    if (cleanupFailures.length > 0) {
      process.stderr.write(
        `[release:installed-reading-mode-os] Cleanup failed:\n${cleanupFailures.join('\n')}\n`,
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
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

async function waitForDebugEndpoint(port, getProcessState, wait) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const processState = getProcessState();
    if (processState.error) {
      throw processState.error;
    }
    if (processState.exitCode !== null) {
      throw new Error(
        `Installed LumaMark exited before WebView2 opened (exit ${processState.exitCode}).`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // WebView2 has not opened the debugging endpoint yet.
    }
    await wait(150);
  }
  throw new Error(`WebView2 debug endpoint did not open on port ${port}.`);
}

function parseRequestedPort(value) {
  if (!value) {
    return undefined;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid LUMAMARK_WEBVIEW_DEBUG_PORT: ${value}`);
  }
  return port;
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
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

function terminateProcessTree(processId) {
  execFileSync('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
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
