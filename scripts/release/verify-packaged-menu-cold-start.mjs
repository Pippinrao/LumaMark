/**
 * Packaged Windows acceptance: theme/language/About via mouse, then true process
 * cold start (kill + respawn) must keep preferences. Reload alone is not enough.
 */
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
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
import { verifyPackagedMenuWorkflows } from './packagedMenuVerification.mjs';

const root = new URL('../..', import.meta.url);
const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  fileURLToPath(new URL('src-tauri/target/release/lumamark.exe', root));

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:packaged-menu-cold-start] Windows WebView2 only; skipping.\n',
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
let port;

try {
  port = await reserveDebugPort(
    parseRequestedPort(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT),
  );
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-packaged-menu-'));

  ({ app, appExit, appStartError, browser, page } = await launchApp({
    port,
    tempDirectory,
  }));

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });

  // Start from a blank document so menus are reachable without file IO.
  const newDocument = page.getByRole('button', { name: /New Document|新建文档/ });
  if (await newDocument.isVisible().catch(() => false)) {
    await newDocument.click();
  }

  await verifyPackagedMenuWorkflows(page, { persistViaReload: false });

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // True cold start: kill process, keep the same WebView2 user-data folder.
  await browser.close().catch(() => {});
  browser = undefined;
  page = undefined;
  if (app?.exitCode === null && !app.killed) {
    app.kill('SIGKILL');
    if (appExit) {
      await Promise.race([appExit, delay(5_000)]);
    }
  }
  app = undefined;
  await delay(1_000);

  ({ app, appExit, appStartError, browser, page } = await launchApp({
    port,
    tempDirectory,
  }));

  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // About must remain independent of Settings after cold start.
  await openTopMenuWithMouse(page, 'Help');
  await page.getByRole('menuitem', { name: 'About LumaMark' }).click();
  await expect(page.getByRole('dialog', { name: 'About LumaMark' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Settings|设置/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  process.stdout.write(
    JSON.stringify(
      {
        aboutIndependent: true,
        coldStartPreferences: true,
        menuMouseWorkflow: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(
    [
      '[release:packaged-menu-cold-start] FAILED',
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

async function launchApp({ port, tempDirectory }) {
  let localStartError;
  const localOutput = processOutput;
  const child = spawn(executablePath, [], {
    env: createPackagedWebviewEnvironment({
      baseEnvironment: process.env,
      debugPort: port,
      tempDirectory,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  const exitPromise = new Promise((resolve) => {
    child.once('exit', resolve);
    child.once('error', (error) => {
      localStartError = error;
      resolve();
    });
  });
  child.stdout?.on('data', (chunk) => {
    localOutput.stdout.push(chunk.toString());
  });
  child.stderr?.on('data', (chunk) => {
    localOutput.stderr.push(chunk.toString());
  });

  await waitForDebugEndpoint(port, () => localStartError ?? appStartError);
  const connected = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = connected.contexts()[0];
  const connectedPage =
    context.pages()[0] ??
    (await context.waitForEvent('page', { timeout: 5_000 }));

  return {
    app: child,
    appExit: exitPromise,
    appStartError: localStartError,
    browser: connected,
    page: connectedPage,
  };
}

async function openTopMenuWithMouse(page, name) {
  const trigger = page.getByRole('menuitem', { exact: true, name });
  await trigger.hover();
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('data-state', 'open');
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
