import { expect, test } from '@playwright/test';

test('renders basic markdown visually and keeps task source editable', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      '# 标题',
      '',
      '**粗体**',
      '',
      '- item',
      '- [ ] task',
      '',
      '![Tiny](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      'plain',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'plain' }).click();

  await expect(page.locator('.lm-md-heading-1')).toContainText('标题');
  await expect(page.locator('.lm-md-strong')).toContainText('粗体');
  await expect(page.locator('.lm-md-hidden-mark')).not.toHaveCount(0);
  await expect(page.locator('.lm-md-unordered-list-line')).toBeVisible();
  await expect(page.locator('.lm-md-task-checkbox')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Tiny' })).toBeVisible();
  await expect(page.locator('.lm-md-code-block', { hasText: 'const x = 1' })).toBeVisible();
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

  const editor = page.locator('.cm-content').first();
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

test('applies basic markdown formatting from the top menu', async ({ page }) => {
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('plain');
  await page.keyboard.press('Control+A');

  await page.locator('.lm-menu-trigger', { hasText: '格式' }).click();
  await page.getByRole('menuitem', { name: '加粗' }).click();

  await expect(editor).toContainText('**plain**');
  await expect(page.locator('.lm-md-strong')).toContainText('plain');
});

test('switches between live preview and source mode without changing markdown source', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('# Title\n\n**bold**\n\nplain');
  await page.locator('.cm-line', { hasText: 'plain' }).click();
  await expect(page.locator('.lm-md-heading-1')).toContainText('Title');
  await expect(page.locator('.lm-md-heading-1')).not.toContainText('#');
  await expect(page.locator('.lm-md-strong')).toContainText('bold');
  await expect(page.locator('.lm-md-strong')).not.toContainText('**');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();

  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await expect(page.locator('.lm-md-heading-1')).toHaveCount(0);
  await expect(editor).toContainText('# Title');
  await expect(editor).toContainText('**bold**');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '实时预览' }).click();

  await expect(page.locator('.lm-editor-live-preview-mode')).toBeVisible();
  await expect(page.locator('.lm-md-heading-1')).toContainText('Title');
  await expect(page.locator('.lm-md-heading-1')).not.toContainText('#');
  await expect(page.locator('.lm-md-strong')).toContainText('bold');
  await expect(page.locator('.lm-md-strong')).not.toContainText('**');
});

test('renders and edits markdown tables as structured live preview widgets', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['intro', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await expect(page.locator('.lm-table-widget table')).toBeVisible();
  await expect(page.locator('.lm-table-widget')).toContainText('A');
  await expect(page.locator('.lm-table-widget')).toContainText('2');
  await expect(page.locator('.lm-table-toolbar')).toBeHidden();

  await page.locator('[data-section="body"][data-row-index="0"][data-column-index="1"]').click();
  await expect(page.locator('.lm-table-toolbar')).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Updated');
  await expect(page.locator('.lm-table-widget')).toContainText('Updated');

  await page.locator('[data-action="add-column"]').click();
  await expect(page.locator('[data-section="header"][data-column-index="2"]')).toBeVisible();

  await page.locator('[data-action="adjust-size"]').click();
  await page.locator('[data-size-rows="2"][data-size-columns="3"]').click();
  await expect(page.locator('[data-section="body"][data-row-index="1"]')).toHaveCount(3);

  await page.locator('[data-section="body"][data-row-index="0"][data-column-index="0"]').click();
  await page.locator('[data-action="more"]').click();
  await page.locator('[data-action="delete-row"]').click();
  await expect(page.locator('[data-section="body"][data-row-index="0"]')).toHaveCount(3);

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();

  await expect(editor).toContainText('| A | B |  |');
  await expect(editor).toContainText('|  |  |  |');
  await expect(page.locator('.lm-table-widget')).toHaveCount(0);
});
