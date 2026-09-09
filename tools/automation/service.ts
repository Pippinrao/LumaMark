import { extractDiagrams } from './markdown.ts';
import { DiagramRenderer } from './renderer.ts';
import { messages } from './messages.ts';
import { AutomationError, MAX_SOURCE_BYTES } from './types.ts';
import type { DiagramFormat, InputFormat, Report } from './types.ts';

export function validateSource(source: string) {
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new AutomationError('input.too_large', messages.tooLarge(MAX_SOURCE_BYTES));
  }
}

export class AutomationService {
  private renderer = new DiagramRenderer();

  async check(source: string, format: InputFormat): Promise<Report> {
    validateSource(source);
    const blocks = format === 'markdown' ? extractDiagrams(source) : [{ source, format, blockLine: 1, sourceLines: source.split('\n').map((_, index) => index + 1) }];
    const report: Report = { schemaVersion: 1, ok: true, checked: 0, diagnostics: [] };
    for (const block of blocks) {
      const result = await this.renderer.render(block);
      report.checked++;
      if (!result.ok) {
        report.ok = false;
        report.diagnostics.push({ code: result.code, message: result.message, format: block.format, blockLine: block.blockLine, line: block.sourceLines[(result.line ?? 1) - 1] ?? block.blockLine });
      }
    }
    return report;
  }

  async render(source: string, format: DiagramFormat): Promise<Report> {
    validateSource(source);
    const result = await this.renderer.render({ source, format });
    return result.ok
      ? { schemaVersion: 1, ok: true, checked: 1, diagnostics: [], svg: result.svg }
      : { schemaVersion: 1, ok: false, checked: 1, diagnostics: [{ code: result.code, message: result.message, format, line: result.line ?? 1, blockLine: 1 }] };
  }

  close() { return this.renderer.close(); }
}
