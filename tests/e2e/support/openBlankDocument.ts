import { expect, type Page } from '@playwright/test';

export const NEW_DOCUMENT_BUTTON_NAME = /^(?:New Document|新建文档)$/;

export async function openBlankDocument(page: Page): Promise<void> {
  const startScreen = page.locator('.lm-start-screen-layer');
  await expect(page.getByTestId('app-shell')).toBeVisible();

  if (await startScreen.isVisible()) {
    await page.getByRole('button', { name: NEW_DOCUMENT_BUTTON_NAME }).click();
  }

  await expect(startScreen).toHaveCount(0);
}
