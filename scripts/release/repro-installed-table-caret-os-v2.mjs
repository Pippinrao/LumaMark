/**
 * Broader installed-app OS-click table caret diagnostics.
 * Measures click vs nested caret for several realistic targets.
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
  const scriptPath = join(tmpdir(), 'lumamark-tbl2-click.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class OsTbl2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
}
"@
[void][OsTbl2]::SetProcessDPIAware()
[void][OsTbl2]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 80
[OsTbl2]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[OsTbl2]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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
  const scriptPath = join(tmpdir(), 'lumamark-tbl2-client.ps1');
  writeFileSync(
    scriptPath,
    `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class R2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p);
  public struct POINT { public int X,Y; }
}
"@
[void][R2]::SetProcessDPIAware()
$p = Get-Process lumamark | Select-Object -First 1
$pt = New-Object R2+POINT
$pt.X = 0; $pt.Y = 0
[void][R2]::ClientToScreen($p.MainWindowHandle, [ref]$pt)
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

const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';

const markdown = [
  '# title',
  '',
  'before table',
  '',
  '| Left | Right |',
  '| --- | --- |',
  '| hello world | beta |',
  '| **bold cell** | gamma |',
  '',
  'after table',
  '',
].join('\n');

const port = await reservePort();
const tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-tbl2-'));
const documentPath = join(tempDirectory, 'probe.md');
await writeFile(documentPath, markdown, 'utf8');

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
await page.locator('.tbl-table-widget').waitFor({ state: 'visible', timeout: 15_000 });
await delay(1000);

async function blurTable() {
  await page.locator('.cm-line').filter({ hasText: 'before table' }).click();
  await delay(250);
}

async function measureClick(label, cssX, cssY) {
  await blurTable();
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const { left, top } = clientOrigin();
  const screenX = Math.round(left + cssX * dpr);
  const screenY = Math.round(top + cssY * dpr);
  osClick(screenX, screenY);
  await delay(600);

  return page.evaluate(
    ({ label, cssX, cssY }) => {
      const nestedContent = document.querySelector('.tbl-cell-editor .cm-content');
      const rootContent = document.querySelector(
        '.lm-editor-live-preview-mode .cm-content',
      );
      const nestedView = nestedContent?.cmTile?.view;
      const rootView = rootContent?.cmTile?.root?.view ?? rootContent?.cmTile?.view;
      const nestedHead = nestedView?.state.selection.main.head ?? null;
      const nestedText = nestedView?.state.doc.toString() ?? null;
      const nestedCaret = nestedView
        ? nestedView.coordsAtPos(nestedHead, -1) ??
          nestedView.coordsAtPos(nestedHead, 1) ??
          nestedView.coordsAtPos(nestedHead)
        : null;
      const rootHead = rootView?.state.selection.main.head ?? null;
      const rootTextSnippet = rootView
        ? rootView.state.doc.toString().slice(Math.max(0, rootHead - 12), rootHead + 12)
        : null;
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const domRect = range?.getBoundingClientRect();
      const deltaNestedX = nestedCaret ? nestedCaret.left - cssX : null;
      const deltaDomX = domRect && domRect.height > 0 ? domRect.left - cssX : null;
      return {
        label,
        click: { x: cssX, y: cssY },
        nested: {
          text: nestedText,
          head: nestedHead,
          caret: nestedCaret
            ? { left: nestedCaret.left, top: nestedCaret.top }
            : null,
          deltaX: deltaNestedX,
        },
        dom: {
          withinNested: Boolean(
            nestedContent &&
              selection?.anchorNode &&
              nestedContent.contains(selection.anchorNode),
          ),
          rect: domRect
            ? { left: domRect.left, top: domRect.top, height: domRect.height }
            : null,
          deltaX: deltaDomX,
        },
        root: { head: rootHead, around: rootTextSnippet },
        hasEditor: Boolean(nestedContent),
      };
    },
    { label, cssX, cssY },
  );
}

const plainCell = page.locator('.tbl-table-body .tbl-table-row').nth(0).locator('.tbl-cell-view').nth(0);
const boldCell = page.locator('.tbl-table-body .tbl-table-row').nth(1).locator('.tbl-cell-view').nth(0);

const plainBox = await plainCell.boundingBox();
const plainGlyph = await plainCell.evaluate((surface) => {
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = /** @type {Text} */ (walker.currentNode);
    const index = node.data.indexOf('w');
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return {
      midX: rect.left + rect.width / 2,
      midY: rect.top + rect.height / 2,
      leftX: rect.left + 1,
      rightX: rect.right - 1,
    };
  }
  throw new Error('w missing');
});

const results = [];
results.push(
  await measureClick('plain-glyph-mid', plainGlyph.midX, plainGlyph.midY),
);
results.push(
  await measureClick('plain-glyph-left', plainGlyph.leftX, plainGlyph.midY),
);
results.push(
  await measureClick(
    'plain-cell-center',
    plainBox.x + plainBox.width * 0.5,
    plainBox.y + plainBox.height * 0.5,
  ),
);
results.push(
  await measureClick(
    'plain-cell-right-pad',
    // After column tightening, 0.92×width can still sit on the last glyph.
    // Use the cell's true trailing padding (Plan A: empty pad → text end).
    plainBox.x + plainBox.width - 3,
    plainBox.y + plainBox.height * 0.5,
  ),
);

const boldGlyph = await boldCell.evaluate((surface) => {
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = /** @type {Text} */ (walker.currentNode);
    if (getComputedStyle(node.parentElement).display === 'none') continue;
    const index = node.data.indexOf('b');
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + 1);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  }
  throw new Error('b missing');
});
results.push(await measureClick('bold-glyph-left', boldGlyph.x, boldGlyph.y));

results.push(
  await measureClick(
    'table-border-ish',
    plainBox.x + plainBox.width * 0.5,
    plainBox.y - 2,
  ),
);

console.log(JSON.stringify(results, null, 2));

await browser.close();
app.kill();

// Plan A: glyph clicks must land near the mouse; empty padding may snap to
// text end (large deltaX is OK). Border chrome clicks are out of scope.
const bad = results.filter((r) => {
  if (r.label === 'table-border-ish') return false;
  if (r.label === 'plain-cell-right-pad') {
    const text = r.nested.text ?? '';
    return !r.hasEditor || r.nested.head !== text.length;
  }
  if (!r.hasEditor) return true;
  const dx = r.nested.deltaX ?? r.dom.deltaX;
  return dx === null || Math.abs(dx) > 8;
});
console.log('\nBAD_COUNT', bad.length, bad.map((b) => b.label));
process.exit(bad.length ? 1 : 0);
