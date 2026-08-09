/**
 * Real installed-app repro: OS mouse click in a table cell, then measure
 * caret.left vs click.x via CDP (read-only). No Playwright.click for the gesture.
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
  const scriptPath = join(tmpdir(), 'lumamark-table-caret-os-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OsTbl {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
[void][OsTbl]::SetProcessDPIAware()
[void][OsTbl]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 80
[OsTbl]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[OsTbl]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lumamark-table-caret-rect.ps1');
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

const cases = [
  {
    name: 'plain',
    markdown: ['# t', '', '| Left | Right |', '| --- | --- |', '| hello world | beta |', ''].join(
      '\n',
    ),
    glyph: 'w',
    fraction: 0.5,
  },
  {
    name: 'bold',
    markdown: [
      '# t',
      '',
      '| Left | Right |',
      '| --- | --- |',
      '| **alpha** | beta |',
      '',
    ].join('\n'),
    glyph: 'a',
    fraction: 0.05,
  },
];

const port = await reservePort();
const tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-table-caret-repro-'));
const results = [];

for (const testCase of cases) {
  const documentPath = join(tempDirectory, `${testCase.name}.md`);
  await writeFile(documentPath, testCase.markdown, 'utf8');

  const app = spawn(executablePath, [documentPath], {
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
  await page.locator('.tbl-table-widget').first().waitFor({ state: 'visible', timeout: 15_000 });
  await delay(800);

  // Prefer the first data-row cell view that contains the target glyph.
  const cellViews = page.locator('.tbl-table-body .tbl-cell-view');
  await cellViews.first().waitFor({ state: 'visible', timeout: 10_000 });

  // Click outside table first so cell is inactive.
  await page.locator('.cm-line').filter({ hasText: '# t' }).click();
  await delay(300);

  const cellCount = await cellViews.count();
  const cellTexts = [];
  for (let i = 0; i < cellCount; i += 1) {
    cellTexts.push(await cellViews.nth(i).innerText());
  }

  const clickCss = await cellViews.first().evaluate((surface, target) => {
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = /** @type {Text} */ (walker.currentNode);
      const index = textNode.data.indexOf(target.glyph);
      if (index < 0) continue;
      const parent = textNode.parentElement;
      if (!parent || getComputedStyle(parent).display === 'none') continue;
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + target.glyph.length);
      const rect = range.getBoundingClientRect();
      return {
        x: rect.left + rect.width * target.fraction,
        y: rect.top + rect.height / 2,
        surfaceText: surface.textContent,
        glyphRect: {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        },
      };
    }
    throw new Error(
      `glyph ${target.glyph} not found in "${surface.textContent}" (cells=${JSON.stringify(target.cellTexts)})`,
    );
  }, { ...testCase, cellTexts });

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const { left, top } = windowRect();
  const screenX = Math.round(left + clickCss.x * dpr);
  const screenY = Math.round(top + clickCss.y * dpr);

  osClick(screenX, screenY);
  await delay(700);

  const after = await page.evaluate(() => {
    const content = document.querySelector('.tbl-cell-editor .cm-content');
    if (!content) {
      return { error: 'no-cell-editor' };
    }
    const view = /** @type {any} */ (content).cmTile?.view;
    if (!view) {
      return { error: 'no-view' };
    }
    const head = view.state.selection.main.head;
    const caret =
      view.coordsAtPos(head, -1) ?? view.coordsAtPos(head, 1) ?? view.coordsAtPos(head);
    const marks = [...content.querySelectorAll('.lm-table-token-mark')].map((el) => ({
      text: el.textContent,
      display: getComputedStyle(el).display,
    }));
    return {
      text: view.state.doc.toString(),
      head,
      caret: caret
        ? { left: caret.left, top: caret.top, bottom: caret.bottom, right: caret.right }
        : null,
      marks,
      activeCell: Boolean(document.querySelector('.tbl-cell-editor')),
    };
  });

  const deltaX =
    after.caret && typeof after.caret.left === 'number'
      ? after.caret.left - clickCss.x
      : null;

  results.push({
    case: testCase.name,
    clickCss,
    screen: { screenX, screenY, dpr, left, top },
    after,
    deltaX,
    fail: deltaX === null || Math.abs(deltaX) > 3,
  });

  await browser.close();
  app.kill();
  await delay(800);
}

console.log(JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.fail);
process.exit(failed.length ? 1 : 0);
