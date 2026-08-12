/**
 * Full Plan-A matrix against the *installed* exe using Win32 OS mouse clicks.
 * Exit 0 only when every case passes; prints JSON evidence either way.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';

const markdown = [
  '# title',
  '',
  'before',
  '',
  '| Left | Center | Right | WideHeaderThatUsedToStretchColumns |',
  '| :--- | :---: | ---: | --- |',
  '| hello world | mid | end | hi |',
  '| **bold cell** | 中文词 | `code` | [lab](https://example.com) |',
  '|  | empty-right | x | y |',
  '',
  'after',
  '',
].join('\n');

const inputDeadline = Date.now() + 180_000;
const mediaAcceptancePath = fileURLToPath(
  new URL('./verify-installed-media-caret-os.mjs', import.meta.url),
);
let app;
let appExit;
let browser;
let finalOutput;
let finalExitCode;
let tempDirectory;

try {
const port = await reserveDebugPort();
tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-matrix-'));
const documentPath = join(tempDirectory, 'matrix.md');
const win32HelperPath = join(tempDirectory, 'lumamark-win32-input.ps1');
await writeFile(documentPath, markdown, 'utf8');
execFileSync(
  process.execPath,
  [mediaAcceptancePath, '--write-win32-helper', win32HelperPath],
  { stdio: 'pipe', timeout: 15_000, windowsHide: true },
);

app = spawn(executablePath, [documentPath], {
  env: createPackagedWebviewEnvironment({
    baseEnvironment: process.env,
    debugPort: port,
    tempDirectory,
  }),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});
appExit = new Promise((resolveExit) => {
  app.once('exit', resolveExit);
  app.once('error', resolveExit);
});

let failedBoot = null;
for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
  } catch {
    // poll
  }
  if (i === 59) failedBoot = 'debug port never opened';
  await delay(500);
}

if (failedBoot) {
  throw new Error(failedBoot);
}

browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0];
try {
  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });
} catch (error) {
  const pages = await Promise.all(
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .map(async (candidate) => ({
        body: (await candidate.locator('body').innerText().catch(() => '')).slice(
          0,
          500,
        ),
        title: await candidate.title().catch(() => ''),
        url: candidate.url(),
      })),
  );
  console.error(
    JSON.stringify({ appExitCode: app.exitCode, pages, port }, null, 2),
  );
  throw error;
}
await page.locator('.tbl-table-widget').waitFor({ state: 'visible', timeout: 15_000 });
await delay(1000);

const osEvidence = [invokeWin32('Probe')];

function invokeWin32(action, options = {}) {
  if (!app?.pid) {
    throw new Error('The table OS matrix has no PID-bound application.');
  }
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
      '-DeadlineUnixMilliseconds',
      String(inputDeadline),
    ],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
  ).trim();
  const parsed = JSON.parse(stdout);
  if (parsed.processId !== app.pid || parsed.action !== action) {
    throw new Error(`Win32 helper returned mismatched ownership: ${stdout}`);
  }
  if (parsed.perMonitorV2 !== true || !Number.isFinite(parsed.dpi)) {
    throw new Error(`Win32 helper is not per-monitor-v2 DPI aware: ${stdout}`);
  }
  if (
    action === 'Click' &&
    (parsed.targetVerifiedBeforeInput !== true ||
      parsed.pointRootProcessId !== app.pid)
  ) {
    throw new Error(`Win32 click was not proven inside app.pid: ${stdout}`);
  }
  if (
    options.dpr !== undefined &&
    Math.abs(parsed.dpi / 96 - options.dpr) > 0.05
  ) {
    throw new Error(`WebView DPR and Win32 DPI disagree: ${stdout}`);
  }
  return parsed;
}

async function blurTable() {
  await page.locator('.cm-line').filter({ hasText: 'after' }).click();
  await delay(250);
}

async function osClickCss(cssX, cssY) {
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  osEvidence.push(invokeWin32('Click', { cssX, cssY, dpr }));
  await delay(650);
}

async function readActive() {
  return page.evaluate(() => {
    const content = document.querySelector('.tbl-cell-editor .cm-content');
    const view = content?.cmTile?.view;
    if (!view) {
      return { hasEditor: false };
    }
    const head = view.state.selection.main.head;
    const text = view.state.doc.toString();
    const caret =
      view.coordsAtPos(head, -1) ??
      view.coordsAtPos(head, 1) ??
      view.coordsAtPos(head);
    const marks = [...content.querySelectorAll('.lm-table-token-mark')].map(
      (el) => getComputedStyle(el).display,
    );
    return {
      hasEditor: true,
      head,
      text,
      caretLeft: caret?.left ?? null,
      contentPadding: getComputedStyle(content).padding,
      marksHidden: marks.length === 0 || marks.every((d) => d === 'none'),
      markCount: marks.length,
    };
  });
}

async function findGlyph(cellLocator, glyph, fraction = 0.5) {
  return cellLocator.locator('.tbl-cell-view').evaluate(
    (surface, target) => {
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = /** @type {Text} */ (walker.currentNode);
        if (
          node.parentElement &&
          getComputedStyle(node.parentElement).display === 'none'
        ) {
          continue;
        }
        const index = node.data.indexOf(target.glyph);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + target.glyph.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width * target.fraction,
          y: rect.top + rect.height / 2,
          glyphWidth: rect.width,
        };
      }
      throw new Error(`glyph ${target.glyph} missing`);
    },
    { glyph, fraction },
  );
}

