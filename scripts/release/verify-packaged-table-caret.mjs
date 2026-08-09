/**
 * Packaged Windows acceptance: click a table cell and type a marker.
 * Proves caret/editing path in real WebView2, not Chromium Playwright only.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const root = new URL('../..', import.meta.url);
const executablePath = fileURLToPath(
  new URL('src-tauri/target/release/lumamark.exe', root),
);
const fileName = 'table-caret-probe.md';
const marker = `tbl-${Date.now()}`;
const markdown = [
  '# Table Caret Probe',
  '',
  '| Left | Right |',
  '| --- | --- |',
  '| alpha | beta |',
  '| gamma | delta |',
  '',
].join('\n');

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:packaged-table-caret] Windows WebView2 only; skipping.\n',
  );
  process.exit(0);
}

const processOutput = { stderr: [], stdout: [] };
let browser;
let page;
let app;
let appExit;
let appStartError;
let tempDirectory;

try {
  const port = await reserveDebugPort(
    parseRequestedPort(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT),
  );
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-packaged-table-'));
  const documentPath = join(tempDirectory, fileName);
  await writeFile(documentPath, markdown, 'utf8');

  app = spawn(executablePath, [documentPath], {
    cwd: tempDirectory,
    env: createPackagedWebviewEnvironment({
      baseEnvironment: process.env,
      debugPort: port,
      tempDirectory,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  appExit = new Promise((resolve) => {
    app.once('exit', resolve);
    app.once('error', (error) => {
      appStartError = error;
      resolve();
    });
  });
  app.stdout?.on('data', (chunk) => {
    processOutput.stdout.push(chunk.toString());
  });
  app.stderr?.on('data', (chunk) => {
    processOutput.stderr.push(chunk.toString());
  });

  await waitForDebugEndpoint(port, () => appStartError);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page =
    context.pages()[0] ??
    (await context.waitForEvent('page', { timeout: 5_000 }));

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('.lm-editor-title', { hasText: fileName }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });

  const table = page.locator('.tbl-table-widget').first();
  await expect(table).toBeVisible({ timeout: 10_000 });

  const targetCell = table.locator('.tbl-cell-view').filter({ hasText: 'beta' }).first();
  await targetCell.click({ position: { x: 8, y: 8 } });

  // Prefer nested cell editor when present; fall back to root contenteditable.
  const cellEditor = page.locator('.tbl-cell-editor .cm-content').first();
  if (await cellEditor.isVisible().catch(() => false)) {
    await cellEditor.click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(marker);
  } else {
    await page.keyboard.press('End');
    await page.keyboard.insertText(marker);
  }

  await page.waitForFunction(
    (expected) => {
      const root = document.querySelector('.cm-content')?.cmTile?.view;
      return root?.state.doc.toString().includes(expected) ?? false;
    },
    marker,
    { timeout: 10_000 },
  );

  // Leave the cell and ensure caret did not jump to document start.
  await page.keyboard.press('Escape');
  await delay(200);
  const selectionHead = await page.evaluate(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.view;
    return view?.state.selection.main.head ?? -1;
  });
  if (selectionHead < 10) {
    throw new Error(
      `Table caret jumped near document start after leaving cell (head=${selectionHead}).`,
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        packagedTableCaret: true,
        markerInserted: true,
        selectionHead,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(
    [
      '[release:packaged-table-caret] FAILED',
      error instanceof Error ? error.stack ?? error.message : String(error),
      `stdout: ${processOutput.stdout.join('')}`,
      `stderr: ${processOutput.stderr.join('')}`,
    ].join('\n'),
  );
  process.stderr.write('\n');
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  if (app?.exitCode === null && !app.killed) {
    app.kill('SIGKILL');
    if (appExit) {
      await Promise.race([appExit, delay(3_000)]);
    }
  }
  if (tempDirectory) {
    await removePackagedWebviewTempDirectory(tempDirectory);
  }
}

function parseRequestedPort(value) {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return Number(value);
}

async function waitForDebugEndpoint(debugPort, getStartError) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const startError = getStartError();
    if (startError) {
      throw new Error(
        `Unable to start packaged LumaMark: ${startError.message}`,
        { cause: startError },
      );
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // keep polling
    }

    await delay(500);
  }

  throw new Error(`WebView2 debug endpoint did not open on port ${debugPort}.`);
}
