/**
 * Packaged LumaMark automation acceptance.
 *
 * Proves that the installed/packaged executable serves the Mermaid/PlantUML
 * CLI and MCP surface with no Node, pnpm or bundled Chromium, that exit codes
 * and the schemaVersion=1 report match the documented contract, that `--help`
 * is the complete usage reference, and that rendering never shows a window.
 *
 * The window assertion uses the Win32 definition of a main window: the first
 * visible, unowned top-level window. A hidden renderer therefore reports none.
 *
 * Build with `pnpm build` (or `tauri build --no-bundle`) first. A plain
 * `cargo build --release` binary is a development build that serves the Vite
 * dev URL, has no embedded assets, and cannot pass this gate.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = new URL('../..', import.meta.url);
const repositoryRoot = fileURLToPath(root);
const executablePath =
  process.env.LUMAMARK_EXECUTABLE?.trim() ||
  fileURLToPath(new URL('src-tauri/target/release/lumamark.exe', root));
const mermaidFixture = join(
  repositoryRoot,
  'tests/fixtures/markdown/mermaid-gallery.md',
);

/** Title of the hidden renderer window created by automation mode. */
const RENDERER_WINDOW_TITLE = 'LumaMark automation';

const HELP_TOKENS = [
  'check <file|->',
  'diagram render <file|->',
  'mcp-config',
  '--format',
  '--output',
  '--json',
  '--help',
  '--version',
  'check_diagrams',
  'render_diagram',
  'mcpServers',
  'schemaVersion',
  'LUMAMARK_TOOLS_LANGUAGE',
  'zh-CN',
  'input.too_large',
  'input.too_many_diagrams',
  'input.format',
  'input.arguments',
  'diagram.empty',
  'diagram.invalid',
  'renderer.timeout',
  'renderer.unavailable',
  'automation.failed',
  '2 MiB',
  '100',
  '30 seconds',
  'Exit code 0 = success, 1 = diagram errors, 2 =',
];

if (process.platform !== 'win32') {
  process.stderr.write(
    '[release:packaged-automation] Windows WebView2 only; skipping.\n',
  );
  process.exit(0);
}

const evidence = {};
let tempDirectory;
let mcpClient;
let mcpTransport;

