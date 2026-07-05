import { expect, test } from '@playwright/test';

const fixturePath = 'E:/lumamark-fixtures/long-open.md';
type OpenFileTestWindow = Window & {
  __LUMAMARK_E2E_RELEASE_OPEN__?: () => void;
};

test('opens long markdown with feedback and keeps the viewport at the document start', async ({
  page,
}) => {
  const longMarkdown = [
    '# File Start',
    '',
    'The first paragraph should stay visible after opening.',
    '',
    ...Array.from({ length: 120 }, (_, index) =>
      [`## Section ${index + 1}`, '', `Body ${index + 1}`].join('\n'),
    ),
    '# File End',
  ].join('\n\n');

  await page.addInitScript(
    ({ path, text }) => {
      let resolveRead: (() => void) | null = null;
      const readGate = new Promise<void>((resolve) => {
        resolveRead = resolve;
      });

      window.__LUMAMARK_E2E_STATE__ = {
        files: {
          [path]: text,
        },
        lastWrite: null,
      };
      (window as OpenFileTestWindow).__LUMAMARK_E2E_RELEASE_OPEN__ = () => {
        resolveRead?.();
      };
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (filePath: string) => {
          await readGate;

          const source =
            window.__LUMAMARK_E2E_STATE__?.files[filePath] ?? '';

          return {
            ok: true,
            data: {
              byteLength: new TextEncoder().encode(source).length,
              path: filePath,
              text: source,
            },
          };
        },
        showOpenDialog: async () => ({
          ok: true,
          data: path,
        }),
        showSaveDialog: async () => ({
          ok: true,
          data: null,
        }),
        writeText: async (filePath: string, source: string) => ({
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(source).length,
            path: filePath,
          },
        }),
      };
    },
    {
      path: fixturePath,
      text: longMarkdown,
    },
  );

  await page.goto('/');
  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.getByRole('menuitem', { name: '打开文件' }).click();

  await expect(page.getByRole('status')).toHaveText('正在打开');

  await page.evaluate(() => {
    (window as OpenFileTestWindow).__LUMAMARK_E2E_RELEASE_OPEN__?.();
  });

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('File Start');
  await expect(page.getByRole('status')).toHaveText('已打开');
  await expect
    .poll(() => page.locator('.cm-scroller').evaluate((node) => node.scrollTop))
    .toBe(0);

  const visibleText = await page.locator('.cm-scroller').innerText();
  expect(visibleText).toContain('File Start');
  expect(visibleText).not.toContain('File End');
});
