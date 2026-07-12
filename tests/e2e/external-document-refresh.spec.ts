import { expect, test, type Page } from '@playwright/test';

const documentPath = 'E:/lumamark-fixtures/external-document.md';

type FileWatchEvent = {
  fingerprint?: string | null;
  kind: 'document' | 'image' | 'removed';
  path: string;
  revision: number;
};

type ExternalDocumentState = {
  emit: (event: FileWatchEvent) => boolean;
  files: Record<string, string>;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_EXTERNAL_DOCUMENT__?: ExternalDocumentState;
  }
}

const diagnostics = new WeakMap<
  Page,
  { consoleErrors: string[]; pageErrors: string[] }
>();

test.afterEach(async ({ page }) => {
  const errors = diagnostics.get(page);
  expect(errors?.pageErrors ?? []).toEqual([]);
  expect(errors?.consoleErrors ?? []).toEqual([]);
});

async function openExternalDocument(page: Page, markdown: string): Promise<void> {
  const errors = { consoleErrors: [] as string[], pageErrors: [] as string[] };
  diagnostics.set(page, errors);
  page.on('pageerror', (error) => errors.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.consoleErrors.push(message.text());
    }
  });
  await page.addInitScript(
    ({ documentPath, markdown }) => {
      const listeners = new Set<(event: FileWatchEvent) => void>();
      const files = { [documentPath]: markdown };
      window.__LUMAMARK_E2E_EXTERNAL_DOCUMENT__ = {
        emit: (event) => {
          if (listeners.size === 0) {
            return false;
          }
          for (const listener of listeners) {
            listener(event);
          }
          return true;
        },
        files,
      };
      window.__LUMAMARK_E2E_FILE_WATCH__ = {
        listen: async (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
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
    },
    { documentPath, markdown },
  );
  await page.goto('/');
  await page.getByRole('menuitem', { name: /File|文件/ }).click();
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();
  await expect(page.locator('.lm-editor-title')).toHaveText('external-document.md');
}

async function replaceDiskText(
  page: Page,
  text: string,
  revision: number,
): Promise<void> {
  const delivered = await page.evaluate(
    ({ documentPath, revision, text }) => {
      const state = window.__LUMAMARK_E2E_EXTERNAL_DOCUMENT__;
      if (!state) {
        return false;
      }
      state.files[documentPath] = text;
      return state.emit({
        fingerprint: `document-${revision}`,
        kind: 'document',
        path: documentPath,
        revision,
      });
    },
    { documentPath, revision, text },
  );
  expect(delivered).toBe(true);
}

test('automatically reloads a clean document changed on disk', async ({ page }) => {
  await openExternalDocument(page, '# Initial disk text');

  await replaceDiskText(page, '# Reloaded from disk', 1);

  await expect(page.getByText('Reloaded from disk')).toBeVisible();
  await expect(page.locator('.lm-editor-title')).toHaveText('external-document.md');
  await expect(page.getByRole('status')).toHaveText(
    /Reloaded from disk|已从磁盘重新加载/,
  );
});

test('keeps dirty input until the user explicitly reloads the latest disk version', async ({
  page,
}) => {
  await openExternalDocument(page, '# Initial disk text');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('\n\nLocal unsaved edit');
  await expect(page.locator('.lm-editor-title')).toContainText('*');

  await replaceDiskText(page, '# First external version', 1);
  const conflict = page.getByRole('dialog', {
    name: /The file changed on disk|磁盘上的文件已更改/,
  });
  await expect(conflict).toBeVisible();
  await conflict
    .getByRole('button', { name: /Keep current content|保留当前内容/ })
    .click();
  await expect(page.getByText('Local unsaved edit')).toBeVisible();

  await replaceDiskText(page, '# Latest external version', 2);
  await expect(conflict).toBeVisible();
  await conflict
    .getByRole('button', { name: /Reload from disk|从磁盘重新加载/ })
    .click();

  await expect(page.getByText('Latest external version')).toBeVisible();
  await expect(page.getByText('Local unsaved edit')).toHaveCount(0);
  await expect(page.locator('.lm-editor-title')).toHaveText('external-document.md');
});

test('keeps editor content visible when the watched document is removed', async ({
  page,
}) => {
  await openExternalDocument(page, '# Content survives removal');

  const delivered = await page.evaluate(({ documentPath }) => {
    const state = window.__LUMAMARK_E2E_EXTERNAL_DOCUMENT__;
    if (!state) {
      return false;
    }
    delete state.files[documentPath];
    return state.emit({
      fingerprint: null,
      kind: 'removed',
      path: documentPath,
      revision: 1,
    });
  }, { documentPath });
  expect(delivered).toBe(true);

  await expect(page.getByText('Content survives removal')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/File not found|找不到该文件/);
  await expect(page.getByTestId('app-shell')).toBeVisible();
});
