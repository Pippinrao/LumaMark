import { expect, test } from '@playwright/test';

test('renders PlantUML locally in the production bundle without remote diagram requests', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/');
  await page.getByRole('button', { name: /^(?:New Document|新建文档)$/ }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(
    [
      'before',
      '',
      '```plantuml',
      '@startuml',
      'Alice -> Bob : Hello',
      '@enduml',
      '```',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-plantuml-preview').first();
  await expect(preview).toHaveAttribute('data-status', 'success', { timeout: 60_000 });
  await expect(preview.locator('.lm-plantuml-svg > svg')).toBeVisible();
  expect(requests.some((url) => /plantuml\.com|kroki/iu.test(url))).toBe(false);
});
