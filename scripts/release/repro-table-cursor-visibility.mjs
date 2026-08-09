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
  const scriptPath = join(tmpdir(), 'lm-cursor-vis-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Cv {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
[void][Cv]::SetProcessDPIAware()
[void][Cv]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 80
[Cv]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 40
[Cv]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lm-cursor-vis-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Rv {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][Rv]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object Rv+RECT
[void][Rv]::GetWindowRect($p.MainWindowHandle, [ref]$r)
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
const dir = await mkdtemp(join(tmpdir(), 'lm-vis-'));
const doc = join(dir, 'v.md');
await writeFile(
  doc,
  ['# t', '', 'before', '', '| A | B |', '| --- | --- |', '| hello world | x |', '', 'after', ''].join(
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

const target = page.locator('.tbl-table-body .tbl-cell-view').first();
const box = await target.boundingBox();
const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();
const cx = box.x + box.width * 0.75;
const cy = box.y + box.height * 0.5;
osClick(Math.round(left + cx * dpr), Math.round(top + cy * dpr));
await delay(700);

const info = await page.evaluate((click) => {
  const root = document.querySelector('.lm-editor-live-preview-mode > .cm-editor, .lm-codemirror .cm-editor');
  const nested = document.querySelector('.tbl-cell-editor .cm-editor');
  const cursors = [...document.querySelectorAll('.cm-cursor, .cm-cursor-primary')].map((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return {
      cls: el.className,
      w: r.width,
      h: r.height,
      left: r.left,
      top: r.top,
      display: st.display,
      visibility: st.visibility,
      opacity: st.opacity,
      inNested: Boolean(el.closest('.tbl-cell-editor')),
    };
  });
  const layers = [...document.querySelectorAll('.cm-cursorLayer')].map((el) => {
    const st = getComputedStyle(el);
    return {
      display: st.display,
      visibility: st.visibility,
      opacity: st.opacity,
      inNested: Boolean(el.closest('.tbl-cell-editor')),
    };
  });
  const nestedView = document.querySelector('.tbl-cell-editor .cm-content')?.cmTile?.view;
  const nestedHead = nestedView?.state.selection.main.head ?? null;
  const nestedCaret = nestedView
    ? nestedView.coordsAtPos(nestedHead, -1) ?? nestedView.coordsAtPos(nestedHead)
    : null;
  return {
    rootFocused: root?.classList.contains('cm-focused'),
    nestedFocused: nested?.classList.contains('cm-focused'),
    click,
    nested: {
      text: nestedView?.state.doc.toString() ?? null,
      head: nestedHead,
      caret: nestedCaret ? { left: nestedCaret.left, top: nestedCaret.top } : null,
      deltaX: nestedCaret ? nestedCaret.left - click.cx : null,
    },
    cursors,
    layers,
  };
}, { cx, cy });

console.log(JSON.stringify(info, null, 2));
const shot = join(dir, 'after-click.png');
await page.screenshot({ path: shot });
console.log('shot', shot);

await browser.close();
app.kill();
