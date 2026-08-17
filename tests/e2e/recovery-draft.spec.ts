import { expect, test, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

const recoveryDraftKey = 'lumamark-recovery-draft-v2:main';

async function seedRecoveryDraft(page: Page) {
  await page.addInitScript((draft) => {
    localStorage.setItem('lumamark-recovery-draft-v1', JSON.stringify(draft));
  }, {
    filePath: 'E:/notes/outline.md',
    text: '# Recovered outline',
  });
}

test('keeps a restored draft recoverable until it is explicitly saved or discarded', async ({
  page,
}) => {
  await seedRecoveryDraft(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: '恢复未保存的草稿？' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('outline.md');

  await dialog.getByRole('button', { name: '恢复草稿' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('# Recovered outline');
  await expect(page.locator('.lm-editor-title')).toHaveText('未命名 *');
  await expect.poll(async () => {
    const serialized = await page.evaluate(
      (key) => localStorage.getItem(key),
      recoveryDraftKey,
    );

    return serialized === null ? null : JSON.parse(serialized);
  }).toEqual({
    filePath: null,
    text: '# Recovered outline',
  });

  await page.reload();
  const reloadedDialog = page.getByRole('dialog', {
    name: '恢复未保存的草稿？',
  });
  await expect(reloadedDialog).toBeVisible();
  await reloadedDialog.getByRole('button', { name: '恢复草稿' }).click();
  await expect(page.locator('.cm-content')).toContainText('# Recovered outline');
  await expect(page.locator('.lm-editor-title')).toHaveText('未命名 *');
});

test('keeps a restored draft dirty after editing and undoing to the recovered text', async ({ page }) => {
  await seedRecoveryDraft(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: '恢复未保存的草稿？' });
  await dialog.getByRole('button', { name: '恢复草稿' }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('X');
  await page.keyboard.press('Control+Z');

  await expect(editor).toContainText('# Recovered outline');
  await expect(page.locator('.lm-editor-title')).toHaveText('未命名 *');
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), recoveryDraftKey))
    .not.toBeNull();
});

test('discards an interrupted draft only when the user explicitly chooses to discard it', async ({ page }) => {
  await seedRecoveryDraft(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: '恢复未保存的草稿？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '丢弃草稿' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main', { name: '开始' })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), recoveryDraftKey))
    .toBeNull();
});

test('does not recover a draft after redo returns to the saved snapshot', async ({ page }) => {
  const savedPath = 'E:/notes/savepoint.md';

  await page.addInitScript((path) => {
    const byteLength = (value: string) => new TextEncoder().encode(value).length;

    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async () => ({
        ok: true,
        data: { byteLength: 0, path, text: '' },
      }),
      showOpenDialog: async () => ({ ok: true, data: path }),
      showSaveDialog: async () => ({ ok: true, data: path }),
      writeText: async (filePath: string, text: string) => ({
        ok: true,
        data: { byteLength: byteLength(text), path: filePath },
      }),
    };
  }, savedPath);

  await page.goto('/');
  await openBlankDocument(page);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('# Saved snapshot');
  await page.keyboard.press('Control+S');
  await expect(page.getByRole('status')).toHaveText('已保存');

  await page.keyboard.press('Control+Z');
  await expect(page.locator('.lm-editor-title')).toHaveText('savepoint.md *');
  await page.keyboard.press('Control+Y');
  await expect(page.locator('.lm-editor-title')).toHaveText('savepoint.md');

  await page.waitForTimeout(700);
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), recoveryDraftKey))
    .toBeNull();

  await page.reload();
  await expect(
    page.getByRole('dialog', { name: '恢复未保存的草稿？' }),
  ).toBeHidden();
});
