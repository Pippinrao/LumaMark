import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const root = new URL('../..', import.meta.url);
const executablePath = fileURLToPath(
  new URL('src-tauri/target/release/lumamark.exe', root),
);
const recentFilesKey = 'lumamark.recent-files.v1';
const recoveryDraftKey = 'lumamark-recovery-draft-v1';
const fileName = 'parity-native.md';
const unicodeText = '中文输入路径';
const initialMarkdown = [
  '# Packaged WebView Smoke',
  '',
  unicodeText,
  '',
  '- [ ] Accessible task',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  'After diagram',
  '',
].join('\n');

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
let page;
let originalStorage;
let app;
let appExit;
let appStartError;
let tempDirectory;

try {
  const requestedPort = parseRequestedPort(
    process.env.LUMAMARK_WEBVIEW_DEBUG_PORT,
  );
  const port = await reserveDebugPort(requestedPort);
  tempDirectory = await mkdtemp(
    join(tmpdir(), 'lumamark-packaged-webview-'),
  );
  const documentPath = join(tempDirectory, fileName);
  await writeFile(documentPath, initialMarkdown, 'utf8');

  app = spawn(executablePath, [], {
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

  const endpoint = await waitForDebugEndpoint(port, () => appStartError);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  page =
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

  originalStorage = await page.evaluate(
    ({ recentFilesKey, recoveryDraftKey }) => ({
      recentFiles: localStorage.getItem(recentFilesKey),
      recoveryDraft: localStorage.getItem(recoveryDraftKey),
    }),
    { recentFilesKey, recoveryDraftKey },
  );
  await page.evaluate(
    ({ recentFilesKey, recoveryDraftKey, documentPath, fileName }) => {
      localStorage.setItem(
        recentFilesKey,
        JSON.stringify([
          {
            name: fileName,
            path: documentPath,
            openedAt: Date.now(),
          },
        ]),
      );
      localStorage.removeItem(recoveryDraftKey);
    },
    { recentFilesKey, recoveryDraftKey, documentPath, fileName },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });

  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: new RegExp(fileName) }).click();
  await page.locator('.lm-editor-title', { hasText: fileName }).waitFor({
    state: 'visible',
    timeout: 10_000,
  });
  await page.locator('.lm-mermaid-svg svg').waitFor({
    state: 'visible',
    timeout: 10_000,
  });

  const taskCheckbox = page.locator('.lm-md-task-checkbox');
  await taskCheckbox.waitFor({ state: 'visible', timeout: 5_000 });
  const taskLabel = await taskCheckbox.getAttribute('aria-label');
  if (!taskLabel) {
    throw new Error('Packaged WebView task checkbox has no accessible label.');
  }

  await page.locator('.lm-mermaid-preview').hover();
  await page.locator('.lm-mermaid-edit-source').click();
  await page.locator('.lm-mermaid-preview-editing').waitFor({
    state: 'visible',
    timeout: 5_000,
  });
  await page.locator('.cm-line', { hasText: 'A --> B' }).click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('\n  B --> C');
  await page.locator('.cm-line', { hasText: 'B --> C' }).waitFor({
    state: 'visible',
    timeout: 5_000,
  });
  await page.keyboard.press('Control+S');
  await waitForSavedStatus(page);

  const activeSaveText = await readFile(documentPath, 'utf8');
  if (!activeSaveText.includes('  B --> C')) {
    throw new Error(
      'Packaged WebView active Mermaid edit was missing from the saved file.',
    );
  }
  if (!(await page.locator('.lm-mermaid-preview-editing').isVisible())) {
    throw new Error('Saving unexpectedly closed the active Mermaid editor.');
  }

  await page.evaluate(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve the packaged CodeMirror EditorView.');
    }
    const from = view.state.doc.length;
    const insert = '\nUnicode input: ';
    view.dispatch({
      changes: { from, insert },
      selection: { anchor: from + insert.length },
    });
    view.focus();
  });
  await page.keyboard.insertText(unicodeText);
  if (
    !(await page.evaluate(
      (text) => {
        const view = document.querySelector('.cm-content')?.cmTile?.view;
        return view?.state.doc.toString().endsWith(`Unicode input: ${text}`);
      },
      unicodeText,
    ))
  ) {
    throw new Error('Packaged WebView Unicode input did not reach the document.');
  }

  const modeSnapshot = await page.evaluate(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve the packaged CodeMirror EditorView.');
    }
    return {
      doc: view.state.doc.toString(),
      selection: view.state.selection.toJSON(),
      scrollTop: view.scrollDOM.scrollTop,
    };
  });
  await page.keyboard.press('Control+/');
  await page.locator('.lm-editor-source-mode').waitFor({
    state: 'visible',
    timeout: 5_000,
  });
  await page.keyboard.press('Control+/');
  await page.locator('.lm-editor-live-preview-mode').waitFor({
    state: 'visible',
    timeout: 5_000,
  });
  const modeAfter = await page.evaluate(() => {
    const view = document.querySelector('.cm-content')?.cmTile?.view;
    if (!view) {
      throw new Error('Unable to resolve the packaged CodeMirror EditorView.');
    }
    return {
      doc: view.state.doc.toString(),
      selection: view.state.selection.toJSON(),
      scrollTop: view.scrollDOM.scrollTop,
    };
  });
  if (
    modeAfter.doc !== modeSnapshot.doc ||
    JSON.stringify(modeAfter.selection) !== JSON.stringify(modeSnapshot.selection) ||
    Math.abs(modeAfter.scrollTop - modeSnapshot.scrollTop) > 1
  ) {
    throw new Error('Packaged WebView display-mode round trip changed editor state.');
  }

  await page.keyboard.press('Control+S');
  await waitForSavedStatus(page);
  const finalSavedText = await readFile(documentPath, 'utf8');
  if (!finalSavedText.endsWith(`Unicode input: ${unicodeText}`)) {
    throw new Error('Packaged WebView Unicode text was not saved exactly.');
  }

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
        activeMermaidSave: true,
        cdpEndpoint: endpoint.webSocketDebuggerUrl ? 'available' : 'missing',
        editorAcceptedInput: true,
        mermaidRendered: true,
        modeRoundTrip: true,
        taskCheckboxAccessible: true,
        unicodeInput: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} finally {
  if (page && originalStorage) {
    await page
      .evaluate(
        ({ recentFilesKey, recoveryDraftKey, originalStorage }) => {
          if (originalStorage.recentFiles === null) {
            localStorage.removeItem(recentFilesKey);
          } else {
            localStorage.setItem(
              recentFilesKey,
              originalStorage.recentFiles,
            );
          }
          if (originalStorage.recoveryDraft === null) {
            localStorage.removeItem(recoveryDraftKey);
          } else {
            localStorage.setItem(
              recoveryDraftKey,
              originalStorage.recoveryDraft,
            );
          }
        },
        { recentFilesKey, recoveryDraftKey, originalStorage },
      )
      .catch(() => {});
  }
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

async function waitForSavedStatus(page) {
  await page.waitForFunction(() => {
    const status = document.querySelector('[role="status"]')?.textContent ?? '';
    const title = document.querySelector('.lm-editor-title')?.textContent ?? '';
    return /Saved|已保存/.test(status) && !title.includes('*');
  });
}

function parseRequestedPort(value) {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return Number(value);
}

async function waitForDebugEndpoint(debugPort, getStartError) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const startError = getStartError();
    if (startError) {
      throw new Error(
        `Unable to start the packaged LumaMark executable: ${startError.message}`,
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
