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
      '> 引用内容',
      '',
      '- item',
      '  - nested item',
      '- [ ] task',
      '',
      '[Luma](https://example.com)',
      '',
      '![Tiny](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
      '',
      '---',
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
  await expect(page.locator('.lm-md-blockquote')).toContainText('引用内容');
  await expect(page.locator('.lm-md-unordered-list-line')).toHaveCount(2);
  await expect(page.locator('.lm-md-list-bullet')).toHaveCount(2);
  await expect(page.locator('.lm-md-task-checkbox')).toBeVisible();
  await expect(page.locator('.lm-md-link')).toContainText('Luma');
  await expect(page.getByRole('img', { name: 'Tiny' })).toBeVisible();
  await expect(page.locator('.lm-md-horizontal-rule')).toBeVisible();
  await expect(
    page.locator('.lm-md-code-block', { hasText: 'const x = 1' }),
  ).toBeVisible();
  await expect(editor).toContainText('- [ ] task');

  await page.locator('.lm-md-task-checkbox').click();

  await expect(editor).toContainText('- [x] task');

  await page.keyboard.press('Control+Z');

  await expect(editor).toContainText('- [ ] task');
});

test('keeps foundational markdown source available in source mode', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      '> quote',
      '',
      '- bullet',
      '',
      '[Luma](https://example.com)',
      '',
      '![Tiny](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
      '',
      '---',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      'plain',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'plain' }).click();

  await expect(page.locator('.lm-md-blockquote')).toContainText('quote');
  await expect(page.locator('.lm-md-list-bullet')).toBeVisible();
  await expect(page.locator('.lm-md-link')).toContainText('Luma');
  await expect(page.getByRole('img', { name: 'Tiny' })).toBeVisible();
  await expect(page.locator('.lm-md-horizontal-rule')).toBeVisible();
  await expect(
    page.locator('.lm-md-code-block', { hasText: 'const x = 1' }),
  ).toBeVisible();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();

  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await expect(editor).toContainText('> quote');
  await expect(editor).toContainText('- bullet');
  await expect(editor).toContainText('[Luma](https://example.com)');
  await expect(editor).toContainText('![Tiny]');
  await expect(editor).toContainText('---');
  await expect(editor).toContainText('```js');
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

test('renders markdown tables through the mature component and keeps table menu commands thin', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['intro', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await expect(page.locator('.tbl-table-widget .tbl-table')).toBeVisible();
  await expect(page.locator('.tbl-table-widget')).toContainText('A');
  await expect(page.locator('.tbl-table-widget')).toContainText('2');
  await expect(page.locator('.lm-table-widget')).toHaveCount(0);
  await expect(page.locator('.lm-table-toolbar')).toHaveCount(0);

  await page.locator('.tbl-data-cell').filter({ hasText: '2' }).click();
  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '复制表格' }).click();
  await expect
    .poll(async () => {
      const text = await page.evaluate(() => navigator.clipboard.readText());

      return text.replace(/\r\n/g, '\n');
    })
    .toBe(['| A | B |', '| - | - |', '| 1 | 2 |'].join('\n'));

  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '删除表格' }).click();
  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
  await expect(editor).toContainText('intro');
  await expect(editor).toContainText('after');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();

  await expect(editor).not.toContainText('| A | B |');
  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
});

test('supports table insert and delete shortcuts', async ({ page }) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n');

  await page.keyboard.press('Control+Alt+T');

  await expect(page.locator('.tbl-table-widget .tbl-table')).toBeVisible();

  await page.locator('.tbl-table-widget').click();
  await page.keyboard.press('Control+Alt+Backspace');

  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
  await expect(editor).toContainText('before');
});

test('shows table shortcuts in top and editor context menus', async ({ page }) => {
  await page.goto('/');

  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  await expect(
    page.getByRole('menuitem', { name: /^表格\s+Ctrl Alt T$/ }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await expect(
    page.getByRole('menuitem', { name: /^复制表格\s+Ctrl Alt C$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: /^删除表格\s+Ctrl Alt Backspace$/ }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n');
  await page.keyboard.press('Control+Alt+T');
  await expect(page.locator('.tbl-table-widget .tbl-table')).toBeVisible();

  await page.locator('.tbl-table-widget').click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: /^表格\s+Ctrl Alt T$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: /^复制表格\s+Ctrl Alt C$/ }),
  ).toBeVisible();
  await page
    .getByRole('menuitem', { name: /^删除表格\s+Ctrl Alt Backspace$/ })
    .click();

  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
  await expect(editor).toContainText('before');
});
