import { expect, test, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      capturedHtml: '',
      exportedPackage: null as unknown,
      printedPath: '',
    };
    const target = window as unknown as {
      __LUMAMARK_E2E_EXPORT__: unknown;
      __LUMAMARK_E2E_EXPORT_STATE__: typeof state;
    };
    target.__LUMAMARK_E2E_EXPORT_STATE__ = state;
    target.__LUMAMARK_E2E_EXPORT__ = {
      capabilities: async () => ({
        data: { maxAssetBytes: 10, maxHtmlBytes: 10, pdfMode: 'direct' },
        ok: true,
      }),
      embedImage: async () => ({
        error: {
          code: 'export.image_read_failed',
          message: 'stub',
          recoverable: true,
        },
        ok: false,
      }),
      exportPackage: async (input: unknown) => {
        state.exportedPackage = input;
        return {
          data: {
            entryName: 'untitled.md',
            outputPath: 'E:/notes/note.zip',
            resourceCount: 1,
            totalBytes: 20,
            warnings: [],
          },
          ok: true,
        };
      },
      printPdf: async (path: string) => {
        state.printedPath = path;
        return { data: { byteLength: 12, path }, ok: true };
      },
      showSaveDialog: async (input: { kind: string }) => ({
        data: `E:/notes/note.${input.kind === 'package' ? 'zip' : input.kind}`,
        ok: true,
      }),
      writeHtml: async (input: { html: string; path: string }) => {
        state.capturedHtml = input.html;
        return {
          data: { byteLength: input.html.length, path: input.path },
          ok: true,
        };
      },
    };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => ({
        ok: true,
        data: { byteLength: 20, path, text: '# Export note' },
      }),
      showOpenDialog: async () => ({ ok: true, data: null }),
      showOpenImageDialog: async () => ({ ok: true, data: null }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => ({
        ok: true,
        data: { byteLength: text.length, path },
      }),
    };
  });
});

async function openExportMenu(page: Page): Promise<void> {
  const fileMenu = page.getByRole('menuitem', { exact: true, name: '文件' });
  await fileMenu.focus();
  await fileMenu.press('ArrowDown');
  const exportTrigger = page.getByRole('menuitem', {
    exact: true,
    name: '导出',
  });
  await exportTrigger.hover();
  await expect(exportTrigger).toHaveAttribute('data-state', 'open');
}

test('exports HTML and PDF through the file menu', async ({ page }) => {  await page.goto('/');
  await openBlankDocument(page);
  await page.locator('.cm-content').first().fill('# Export note\n\nHello **world**.');
  await openExportMenu(page);
  await page.getByRole('menuitem', { name: /^导出为 HTML/ }).click();

  await expect(
    page.getByRole('dialog').getByText('HTML 导出完成。'),
  ).toBeVisible();
  const captured = await page.evaluate(() => {
    const target = window as unknown as {
      __LUMAMARK_E2E_EXPORT_STATE__: { capturedHtml: string };
    };
    return target.__LUMAMARK_E2E_EXPORT_STATE__.capturedHtml;
  });
  expect(captured).toContain('<h1>Export note</h1>');
  expect(captured).toContain('<strong>world</strong>');
  expect(captured).not.toContain('<script');
  await page.getByRole('button', { name: '关闭' }).click();

  await openExportMenu(page);
  await page.getByRole('menuitem', { name: /^导出为 PDF/ }).click();
  await expect(
    page.getByRole('dialog').getByText('PDF 导出完成。'),
  ).toBeVisible();
  const printed = await page.evaluate(() => {
    const target = window as unknown as {
      __LUMAMARK_E2E_EXPORT_STATE__: { printedPath: string };
    };
    return target.__LUMAMARK_E2E_EXPORT_STATE__.printedPath;
  });
  expect(printed).toBe('E:/notes/note.pdf');
});

test('exports a portable package through the file menu', async ({ page }) => {
  await page.goto('/');
  await openBlankDocument(page);
  await page
    .locator('.cm-content')
    .first()
    .fill('# Package note\n\n![a](E:/notes/a.png)');

  await openExportMenu(page);
  await page.getByRole('menuitem', { name: /^导出为压缩包/ }).click();

  await expect(
    page.getByRole('dialog').getByText(/压缩包已导出/),
  ).toBeVisible();

  const input = await page.evaluate(() => {
    const target = window as unknown as {
      __LUMAMARK_E2E_EXPORT_STATE__: {
        exportedPackage: {
          entryText: string;
          resources: { kind: string }[];
        };
      };
    };
    return target.__LUMAMARK_E2E_EXPORT_STATE__.exportedPackage;
  });

  expect(input.entryText).toContain('lumamark-assets/');
  expect(input.resources).toHaveLength(1);
  expect(input.resources[0]?.kind).toBe('local');
});
