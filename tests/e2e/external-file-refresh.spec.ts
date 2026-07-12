import { expect, test } from '@playwright/test';

const documentPath = 'E:/lumamark-fixtures/external-refresh.md';
const localImagePath = 'E:/lumamark-fixtures/assets/pic.png';
const stableImagePath = 'E:/lumamark-fixtures/assets/stable.png';
const markdownSource = [
  '![Local watcher image](./assets/pic.png)',
  '',
  '![Stable local image](./assets/stable.png)',
].join('\n');

type ExternalRefreshState = {
  emit: (event: {
    fingerprint?: string | null;
    kind: 'document' | 'image' | 'removed';
    path: string;
    revision: number;
  }) => boolean;
  authorizationCounts: Record<string, number>;
  files: Record<string, string>;
  setImageAvailable: (available: boolean) => void;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_EXTERNAL_REFRESH__?: ExternalRefreshState;
  }
}

test('refreshes a changed local image without rewriting its Markdown source', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  await page.route('https://lumamark-assets.test/**', async (route) => {
    await route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#0af"/></svg>',
      contentType: 'image/svg+xml',
      status: 200,
    });
  });
  await page.addInitScript(
    ({ documentPath, localImagePath, markdownSource, stableImagePath }) => {
      const listeners = new Set<
        (event: {
            fingerprint?: string | null;
            kind: 'document' | 'image' | 'removed';
            path: string;
            revision: number;
          }) => void
      >();
      const files = { [documentPath]: markdownSource };
      const authorizationCounts: Record<string, number> = {};
      let imageAvailable = true;
      window.__LUMAMARK_E2E_EXTERNAL_REFRESH__ = {
        emit: (event) => {
          if (listeners.size === 0) {
            return false;
          }
          for (const listener of listeners) {
            listener(event);
          }
          return true;
        },
        authorizationCounts,
        files,
        setImageAvailable: (available) => {
          imageAvailable = available;
        },
      };
      (
        window as Window & {
          __TAURI_INTERNALS__?: {
            convertFileSrc: (path: string) => string;
          };
        }
      ).__TAURI_INTERNALS__ = {
        convertFileSrc: (path) =>
          `https://lumamark-assets.test/image.svg?file=${encodeURIComponent(path)}`,
      };
      window.__LUMAMARK_E2E_FILE_WATCH__ = {
        listen: async (nextListener) => {
          listeners.add(nextListener);
          return () => {
            listeners.delete(nextListener);
          };
        },
        replaceLocalImageTargets: async () => ({ ok: true, data: undefined }),
        unwatchDocument: async () => ({ ok: true, data: undefined }),
        watchDocument: async () => ({ ok: true, data: undefined }),
      };
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (path) => {
          const text = files[path];
          return text == null
            ? {
                ok: false,
                error: {
                  code: 'file.not_found',
                  message: 'File not found.',
                  recoverable: true,
                },
              }
            : {
                ok: true,
                data: {
                  byteLength: new TextEncoder().encode(text).length,
                  path,
                  text,
                },
              };
        },
        showOpenDialog: async () => ({ ok: true, data: documentPath }),
        showSaveDialog: async () => ({ ok: true, data: documentPath }),
        writeText: async (path, text) => {
          files[path] = text;
          return {
            ok: true,
            data: {
              byteLength: new TextEncoder().encode(text).length,
              path,
            },
          };
        },
      };
      window.__LUMAMARK_E2E_ASSET_COMMANDS__ = {
        authorizeLocalImage: async ({ source }) => {
          authorizationCounts[source] = (authorizationCounts[source] ?? 0) + 1;
          if (!imageAvailable && !source.includes('stable')) {
            return {
              ok: false,
              error: {
                code: 'file.not_found',
                message: 'Image file not found.',
                recoverable: true,
              },
            };
          }
          return {
            ok: true,
            data: source.includes('stable') ? stableImagePath : localImagePath,
          };
        },
      };
    },
    { documentPath, localImagePath, markdownSource, stableImagePath },
  );

  await page.goto('/');
  await page.getByRole('menuitem', { name: /File|文件/ }).click();
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();
  const image = page.getByRole('img', { name: 'Local watcher image' });
  const stableImage = page.getByRole('img', { name: 'Stable local image' });
  await expect(image).toBeVisible();
  await expect(stableImage).toBeVisible();
  await expect(image).not.toHaveAttribute('src', /[?&]lmv=/);

  const delivered = await page.evaluate(
    ({ localImagePath }) => {
      return window.__LUMAMARK_E2E_EXTERNAL_REFRESH__?.emit({
        fingerprint: 'image-fingerprint-5',
        kind: 'image',
        path: localImagePath,
        revision: 5,
      });
    },
    { localImagePath },
  );
  expect(delivered).toBe(true);

  await expect(image).toHaveAttribute('src', /[?&]lmv=5(?:&|$)/);
  await expect(stableImage).not.toHaveAttribute('src', /[?&]lmv=/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__LUMAMARK_E2E_EXTERNAL_REFRESH__?.authorizationCounts,
      ),
    )
    .toEqual({
      './assets/pic.png': 2,
      './assets/stable.png': 1,
    });

  const removedDelivered = await page.evaluate(({ localImagePath }) => {
    const state = window.__LUMAMARK_E2E_EXTERNAL_REFRESH__;
    state?.setImageAvailable(false);
    return state?.emit({
      fingerprint: null,
      kind: 'removed',
      path: localImagePath,
      revision: 6,
    });
  }, { localImagePath });
  expect(removedDelivered).toBe(true);
  await expect(page.getByText(/Image failed to load|图片加载失败/)).toBeVisible();
  await expect(stableImage).toBeVisible();

  const recreatedDelivered = await page.evaluate(({ localImagePath }) => {
    const state = window.__LUMAMARK_E2E_EXTERNAL_REFRESH__;
    state?.setImageAvailable(true);
    return state?.emit({
      fingerprint: 'image-fingerprint-7',
      kind: 'image',
      path: localImagePath,
      revision: 7,
    });
  }, { localImagePath });
  expect(recreatedDelivered).toBe(true);
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /[?&]lmv=7(?:&|$)/);
  await page.getByRole('menuitem', { name: /View|视图/ }).click();
  await page.getByRole('menuitem', { name: /Source Mode|源码模式/ }).click();
  await expect(page.locator('.cm-line')).toHaveText(markdownSource.split('\n'));
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