try {
  await stat(executablePath).catch(() => {
    throw new Error(
      `Missing ${executablePath}. Build the packaged app first (pnpm build).`,
    );
  });
  step('help and version contracts');
  tempDirectory = await mkdtemp(join(tmpdir(), 'lumamark-automation-'));
  const validMermaid = join(tempDirectory, 'valid.mmd');
  const invalidMermaid = join(tempDirectory, 'invalid.mmd');
  const validPlantuml = join(tempDirectory, 'valid.puml');
  const invalidPlantuml = join(tempDirectory, 'invalid.puml');
  const unknownExtension = join(tempDirectory, 'unknown.diagram');
  const oversized = join(tempDirectory, 'oversized.md');
  const output = join(tempDirectory, 'chart.svg');

  await writeFile(validMermaid, 'graph TD\n  A[Start] --> B[End]\n', 'utf8');
  await writeFile(
    invalidMermaid,
    'flowchart TD\n  A --> B\n  subgraph\n',
    'utf8',
  );
  await writeFile(validPlantuml, '@startuml\nAlice -> Bob: hello\n@enduml\n', 'utf8');
  // A missing @enduml makes the official engine fail instead of rendering.
  await writeFile(invalidPlantuml, '@startuml\nAlice -> Bob\n', 'utf8');
  await writeFile(unknownExtension, 'graph TD\n', 'utf8');
  await writeFile(oversized, 'x'.repeat(2 * 1024 * 1024 + 32), 'utf8');

  // 1. `--help` is the complete usage reference.
  step('--help contract');
  const help = await run(['--help']);
  assertExit(help, 0, '--help exit code');
  const missingHelpTokens = HELP_TOKENS.filter((token) => !help.stdout.includes(token));
  assertEqual(missingHelpTokens, [], '--help must document every contract token');
  evidence.helpTokens = HELP_TOKENS.length;

  // 2. `--version` matches the packaged version.
  step('--version contract');
  const version = await run(['--version']);
  assertExit(version, 0, '--version exit code');
  const cargoManifest = await readFile(
    join(repositoryRoot, 'src-tauri/Cargo.toml'),
    'utf8',
  );
  const cargoVersion = /^version = "(.+)"$/mu.exec(cargoManifest)?.[1];
  assertEqual(version.stdout.trim(), cargoVersion, '--version output');
  evidence.version = version.stdout.trim();

  // 3. `mcp-config` describes this executable without any environment.
  step('mcp-config contract');
  const mcpConfig = await run(['mcp-config']);
  assertExit(mcpConfig, 0, 'mcp-config exit code');
  const configuration = JSON.parse(mcpConfig.stdout);
  const server = configuration.mcpServers?.lumamark;
  assertEqual(server?.args, ['mcp'], 'mcp-config args');
  assertEqual(server?.env, undefined, 'mcp-config must not require environment');
  assertEqual(
    server?.command?.toLowerCase(),
    executablePath.toLowerCase(),
    'mcp-config command',
  );
  evidence.mcpConfig = server.command;

  step('markdown fence check');
  const gallery = await run(['check', mermaidFixture, '--json']);
  if (gallery.code === 2 && gallery.stdout.includes('renderer.unavailable')) {
    throw new Error(
      [
        'the renderer page never loaded; this usually means the executable is a development build',
        "run `pnpm build` (or `tauri build --no-bundle`) so the frontend assets are embedded",
        `stdout: ${gallery.stdout.slice(0, 300)}`,
      ].join('\n'),
    );
  }
  assertExit(gallery, 0, 'gallery check exit code');
  const galleryReport = JSON.parse(gallery.stdout);
  assertEqual(galleryReport.schemaVersion, 1, 'gallery schemaVersion');
  assertEqual(galleryReport.ok, true, 'gallery ok');
  assertEqual(galleryReport.diagnostics, [], 'gallery diagnostics');
  if (!(galleryReport.checked >= 10)) {
    throw new Error(`expected at least 10 checked diagrams, got ${galleryReport.checked}`);
  }
  evidence.checkedDiagrams = galleryReport.checked;

  step('single diagram check');
  const singleCheck = await run(['check', validMermaid, '--json']);
  assertExit(singleCheck, 0, 'single check exit code');
  const singleReport = JSON.parse(singleCheck.stdout);
  assertEqual(singleReport.svg, undefined, 'check must not return svg');
  assertEqual(singleReport.checked, 1, 'single check count');

  step('diagram render');
  const rendered = await run(['diagram', 'render', validMermaid, '--json']);
  assertExit(rendered, 0, 'render exit code');
  const renderedReport = JSON.parse(rendered.stdout);
  if (!String(renderedReport.svg ?? '').includes('<svg')) {
    throw new Error('render did not return SVG');
  }
  if (!String(renderedReport.svg).includes('Start')) {
    throw new Error('render output lost the diagram text');
  }
  if (String(renderedReport.svg).includes('<script')) {
    throw new Error('render output was not sanitized');
  }

  const written = await run(['diagram', 'render', validMermaid, '--output', output, '--json']);
  assertExit(written, 0, 'render --output exit code');
  const writtenReport = JSON.parse(written.stdout);
  assertEqual(writtenReport.svg, undefined, '--output must not also print svg');
  assertEqual(writtenReport.output, output, 'reported output path');
  const svgFile = await readFile(output, 'utf8');
  if (!svgFile.includes('<svg')) {
    throw new Error('written SVG is invalid');
  }

  const overwrite = await run(['diagram', 'render', validMermaid, '--output', output, '--json']);
  assertExit(overwrite, 2, 'existing output must fail with the usage code');
  assertEqual(
    JSON.parse(overwrite.stdout).diagnostics[0].code,
    'automation.failed',
    'existing output diagnostic',
  );

  step('invalid diagrams');
  const invalid = await run(['check', invalidMermaid, '--json']);
  assertExit(invalid, 1, 'invalid diagram exit code');
  const invalidReport = JSON.parse(invalid.stdout);
  assertEqual(invalidReport.ok, false, 'invalid diagram ok');
  const invalidDiagnostic = invalidReport.diagnostics[0];
  assertEqual(invalidDiagnostic.code, 'diagram.invalid', 'invalid diagram code');
  assertEqual(invalidDiagnostic.format, 'mermaid', 'invalid diagram format');
  if (!(invalidDiagnostic.line >= 1)) {
    throw new Error('invalid diagram diagnostic must carry a document line');
  }

  const invalidPuml = await run(['check', invalidPlantuml, '--json']);
  assertExit(invalidPuml, 1, 'invalid PlantUML exit code');
  assertEqual(
    JSON.parse(invalidPuml.stdout).diagnostics[0].code,
    'diagram.invalid',
    'invalid PlantUML code',
  );

  const validPuml = await run(['check', validPlantuml, '--json']);
  assertExit(validPuml, 0, 'valid PlantUML exit code');

  step('stdin, formats and limits');
  const piped = await run(['check', '-', '--format', 'mermaid', '--json'], 'graph TD\n');
  assertExit(piped, 0, 'stdin check exit code');
  assertEqual(JSON.parse(piped.stdout).checked, 1, 'stdin check count');

  const unknown = await run(['check', unknownExtension, '--json']);
  assertExit(unknown, 2, 'unknown extension exit code');
  assertEqual(
    JSON.parse(unknown.stdout).diagnostics[0].code,
    'input.format',
    'unknown extension diagnostic',
  );

  const tooLarge = await run(['check', oversized, '--json']);
  assertExit(tooLarge, 2, 'oversized input exit code');
  assertEqual(
    JSON.parse(tooLarge.stdout).diagnostics[0].code,
    'input.too_large',
    'oversized input diagnostic',
  );

  step('MCP session');
  mcpTransport = new StdioClientTransport({
    command: executablePath,
    args: ['mcp'],
    stderr: 'pipe',
  });
  mcpClient = new Client(
    { name: 'lumamark-automation-acceptance', version: '1.0.0' },
    { capabilities: {} },
  );
  const windowProbe = observeVisibleWindow();
  await mcpClient.connect(mcpTransport);

  const tools = await mcpClient.listTools();
  assertEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ['check_diagrams', 'render_diagram'],
    'MCP tool discovery',
  );
  const checkTool = tools.tools.find((tool) => tool.name === 'check_diagrams');
  if (!checkTool.description?.includes('Markdown')) {
    throw new Error('check_diagrams description is missing');
  }

  const mcpCheck = await mcpClient.callTool({
    name: 'check_diagrams',
    arguments: { source: 'graph TD\n  A[MCPSource] --> B\n', format: 'mermaid' },
  });
  assertEqual(mcpCheck.isError ?? false, false, 'MCP valid check isError');
  assertEqual(
    mcpCheck.structuredContent?.schemaVersion,
    1,
    'MCP report schemaVersion',
  );
  assertEqual(
    mcpCheck.structuredContent?.svg,
    undefined,
    'MCP check must not return svg',
  );

  const mcpRender = await mcpClient.callTool({
    name: 'render_diagram',
    arguments: { source: 'graph TD\n  A[MCPSource] --> B\n', format: 'mermaid' },
  });
  assertEqual(mcpRender.isError ?? false, false, 'MCP render isError');
  if (!String(mcpRender.structuredContent?.svg ?? '').includes('MCPSource')) {
    throw new Error('MCP render did not return the rendered diagram');
  }

  const mcpInvalid = await mcpClient.callTool({
    name: 'check_diagrams',
    arguments: { source: 'flowchart TD\n  A --> B\n  subgraph\n', format: 'mermaid' },
  });
  assertEqual(mcpInvalid.isError, true, 'MCP invalid check isError');
  assertEqual(
    mcpInvalid.structuredContent?.diagnostics?.[0]?.code,
    'diagram.invalid',
    'MCP invalid diagnostic',
  );

  await mcpClient.close();
  mcpClient = undefined;
  const windowObservations = await windowProbe;

  const rendererWindows = windowObservations.filter(
    (observation) => observation.title === RENDERER_WINDOW_TITLE,
  );
  if (rendererWindows.length === 0) {
    throw new Error(
      `the hidden renderer window was never created: ${JSON.stringify(windowObservations)}`,
    );
  }
  const visibleRenderer = rendererWindows.filter((observation) => observation.visible);
  assertEqual(visibleRenderer, [], 'the renderer window must stay hidden');

  const visibleTitled = windowObservations.filter(
    (observation) => observation.visible && observation.title !== '',
  );
  assertEqual(visibleTitled, [], 'no visible titled window may exist');

  evidence.mcpTools = tools.tools.map((tool) => tool.name);
  evidence.windowObservations = windowObservations.length;
  evidence.rendererWindow = {
    present: rendererWindows.length > 0,
    visible: visibleRenderer.length > 0,
    className: rendererWindows[0]?.className,
  };

  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    [
      '[release:packaged-automation] FAILED',
      error instanceof Error ? error.stack ?? error.message : String(error),
      `executable: ${executablePath}`,
    ].join('\n'),
  );
  process.stderr.write('\n');
  process.exitCode = 1;
} finally {
  if (mcpClient) {
    await mcpClient.close().catch(() => undefined);
  }
  if (tempDirectory) {
    await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function assertEqual(actual, expected, label) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`${label}: expected ${expectedText}, received ${actualText}`);
  }
}

