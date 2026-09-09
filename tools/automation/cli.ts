#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { messages } from './messages.ts';
import { AutomationError, errorReport, MAX_SOURCE_BYTES } from './types.ts';
import type { InputFormat, Report } from './types.ts';

async function readSource(path: string) {
  const stream = path === '-' ? process.stdin : createReadStream(resolve(path));
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_SOURCE_BYTES) throw new AutomationError('input.too_large', messages.tooLarge(MAX_SOURCE_BYTES));
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function inputFormat(explicit: string | undefined, path: string, render: boolean): InputFormat {
  const extensions: Record<string, InputFormat> = { '.md': 'markdown', '.markdown': 'markdown', '.mmd': 'mermaid', '.mermaid': 'mermaid', '.puml': 'plantuml', '.plantuml': 'plantuml' };
  const format = explicit ?? (path === '-' && !render ? 'markdown' : extensions[extname(path).toLowerCase()]);
  if (format !== 'markdown' && format !== 'mermaid' && format !== 'plantuml') {
    throw new AutomationError('input.format', messages.format);
  }
  if (render && format === 'markdown') throw new AutomationError('input.format', messages.renderFormat);
  return format;
}

function printReport(report: Report, json: boolean) {
  if (json) process.stdout.write(`${JSON.stringify(report)}\n`);
  else if (report.svg) process.stdout.write(`${report.svg}\n`);
  else if (report.ok) process.stdout.write(`${messages.checked(report.checked, report.output)}\n`);
  else process.stderr.write(report.diagnostics.map((item) => `${item.code}${item.line ? `:${item.line}` : ''}: ${item.message}`).join('\n') + '\n');
}

let json = process.argv.includes('--json');
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, json: { type: 'boolean' },
    format: { type: 'string' }, output: { type: 'string', short: 'o' },
  } });
  json = values.json ?? false;
  if (values.help || !positionals.length) process.stdout.write(messages.help);
  else if (positionals[0] === 'mcp-config') {
    if (positionals.length !== 1 || values.output || values.format || json) throw new AutomationError('input.arguments', messages.mcpArguments);
    const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const env = browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath === '0' ? '0' : resolve(browserPath) } : undefined;
    process.stdout.write(JSON.stringify({ mcpServers: { lumamark: { command: process.execPath, args: [fileURLToPath(import.meta.url), 'mcp'], env } } }, null, 2) + '\n');
  }
  else if (positionals[0] === 'mcp') {
    if (positionals.length !== 1 || values.output || values.format || json) throw new AutomationError('input.arguments', messages.mcpArguments);
    const { startMcp } = await import('./mcp.ts');
    await startMcp();
  } else {
    const render = positionals[0] === 'diagram' && positionals[1] === 'render';
    const path = positionals[render ? 2 : 1];
    if ((!render && positionals[0] !== 'check') || !path || positionals.length !== (render ? 3 : 2) || (!render && values.output)) {
      throw new AutomationError('input.arguments', messages.arguments);
    }
    const format = inputFormat(values.format, path, render);
    const source = await readSource(path);
    const { AutomationService } = await import('./service.ts');
    const service = new AutomationService();
    try {
      const report = render && format !== 'markdown' ? await service.render(source, format) : await service.check(source, format);
      if (report.ok && report.svg && values.output) {
        const output = resolve(values.output);
        await writeFile(output, report.svg, { flag: 'wx' });
        delete report.svg;
        report.output = output;
      }
      printReport(report, json);
      process.exitCode = report.ok ? 0 : 1;
    } finally {
      await service.close();
    }
  }
} catch (error) {
  printReport(errorReport(error), json);
  process.exitCode = 2;
}
