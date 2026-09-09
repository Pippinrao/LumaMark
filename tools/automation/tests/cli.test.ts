import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entry = fileURLToPath(new URL('../cli.ts', import.meta.url));
function run(args: string[], input = '', env: NodeJS.ProcessEnv = process.env): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { windowsHide: true, timeout: 90_000, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('help exposes CLI and MCP without starting a renderer', async () => {
  const result = await run(['--help']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /check/);
  assert.match(result.stdout, /mcp/);
});

test('mcp-config prints absolute runtime and entry paths without requiring PATH', async () => {
  const result = await run(['mcp-config']);
  assert.equal(result.code, 0, result.stderr);
  const config = JSON.parse(result.stdout).mcpServers.lumamark;
  assert.equal(config.command, process.execPath);
  assert.deepEqual(config.args, [entry, 'mcp']);
});

test('mcp-config preserves a custom Chromium install path across host working directories', async () => {
  const result = await run(['mcp-config'], '', { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '.ms-playwright' });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).mcpServers.lumamark.env, { PLAYWRIGHT_BROWSERS_PATH: resolve('.ms-playwright') });
  const hermetic = await run(['mcp-config'], '', { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' });
  assert.deepEqual(JSON.parse(hermetic.stdout).mcpServers.lumamark.env, { PLAYWRIGHT_BROWSERS_PATH: '0' });
});

test('check renders both diagram engines and ignores unrelated code fences', async () => {
  const result = await run(['check', '-', '--json'], [
    '# Notes', '', '```mermaid', 'flowchart TD', 'A --> B', '```', '',
    '```plantuml', '@startuml', 'Alice -> Bob: hello', '@enduml', '```', '',
    '```js', 'not a diagram', '```',
  ].join('\n'));
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.checked, 2);
  assert.equal(report.ok, true);
  assert.deepEqual(report.diagnostics, []);
});

test('check reports invalid Mermaid and PlantUML with Markdown block locations', async () => {
  const result = await run(['check', '-', '--json'], [
    '# Invalid', '', '```mermaid', 'flowchart TD', 'A --> [', '```', '',
    '```plantuml', '@startuml', 'this is not valid UML !@#', '@enduml', '```',
  ].join('\n'));
  assert.equal(result.code, 1, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.checked, 2);
  assert.equal(report.diagnostics.length, 2);
  assert.equal(report.diagnostics[0].blockLine, 3);
  assert.equal(report.diagnostics[1].blockLine, 8);
  assert.equal(report.diagnostics[0].line, 5);
  assert.equal(report.diagnostics[1].line, 10);
});

test('render writes SVG only to the requested output and never overwrites existing files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lumamark-cli-test-'));
  try {
    const input = join(directory, 'diagram.mmd');
    const output = join(directory, 'diagram.svg');
    await writeFile(input, 'flowchart TD\nA --> B');
    const result = await run(['diagram', 'render', input, '--output', output, '--json']);
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(await readFile(output, 'utf8'), /<svg[\s>]/);
    assert.equal(JSON.parse(result.stdout).ok, true);
    await writeFile(output, 'keep this');
    const duplicate = await run(['diagram', 'render', input, '--output', output, '--json']);
    assert.equal(duplicate.code, 2);
    assert.equal(await readFile(output, 'utf8'), 'keep this');
    assert.equal(await readFile(input, 'utf8'), 'flowchart TD\nA --> B');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unknown formats and unreadable inputs return structured operational errors', async () => {
  for (const args of [['check', '-', '--format', 'unknown', '--json'], ['check', 'does-not-exist.md', '--json']]) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).ok, false);
  }
});