function step(name) {
  process.stderr.write(`[release:packaged-automation] ${name}\n`);
}

/** Exit-code assertion that keeps the child's streams for diagnosis. */
function assertExit(result, expected, label) {
  if (result.code !== expected) {
    throw new Error(
      [
        `${label}: expected ${expected}, received ${result.code}`,
        `stdout: ${result.stdout.slice(0, 600)}`,
        `stderr: ${result.stderr.slice(0, 600)}`,
      ].join('\n'),
    );
  }
}

function run(args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, {
      cwd: tempDirectory ?? repositoryRoot,
      windowsHide: true,
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && code !== 1 && code !== 2) {
        reject(
          new Error(
            `LumaMark ${args.join(' ')} exited with ${code}\nstderr: ${stderr}`,
          ),
        );
        return;
      }
      resolve({ code, stdout, stderr });
    });
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    }
  });
}

/**
 * Samples the process' top-level windows while the MCP session is alive.
 *
 * The renderer must exist and stay invisible, and nothing else may appear as a
 * visible titled window. tao publishes an internal event-target window, so the
 * probe enumerates windows instead of trusting `Get-Process.MainWindowHandle`.
 */
async function observeVisibleWindow() {
  const samples = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await delay(150);
    samples.push(...(await probeWindows()));
  }
  return samples;
}

function probeWindows() {
  const processId = mcpProcessId();
  if (processId === undefined) {
    return Promise.resolve([]);
  }

  return new Promise((resolve, reject) => {
    const script = fileURLToPath(
      new URL('automationWindowProbe.ps1', import.meta.url),
    );
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-TargetProcessId',
        String(processId),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim() || '[]');
        resolve(Array.isArray(parsed) ? parsed : [parsed]);
      } catch {
        // A sample that could not be read is not evidence of a visible window.
        resolve([]);
      }
    });
  });
}

/** The MCP client transport owns the packaged process. */
function mcpProcessId() {
  return mcpTransport?.pid ?? undefined;
}
