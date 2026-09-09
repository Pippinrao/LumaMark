import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP stdio discovers tools and returns the same structured report for source checks', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../cli.ts', import.meta.url)), 'mcp'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'lumamark-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), ['check_diagrams', 'render_diagram']);
    const result = await client.callTool({ name: 'check_diagrams', arguments: { source: 'flowchart TD\nA --> B', format: 'mermaid' } });
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, { schemaVersion: 1, ok: true, checked: 1, diagnostics: [] });
    const invalid = await client.callTool({ name: 'check_diagrams', arguments: { source: 'flowchart TD\nA --> [', format: 'mermaid' } });
    assert.equal(invalid.isError, true);
    assert.ok(invalid.structuredContent && typeof invalid.structuredContent === 'object' && 'ok' in invalid.structuredContent);
    assert.equal(invalid.structuredContent.ok, false);
    const svg = await client.callTool({ name: 'render_diagram', arguments: { source: '@startuml\nAlice -> Bob: hello\n@enduml', format: 'plantuml' } });
    assert.equal(svg.isError, false);
    assert.ok(svg.structuredContent && typeof svg.structuredContent === 'object' && 'svg' in svg.structuredContent);
    assert.match(String(svg.structuredContent.svg), /<svg[\s>]/);
    const badArguments = await client.callTool({ name: 'render_diagram', arguments: { source: 'test', format: 'markdown' } });
    assert.equal(badArguments.isError, true);
  } finally {
    await client.close();
    await transport.close();
  }
});
