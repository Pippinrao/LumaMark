/**
 * Diagnose: installed app menus work via CDP, but do OS-level clicks also work?
 * Uses CDP only to observe state + open menu; activates Dark via Win32 mouse_event.
 */
import { spawn, execFileSync } from 'node:child_process';
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
  const scriptPath = join(tmpdir(), 'lumamark-os-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OsClick {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
[void][OsClick]::SetProcessDPIAware()
[void][OsClick]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 120
[OsClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[OsClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`,
  );
  execFileSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { encoding: 'utf8' },
  );
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
    if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
      break;
    }
  } catch {
    // keep polling
  }
  await delay(500);
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0];
await delay(2000);

await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await page.getByRole('menuitemradio', { name: '亮色' }).click();
await delay(400);
const themeBefore = await page.locator('html').getAttribute('data-theme');

await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await delay(400);
const dark = page.getByRole('menuitemradio', { name: '暗色' });
const box = await dark.boundingBox();
if (!box) {
  throw new Error('Dark radio has no bounding box');
}

const win = await page.evaluate(() => ({
  screenX: window.screenX,
  screenY: window.screenY,
  dpr: window.devicePixelRatio,
}));

// Prefer Win32 GetWindowRect (physical) + CSS box * DPR.
// Mixing screenX (DIP) with SetCursorPos (physical) is unreliable under DPI scaling.
const hwndScript = join(tmpdir(), 'lumamark-hwnd-rect.ps1');
writeFileSync(
  hwndScript,
  `
Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class HwndRect {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][HwndRect]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object HwndRect+RECT
[void][HwndRect]::GetWindowRect($p.MainWindowHandle, [ref]$r)
Write-Output ("$($r.L),$($r.T),$($r.R),$($r.B)")
`,
);
const rectText = execFileSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', hwndScript],
  { encoding: 'utf8' },
).trim();
const [left, top] = rectText.split(',').map((value) => Number(value));
const clickX = Math.round(left + (box.x + box.width / 2) * win.dpr);
const clickY = Math.round(top + (box.y + box.height / 2) * win.dpr);

console.log(
  JSON.stringify({
    themeBefore,
    box,
    win,
    windowRect: rectText,
    clickX,
    clickY,
  }),
);

osClick(clickX, clickY);
await delay(1000);

const themeAfterOsClick = await page.locator('html').getAttribute('data-theme');
console.log(JSON.stringify({ themeAfterOsClick }));

await browser.close();
app.kill();

if (themeAfterOsClick !== 'dark') {
  process.exitCode = 1;
}
