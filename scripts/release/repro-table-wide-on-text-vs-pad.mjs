/**
 * Wide cell: click ON the short text vs click empty padding.
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
  const scriptPath = join(tmpdir(), 'lm-w2-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class W2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[void][W2]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
[void][W2]::SetForegroundWindow($p.MainWindowHandle)
[void][W2]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
[W2]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[W2]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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

function clientOrigin() {
  const scriptPath = join(tmpdir(), 'lm-w2-client.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class W2r {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  public struct POINT { public int X,Y; }
}
"@
[void][W2r]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$pt = New-Object W2r+POINT
$pt.X = 0; $pt.Y = 0
[void][W2r]::ClientToScreen($p.MainWindowHandle, [ref]$pt)
Write-Output ("$($pt.X),$($pt.Y)")
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
const dir = await mkdtemp(join(tmpdir(), 'lm-w2-'));
const doc = join(dir, 'w2.md');
await writeFile(
  doc,
  [
    '# t',
    '',
    'before',
    '',
    '| Very wide column title goes here | B |',
    '| -------------------------------- | - |',
    '| hi                               | x |',
    '',
    'after',
    '',
  ].join('\n'),
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

async function blur() {
  await page.locator('.cm-line').filter({ hasText: 'before' }).click();
  await delay(200);
}

async function measure(label, cssX, cssY) {
  await blur();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const { left, top } = clientOrigin();
  osClick(Math.round(left + cssX * dpr), Math.round(top + cssY * dpr));
  await delay(600);
  return page.evaluate(
    ({ label, cssX }) => {
      const content = document.querySelector('.tbl-cell-editor .cm-content');
      const view = content?.cmTile?.view;
      const head = view?.state.selection.main.head ?? null;
      const caret = view
        ? view.coordsAtPos(head, -1) ?? view.coordsAtPos(head)
        : null;
      return {
        label,
        text: view?.state.doc.toString() ?? null,
        head,
        clickX: cssX,
        caretLeft: caret?.left ?? null,
        deltaX: caret ? caret.left - cssX : null,
      };
    },
    { label, cssX },
  );
}

const glyph = await page.locator('.tbl-table-body .tbl-cell-view').first().evaluate((surface) => {
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = /** @type {Text} */ (walker.currentNode);
    const index = node.data.indexOf('h');
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  throw new Error('h missing');
});

const box = await page.locator('.tbl-table-body .tbl-cell-view').first().boundingBox();
const results = [
  await measure('on-glyph-h', glyph.x, glyph.y),
  await measure('pad-50', box.x + box.width * 0.5, box.y + box.height / 2),
  await measure('pad-80', box.x + box.width * 0.8, box.y + box.height / 2),
];

console.log(JSON.stringify(results, null, 2));
await browser.close();
app.kill();
