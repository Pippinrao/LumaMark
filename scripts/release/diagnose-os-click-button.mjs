/**
 * Control: does OS mouse_event deliver pointerup/click to a normal button
 * in the same installed WebView2 (Start Screen CTA)?
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
  const scriptPath = join(tmpdir(), 'lumamark-btn-os-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OsClick4 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
[void][OsClick4]::SetProcessDPIAware()
[void][OsClick4]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
[OsClick4]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[OsClick4]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lumamark-btn-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class R3 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][R3]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object R3+RECT
[void][R3]::GetWindowRect($p.MainWindowHandle, [ref]$r)
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
await delay(2500);

await page.evaluate(() => {
  window.__lmEvents = [];
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']) {
    document.addEventListener(
      type,
      (event) => {
        window.__lmEvents.push({
          type,
          ctor: event.constructor.name,
          cls:
            event.target instanceof Element
              ? String(event.target.className).slice(0, 80)
              : null,
        });
      },
      true,
    );
  }
});

const button = page.getByRole('button', { name: /新建文档|New Document/ });
await button.waitFor({ state: 'visible', timeout: 15_000 });
const box = await button.boundingBox();
const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();
const x = Math.round(left + (box.x + box.width / 2) * dpr);
const y = Math.round(top + (box.y + box.height / 2) * dpr);

await page.evaluate(() => {
  window.__lmEvents = [];
});
osClick(x, y);
await delay(1000);

const result = await page.evaluate(() => ({
  events: window.__lmEvents,
  startScreenGone: !document.body.innerText.includes('新建文档') &&
    !document.body.innerText.includes('New Document'),
  bodySnippet: document.body.innerText.slice(0, 120),
}));

console.log(JSON.stringify({ x, y, box, dpr, left, top, ...result }, null, 2));

await browser.close();
app.kill();

const types = new Set(result.events.map((event) => event.type));
console.log(
  JSON.stringify({
    hasPointerup: types.has('pointerup'),
    hasClick: types.has('click'),
    eventTypes: [...types],
  }),
);
