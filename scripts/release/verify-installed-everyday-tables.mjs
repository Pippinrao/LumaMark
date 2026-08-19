/**
 * Installed probe: everyday and alignment GFM tables must mount widgets
 * without rewriting source. Padded "canonical" tables remain a control.
 *
 * Fail if everyday or aligned widgetCount === 0. This is not the two-rAF
 * stutter gate.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createPackagedWebviewEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';
import { createRoutingEnvironment } from './installedWindowRoutingHelpers.mjs';

const EVERYDAY_SOURCE = [
  '# Everyday GFM',
  '',
  '| Name | Score |',
  '| --- | --- |',
  '| Alice | 1 |',
  '| Bob | 2 |',
  '',
].join('\n');

const ALIGNED_SOURCE = [
  '# Aligned GFM',
  '',
  '| Header | Value |',
  '| :--- | ---: |',
  '| x | longer value |',
  '',
].join('\n');

const PADDED_SOURCE = [
  '# Padded control',
  '',
  '| Left  | Right |',
  '| ----- | ----- |',
  '| alpha | beta  |',
  '| gamma | delta |',
  '',
].join('\n');

const options = parseArguments(process.argv.slice(2));
const executablePath =
  options.executablePath ||
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  join(process.env.LOCALAPPDATA ?? '', 'LumaMark', 'lumamark.exe');

if (options.plan) {
  process.stdout.write(
    `${JSON.stringify(
      {
        executablePath,
        fixtures: ['everyday', 'aligned', 'padded'],
        requireWidgets: ['everyday', 'aligned'],
      },
      null,
      2,
    )}\n`,
  );
} else {
  await runProbe();
}

async function runProbe() {
  if (process.platform !== 'win32') {
    throw new Error(
      'Everyday table probe requires an interactive Windows desktop.',
    );
  }

  const absoluteExecutablePath = resolve(executablePath);
  if (!existsSync(absoluteExecutablePath)) {
    throw new Error(`Installed executable does not exist: ${absoluteExecutablePath}`);
  }

  assertNoExistingLumaMarkProcesses();

  let app;
  let browser;
  let tempDirectory;
  const processOutput = { stderr: [], stdout: [] };
  let appStartError;
  let appExit;

  try {
    const debugPort = await reserveDebugPort(options.debugPort);
    tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-menu-context-os-everyday-tables-'));
    const settingsConfigDirectory = join(tempDirectory, 'settings-config');
    const fixturesDirectory = join(tempDirectory, 'fixtures');
    await mkdir(settingsConfigDirectory, { recursive: true });
    await mkdir(fixturesDirectory, { recursive: true });

    const nonce = Date.now();
    const everydayPath = join(fixturesDirectory, 'everyday.md');
    const alignedPath = join(fixturesDirectory, 'aligned.md');
    const paddedPath = join(fixturesDirectory, 'padded.md');
    await writeFile(everydayPath, EVERYDAY_SOURCE, 'utf8');
    await writeFile(alignedPath, ALIGNED_SOURCE, 'utf8');
    await writeFile(paddedPath, PADDED_SOURCE, 'utf8');
    await writeFile(
      join(settingsConfigDirectory, 'settings.json'),
      `${JSON.stringify(acceptanceSettings(), null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      join(settingsConfigDirectory, 'recent-files.json'),
      `${JSON.stringify(
        {
          files: [
            { name: 'aligned.md', openedAt: nonce - 1_000, path: alignedPath },
            { name: 'padded.md', openedAt: nonce - 2_000, path: paddedPath },
            { name: 'everyday.md', openedAt: nonce - 3_000, path: everydayPath },
          ],
          legacyImported: false,
          revision: 1,
          version: 1,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const environment = createPackagedWebviewEnvironment({
      baseEnvironment: createRoutingEnvironment(
        process.env,
        settingsConfigDirectory,
      ),
      debugPort,
      tempDirectory,
    });

    app = spawn(absoluteExecutablePath, [everydayPath], {
      cwd: tempDirectory,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    appExit = new Promise((resolveExit) => {
      app.once('exit', resolveExit);
      app.once('error', (error) => {
        appStartError = error;
        resolveExit();
      });
    });
    app.stdout?.on('data', (chunk) => {
      processOutput.stdout.push(String(chunk));
    });
    app.stderr?.on('data', (chunk) => {
      processOutput.stderr.push(String(chunk));
    });

    await waitForDebugEndpoint(debugPort, () => ({
      error: appStartError,
      exitCode: app.exitCode,
    }));
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const context = browser.contexts()[0];
    const page =
      context.pages()[0] ??
      (await context.waitForEvent('page', { timeout: 5_000 }));
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    await page
      .getByRole('banner')
      .getByRole('heading', { name: /lumamark/i })
      .waitFor({ state: 'visible', timeout: 20_000 });

    const everyday = await sampleOpenFile(page, {
      expectedSnippet: '| Alice | 1 |',
      label: 'everyday',
      title: 'everyday.md',
    });
    await openRecentFile(page, 'aligned.md');
    const aligned = await sampleOpenFile(page, {
      expectedSnippet: '| :--- | ---: |',
      label: 'aligned',
      title: 'aligned.md',
    });
    await openRecentFile(page, 'padded.md');
    const padded = await sampleOpenFile(page, {
      expectedSnippet: '| alpha | beta  |',
      label: 'padded',
      title: 'padded.md',
    });

    const evidence = { aligned, everyday, padded };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);

    const failures = [];
    if (everyday.widgetCount === 0) {
      failures.push('everyday GFM table mounted 0 widgets');
    }
    if (!everyday.sourceUnchanged) {
      failures.push('everyday GFM table source was rewritten');
    }
    if (aligned.widgetCount === 0) {
      failures.push('aligned GFM table mounted 0 widgets');
    }
    if (!aligned.sourceUnchanged) {
      failures.push('aligned GFM table source was rewritten');
    }
    if (padded.widgetCount === 0) {
      failures.push('padded control table mounted 0 widgets');
    }
    if (failures.length > 0) {
      throw new Error(failures.join('; '));
    }
  } finally {
    await browser?.close().catch(() => {});
    if (app && app.exitCode === null) {
      app.kill();
      await appExit;
    }
    if (tempDirectory) {
      await removePackagedWebviewTempDirectory(tempDirectory);
    }
  }
}

async function sampleOpenFile(page, { expectedSnippet, label, title }) {
  await page.locator('.lm-editor-title', { hasText: title }).waitFor({
    state: 'visible',
    timeout: 20_000,
  });
  await waitForEditorSnippet(page, expectedSnippet, 20_000);
  await delay(400);
  return page.evaluate(
    ({ expectedSnippet: snippet, label: fixtureLabel }) => {
      const widgets = document.querySelectorAll('.tbl-table-widget');
      const text = document.querySelector('.cm-content')?.innerText ?? '';
      const normalized = text.replace(/\r\n/g, '\n');
      return {
        fixture: fixtureLabel,
        sourceUnchanged: normalized.includes(snippet),
        widgetCount: widgets.length,
      };
    },
    { expectedSnippet, label },
  );
}

async function openRecentFile(page, name) {
  const target = page.locator('.lm-recent-file', { hasText: name }).first();
  await target.waitFor({ state: 'visible', timeout: 8_000 });
  await target.click({ timeout: 5_000 });
}

async function waitForEditorSnippet(page, snippet, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest = '';
  while (Date.now() < deadline) {
    latest = await page.evaluate(() => document.querySelector('.cm-content')?.innerText ?? '');
    if (latest.replace(/\r\n/g, '\n').includes(snippet)) {
      return;
    }
    await delay(100);
  }
  throw new Error(
    `Editor never showed ${snippet}. Last text: ${latest.slice(0, 240)}`,
  );
}

function acceptanceSettings() {
  return {
    appearance: {
      theme: 'system',
    },
    editor: {
      defaultDisplayMode: 'livePreview',
      plantuml: {
        enabled: true,
      },
    },
    updates: {
      autoCheckOnStartup: false,
    },
    version: 3,
  };
}

function assertNoExistingLumaMarkProcesses() {
  const command = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    '$items = @(Get-Process -Name lumamark -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ id = $_.Id; path = $_.Path } })',
    'ConvertTo-Json -Compress -Depth 3 -InputObject $items',
  ].join('; ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to inspect existing LumaMark processes: ${
        result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`
      }`,
      result.error ? { cause: result.error } : undefined,
    );
  }
  const existing = JSON.parse(result.stdout.trim() || '[]');
  const items = Array.isArray(existing) ? existing : [existing];
  if (items.length > 0 && items[0]?.id) {
    throw new Error(
      `Close existing LumaMark processes before installed acceptance: ${JSON.stringify(
        items,
      )}`,
    );
  }
}

async function waitForDebugEndpoint(debugPort, getProcessState) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const processState = getProcessState();
    if (processState.error) {
      throw new Error(`Unable to start installed LumaMark: ${processState.error.message}`, {
        cause: processState.error,
      });
    }
    if (processState.exitCode !== null && processState.exitCode !== undefined) {
      throw new Error(
        `Installed LumaMark child exited before WebView2 opened (exit ${processState.exitCode}).`,
      );
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the child exposes its WebView2 endpoint.
    }
    await delay(500);
  }
  throw new Error(`WebView2 debug endpoint did not open on port ${debugPort}.`);
}

function parseArguments(args) {
  const parsed = {
    debugPort: undefined,
    executablePath: undefined,
    plan: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan') {
      parsed.plan = true;
      continue;
    }
    if (argument === '--executable' || argument === '--debug-port') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === '--executable') {
        parsed.executablePath = value;
      } else {
        parsed.debugPort = parsePositiveInteger(value, argument);
      }
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}.`);
  }
  return parsed;
}
