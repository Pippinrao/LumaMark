/**
 * Capture-phase event diff on INSTALLED app:
 * Playwright click (works) vs OS mouse_event click (fails) on the same Dark radio.
 */
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
  const scriptPath = join(tmpdir(), 'lumamark-event-diff-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OsClick2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][OsClick2]::SetProcessDPIAware()
[void][OsClick2]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 80
[OsClick2]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[OsClick2]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lumamark-event-diff-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class R {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][R]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object R+RECT
[void][R]::GetWindowRect($p.MainWindowHandle, [ref]$r)
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

const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';

const port = await reservePort();
const env = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
};
delete env.WEBVIEW2_USER_DATA_FOLDER;

const app = spawn(executablePath, [], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});

for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
  } catch {
    // poll
  }
  await delay(500);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0];
await delay(2000);

await page.evaluate(() => {
  const w = window;
  w.__lmMenuEvents = [];
  const push = (phase, type, event) => {
    const path = event.composedPath().filter((n) => n instanceof Element).slice(0, 8);
    w.__lmMenuEvents.push({
      phase,
      type,
      timeStamp: event.timeStamp,
      defaultPrevented: event.defaultPrevented,
      cancelable: event.cancelable,
      eventType: event.constructor.name,
      pointerType: 'pointerType' in event ? event.pointerType : null,
      button: 'button' in event ? event.button : null,
      detail: event.detail,
      targetTag: event.target instanceof Element ? event.target.tagName : null,
      targetRole:
        event.target instanceof Element ? event.target.getAttribute('role') : null,
      targetClass:
        event.target instanceof Element ? event.target.className : null,
      path: path.map((el) => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        cls: el.className?.toString?.().slice?.(0, 80) ?? '',
        drag: el.getAttribute('data-tauri-drag-region'),
      })),
    });
  };

  for (const type of [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'pointercancel',
  ]) {
    document.addEventListener(type, (event) => push('bubble', type, event), false);
    document.addEventListener(type, (event) => push('capture', type, event), true);
  }
});

async function dump(label) {
  const events = await page.evaluate(() => {
    const w = window;
    const copy = w.__lmMenuEvents ?? [];
    w.__lmMenuEvents = [];
    return copy;
  });
  const theme = await page.locator('html').getAttribute('data-theme');
  console.log(`\n===== ${label} theme=${theme} events=${events.length} =====`);
  for (const event of events) {
    if (!['pointerdown', 'mousedown', 'click', 'pointerup', 'mouseup'].includes(event.type)) {
      continue;
    }
    if (event.phase !== 'capture') continue;
    console.log(
      JSON.stringify({
        type: event.type,
        ctor: event.eventType,
        pointerType: event.pointerType,
        defaultPrevented: event.defaultPrevented,
        role: event.targetRole,
        cls: event.targetClass,
        pathDrag: event.path.map((p) => p.drag),
        pathRoles: event.path.map((p) => p.role),
      }),
    );
  }
  return { events, theme };
}

// Reset light
await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await page.getByRole('menuitemradio', { name: '亮色' }).click();
await delay(300);
await page.evaluate(() => {
  window.__lmMenuEvents = [];
});

// A) Playwright click path
await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await delay(300);
await page.evaluate(() => {
  window.__lmMenuEvents = [];
});
await page.getByRole('menuitemradio', { name: '暗色' }).click();
await delay(500);
const play = await dump('PLAYWRIGHT_CLICK');

// Reset light again
await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await page.getByRole('menuitemradio', { name: '亮色' }).click();
await delay(300);

// B) OS click path — open with Playwright, activate with OS mouse
await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await delay(400);
const dark = page.getByRole('menuitemradio', { name: '暗色' });
const box = await dark.boundingBox();
const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();
const x = Math.round(left + (box.x + box.width / 2) * dpr);
const y = Math.round(top + (box.y + box.height / 2) * dpr);
console.log(JSON.stringify({ box, dpr, left, top, x, y }));
await page.evaluate(() => {
  window.__lmMenuEvents = [];
});
osClick(x, y);
await delay(800);
const os = await dump('OS_MOUSE_EVENT_CLICK');

await browser.close();
app.kill();

console.log(
  JSON.stringify({
    playwrightTheme: play.theme,
    osTheme: os.theme,
    playwrightHadPointerdown: play.events.some(
      (e) => e.phase === 'capture' && e.type === 'pointerdown',
    ),
    osHadPointerdown: os.events.some(
      (e) => e.phase === 'capture' && e.type === 'pointerdown',
    ),
    playwrightHadClick: play.events.some(
      (e) => e.phase === 'capture' && e.type === 'click',
    ),
    osHadClick: os.events.some(
      (e) => e.phase === 'capture' && e.type === 'click',
    ),
  }),
);
