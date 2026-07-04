import { expect, test } from '@playwright/test';

test('renders basic markdown visually and keeps task source editable', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('# 标题\n\n**粗体**\n\n- [ ] task');

  await expect(page.locator('.lm-md-heading-1')).toContainText('标题');
  await expect(page.locator('.lm-md-strong')).toContainText('粗体');
  await expect(page.locator('.lm-md-task-checkbox')).toBeVisible();
  await expect(editor).toContainText('- [ ] task');

  await page.locator('.lm-md-task-checkbox').click();

  await expect(editor).toContainText('- [x] task');

  await page.keyboard.press('Control+Z');

  await expect(editor).toContainText('- [ ] task');
});

test('toggles tasks with keyboard and ignores fenced code task literals', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(
    ['```md', '- [ ] literal', '```', '', '- [ ] task'].join('\n'),
  );

  await expect(page.locator('.lm-md-task-checkbox')).toHaveCount(1);

  await page.keyboard.press('Control+Enter');

  await expect(editor).toContainText('- [x] task');

  await page.locator('.cm-line', { hasText: '- [ ] literal' }).click();
  await page.keyboard.press('Control+Enter');

  await expect(editor).toContainText('- [ ] literal');
  await expect(editor).not.toContainText('- [x] literal');
  await expect(page.locator('.lm-md-task-checkbox')).toHaveCount(1);
});
