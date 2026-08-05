import { expect, test } from '@playwright/test';

test('starts the app shell and shows the editor placeholder', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await expect(page).toHaveTitle(/LumaMark/);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'LumaMark' }),
  ).toBeVisible();
  await expect(page.getByRole('main', { name: '编辑器' })).toBeVisible();
  await expect(page.getByTestId('editor-host')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('就绪');
});
