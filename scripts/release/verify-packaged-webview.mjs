import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

const root = new URL('../..', import.meta.url);
const executablePath = fileURLToPath(
  new URL('src-tauri/target/release/lumamark.exe', root),
);
const port = Number(process.env.LUMAMARK_WEBVIEW_DEBUG_PORT ?? 9334);

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:packaged-webview] This smoke test currently targets Windows WebView2.\n',
  );
  process.exit(0);
}

const processOutput = {
  stderr: [],
  stdout: [],
};
let browser;
const app = spawn(executablePath, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});

app.stdout.on('data', (chunk) => {
  processOutput.stdout.push(chunk.toString());
});
app.stderr.on('data', (chunk) => {
  processOutput.stderr.push(chunk.toString());
});

try {
  const endpoint = await waitForDebugEndpoint(port);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  const page =
    context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 5_000 }));
  const consoleMessages = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleMessages.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.stack ?? error.message);
  });

  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
  await page.getByRole('heading', { name: /lumamark/i }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await editor.click();
  await page.keyboard.insertText('# Packaged WebView Smoke');
  await page.getByText('Packaged WebView Smoke').waitFor({
    state: 'visible',
    timeout: 5_000,
  });

  if (pageErrors.length > 0 || consoleMessages.length > 0) {
    throw new Error(
      [
        'Packaged WebView emitted runtime errors.',
        ...pageErrors,
        ...consoleMessages,
      ].join('\n'),
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        appStarted: true,
        cdpEndpoint: endpoint.webSocketDebuggerUrl ? 'available' : 'missing',
        editorAcceptedInput: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
  app.kill('SIGKILL');
}

async function waitForDebugEndpoint(debugPort) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
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
      // Keep polling until WebView2 opens the debugging endpoint.
    }

    await delay(500);
  }

  throw new Error(
    [
      `WebView2 remote debugging endpoint did not open on port ${debugPort}.`,
      `stdout: ${processOutput.stdout.join('')}`,
      `stderr: ${processOutput.stderr.join('')}`,
    ].join('\n'),
  );
}
