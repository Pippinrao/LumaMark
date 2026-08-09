/**
 * Overlay click (lime) and measured caret (red) markers, then screenshot.
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
  const scriptPath = join(tmpdir(), 'lm-mark-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Mk {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[void][Mk]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
[void][Mk]::SetForegroundWindow($p.MainWindowHandle)
[void][Mk]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
[Mk]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Mk]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lm-mark-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Mr {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][Mr]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object Mr+RECT
[void][Mr]::GetWindowRect($p.MainWindowHandle, [ref]$r)
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
const dir = await mkdtemp(join(tmpdir(), 'lm-mark-'));
const doc = join(dir, 'mark.md');
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
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      glyph: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    };
  }
  throw new Error('missing');
});

const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();
osClick(Math.round(left + point.x * dpr), Math.round(top + point.y * dpr));
await delay(700);

const measured = await page.evaluate((click) => {
  const content = document.querySelector('.tbl-cell-editor .cm-content');
  const view = content?.cmTile?.view;
  const head = view?.state.selection.main.head ?? null;
  const caret = view
    ? view.coordsAtPos(head, -1) ?? view.coordsAtPos(head)
    : null;
  const sel = document.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  const domRect = range?.getBoundingClientRect();

  for (const id of ['lm-click-mark', 'lm-caret-mark', 'lm-dom-mark']) {
    document.getElementById(id)?.remove();
  }

  const add = (id, x, y, color, label) => {
    const el = document.createElement('div');
    el.id = id;
    el.style.cssText = `position:fixed;left:${x - 1}px;top:${y - 20}px;width:2px;height:40px;background:${color};z-index:999999;pointer-events:none;`;
    el.title = label;
    const tag = document.createElement('div');
    tag.style.cssText = `position:fixed;left:${x + 4}px;top:${y - 34}px;color:${color};font:12px monospace;z-index:999999;pointer-events:none;background:#000c;padding:1px 4px;`;
    tag.textContent = label;
    document.body.append(el, tag);
  };

  add('lm-click-mark', click.x, click.y, '#00ff66', 'CLICK');
  if (caret) add('lm-caret-mark', caret.left, caret.top + 10, '#ff3355', `CM@${head}`);
  if (domRect && domRect.height > 0) {
    add('lm-dom-mark', domRect.left, domRect.top + 10, '#3399ff', 'DOM');
  }

  return {
    head,
    text: view?.state.doc.toString() ?? null,
    click,
    caret: caret ? { left: caret.left, top: caret.top } : null,
    dom: domRect ? { left: domRect.left, top: domRect.top, height: domRect.height } : null,
    deltaCm: caret ? caret.left - click.x : null,
    deltaDom: domRect && domRect.height > 0 ? domRect.left - click.x : null,
  };
}, point);

console.log(JSON.stringify(measured, null, 2));
const shot = join(dir, 'marked.png');
await page.screenshot({ path: shot });
console.log('shot', shot);

await browser.close();
app.kill();
