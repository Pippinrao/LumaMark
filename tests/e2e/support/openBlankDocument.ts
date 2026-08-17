import { expect, type Page } from '@playwright/test';

export const NEW_DOCUMENT_BUTTON_NAME = /^(?:New Document|新建文档)$/;

export async function openBlankDocument(page: Page): Promise<void> {
  const startScreen = page.locator('.lm-start-screen-layer');
  const newDocumentButton = page.getByRole('button', {
    name: NEW_DOCUMENT_BUTTON_NAME,
  });
  await expect(page.getByTestId('app-shell')).toBeVisible();

  await expect(async () => {
    if (await startScreen.isVisible()) {
      await newDocumentButton.click();
    }

    await expect(startScreen).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
