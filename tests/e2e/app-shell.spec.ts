import { expect, test } from '@playwright/test';

test('opens the command palette and triggers save', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: '命令' }).click();
  const palette = page.getByRole('dialog', { name: '命令面板' });
  await expect(palette).toBeVisible();

  await palette.getByPlaceholder('搜索命令').fill('保存');
  await palette.getByText('保存', { exact: true }).click();

  await expect(palette).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('保存失败');
});
