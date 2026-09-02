/**
 * Repeatable idle-memory measurement for issue #32.
 *
 * Opens a simple document and a mixed document, then samples JS heap
 * (CDP Performance.getMetrics) and the Windows working set while the window
 * sits idle. Default run records data only; pass --max-working-set-mb to fail
 * closed once a budget exists.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import {
  createAcceptanceSettingsEnvironment,
  removePackagedWebviewTempDirectory,
  reserveDebugPort,
} from './packagedWebviewHarness.mjs';

const SIMPLE_SOURCE = readFileSync(
  fileURLToPath(new URL('../../tests/fixtures/markdown/headings.md', import.meta.url)),
  'utf8',
);
const MIXED_SOURCE = [
  '# Mixed writing sample',
  '',
  'Lead-in with inline math $E=mc^2$ before the heavy blocks.',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}',
  '$$',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[Start] --> B{Branch}',
  '  B --> C[Done]',
  '```',
  '',
  '```plantuml',
  '@startuml',
  'Alice -> Bob: hello',
  '@enduml',
  '```',
  '',
  '| Col | Value |',
  '| --- | ----- |',
  '| a   | 1     |',
  '| b   | 2     |',
  '',
  'Tail paragraph for idle observation.',
].join('\n');

const options = parseArguments(process.argv.slice(2));
const executablePath =
  options.executablePath ||
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  fileURLToPath(
    new URL('../../src-tauri/target/release/lumamark.exe', import.meta.url),
  );

if (options.plan) {
  process.stdout.write(
    `${JSON.stringify(
      {
        durationMs: options.durationMs,
        executablePath,
        intervalMs: options.intervalMs,
        maxWorkingSetMb: options.maxWorkingSetMb,
        profiles: ['simple', 'mixed'],
      },
      null,
      2,
    )}\n`,
  );
} else {
  await runMeasurement();
}

async function runMeasurement() {
  if (process.platform !== 'win32') {
    throw new Error('Idle-memory measurement requires Windows.');
  }

  const absoluteExecutablePath = resolve(executablePath);
  if (!existsSync(absoluteExecutablePath)) {
    throw new Error(`LumaMark executable does not exist: ${absoluteExecutablePath}`);
  }

  const evidence = {
    durationMs: options.durationMs,
    executablePath: absoluteExecutablePath,
    intervalMs: options.intervalMs,
    profiles: [],
  };

  try {
    const executableStats = await stat(absoluteExecutablePath);
    evidence.executable = {
      modifiedAt: executableStats.mtime.toISOString(),
      size: executableStats.size,
    };
    evidence.profiles.push(
      await measureProfile({
        absoluteExecutablePath,
        durationMs: options.durationMs,
        intervalMs: options.intervalMs,
        name: 'simple',
        source: SIMPLE_SOURCE,
      }),
    );
    evidence.profiles.push(
      await measureProfile({
        absoluteExecutablePath,
        durationMs: options.durationMs,
        intervalMs: options.intervalMs,
        name: 'mixed',
        source: MIXED_SOURCE,
      }),
    );

    if (options.maxWorkingSetMb !== undefined) {
      const overBudget = evidence.profiles.filter((profile) => {
        const last = profile.samples.at(-1);
        return (last?.workingSetBytes ?? 0) > options.maxWorkingSetMb * 1024 * 1024;
      });
      if (overBudget.length > 0) {
        throw new Error(
          `Working set exceeded ${options.maxWorkingSetMb} MB: ${JSON.stringify(overBudget)}`,
        );
      }
    }

    evidence.passed = true;
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      [
        '[release:installed-idle-memory] FAILED',
        error instanceof Error ? error.stack ?? error.message : String(error),
        `partial evidence: ${JSON.stringify(evidence)}`,
      ].join('\n'),
    );
    process.stderr.write('\n');
    process.exitCode = 1;
  }
}

async function measureProfile({
  absoluteExecutablePath,
  durationMs,
  intervalMs,
  name,
  source,
}) {
  let app;
  let appExit;
  let appStartError;
  let browser;
  let tempDirectory;
  const processOutput = { stderr: [], stdout: [] };
  const profile = { name, samples: [] };

  try {
    const debugPort = await reserveDebugPort();
    tempDirectory = await mkdtemp(
      join(tmpdir(), `lumamark-menu-context-os-idle-memory-${name}-`),
    );
    const documentPath = join(tempDirectory, `${name}.md`);
    await writeFile(documentPath, source, 'utf8');
    app = spawn(absoluteExecutablePath, [documentPath], {
      cwd: dirname(absoluteExecutablePath),
      env: await createAcceptanceSettingsEnvironment({
        baseEnvironment: process.env,
        debugPort,
        tempDirectory,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    });
    profile.pid = app.pid ?? null;
    appExit = new Promise((resolveExit) => {
      app.once('exit', resolveExit);
      app.once('error', (error) => {
        appStartError = error;
        resolveExit();
      });
    });
    app.stdout?.on('data', (chunk) => processOutput.stdout.push(String(chunk)));
    app.stderr?.on('data', (chunk) => processOutput.stderr.push(String(chunk)));

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
    await page.waitForFunction(
      () => Boolean(document.querySelector('.lm-editor-live-preview-mode .cm-content')),
      null,
      { timeout: 20_000 },
    );
    await delay(2_000);

    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const startedAt = Date.now();
    while (Date.now() - startedAt <= durationMs) {
      const metrics = await session.send('Performance.getMetrics');
      const heap = metricValue(metrics.metrics, 'JSHeapUsedSize');
      const widgets = await page.evaluate(() => ({
        mathStyles: document.querySelectorAll('style[data-lm-math-style]').length,
        mermaidBlocks: document.querySelectorAll('.lm-mermaid-widget').length,
        tableWidgets: document.querySelectorAll('.tbl-table-widget').length,
      }));
      const processMemory = readProcessMemory(app.pid);
      profile.samples.push({
        elapsedMs: Date.now() - startedAt,
        jsHeapUsedSize: heap,
        ...processMemory,
        ...widgets,
      });
      await delay(intervalMs);
    }

    const first = profile.samples[0];
    const last = profile.samples.at(-1);
    profile.summary = {
      heapGrowthBytes: (last?.jsHeapUsedSize ?? 0) - (first?.jsHeapUsedSize ?? 0),
      lastWorkingSetBytes: last?.workingSetBytes ?? 0,
      workingSetGrowthBytes:
        (last?.workingSetBytes ?? 0) - (first?.workingSetBytes ?? 0),
    };
    return profile;
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
}

function metricValue(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value ?? null;
}

function readProcessMemory(pid) {
  if (!pid) {
    return {
      childCount: null,
      privateBytes: null,
      processTree: [],
      workingSetBytes: null,
    };
  }
  const script = `
$root = ${pid}
$all = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize)
$byParent = @{}
foreach ($proc in $all) {
  $parentId = [int]$proc.ParentProcessId
  if (-not $byParent.ContainsKey($parentId)) { $byParent[$parentId] = New-Object System.Collections.Generic.List[object] }
  [void]$byParent[$parentId].Add($proc)
}
$ids = New-Object 'System.Collections.Generic.List[int]'
[void]$ids.Add($root)
$queue = New-Object 'System.Collections.Generic.Queue[int]'
$queue.Enqueue($root)
while ($queue.Count -gt 0) {
  $parent = $queue.Dequeue()
  if ($byParent.ContainsKey($parent)) {
    foreach ($child in $byParent[$parent]) {
      $childId = [int]$child.ProcessId
      if (-not $ids.Contains($childId)) {
        [void]$ids.Add($childId)
        $queue.Enqueue($childId)
      }
    }
  }
}
$tree = foreach ($id in $ids) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -ne $p) {
    [pscustomobject]@{
      name = $p.ProcessName
      pid = $id
      privateBytes = $p.PrivateMemorySize64
      workingSetBytes = $p.WorkingSet64
    }
  }
}
@{
  childCount = @($tree).Count
  privateBytes = [int64]((@($tree) | Measure-Object privateBytes -Sum).Sum)
  processTree = @($tree)
  workingSetBytes = [int64]((@($tree) | Measure-Object workingSetBytes -Sum).Sum)
} | ConvertTo-Json -Compress -Depth 4
`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 20_000, windowsHide: true },
  );
  if (result.status !== 0) {
    return {
      childCount: null,
      privateBytes: null,
      processTree: [],
      workingSetBytes: null,
      stderr: result.stderr?.trim() || null,
    };
  }
  return JSON.parse(result.stdout.trim());
}

async function waitForDebugEndpoint(debugPort, getProcessState) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const state = getProcessState();
    if (state.error) {
      throw new Error(`Unable to start LumaMark: ${state.error.message}`, {
        cause: state.error,
      });
    }
    if (state.exitCode !== null) {
      throw new Error(
        `Exact LumaMark child exited before WebView2 opened (exit ${state.exitCode}).`,
      );
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) return;
    } catch {
      // Poll only the remote-debugging port assigned to the exact child.
    }
    await delay(500);
  }
  throw new Error(`WebView2 debug endpoint did not open on port ${debugPort}.`);
}

function parseArguments(args) {
  const parsed = {
    durationMs: 120_000,
    executablePath: undefined,
    intervalMs: 15_000,
    maxWorkingSetMb: undefined,
    plan: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--plan') {
      parsed.plan = true;
      continue;
    }
    if (
      argument === '--executable' ||
      argument === '--duration-ms' ||
      argument === '--interval-ms' ||
      argument === '--max-working-set-mb'
    ) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === '--executable') {
        parsed.executablePath = value;
        continue;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(`${argument} must be a positive number; received ${value}.`);
      }
      if (argument === '--duration-ms') parsed.durationMs = numeric;
      if (argument === '--interval-ms') parsed.intervalMs = numeric;
      if (argument === '--max-working-set-mb') parsed.maxWorkingSetMb = numeric;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}