function dataCell(row, col) {
  return page
    .locator('.tbl-table-body .tbl-table-row')
    .nth(row)
    .locator('.tbl-data-cell')
    .nth(col);
}

const results = [];

function pass(name, ok, detail) {
  results.push({ name, ok, ...detail });
}

// 1) Geometry: inactive padding == active padding
await blurTable();
const plainCell = dataCell(0, 0);
const inactivePadding = await plainCell
  .locator('.tbl-cell-view')
  .evaluate((el) => getComputedStyle(el).padding);
const g = await findGlyph(plainCell, 'w');
await osClickCss(g.x, g.y);
const afterPad = await readActive();
pass('inactive-active-padding', afterPad.contentPadding === inactivePadding, {
  inactivePadding,
  activePadding: afterPad.contentPadding,
});

// 2) Marks stay hidden after activation (bold cell)
await blurTable();
const boldCell = dataCell(1, 0);
const inactiveMarks = await boldCell.locator('.tbl-cell-view').evaluate((surface) =>
  [...surface.querySelectorAll('.lm-table-token-mark')].map(
    (el) => getComputedStyle(el).display,
  ),
);
const bg = await findGlyph(boldCell, 'b', 0.05);
await osClickCss(bg.x, bg.y);
const boldActive = await readActive();
const marksOk =
  inactiveMarks.every((d) => d === 'none') &&
  boldActive.marksHidden === true &&
  Math.abs(boldActive.caretLeft - bg.x) <= Math.max(3, bg.glyphWidth / 2 + 1);
pass('marks-hidden-and-bold-glyph', marksOk, {
  inactiveMarks,
  marksHidden: boldActive.marksHidden,
  deltaX: boldActive.caretLeft - bg.x,
  glyphWidth: bg.glyphWidth,
  head: boldActive.head,
  text: boldActive.text,
});

// 3) Glyph matrix: plain / CJK / code / link
const glyphCases = [
  { name: 'glyph-plain', row: 0, col: 0, glyph: 'w' },
  { name: 'glyph-cjk', row: 1, col: 1, glyph: '文' },
  { name: 'glyph-code', row: 1, col: 2, glyph: 'o' },
  { name: 'glyph-link', row: 1, col: 3, glyph: 'a', fraction: 0.2 },
];
for (const item of glyphCases) {
  await blurTable();
  const cell = dataCell(item.row, item.col);
  const point = await findGlyph(cell, item.glyph, item.fraction ?? 0.5);
  await osClickCss(point.x, point.y);
  const active = await readActive();
  const delta = Math.abs((active.caretLeft ?? 9999) - point.x);
  // Link labels are narrow; allow one extra CSS px for OS mouse quantization.
  const limit =
    item.name === 'glyph-link'
      ? Math.max(4, point.glyphWidth / 2 + 2)
      : Math.max(3, point.glyphWidth / 2 + 1);
  pass(item.name, active.hasEditor && delta <= limit, {
    delta,
    limit,
    head: active.head,
    text: active.text,
    clickX: point.x,
    caretLeft: active.caretLeft,
  });
}

