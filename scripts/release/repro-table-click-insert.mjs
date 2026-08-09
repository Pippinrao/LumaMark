/**
 * Click at a known glyph, type a marker, verify insertion index matches the glyph.
 * Also capture caret delta and whether a native selection caret exists.
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
  const scriptPath = join(tmpdir(), 'lm-ins-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Ins {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
[void][Ins]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
[void][Ins]::SetForegroundWindow($p.MainWindowHandle)
[void][Ins]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 100
[Ins]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[Ins]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lm-ins-rect.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Ir {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  public struct RECT { public int L,T,R,B; }
}
"@
[void][Ir]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$r = New-Object Ir+RECT
[void][Ir]::GetWindowRect($p.MainWindowHandle, [ref]$r)
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

function osType(text) {
  const scriptPath = join(tmpdir(), 'lm-ins-type.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${text}")
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

const exe =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';
const port = await reservePort();
const dir = await mkdtemp(join(tmpdir(), 'lm-ins-'));
const doc = join(dir, 'insert.md');
await writeFile(
  doc,
  [
    '# title',
    '',
    'before',
    '',
    '| Col |',
    '| --- |',
    '| 点击这里world |',
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
await delay(1000);

await page.locator('.cm-line').filter({ hasText: 'before' }).click();
await delay(300);

const glyph = '里';
const point = await page.locator('.tbl-table-body .tbl-cell-view').first().evaluate((surface, g) => {
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = /** @type {Text} */ (walker.currentNode);
    const index = node.data.indexOf(g);
    if (index < 0) continue;
    if (getComputedStyle(node.parentElement).display === 'none') continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + g.length);
    const rect = range.getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.5,
      expectedIndex: node.data.slice(0, index).length, // within this text node only — wrong for full cell
      cellText: surface.textContent,
    };
  }
  throw new Error('glyph missing');
}, glyph);

// Better expected index from full cell text
const expectedIndex = '点击这里world'.indexOf(glyph);

const dpr = await page.evaluate(() => window.devicePixelRatio);
const { left, top } = windowRect();
osClick(Math.round(left + point.x * dpr), Math.round(top + point.y * dpr));
await delay(500);

const beforeType = await page.evaluate((clickX) => {
  const content = document.querySelector('.tbl-cell-editor .cm-content');
  const view = content?.cmTile?.view;
  const head = view?.state.selection.main.head ?? null;
  const caret = view
    ? view.coordsAtPos(head, -1) ?? view.coordsAtPos(head)
    : null;
  const sel = document.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect();
  return {
    text: view?.state.doc.toString() ?? null,
    head,
    caretDelta: caret ? caret.left - clickX : null,
    domDelta: rect && rect.height > 0 ? rect.left - clickX : null,
    nestedFocused: document
      .querySelector('.tbl-cell-editor .cm-editor')
      ?.classList.contains('cm-focused'),
  };
}, point.x);

osType('Q');
await delay(500);

const afterType = await page.evaluate(() => {
  const content = document.querySelector('.tbl-cell-editor .cm-content');
  const view = content?.cmTile?.view;
  return {
    text: view?.state.doc.toString() ?? null,
    head: view?.state.selection.main.head ?? null,
    root: document.querySelector('.lm-editor-live-preview-mode .cm-content')?.cmTile?.view
      ?.state.doc.toString() ?? null,
  };
});

const insertedAt = afterType.text?.indexOf('Q') ?? -1;
const result = {
  point,
  expectedIndex,
  beforeType,
  afterType: { text: afterType.text, head: afterType.head },
  insertedAt,
  // Q should appear at expectedIndex (before 里) or expectedIndex+1 depending on click half
  insertionOk:
    insertedAt === expectedIndex ||
    insertedAt === expectedIndex + 1,
  caretOk:
    beforeType.caretDelta !== null && Math.abs(beforeType.caretDelta) <= 8,
};

console.log(JSON.stringify(result, null, 2));
await page.screenshot({ path: join(dir, 'after-type.png') });
console.log('shot', join(dir, 'after-type.png'));

await browser.close();
app.kill();
process.exit(result.insertionOk && result.caretOk ? 0 : 1);
