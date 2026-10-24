/**
 * Repeatable idle-memory measurement for issue #32.
 *
 * Samples an empty start screen, small and mixed documents, 1MB and 10MB
 * documents, and repeated same-window file switches. Each sample forces a
 * garbage collection, then records the JS heap and the Windows working set of
 * the lumamark + WebView2 process tree, split by process role.
 * Default run records data only; pass --max-working-set-mb to fail closed
 * once a budget exists. Run this command alone, not beside a build or E2E.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdtemp, stat, writeFile } from 'node:fs/promises';
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
        profiles: [
          'empty',
          'simple',
          'mixed',
          'large-1mb',
          'large-10mb',
          'switch',
        ],
        rounds: options.rounds,
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
    const fixtureDirectory = fileURLToPath(
      new URL('../../tests/fixtures/markdown/', import.meta.url),
    );
    const profileSpecs = [
      { name: 'empty', kind: 'empty' },
      { name: 'simple', kind: 'document', source: SIMPLE_SOURCE },
      { name: 'mixed', kind: 'document', source: MIXED_SOURCE },
      {
        name: 'large-1mb',
        kind: 'fixture',
        fixturePath: join(fixtureDirectory, 'large-1mb.md'),
      },
      {
        name: 'large-10mb',
        kind: 'fixture',
        fixturePath: join(fixtureDirectory, 'large-10mb.md'),
      },
      { name: 'switch', kind: 'switch', rounds: options.rounds },
    ].filter((spec) => options.only === undefined || spec.name === options.only);
    for (const spec of profileSpecs) {
      evidence.profiles.push(
        await measureProfile({
          absoluteExecutablePath,
          durationMs: options.durationMs,
          intervalMs: options.intervalMs,
          ...spec,
        }),
      );
    }

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
  fixturePath,
  intervalMs,
  kind,
  name,
  rounds,
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
    const environment = await createAcceptanceSettingsEnvironment({
      baseEnvironment: process.env,
      debugPort,
      tempDirectory,
    });
    const launch = await prepareLaunch({
      fixturePath,
      kind,
      name,
      source,
      tempDirectory,
    });
    app = spawn(absoluteExecutablePath, launch.args, {
      cwd: dirname(absoluteExecutablePath),
      env: environment,
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
    const editorTimeoutMs = name.startsWith('large-') ? 90_000 : 20_000;
    if (kind === 'empty') {
      await page.waitForFunction(
        () => Boolean(document.querySelector('.lm-start-screen')),
        null,
        { timeout: editorTimeoutMs },
      );
    } else {
      await page.waitForFunction(
        () => Boolean(document.querySelector('.lm-editor-live-preview-mode .cm-content')),
        null,
        { timeout: editorTimeoutMs },
      );
    }
    await delay(2_000);

    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    await session.send('HeapProfiler.enable').catch(() => {});
    const startedAt = Date.now();
    const takeSample = async (label) => {
      await session.send('HeapProfiler.collectGarbage').catch(() => {});
      const metrics = await session.send('Performance.getMetrics');
      const heap = metricValue(metrics.metrics, 'JSHeapUsedSize');
      const widgets = await page.evaluate(() => ({
        mathStyles: document.querySelectorAll('style[data-lm-math-style]').length,
        mermaidBlocks: document.querySelectorAll('.lm-mermaid-widget').length,
        tableWidgets: document.querySelectorAll('.tbl-table-widget').length,
      }));
      const processMemory = readProcessMemory(app.pid);
      return {
        elapsedMs: Date.now() - startedAt,
        jsHeapUsedSize: heap,
        label,
        roles: summarizeRoles(processMemory.processTree),
        ...processMemory,
        ...widgets,
      };
    };

    if (kind === 'switch') {
      profile.samples = await sampleFileSwitches(page, takeSample, launch.files, rounds);
    } else {
      while (Date.now() - startedAt <= durationMs) {
        profile.samples.push(await takeSample('idle'));
        await delay(intervalMs);
      }
    }

    const first =
      profile.samples.find((sample) => sample.label === 'after-round-1') ??
      profile.samples[0];
    const last =
      profile.samples.find((sample) => sample.label === 'after-last-round') ??
      profile.samples.at(-1);
    profile.summary = {
      heapGrowthBytes: (last?.jsHeapUsedSize ?? 0) - (first?.jsHeapUsedSize ?? 0),
      lastPrivateBytes: last?.privateBytes ?? 0,
      lastWorkingSetBytes: last?.workingSetBytes ?? 0,
      privateGrowthBytes: (last?.privateBytes ?? 0) - (first?.privateBytes ?? 0),
      roles: last?.roles ?? null,
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

async function prepareLaunch({ fixturePath, kind, name, source, tempDirectory }) {
  if (kind === 'empty') {
    return { args: [], files: [] };
  }
  if (kind === 'fixture') {
    const documentPath = join(tempDirectory, `${name}.md`);
    await copyFile(fixturePath, documentPath);
    return { args: [documentPath], files: [] };
  }
  if (kind === 'switch') {
    const files = [];
    for (let index = 0; index < 5; index += 1) {
      const fileName = `switch-${index + 1}.md`;
      const path = join(tempDirectory, fileName);
      const token = `SWITCH-TOKEN-${index + 1}`;
      await writeFile(
        path,
        `# ${fileName}\n\n${token}\n\nA short paragraph for the leak check.\n`,
        'utf8',
      );
      files.push({ name: fileName, path, token });
    }
    const settingsDirectory = join(tempDirectory, 'settings-config');
    await writeFile(
      join(settingsDirectory, 'settings.json'),
      `${JSON.stringify(aggregateWindowSettings(), null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      join(settingsDirectory, 'recent-files.json'),
      `${JSON.stringify(
        {
          files: files.map((file, index) => ({
            name: file.name,
            openedAt: index + 1,
            path: file.path,
          })),
          legacyImported: false,
          revision: 1,
          version: 1,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    // Open the first file directly. The start screen marks the workspace
    // inert, and that collapse sticks, so sidebar recent-file buttons never
    // become clickable after leaving home.
    return { args: [files[0].path], files };
  }
  const documentPath = join(tempDirectory, `${name}.md`);
  await writeFile(documentPath, source, 'utf8');
  return { args: [documentPath], files: [] };
}

function aggregateWindowSettings() {
  // Version 3 is what the other installed probes persist. The app migrates it
  // forward, including openWindowMode, which keeps the recent-file list in the
  // sidebar while several documents are open.
  return {
    appearance: {
      fontZoomPercent: 100,
      pageWidth: 'standard',
      sidebarOpenOnStartup: true,
      theme: 'light',
    },
    editor: {
      autosaveEnabled: false,
      defaultDisplayMode: 'livePreview',
      focusModeOnStartup: false,
    },
    general: {
      language: 'en',
      openWindowMode: 'aggregateWindow',
      startupBehavior: 'home',
    },
    images: {
      copyImagesToAssets: false,
    },
    markdown: {
      math: {
        equationNumbering: 'none',
        physicsEnabled: false,
        syntaxMode: 'pandoc',
      },
      plantuml: { enabled: true },
    },
    updates: { autoCheckOnStartup: false },
    version: 3,
  };
}

async function sampleFileSwitches(page, takeSample, files, rounds) {
  const samples = [];
  await waitForToken(page, files[0].token);
  // A file opened without a workspace starts on the outline tab, which
  // unmounts the file tree. Recent files live on the files tab.
  await page.locator('.lm-sidebar-tab').first().click();
  try {
    await page.locator('.lm-recent-file').first().waitFor({
      state: 'visible',
      timeout: 15_000,
    });
  } catch (error) {
    throw new Error(`Recent files were not visible: ${JSON.stringify(await describeSwitchSurface(page))}`, {
      cause: error,
    });
  }
  for (let round = 0; round < rounds; round += 1) {
    for (const file of files) {
      await clickRecentFile(page, file.name);
      await waitForToken(page, file.token);
    }
    if (round === 0 || round === rounds - 1) {
      samples.push(await takeSample(round === 0 ? 'after-round-1' : 'after-last-round'));
    }
  }
  await clickRecentFile(page, files[0].name);
  await waitForToken(page, files[0].token);
  samples.push(await takeSample('back-to-first'));
  return samples;
}

async function describeSwitchSurface(page) {
  return page
    .evaluate(() => {
      const sidebar = document.querySelector('.lm-sidebar-content');
      const box = sidebar?.getBoundingClientRect();
      return {
        recentFiles: document.querySelectorAll('.lm-recent-file').length,
        recentSection: Boolean(document.querySelector('.lm-recent-files')),
        sidebarHidden: sidebar?.getAttribute('aria-hidden') ?? null,
        sidebarText: sidebar?.textContent?.slice(0, 400) ?? null,
        sidebarWidth: box?.width ?? null,
        singleFile: document.querySelector('.lm-single-file-sidebar')?.textContent ?? null,
        startScreen: Boolean(document.querySelector('.lm-start-screen')),
      };
    })
    .catch(() => null);
}

async function clickRecentFile(page, name) {
  const target = page.locator('.lm-recent-file', { hasText: name }).first();
  try {
    await target.click({ timeout: 15_000 });
  } catch (error) {
    const surface = await page
      .evaluate(() => ({
        recentFiles: document.querySelectorAll('.lm-recent-file').length,
        sidebarHidden:
          document.querySelector('.lm-sidebar-content')?.getAttribute('aria-hidden') ?? null,
        singleFile: document.querySelector('.lm-single-file-sidebar')?.textContent ?? null,
        startScreen: Boolean(document.querySelector('.lm-start-screen')),
      }))
      .catch(() => null);
    throw new Error(
      `Could not open recent file ${name}: ${JSON.stringify(surface)}`,
      { cause: error },
    );
  }
}

async function waitForToken(page, token) {
  await page.waitForFunction(
    (expected) => {
      const content = document.querySelector('.lm-editor-live-preview-mode .cm-content');
      return Boolean(content && content.textContent.includes(expected));
    },
    token,
    { timeout: 20_000 },
  );
}

function metricValue(metrics, name) {
  return metrics.find((metric) => metric.name === name)?.value ?? null;
}

function summarizeRoles(processTree) {
  const roles = {};
  for (const entry of processTree ?? []) {
    const role = processRole(entry);
    const current = roles[role] ?? { count: 0, privateBytes: 0, workingSetBytes: 0 };
    current.count += 1;
    current.privateBytes += entry.privateBytes ?? 0;
    current.workingSetBytes += entry.workingSetBytes ?? 0;
    roles[role] = current;
  }
  return roles;
}

function processRole(entry) {
  const line = entry.commandLine ?? '';
  if (entry.name === 'lumamark') return 'main';
  if (line.includes('--type=gpu-process')) return 'gpu';
  if (line.includes('--type=renderer')) return 'renderer';
  if (line.includes('--type=crashpad')) return 'crashpad';
  if (line.includes('--type=utility')) return 'utility';
  if (line.includes('--embedded-browser-webview')) return 'browser';
  return 'other';
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
$all = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
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
    $command = $all | Where-Object { [int]$_.ProcessId -eq $id } | Select-Object -First 1 -ExpandProperty CommandLine
    [pscustomobject]@{
      commandLine = if ($null -eq $command) { '' } else { [string]$command.Substring(0, [Math]::Min(180, $command.Length)) }
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
    only: undefined,
    plan: false,
    rounds: 10,
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
      argument === '--max-working-set-mb' ||
      argument === '--rounds' ||
      argument === '--only'
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
      if (argument === '--only') {
        parsed.only = value;
        continue;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        throw new Error(`${argument} must be a positive number; received ${value}.`);
      }
      if (argument === '--duration-ms') parsed.durationMs = numeric;
      if (argument === '--interval-ms') parsed.intervalMs = numeric;
      if (argument === '--max-working-set-mb') parsed.maxWorkingSetMb = numeric;
      if (argument === '--rounds') parsed.rounds = numeric;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}
