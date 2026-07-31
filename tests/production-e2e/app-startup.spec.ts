import { expect, test } from '@playwright/test';

test('boots the production bundle and loads the lazy Mermaid renderer', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');

  await expect(page.getByTestId('app-shell')).toBeVisible();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'After diagram'].join(
      '\n',
    ),
  );
  await page.locator('.cm-line', { hasText: 'After diagram' }).click();

  await expect(page.locator('.lm-mermaid-svg svg')).toBeVisible();
  await expect(page.locator('.lm-mermaid-error')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
