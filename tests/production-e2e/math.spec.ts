import { expect, test, type Page } from '@playwright/test';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from '../e2e/support/rootEditorViewTestBridge';
import {
  confirmDiscardIfAsked,
  installProductionDocumentMock,
  readProductionDocumentWrites,
} from './support/productionDocumentInvoke';

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
  await expect(page.locator('html')).toHaveAttribute(
    'data-lm-math-fonts-preloaded',
    'ready',
    { timeout: 30_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.workers().map((worker) => worker.url()))
    .toEqual(expect.arrayContaining([expect.stringMatching(/mathDocumentWorker/u)]));

  const assetEvidence = await page.evaluate(() => {
    const stylesheet =
      document.querySelector('[data-lm-math-style]')?.textContent ?? '';
    const fontUrls = [
      ...stylesheet.matchAll(/url\(["']?([^"')]+)["']?\)/gu),
    ].map((match) => new URL(match[1] as string, location.href).href);
    return { appOrigin: location.origin, fontUrls, stylesheet };
  });
  const requestedFonts = requests.filter((url) => url.includes('.woff2'));

  expect(assetEvidence.fontUrls.length).toBeGreaterThan(0);
  expect(
    assetEvidence.fontUrls.every(
      (url) =>
        url.startsWith('blob:') ||
        new URL(url).origin === assetEvidence.appOrigin,
    ),
  ).toBe(true);
  expect(requestedFonts.length).toBeGreaterThan(0);
  expect(
    requestedFonts.every((url) => new URL(url).origin === assetEvidence.appOrigin),
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

  await installProductionDocumentMock(page, {
    files: {
      [canonicalPath]: source,
      [requestedPath]: source,
    },
    openDialogPath: requestedPath,
    resolvedPath: canonicalPath,
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
  await page.keyboard.press(`${primaryModifier}+O`);
  await confirmDiscardIfAsked(page);

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
  await expect.poll(() => readProductionDocumentWrites(page)).toEqual([
    { path: canonicalPath, text: savedSource },
  ]);
  expect(await readSource(editor)).toBe(savedSource);
});

async function readSource(editor: ReturnType<Page['locator']>) {
  return editor.evaluate((content) =>
    (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest()
      .state.doc.toString(),
  );
}
