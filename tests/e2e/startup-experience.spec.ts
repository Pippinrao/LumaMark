import { expect, test } from '@playwright/test';

const startupStorageKey = 'lumamark.startup.v1';

test('keeps the start screen open when the file picker is cancelled', async ({ page }) => {
  await page.addInitScript(() => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async () => { throw new Error('readText should not be called'); },
      showOpenDialog: async () => ({ ok: true, data: null }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async () => { throw new Error('writeText should not be called'); },
    };
  });
  await page.goto('/');

  await page.getByRole('button', { name: '打开 Markdown 文件' }).click();

  await expect(page.getByRole('main', { name: '开始' })).toBeVisible();
  await expect(page.getByTestId('workspace-content')).toHaveAttribute('aria-hidden', 'true');
});

test('restores the last file only after the editor and recovery check are ready', async ({ page }) => {
  const path = 'E:/notes/last.md';
  await page.addInitScript(({ key, path }) => {
    localStorage.setItem(key, JSON.stringify({
      lastSession: { kind: 'file', path },
      recentWorkspaces: [],
      startupBehavior: 'restoreLastSession',
      version: 1,
    }));
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async () => ({
        ok: true,
        data: { byteLength: 13, path, text: '# Last file' },
      }),
      showOpenDialog: async () => ({ ok: true, data: null }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async () => { throw new Error('writeText should not be called'); },
    };
  }, { key: startupStorageKey, path });
  await page.goto('/');

  await expect(page.getByRole('main', { name: '开始' })).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('# Last file');
  await expect(page.locator('.lm-editor-title')).toHaveText('last.md');
});

test('gives an unsaved recovery draft priority over last-session restore', async ({ page }) => {
  const path = 'E:/notes/last.md';
  await page.addInitScript(({ key, path }) => {
    localStorage.setItem(key, JSON.stringify({
      lastSession: { kind: 'file', path },
      recentWorkspaces: [],
      startupBehavior: 'restoreLastSession',
      version: 1,
    }));
    localStorage.setItem('lumamark-recovery-draft-v1', JSON.stringify({
      filePath: null,
      text: '# Recovered first',
    }));
    (window as Window & { __LUMAMARK_OPEN_COUNT__?: number })
      .__LUMAMARK_OPEN_COUNT__ = 0;
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async () => {
        const target = window as Window & { __LUMAMARK_OPEN_COUNT__?: number };
        target.__LUMAMARK_OPEN_COUNT__ = (target.__LUMAMARK_OPEN_COUNT__ ?? 0) + 1;
        return {
          ok: true,
          data: { byteLength: 13, path, text: '# Last file' },
        };
      },
      showOpenDialog: async () => ({ ok: true, data: null }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async () => { throw new Error('writeText should not be called'); },
    };
  }, { key: startupStorageKey, path });
  await page.goto('/');

  const recoveryDialog = page.getByRole('dialog', { name: '恢复未保存的草稿？' });
  await expect(recoveryDialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __LUMAMARK_OPEN_COUNT__?: number }
  ).__LUMAMARK_OPEN_COUNT__)).toBe(0);

  await recoveryDialog.getByRole('button', { name: '恢复草稿' }).click();

  await expect(page.locator('.cm-content')).toContainText('# Recovered first');
  await expect(page.locator('.cm-content')).not.toContainText('# Last file');
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __LUMAMARK_OPEN_COUNT__?: number }
  ).__LUMAMARK_OPEN_COUNT__)).toBe(0);
});
