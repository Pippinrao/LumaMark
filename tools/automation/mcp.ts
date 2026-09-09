import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { AutomationService } from './service.ts';
import { messages } from './messages.ts';
import { errorReport, MAX_SOURCE_BYTES } from './types.ts';
import type { Report } from './types.ts';

export async function startMcp() {
  const service = new AutomationService();
  const metadata = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  const server = new McpServer({ name: 'lumamark', version: metadata.version });
  const result = async (action: () => Promise<Report>) => {
    let report: Report;
    try { report = await action(); } catch (error) { report = errorReport(error); }
    return { isError: !report.ok, structuredContent: { ...report }, content: [{ type: 'text' as const, text: JSON.stringify(report) }] };
  };
  const source = z.string().max(MAX_SOURCE_BYTES).describe(messages.sourceDescription);
  server.registerTool('check_diagrams', {
    description: messages.checkDescription,
    inputSchema: { source, format: z.enum(['markdown', 'mermaid', 'plantuml']).default('markdown') },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ source, format }) => result(() => service.check(source, format)));
  server.registerTool('render_diagram', {
    description: messages.renderDescription,
    inputSchema: { source, format: z.enum(['mermaid', 'plantuml']) },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ source, format }) => result(() => service.render(source, format)));
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    await service.close();
    await server.close();
  })();
  const onClose = () => { void close().catch((error) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 2; }); };
  process.stdin.once('end', onClose);
  process.once('SIGINT', onClose);
  process.once('SIGTERM', onClose);
  server.server.onclose = onClose;
  await server.connect(new StdioServerTransport());
}
