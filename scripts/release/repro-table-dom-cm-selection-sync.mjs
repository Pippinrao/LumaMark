/**
 * Prove whether native DOM caret and nested CM selection disagree after OS click.
 */
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

function osClick(x, y) {
  const scriptPath = join(tmpdir(), 'lm-sync-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SyncC {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[void][SyncC]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
[void][SyncC]::SetForegroundWindow($p.MainWindowHandle)
[void][SyncC]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
[SyncC]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[SyncC]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`,
  );
  execFileSync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ]);
}

function windowRect() {
  const scriptPath = join(tmpdir(), 'lm-sync-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SyncR {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][SyncR]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object SyncR+RECT
[void][SyncR]::GetWindowRect($p.MainWindowHandle, [ref]$r)
Write-Output ("$($r.L),$($r.T)")
`,
  );
  const text = execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { encoding: 'utf8' },
  ).trim();
  const [left, top] = text.split(',').map(Number);
  return { left, top };
}

const exe =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';
const port = await reservePort();
const dir = await mkdtemp(join(tmpdir(), 'lm-sync-'));
const doc = join(dir, 'sync.md');
await writeFile(
  doc,
  ['# t', '', 'before', '', '| Col |', '| --- |', '| 点击这里world |', '', 'after', ''].join(
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

const point = await page.locator('.tbl-table-body .tbl-cell-view').first().evaluate((surface) => {
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = /** @type {Text} */ (walker.currentNode);
    const index = node.data.indexOf('里');
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  throw new Error('missing');
});

const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();
osClick(Math.round(left + point.x * dpr), Math.round(top + point.y * dpr));
await delay(700);

const snap = await page.evaluate((click) => {
  const content = document.querySelector('.tbl-cell-editor .cm-content');
  const view = content?.cmTile?.view;
  const cmHead = view?.state.selection.main.head ?? null;
  const cmCaret = view
    ? view.coordsAtPos(cmHead, -1) ?? view.coordsAtPos(cmHead)
    : null;
  const sel = document.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  let domTextOffset = null;
  if (content && range && content.contains(range.startContainer)) {
    const pre = document.createRange();
    pre.selectNodeContents(content);
    pre.setEnd(range.startContainer, range.startOffset);
    domTextOffset = pre.toString().length;
  }
  const domRect = range?.getBoundingClientRect();
  return {
    click,
    cm: {
      head: cmHead,
      text: view?.state.doc.toString() ?? null,
      caretLeft: cmCaret?.left ?? null,
      delta: cmCaret ? cmCaret.left - click.x : null,
    },
    dom: {
      offset: domTextOffset,
      anchorOffset: sel?.anchorOffset ?? null,
      focusOffset: sel?.focusOffset ?? null,
      nodeType: sel?.anchorNode?.nodeType ?? null,
      nodeText: sel?.anchorNode?.nodeType === 3 ? sel.anchorNode.data : sel?.anchorNode?.nodeName,
      rectLeft: domRect?.left ?? null,
      rectHeight: domRect?.height ?? null,
      delta: domRect && domRect.height > 0 ? domRect.left - click.x : null,
      withinEditor: Boolean(content && sel?.anchorNode && content.contains(sel.anchorNode)),
    },
    disagree: cmHead !== null && domTextOffset !== null && cmHead !== domTextOffset,
  };
}, point);

console.log(JSON.stringify(snap, null, 2));
await page.screenshot({ path: join(dir, 'sync.png') });
console.log('shot', join(dir, 'sync.png'));

// Also try Playwright click path for comparison
await page.locator('.cm-line').filter({ hasText: 'before' }).click();
await delay(200);
await page.mouse.click(point.x, point.y);
await delay(500);
const pw = await page.evaluate((click) => {
  const content = document.querySelector('.tbl-cell-editor .cm-content');
  const view = content?.cmTile?.view;
  const cmHead = view?.state.selection.main.head ?? null;
  const sel = document.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  let domTextOffset = null;
  if (content && range && content.contains(range.startContainer)) {
    const pre = document.createRange();
    pre.selectNodeContents(content);
    pre.setEnd(range.startContainer, range.startOffset);
    domTextOffset = pre.toString().length;
  }
  const cmCaret = view
    ? view.coordsAtPos(cmHead, -1) ?? view.coordsAtPos(cmHead)
    : null;
  const domRect = range?.getBoundingClientRect();
  return {
    cmHead,
    domTextOffset,
    disagree: cmHead !== null && domTextOffset !== null && cmHead !== domTextOffset,
    cmDelta: cmCaret ? cmCaret.left - click.x : null,
    domDelta: domRect && domRect.height > 0 ? domRect.left - click.x : null,
  };
}, point);
console.log('playwrightClick', JSON.stringify(pw, null, 2));

await browser.close();
app.kill();
process.exit(snap.disagree || Math.abs(snap.dom.delta ?? 99) > 10 ? 1 : 0);
