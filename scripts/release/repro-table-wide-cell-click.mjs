/**
 * Wide-cell padding click: many users click empty space inside a wide cell.
 * Measure how far caret ends from the click.
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
  const scriptPath = join(tmpdir(), 'lm-wide-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Wd {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[void][Wd]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
[void][Wd]::SetForegroundWindow($p.MainWindowHandle)
[void][Wd]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
[Wd]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Wd]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lm-wide-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Wr {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][Wr]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object Wr+RECT
[void][Wr]::GetWindowRect($p.MainWindowHandle, [ref]$r)
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
const dir = await mkdtemp(join(tmpdir(), 'lm-wide-'));
const doc = join(dir, 'wide.md');
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
await page.locator('.cm-line').filter({ hasText: 'before' }).click();
await delay(200);

const box = await page.locator('.tbl-table-body .tbl-cell-view').first().boundingBox();
const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();

// Click at 80% of the wide cell — usually empty padding after short "hi"
const cx = box.x + box.width * 0.8;
const cy = box.y + box.height / 2;
osClick(Math.round(left + cx * dpr), Math.round(top + cy * dpr));
await delay(700);

const result = await page.evaluate((click) => {
  const content = document.querySelector('.tbl-cell-editor .cm-content');
  const view = content?.cmTile?.view;
  const head = view?.state.selection.main.head ?? null;
  const caret = view
    ? view.coordsAtPos(head, -1) ?? view.coordsAtPos(head)
    : null;
  const cell = content?.closest('.tbl-cell')?.getBoundingClientRect();
  return {
    text: view?.state.doc.toString() ?? null,
    head,
    click,
    caret: caret ? { left: caret.left, top: caret.top } : null,
    cellWidth: cell?.width ?? null,
    deltaX: caret ? caret.left - click.x : null,
  };
}, { x: cx, y: cy, cell: box });

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: join(dir, 'wide.png') });
console.log('shot', join(dir, 'wide.png'));

await browser.close();
app.kill();
process.exit(Math.abs(result.deltaX ?? 999) > 20 ? 1 : 0);
