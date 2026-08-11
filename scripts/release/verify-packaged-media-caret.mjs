/**
 * Packaged Windows acceptance: image + mermaid widgets must not shift
 * click → caret mapping. Runs against installed/packaged WebView2.
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
const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  fileURLToPath(new URL('src-tauri/target/release/lumamark.exe', root));
const fileName = 'media-caret-probe.md';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="#4488cc"/></svg>`;
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const markdown = [
  'alpha line',
  '',
  `![pic](${dataUrl})`,
  '',
  'beta line',
  '',
  '```mermaid',
  'graph TD;',
  '  A-->B;',
  '  B-->C;',
  '```',
  '',
  'gamma line',
  '',
  'delta line',
  '',
].join('\n');

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:packaged-media-caret] Windows WebView2 only; skipping.\n',
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
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-packaged-media-'));
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

  await expect(page.locator('.lm-image-preview img')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.lm-mermaid-preview')).toHaveAttribute(
    'data-status',
    'success',
    { timeout: 30_000 },
  );

  const margins = await page.evaluate(() => {
    const image = document.querySelector('.lm-image-preview');
    const mermaid = document.querySelector('.lm-mermaid-preview');
    if (!(image instanceof HTMLElement) || !(mermaid instanceof HTMLElement)) {
      throw new Error('Expected image and mermaid widgets');
    }
    const imageStyle = getComputedStyle(image);
    const mermaidStyle = getComputedStyle(mermaid);
    return {
      image: {
        marginBottom: imageStyle.marginBottom,
        marginTop: imageStyle.marginTop,
      },
      mermaid: {
        marginBottom: mermaidStyle.marginBottom,
        marginTop: mermaidStyle.marginTop,
      },
    };
  });
  if (
    margins.image.marginTop !== '0px' ||
    margins.image.marginBottom !== '0px' ||
    margins.mermaid.marginTop !== '0px' ||
    margins.mermaid.marginBottom !== '0px'
  ) {
    throw new Error(`Block media widgets still invent margins: ${JSON.stringify(margins)}`);
  }

  const probeNames = ['alpha line', 'beta line', 'gamma line', 'delta line'];
  let settled = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    settled = await probeNamedLines(page, probeNames);
    const aligned = settled.rows.every((row) => row.drift === 0 && row.ok);
    const heightOk =
      Math.abs(settled.contentInnerHeight - settled.docHeight) <= 2;
    if (aligned && heightOk) {
      break;
    }
    await delay(250);
    settled = null;
  }
  if (!settled) {
    throw new Error('Timed out waiting for media widget height-map alignment.');
  }

  for (const [name, marker] of [
    ['beta line', 'BETA'],
    ['gamma line', 'GAMMA'],
    ['delta line', 'DELTA'],
  ]) {
    const line = page.locator('.lm-editor-live-preview-mode .cm-line', {
      hasText: new RegExp(`^${name}$`),
    });
    await line.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const probe = await probeNamedLines(page, [name]);
        return probe.rows[0];
      })
      .toMatchObject({ drift: 0, name, ok: true });

    const point = await line.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.keyboard.insertText(marker);
  }

  const source = await page.evaluate(() => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const tile = content?.cmTile;
    const view = tile?.root?.view ?? tile?.view;
    return view?.state.doc.toString() ?? '';
  });

  if (!/BETAbeta line/.test(source)) {
    throw new Error(`BETA insert missed beta line. Source:\n${source}`);
  }
  if (!/GAMMAgamma line/.test(source)) {
    throw new Error(`GAMMA insert missed gamma line. Source:\n${source}`);
  }
  if (!/DELTAdelta line/.test(source)) {
    throw new Error(`DELTA insert missed delta line. Source:\n${source}`);
  }

  process.stdout.write(
    JSON.stringify(
      {
        packagedMediaCaret: true,
        heightDelta: Math.abs(settled.contentInnerHeight - settled.docHeight),
        margins,
        rows: settled.rows,
        sourceMatched: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(
    [
      '[release:packaged-media-caret] FAILED',
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

async function probeNamedLines(page, names) {
  return page.evaluate((lineNames) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    if (!(content instanceof HTMLElement)) {
      throw new Error('Expected live-preview content');
    }

    const tile = content.cmTile;
    const view = tile.root?.view ?? tile.view;
    const contentRect = view.contentDOM.getBoundingClientRect();
    const docTop = contentRect.top + view.viewState.paddingTop;
    const text = view.state.doc.toString();

    const rows = lineNames.map((name) => {
      const index = text.indexOf(name);
      if (index < 0) {
        throw new Error(`Missing probe line ${name}`);
      }
      const line = view.state.doc.lineAt(index);
      const block = view.lineBlockAt(line.from);
      const el = [
        ...document.querySelectorAll('.lm-editor-live-preview-mode .cm-line'),
      ].find((node) => node.textContent === name);
      if (!(el instanceof HTMLElement)) {
        throw new Error(`Missing DOM line ${name}`);
      }
      const rect = el.getBoundingClientRect();
      const pos = view.posAtCoords({
        x: rect.left + 5,
        y: rect.top + rect.height / 2,
      });
      return {
        drift: Math.round(rect.top - docTop - block.top) || 0,
        name,
        ok: pos != null && view.state.doc.lineAt(pos).text === name,
        resolved:
          pos == null ? null : view.state.doc.lineAt(pos).text.slice(0, 24),
      };
    });

    return {
      contentInnerHeight: Math.round(
        contentRect.height -
          view.viewState.paddingTop -
          view.viewState.paddingBottom,
      ),
      docHeight: Math.round(view.viewState.docHeight),
      rows,
    };
  }, names);
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