// 4) Alignment L/C/R — row0: hello world | mid | end
const alignGlyphs = ['e', 'i', 'e'];
for (let col = 0; col < 3; col += 1) {
  await blurTable();
  const cell = dataCell(0, col);
  const p = await findGlyph(cell, alignGlyphs[col], 0.2);
  await osClickCss(p.x, p.y);
  const active = await readActive();
  const delta = Math.abs((active.caretLeft ?? 9999) - p.x);
  const limit = Math.max(3, p.glyphWidth / 2 + 1);
  pass(`align-col-${col}`, active.hasEditor && delta <= limit, {
    delta,
    limit,
    text: active.text,
    head: active.head,
  });
}

// 5) Empty cell → head 0, then type
await blurTable();
const emptyCell = dataCell(2, 0);
const emptyBox = await emptyCell.locator('.tbl-cell-view').boundingBox();
await osClickCss(emptyBox.x + 8, emptyBox.y + emptyBox.height / 2);
const emptyActive = await readActive();
if (emptyActive.hasEditor && emptyActive.head === 0 && emptyActive.text === '') {
  await page.keyboard.insertText('空');
  await delay(300);
  const afterType = await readActive();
  const typedOk = afterType.text === '空';
  pass('empty-cell-type', typedOk, {
    before: emptyActive,
    after: afterType,
  });
} else {
  pass('empty-cell-type', false, { emptyActive });
}

// 6) Wide header column tightened + padding → text end
await blurTable();
const wideCell = dataCell(0, 3);
const wideBox = await wideCell.locator('.tbl-cell-view').boundingBox();
await osClickCss(wideBox.x + wideBox.width - 3, wideBox.y + wideBox.height / 2);
const wideActive = await readActive();
pass(
  'wide-pad-to-end',
  wideActive.text === 'hi' && wideActive.head === 2,
  {
    width: wideBox.width,
    head: wideActive.head,
    text: wideActive.text,
    deltaX: (wideActive.caretLeft ?? 0) - (wideBox.x + wideBox.width - 3),
  },
);

// 7) Plain right pad → end
await blurTable();
const plainBox = await plainCell.locator('.tbl-cell-view').boundingBox();
await osClickCss(plainBox.x + plainBox.width - 3, plainBox.y + plainBox.height / 2);
const padActive = await readActive();
pass(
  'plain-right-pad-to-end',
  padActive.text === 'hello world' && padActive.head === padActive.text.length,
  {
    head: padActive.head,
    length: padActive.text?.length,
    deltaX: (padActive.caretLeft ?? 0) - (plainBox.x + plainBox.width - 3),
  },
);

const failed = results.filter((r) => !r.ok);
finalOutput = {
  executablePath,
  failed: failed.map((failure) => failure.name),
  osEvidence,
  results,
};
finalExitCode = failed.length ? 1 : 0;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  finalExitCode = 1;
} finally {
  const cleanupFailures = [];
  if (app?.pid && isProcessRunning(app.pid)) {
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
    if (isProcessRunning(app.pid)) {
      cleanupFailures.push(`spawned process ${app.pid} did not exit`);
    }
  }
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
    console.error(`Cleanup failed:\n${cleanupFailures.join('\n')}`);
    finalExitCode = 1;
  }
}

if (finalOutput) {
  console.log(JSON.stringify(finalOutput, null, 2));
  console.log(
    `\nSUMMARY pass=${finalOutput.results.length - finalOutput.failed.length}/${finalOutput.results.length}`,
  );
}
process.exitCode = finalExitCode;

function terminateProcessTree(processId) {
  execFileSync(
    'taskkill.exe',
    ['/PID', String(processId), '/T', '/F'],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true },
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
