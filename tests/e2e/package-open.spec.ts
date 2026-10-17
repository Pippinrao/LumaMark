import { expect, test } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

const zipPath = 'E:/notes/bundle.zip';
const extractedPath = 'E:/out/bundle/note.md';

type PackageE2EState = {
  lastWrite: null | { path: string; text: string };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ extractedPath, zipPath }) => {
      const state: PackageE2EState = { lastWrite: null };
      const target = window as unknown as {
        __LUMAMARK_E2E_FILE_COMMANDS__: unknown;
        __LUMAMARK_E2E_FILE_STATE__: PackageE2EState;
        __LUMAMARK_E2E_PACKAGE_COMMANDS__: unknown;
      };
      target.__LUMAMARK_E2E_FILE_STATE__ = state;
      target.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (path: string) => {
          const text = path.includes('bundle/note.md')
            ? '# Extracted note'
            : '# Packaged note';
          return {
            data: { byteLength: text.length, path, text },
            ok: true,
          };
        },
        showOpenDialog: async () => ({ data: zipPath, ok: true }),
        showOpenImageDialog: async () => ({ data: null, ok: true }),
        showSaveDialog: async () => ({ data: null, ok: true }),
        writeText: async (path: string, text: string) => {
          state.lastWrite = { path, text };
          return {
            data: { byteLength: text.length, path },
            ok: true,
          };
        },
      };
      target.__LUMAMARK_E2E_PACKAGE_COMMANDS__ = {
        extract: async () => ({
          data: {
            entryPath: extractedPath,
            outputDirectory: 'E:/out/bundle',
          },
          ok: true,
        }),
        open: async (path: string) => ({
          data: {
            entryName: 'note.md',
            entryPath: 'E:/cache/pkg/note.md',
            resourceCount: 1,
            reusedSession: false,
            sessionDir: 'E:/cache/pkg',
            zipPath: path,
          },
          ok: true,
        }),
        showExtractDialog: async () => ({ data: 'E:/out', ok: true }),
      };
    },
    { extractedPath, zipPath },
  );
});

test('opens a package read-only and unpacks it to a folder', async ({ page }) => {
  await page.goto('/');
  await openBlankDocument(page);

  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.getByRole('menuitem', { name: '打开文件' }).click();

  await expect(page.locator('.cm-content').first()).toContainText(
    'Packaged note',
  );
  await expect(page.getByTestId('status-package')).toHaveText(
    '压缩包 · 只读',
  );

  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status')).toHaveText('压缩包 · 只读');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __LUMAMARK_E2E_FILE_STATE__: PackageE2EState;
            }
          ).__LUMAMARK_E2E_FILE_STATE__.lastWrite,
      ),
    )
    .toBeNull();

  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.getByRole('menuitem', { name: '解包到文件夹…' }).click();

  await expect(page.locator('.cm-content').first()).toContainText(
    'Extracted note',
  );
  await expect(page.getByTestId('status-package')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('压缩包已解包');
});
