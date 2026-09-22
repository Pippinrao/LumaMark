// Equivalent packaged WebView acceptance: native mouse selection and clipboard.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import {
  createAcceptanceSettingsEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const executable = resolve(process.argv[2] ?? 'src-tauri/target/release/lumamark.exe');
const probePath = fileURLToPath(new URL('./windows-window-chrome-probe.ps1', import.meta.url));
const source = 'before\n\n| Name | Value |\n| --- | --- |\n| alpha bravo charlie | 中文词语测试 |\n\nafter';
const directory = await mkdtemp(join(tmpdir(), 'lumamark-menu-context-os-table-copy-'));
const fixture = join(directory, 'table-copy.md');
const evidence = { executable, input: 'Win32 SendInput + Windows Forms SendKeys', gestures: [] };
let app;
let browser;
let appError;

function powershell(args) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', ...args], {
    encoding: 'utf8', timeout: 20_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr);
  }
  return result.stdout.replace(/^\uFEFF/, '');
}

function native(action, values = {}) {
  const args = ['-ExecutionPolicy', 'Bypass', '-File', probePath,
    '-TargetProcessId', String(app.pid), '-Action', action];
  for (const [key, value] of Object.entries(values)) args.push(`-${key}`, String(value));
  const state = JSON.parse(powershell(args));
  assert.equal(state.targetPid, app.pid);
  return state;
}

async function snapshot(page) {
  return page.evaluate(() => {
    const read = (selector) => {
      const content = document.querySelector(selector);
      const view = content?.cmTile?.root?.view ?? content?.cmTile?.view;
      if (!view) return null;
      const { from, to } = view.state.selection.main;
      return { source: view.state.doc.toString(), selected: view.state.sliceDoc(from, to) };
    };
    return { root: read('.lm-editor-live-preview-mode .cm-content'),
      nested: read('.tbl-cell-editor .cm-content') };
  });
}

async function point(page, word) {
  return page.evaluate((text) => {
    const root = document.querySelector('.lm-editor-live-preview-mode');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = node.textContent.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start + Math.min(2, text.length - 1));
      range.setEnd(node, start + Math.min(3, text.length));
      const rect = range.getBoundingClientRect();
      if (rect.width && rect.height) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error(`No visible text: ${text}`);
  }, word);
}

async function screenPoint(page, word) {
  const client = native('State').clientRect;
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  assert.ok(Math.abs(client.width - viewport.width * viewport.dpr) <= 2);
  assert.ok(Math.abs(client.height - viewport.height * viewport.dpr) <= 2);
  const css = await point(page, word);
  return { X: Math.round(client.left + css.x * viewport.dpr), Y: Math.round(client.top + css.y * viewport.dpr) };
}

try {
  await writeFile(fixture, source, 'utf8');
  const port = await reserveDebugPort();
  app = spawn(executable, [fixture], {
    cwd: dirname(executable), windowsHide: true, stdio: 'ignore',
    env: await createAcceptanceSettingsEnvironment({ baseEnvironment: process.env, debugPort: port, tempDirectory: directory }),
  });
  app.once('error', (error) => { appError = error; });
  await expect.poll(async () => {
    if (appError) throw appError;
    assert.equal(app.exitCode, null);
    try {
      return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok;
    } catch { return false; }
  }, { timeout: 30_000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect.poll(async () => (await snapshot(page)).root?.source, { timeout: 30_000 }).toBe(source);
  const placed = native('PlaceNormal', { Left: 80, Top: 60, Width: 1000, Height: 700 });
  assert.equal(resolve(placed.executablePath).toLowerCase(), executable.toLowerCase());
  evidence.pid = app.pid;

  for (const kind of ['double-click', 'drag']) {
    native('Click', await screenPoint(page, 'after'));
    await expect(page.locator('.tbl-cell-editor')).toHaveCount(0);
    const start = await screenPoint(page, kind === 'double-click' ? 'bravo' : 'alpha');
    if (kind === 'double-click') native('DoubleClick', start);
    else {
      const end = await screenPoint(page, 'charlie');
      native('Drag', { ...start, EndX: end.X, EndY: end.Y });
    }
    await expect.poll(async () => (await snapshot(page)).nested?.selected).toContain('bravo');
    const selected = (await snapshot(page)).nested.selected;
    // Exact child/window ownership was checked by the native gesture probe.
    const copied = powershell(['-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c'); Start-Sleep -Milliseconds 150; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::Write([System.Windows.Forms.Clipboard]::GetText())"]);
    assert.equal(copied, selected);
    const result = await snapshot(page);
    assert.equal(result.root.source, source);
    assert.equal(result.root.selected, selected);
    evidence.gestures.push({ kind, selected, copied, rootSelection: result.root.selected });
  }
  assert.equal(await readFile(fixture, 'utf8'), source);
  assert.deepEqual(errors, []);
  evidence.passed = true;
} catch (error) {
  evidence.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (app?.exitCode === null) {
    app.kill();
    await delay(500);
  }
  await removePackagedWebviewTempDirectory(directory);
  const output = resolve('artifacts/installed-menu-context-os/table-selection-copy');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
