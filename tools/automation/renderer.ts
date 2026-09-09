import { chromium } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutomationError } from './types.ts';
import { messages } from './messages.ts';
import type { DiagramInput, RenderResult } from './types.ts';

const origin = 'http://lumamark.localhost';
const roots = {
  mermaid: dirname(fileURLToPath(import.meta.resolve('mermaid'))),
  plantuml: dirname(fileURLToPath(import.meta.resolve('@plantuml/core'))),
  dompurify: dirname(fileURLToPath(import.meta.resolve('dompurify'))),
};

/** A separate browser page per job isolates global engine state and directives. */
export class DiagramRenderer {
  private browser: Browser | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private timeoutMs: number;

  constructor(timeoutMs = 30_000) { this.timeoutMs = timeoutMs; }

  render(input: DiagramInput): Promise<RenderResult> {
    const result = this.queue.then(() => this.renderIsolated(input));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async renderIsolated(input: DiagramInput): Promise<RenderResult> {
    if (this.closed) throw new AutomationError('renderer.closed', messages.closed);
    if (!input.source.trim()) return { ok: false, code: 'diagram.empty', message: messages.empty };
    try {
      this.browser ??= await chromium.launch({ headless: true, timeout: 30_000 });
    } catch (error) {
      throw new AutomationError('renderer.unavailable', messages.unavailable(String(error)));
    }
    if (this.closed) {
      await this.browser.close();
      throw new AutomationError('renderer.closed', messages.closed);
    }
    const context = await this.browser.newContext({ serviceWorkers: 'block' });
    const blocked: string[] = [];
    const assetErrors: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          blocked.push(url.origin);
          await route.abort('blockedbyclient');
          return;
        }
        if (url.pathname === '/') {
          await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>' });
          return;
        }
        try {
          if (url.pathname === '/runtime.mjs') {
            await route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('./browser-runtime.mjs', import.meta.url)) });
            return;
          }
          const [, prefix, ...segments] = decodeURIComponent(url.pathname).split('/');
          const root = roots[prefix as keyof typeof roots];
          const path = root && resolve(root, ...segments);
          if (!path || !path.startsWith(root + sep) || !/\.(m?js|wasm|json)$/.test(path)) {
            throw new Error(messages.outside);
          }
          await route.fulfill({ contentType: path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', body: await readFile(path) });
        } catch (error) {
          assetErrors.push(`${url.pathname}: ${String(error)}`);
          await route.fulfill({ status: 404, body: messages.unavailableAsset });
        }
      });
      const page = await context.newPage();
      const job = async (): Promise<RenderResult> => {
        await page.goto(origin);
        return page.evaluate(async ({ input, moduleUrl, browserMessages }) => {
          const runtime = await import(moduleUrl);
          return runtime.renderDiagram(input, browserMessages);
        }, { input, moduleUrl: `${origin}/runtime.mjs`, browserMessages: messages.browser });
      };
      const result = await Promise.race([
        job(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AutomationError('renderer.timeout', messages.timeout(this.timeoutMs))), this.timeoutMs);
        }),
      ]);
      if (assetErrors.length) throw new AutomationError('renderer.assets_unavailable', assetErrors.join('\n'));
      if (blocked.length) return { ok: false, code: 'diagram.network_blocked', message: messages.networkBlocked };
      return result;
    } finally {
      clearTimeout(timer);
      await context.close();
    }
  }

  async close() {
    this.closed = true;
    await this.browser?.close();
    this.browser = undefined;
  }
}
