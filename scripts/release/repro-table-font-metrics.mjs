/**
 * Measure inactive cell-view font metrics vs nested cell-editor metrics.
 * A font-size mismatch would shift caret after activation.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

const exe =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';
const port = await reservePort();
const dir = await mkdtemp(join(tmpdir(), 'lm-font-'));
const doc = join(dir, 'font.md');
await writeFile(
  doc,
  ['# t', '', 'before', '', '| Col |', '| --- |', '| hello world 中文 |', '', 'after', ''].join(
    '\n',
  ),
);

const app = spawn(exe, [doc], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});

for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
  } catch {
    // poll
  }
  await delay(500);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0];
await page
  .getByRole('banner')
  .getByRole('heading', { name: /lumamark/i })
  .waitFor({ state: 'visible', timeout: 20_000 });
await page.locator('.tbl-table-widget').waitFor({ state: 'visible', timeout: 15_000 });
await delay(800);
await page.locator('.cm-line').filter({ hasText: 'before' }).click();
await delay(200);

const before = await page.locator('.tbl-table-body .tbl-cell-view').first().evaluate((surface) => {
  const style = getComputedStyle(surface);
  const scroller = document.querySelector('.lm-codemirror .cm-scroller');
  const rootStyle = scroller ? getComputedStyle(scroller) : null;
  const glyph = [...surface.querySelectorAll('*')].find(() => false);
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  let helloWidth = null;
  while (walker.nextNode()) {
    const node = /** @type {Text} */ (walker.currentNode);
    if (!node.data.includes('hello')) continue;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 5);
    helloWidth = range.getBoundingClientRect().width;
    break;
  }
  return {
    cellFontSize: style.fontSize,
    cellFontFamily: style.fontFamily,
    cellLineHeight: style.lineHeight,
    cellPadding: style.padding,
    rootScrollerFontSize: rootStyle?.fontSize ?? null,
    helloWidth,
    tblVar: style.getPropertyValue('--tbl-style-font-size'),
  };
});

await page.locator('.tbl-table-body .tbl-cell-view').first().click({ position: { x: 30, y: 10 } });
await delay(500);

const after = await page.evaluate(() => {
  const content = document.querySelector('.tbl-cell-editor .cm-content');
  const scroller = document.querySelector('.tbl-cell-editor .cm-scroller');
  const editor = document.querySelector('.tbl-cell-editor .cm-editor');
  const cStyle = content ? getComputedStyle(content) : null;
  const sStyle = scroller ? getComputedStyle(scroller) : null;
  const eStyle = editor ? getComputedStyle(editor) : null;
  let helloWidth = null;
  if (content) {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = /** @type {Text} */ (walker.currentNode);
      if (!node.data.includes('hello')) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 5);
      helloWidth = range.getBoundingClientRect().width;
      break;
    }
  }
  return {
    contentFontSize: cStyle?.fontSize ?? null,
    contentFontFamily: cStyle?.fontFamily ?? null,
    contentLineHeight: cStyle?.lineHeight ?? null,
    contentPadding: cStyle?.padding ?? null,
    scrollerFontSize: sStyle?.fontSize ?? null,
    editorFontSize: eStyle?.fontSize ?? null,
    helloWidth,
  };
});

console.log(JSON.stringify({ before, after, widthDelta: (after.helloWidth ?? 0) - (before.helloWidth ?? 0) }, null, 2));

await browser.close();
app.kill();
process.exit(Math.abs((after.helloWidth ?? 0) - (before.helloWidth ?? 0)) > 0.5 ? 1 : 0);
