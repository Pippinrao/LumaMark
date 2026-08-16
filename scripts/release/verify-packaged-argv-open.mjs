/**
 * Packaged Windows acceptance: cold-start LumaMark with a Markdown path argv.
 * This must prove OS / CLI open without seeding recent files or session restore.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createAcceptanceSettingsEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const root = new URL('../..', import.meta.url);
const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  fileURLToPath(new URL('src-tauri/target/release/lumamark.exe', root));
const marker = `argv-open-${Date.now()}`;
const fileName = 'argv-open-probe.md';
const markdown = [
  '# Argv Open Probe',
  '',
  marker,
  '',
].join('\n');

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:packaged-argv-open] Windows WebView2 only; skipping.\n',
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
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-menu-context-os-packaged-argv-'));
  const documentPath = join(tempDirectory, fileName);
  await writeFile(documentPath, markdown, 'utf8');

  app = spawn(executablePath, [documentPath], {
    cwd: tempDirectory,
    env: await createAcceptanceSettingsEnvironment({
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

  const endpoint = await waitForDebugEndpoint(port, () => appStartError);
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

  // Must open the argv file without requiring an open-workspace action.
  await page.locator('.lm-editor-title', { hasText: fileName }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await page.locator('.cm-content').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    (expected) => document.querySelector('.cm-content')?.textContent?.includes(expected),
    marker,
    { timeout: 20_000 },
  );

  const workspaceRootVisible = await page
    .getByRole('button', { name: /Open Workspace|打开工作区/ })
    .isVisible()
    .catch(() => false);
  // Single-file mode may still show sidebar affordances; the gate is that the
  // document is already open from argv without the user picking a workspace first.
  if (!(await page.locator('.lm-editor-title', { hasText: fileName }).isVisible())) {
    throw new Error('Argv open did not surface the Markdown file title.');
  }

  process.stdout.write(
    JSON.stringify(
      {
        argvOpen: true,
        cdpEndpoint: endpoint.webSocketDebuggerUrl ? 'available' : 'missing',
        documentPath,
        markerFound: true,
        workspacePromptNotRequired: true,
        workspaceRootButtonVisible: workspaceRootVisible,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(
    [
      '[release:packaged-argv-open] FAILED',
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

  throw new Error(
    [
      `WebView2 debug endpoint did not open on port ${debugPort}.`,
      `stdout: ${processOutput.stdout.join('')}`,
      `stderr: ${processOutput.stderr.join('')}`,
    ].join('\n'),
  );
}
