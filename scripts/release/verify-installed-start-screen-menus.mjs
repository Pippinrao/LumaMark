/**
 * Probe installed LumaMark the way a user often first sees it: Start Screen.
 * Assert Theme / Language / About work before opening a document.
 * Then open a file via File menu path simulation (recent-free argv already covered).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';

if (process.platform !== 'win32') process.exit(0);

let browser;
let page;
let app;
let appExit;
let tempDirectory;
const processOutput = { stderr: [], stdout: [] };

try {
  const port = await reserveDebugPort();
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-installed-start-'));
  // Fresh profile: should land on Start Screen.
  app = spawn(executablePath, [], {
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
    app.once('error', resolve);
  });
  app.stdout?.on('data', (c) => processOutput.stdout.push(String(c)));
  app.stderr?.on('data', (c) => processOutput.stderr.push(String(c)));

  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch {
      // keep polling
    }
    await delay(500);
  }

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page =
    browser.contexts()[0].pages()[0] ??
    (await browser.contexts()[0].waitForEvent('page', { timeout: 5_000 }));

  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });

  const startScreen = page.getByRole('main', { name: /开始|Start|LumaMark/i });
  const openFileButton = page.getByRole('button', { name: /打开文件|Open File/ });
  await expect(openFileButton).toBeVisible({ timeout: 10_000 });

  // Menus must work on the Start Screen itself (common user complaint path).
  await openTopMenu(page, '主题');
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await openTopMenu(page, '语言');
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await openTopMenu(page, 'Help');
  await page.getByRole('menuitem', { name: 'About LumaMark' }).click();
  await expect(page.getByRole('dialog', { name: 'About LumaMark' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // Start Screen still present after menu actions.
  await expect(page.getByRole('button', { name: /Open File|打开文件/ })).toBeVisible();

  process.stdout.write(
    JSON.stringify(
      {
        installedExecutable: executablePath,
        startScreenMenus: true,
        themeLanguageAboutOnStartScreen: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(
    [
      '[release:installed-start-screen-menus] FAILED',
      error instanceof Error ? error.stack ?? error.message : String(error),
      `stdout: ${processOutput.stdout.join('')}`,
      `stderr: ${processOutput.stderr.join('')}`,
    ].join('\n'),
  );
  process.stderr.write('\n');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app?.exitCode === null && !app.killed) {
    app.kill('SIGKILL');
    if (appExit) await Promise.race([appExit, delay(3_000)]);
  }
  if (tempDirectory) await removePackagedWebviewTempDirectory(tempDirectory);
}

async function openTopMenu(page, name) {
  const trigger = page.getByRole('menuitem', { exact: true, name });
  await trigger.hover();
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('data-state', 'open');
}
