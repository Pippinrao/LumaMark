/**
 * Test the INSTALLED LumaMark via single-instance + second-launch argv.
 * 1) Start installed exe with remote debugging (empty args)
 * 2) Spawn a second process with a Markdown path (no debug) — single-instance should forward
 * 3) Assert the already-running window opens that file
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  'C:\\Users\\pippin\\AppData\\Local\\LumaMark\\lumamark.exe';
const marker = `installed-second-${Date.now()}`;
const fileName = 'installed-second-open.md';

if (process.platform !== 'win32') {
  process.exit(0);
}

const processOutput = { stderr: [], stdout: [] };
let browser;
let page;
let primary;
let primaryExit;
let tempDirectory;

try {
  const port = await reserveDebugPort(
    process.env.LUMAMARK_WEBVIEW_DEBUG_PORT
      ? Number(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT)
      : undefined,
  );
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-installed-second-'));
  const documentPath = join(tempDirectory, fileName);
  await writeFile(
    documentPath,
    `# Installed Second Open\n\n${marker}\n`,
    'utf8',
  );

  primary = spawn(executablePath, [], {
    cwd: tempDirectory,
    env: createPackagedWebviewEnvironment({
      baseEnvironment: process.env,
      debugPort: port,
      tempDirectory,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  primaryExit = new Promise((resolve) => {
    primary.once('exit', resolve);
    primary.once('error', resolve);
  });
  primary.stdout?.on('data', (c) => processOutput.stdout.push(String(c)));
  primary.stderr?.on('data', (c) => processOutput.stderr.push(String(c)));

  await waitForDebug(port);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page =
    context.pages()[0] ??
    (await context.waitForEvent('page', { timeout: 5_000 }));
  await page
    .getByRole('banner')
    .getByRole('heading', { name: /lumamark/i })
    .waitFor({ state: 'visible', timeout: 20_000 });

  // Second launch: same as Explorer / Open with — no debug env, only the path.
  const secondary = spawn(executablePath, [documentPath], {
    cwd: tempDirectory,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await new Promise((resolve) => {
    secondary.once('exit', resolve);
    secondary.once('error', resolve);
    setTimeout(resolve, 8_000);
  });

  await page.locator('.lm-editor-title', { hasText: fileName }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await page.waitForFunction(
    (expected) =>
      document.querySelector('.cm-content')?.textContent?.includes(expected),
    marker,
    { timeout: 20_000 },
  );

  process.stdout.write(
    JSON.stringify(
      {
        installedExecutable: executablePath,
        secondInstanceForwarded: true,
        markerFound: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(
    [
      '[release:installed-second-instance-open] FAILED',
      error instanceof Error ? error.stack ?? error.message : String(error),
      `stdout: ${processOutput.stdout.join('')}`,
      `stderr: ${processOutput.stderr.join('')}`,
    ].join('\n'),
  );
  process.stderr.write('\n');
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (primary?.exitCode === null && !primary.killed) {
    primary.kill('SIGKILL');
    if (primaryExit) await Promise.race([primaryExit, delay(3_000)]);
  }
  if (tempDirectory) await removePackagedWebviewTempDirectory(tempDirectory);
}

async function waitForDebug(debugPort) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await delay(500);
  }
  throw new Error(`WebView2 debug endpoint did not open on port ${debugPort}.`);
}
