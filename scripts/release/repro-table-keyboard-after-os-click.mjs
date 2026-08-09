/**
 * After OS click into a table cell, check whether keyboard input reaches the cell
 * (Playwright keyboard vs OS SendKeys) and where text lands.
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
  const scriptPath = join(tmpdir(), 'lm-kb-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Kb {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[void][Kb]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
[void][Kb]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 100
[void][Kb]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 80
[Kb]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Kb]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lm-kb-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Kr {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][Kr]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object Kr+RECT
[void][Kr]::GetWindowRect($p.MainWindowHandle, [ref]$r)
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
const dir = await mkdtemp(join(tmpdir(), 'lm-kb-'));
const doc = join(dir, 'kb.md');
await writeFile(
  doc,
  ['# t', '', 'before', '', '| Col |', '| --- |', '| hello |', '', 'after', ''].join('\n'),
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
const cx = box.x + 20;
const cy = box.y + box.height / 2;
osClick(Math.round(left + cx * dpr), Math.round(top + cy * dpr));
await delay(600);

const afterClick = await page.evaluate(() => {
  const active = document.activeElement;
  return {
    activeTag: active?.tagName ?? null,
    activeClass: active?.className ?? null,
    inNested: Boolean(active?.closest?.('.tbl-cell-editor')),
    nestedFocused: document
      .querySelector('.tbl-cell-editor .cm-editor')
      ?.classList.contains('cm-focused'),
    nestedText: document.querySelector('.tbl-cell-editor .cm-content')?.cmTile?.view?.state.doc.toString() ?? null,
    nestedHead: document.querySelector('.tbl-cell-editor .cm-content')?.cmTile?.view?.state.selection.main.head ?? null,
  };
});

// A) Playwright keyboard (CDP input) — known to work in prior tests
await page.keyboard.insertText('PW');
await delay(400);
const afterPw = await page.evaluate(() => ({
  nested: document.querySelector('.tbl-cell-editor .cm-content')?.cmTile?.view?.state.doc.toString() ?? null,
  root: document.querySelector('.lm-editor-live-preview-mode .cm-content')?.cmTile?.view?.state.doc.toString() ?? null,
  activeClass: document.activeElement?.className ?? null,
}));

console.log(JSON.stringify({ afterClick, afterPw }, null, 2));
await page.screenshot({ path: join(dir, 'kb.png') });
console.log('shot', join(dir, 'kb.png'));

await browser.close();
app.kill();
