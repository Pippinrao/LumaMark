import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const { artifactDir, debugPort, executablePath } = parseArguments(
  process.argv.slice(2),
);
const output = { stderr: [], stdout: [] };
const pageErrors = [];
const consoleErrors = [];
let app;
let browser;
let page;

await mkdir(artifactDir, { recursive: true });

try {
  app = spawn(executablePath, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${debugPort}`,
      ].join(' '),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  app.stdout.on('data', (chunk) => output.stdout.push(chunk.toString()));
  app.stderr.on('data', (chunk) => output.stderr.push(chunk.toString()));

  const endpoint = await waitForDebugEndpoint(debugPort);
  await writeDiagnostic('cdp-endpoint.json', endpoint);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? (await context.waitForEvent('page'));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));

  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
  await page.getByRole('heading', { name: /lumamark/i }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await editor.click();
  await page.keyboard.insertText('# Installed release smoke');
  await page.getByText('Installed release smoke').waitFor({
    state: 'visible',
    timeout: 5_000,
  });

  if (pageErrors.length > 0 || consoleErrors.length > 0) {
    throw new Error('Installed WebView emitted console or page errors.');
  }

  await page.screenshot({ path: resolve(artifactDir, 'installed-app.png') });
  await writeDiagnostic('result.json', {
    appStarted: true,
    cdpEndpoint: endpoint.webSocketDebuggerUrl ? 'available' : 'missing',
    editorAcceptedInput: true,
  });
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: resolve(artifactDir, 'failure.png') })
      .catch(() => {});
  }
  await writeDiagnostic('failure.json', {
    consoleErrors,
    error: error.stack ?? error.message,
    pageErrors,
  });
  throw error;
} finally {
  await writeFile(resolve(artifactDir, 'app-stdout.log'), output.stdout.join(''));
  await writeFile(resolve(artifactDir, 'app-stderr.log'), output.stderr.join(''));
  await browser?.close().catch(() => {});
  stopProcessTree(app);
}

function parseArguments(args) {
  const executablePath = valueFor(args, '--executable');
  const artifactDir = valueFor(args, '--artifacts-dir');
  const debugPort = Number(valueFor(args, '--debug-port'));

  if (!executablePath || !artifactDir || !Number.isInteger(debugPort) || debugPort < 1) {
    throw new Error(
      'Usage: --executable <path> --artifacts-dir <path> --debug-port <port>',
    );
  }

  return {
    artifactDir: resolve(artifactDir),
    debugPort,
    executablePath: resolve(executablePath),
  };
}

function valueFor(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args.at(index + 1);
}

async function waitForDebugEndpoint(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // The installed WebView2 process needs time to expose its CDP endpoint.
    }
    await delay(500);
  }

  throw new Error(`WebView2 CDP endpoint did not open on port ${port}.`);
}

async function writeDiagnostic(name, value) {
  await writeFile(resolve(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function stopProcessTree(child) {
  if (!child?.pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', `${child.pid}`, '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  child.kill('SIGKILL');
}
