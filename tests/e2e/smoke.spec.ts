import { expect, test } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

test('starts the app shell and shows the editor placeholder', async ({ page }) => {
  await page.goto('/');
  await openBlankDocument(page);

  await expect(page).toHaveTitle(/LumaMark/);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByRole('main', { name: '编辑器' })).toBeVisible();
  await expect(page.getByTestId('editor-host')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('就绪');
});

test('lets the editor receive clicks after the start screen closes', async ({
  page,
}) => {
  await page.goto('/');
  await openBlankDocument(page);

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.type('start-screen-closed');
  await expect(editor).toContainText('start-screen-closed');
});
