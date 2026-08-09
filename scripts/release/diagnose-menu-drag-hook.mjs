/**
 * Prove whether OS click on Dark triggers plugin:window|start_dragging.
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
  const scriptPath = join(tmpdir(), 'lumamark-drag-hook-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OsClick3 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
[void][OsClick3]::SetProcessDPIAware()
[void][OsClick3]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 80
[OsClick3]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[OsClick3]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lumamark-drag-hook-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class R2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][R2]::SetProcessDPIAware()
\$p = Get-Process lumamark | Select-Object -First 1
\$r = New-Object R2+RECT
[void][R2]::GetWindowRect(\$p.MainWindowHandle, [ref]\$r)
Write-Output ("\$(\$r.L),\$(\$r.T)")
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
  w.__lmInvokes = [];
  const internals = w.__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    w.__lmInvokes.push({ error: 'no __TAURI_INTERNALS__.invoke' });
    return;
  }
  const original = internals.invoke.bind(internals);
  internals.invoke = (cmd, args) => {
    w.__lmInvokes.push({ cmd, args, at: performance.now() });
    return original(cmd, args);
  };
});

await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await page.getByRole('menuitemradio', { name: '亮色' }).click();
await delay(300);

await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
await delay(400);
const box = await page.getByRole('menuitemradio', { name: '暗色' }).boundingBox();
const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();
const x = Math.round(left + (box.x + box.width / 2) * dpr);
const y = Math.round(top + (box.y + box.height / 2) * dpr);

await page.evaluate(() => {
  window.__lmInvokes = [];
  window.__lmMenuEvents = [];
  document.addEventListener(
    'mousedown',
    (event) => {
      window.__lmMenuEvents.push({
        type: 'mousedown',
        defaultPrevented: event.defaultPrevented,
        role:
          event.target instanceof Element
            ? event.target.getAttribute('role')
            : null,
        cls:
          event.target instanceof Element
            ? String(event.target.className).slice(0, 60)
            : null,
      });
    },
    true,
  );
});

osClick(x, y);
await delay(1000);

const result = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute('data-theme'),
  invokes: window.__lmInvokes,
  events: window.__lmMenuEvents,
}));

console.log(JSON.stringify({ x, y, ...result }, null, 2));

await browser.close();
app.kill();

const dragged = result.invokes.some(
  (item) =>
    typeof item.cmd === 'string' &&
    (item.cmd.includes('start_dragging') || item.cmd.includes('startDragging')),
);
if (dragged) {
  console.log('ROOT_EVIDENCE: start_dragging was invoked during OS menu-item click');
  process.exitCode = 2;
} else if (result.theme !== 'dark') {
  console.log('OS click failed without start_dragging invoke');
  process.exitCode = 1;
}
