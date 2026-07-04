import { expect, test } from '@playwright/test';

test('renders mermaid asynchronously while normal text remains editable', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.keyboard.type('\nfast input');

  await expect(editor).toContainText('fast input');
  await expect(page.locator('.lm-mermaid-preview')).toBeVisible();
  await expect(page.locator('.lm-mermaid-svg svg')).toBeVisible();
});
