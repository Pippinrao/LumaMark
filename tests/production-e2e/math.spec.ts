import { expect, test, type Page } from '@playwright/test';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from '../e2e/support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test('loads MathJax through a production module Worker with CHTML and packaged WOFF2 assets', async ({
  page,
}) => {
  const requests: string[] = [];
  const failedRequests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));

  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
  const editor = page.locator('.cm-content').first();
  const source = String.raw`rare $\text{é}$ and chemistry $\ce{H2O}$`;
  await editor.click();
  await page.keyboard.insertText(source);

  await expect(page.getByRole('math', { name: String.raw`\text{é}` })).toBeVisible();
  await expect(page.getByRole('math', { name: String.raw`\ce{H2O}` })).toBeVisible();
  await expect(page.locator('mjx-container')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.workers().map((worker) => worker.url()))
    .toEqual(expect.arrayContaining([expect.stringMatching(/mathDocumentWorker/u)]));

  const assetEvidence = await page.waitForFunction(() => {
    const stylesheet =
      document.querySelector('[data-lm-math-style]')?.textContent ?? '';
    const fontUrls = [
      ...stylesheet.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/gu),
    ].map((match) => new URL(match[1] as string, location.href).href);
    const requestedFonts = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => url.includes('.woff2'));
    return fontUrls.length > 0 && requestedFonts.length > 0
      ? { appOrigin: location.origin, fontUrls, requestedFonts }
      : null;
  }).then((handle) => handle.jsonValue());

  expect(assetEvidence).not.toBeNull();
  expect(
    [...assetEvidence!.fontUrls, ...assetEvidence!.requestedFonts].every(
      (url) => new URL(url).origin === assetEvidence!.appOrigin,
    ),
  ).toBe(true);
  expect(
    requests.some((url) => /mathDocumentWorker/u.test(url)),
  ).toBe(true);
  expect(failedRequests).toEqual([]);

  await installRootEditorViewTestBridge(editor);
  expect(await readSource(editor)).toBe(source);
});

test('keeps the canonical production document identity when saving rendered math', async ({
  page,
}) => {
  const requestedPath = 'E:/LumaMark-Fixtures/Math/Identity.md';
  const canonicalPath = 'e:/lumamark-fixtures/math/identity.md';
  const source = String.raw`identity $x^2$`;
  const savedSource = `${source}\n`;

  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
  await installProductionFileMock(page, {
    canonicalPath,
    requestedPath,
    source,
  });
  await page.keyboard.press(`${primaryModifier}+O`);

  const editor = page.locator('.cm-content').first();
  await expect(page.locator('.lm-editor-title')).toHaveText('identity.md');
  await expect(page.getByRole('math', { name: 'x^2' })).toBeVisible();
  await installRootEditorViewTestBridge(editor);
  await editor.evaluate((content) => {
    const view = (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest();
    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n' },
      selection: { anchor: view.state.doc.length + 1 },
    });
  });
  await expect(page.locator('.lm-editor-title')).toContainText('*');

  await page.keyboard.press(`${primaryModifier}+S`);
  await expect.poll(() => readProductionWrites(page)).toEqual([
    { path: canonicalPath, text: savedSource },
  ]);
  expect(await readSource(editor)).toBe(savedSource);
});

async function installProductionFileMock(
  page: Page,
  fixture: {
    canonicalPath: string;
    requestedPath: string;
    source: string;
  },
): Promise<void> {
  await page.evaluate(({ canonicalPath, requestedPath, source }) => {
    const writes: Array<{ path: string; text: string }> = [];
    const existing = (
      window as Window & { __TAURI_INTERNALS__?: Record<string, unknown> }
    ).__TAURI_INTERNALS__ ?? {};
    (
      window as Window & {
        __LUMAMARK_MATH_PRODUCTION_WRITES__?: typeof writes;
        __TAURI_INTERNALS__?: Record<string, unknown> & {
          invoke?: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__LUMAMARK_MATH_PRODUCTION_WRITES__ = writes;
    (
      window as Window & {
        __TAURI_INTERNALS__?: Record<string, unknown> & {
          invoke?: (
            command: string,
            args?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__ = {
      ...existing,
      invoke: async (command, args = {}) => {
        if (command === 'files_show_open_file_dialog') {
          return requestedPath;
        }
        if (command === 'files_read_text') {
          return {
            byteLength: new TextEncoder().encode(source).length,
            path: canonicalPath,
            text: source,
          };
        }
        if (command === 'files_write_text') {
          if (typeof args.path !== 'string' || typeof args.text !== 'string') {
            throw new Error('Invalid production write arguments.');
          }
          writes.push({ path: args.path, text: args.text });
          return {
            byteLength: new TextEncoder().encode(args.text).length,
            path: args.path,
          };
        }
        throw new Error(`Unexpected production command: ${command}`);
      },
    };
  }, fixture);
}

function readProductionWrites(page: Page) {
  return page.evaluate(() =>
    (
      window as Window & {
        __LUMAMARK_MATH_PRODUCTION_WRITES__?: Array<{
          path: string;
          text: string;
        }>;
      }
    ).__LUMAMARK_MATH_PRODUCTION_WRITES__ ?? [],
  );
}

function readSource(editor: ReturnType<Page['locator']>) {
  return editor.evaluate((content) =>
    (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest()
      .state.doc.toString(),
  );
}
