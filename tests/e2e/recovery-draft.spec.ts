import { expect, test, type Page } from '@playwright/test';

const recoveryDraftKey = 'lumamark-recovery-draft-v1';

async function seedRecoveryDraft(page: Page) {
  await page.addInitScript((draft) => {
    localStorage.setItem('lumamark-recovery-draft-v1', JSON.stringify(draft));
  }, {
    filePath: 'E:/notes/outline.md',
    text: '# Recovered outline',
  });
}

test('restores an interrupted draft as a new unsaved document', async ({ page }) => {
  await seedRecoveryDraft(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: '恢复未保存的草稿？' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('outline.md');

  await dialog.getByRole('button', { name: '恢复草稿' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('# Recovered outline');
  await expect(page.locator('.lm-editor-title')).toHaveText('未命名 *');
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), recoveryDraftKey))
    .toBeNull();
});

test('discards an interrupted draft only when the user explicitly chooses to discard it', async ({ page }) => {
  await seedRecoveryDraft(page);
  await page.goto('/');

  const dialog = page.getByRole('dialog', { name: '恢复未保存的草稿？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '丢弃草稿' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('# LumaMark');
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), recoveryDraftKey))
    .toBeNull();
});
