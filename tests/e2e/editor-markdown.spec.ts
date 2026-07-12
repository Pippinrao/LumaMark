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
    page.locator('.lm-md-code-block-line', { hasText: 'const x = 1' }),
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
    page.locator('.lm-md-code-block-line', { hasText: 'const x = 1' }),
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

test('keeps fenced code blocks editable with stable preview row layout', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```ts', 'const value = 1', 'console.log(value)', '```', '', 'plain'].join(
      '\n',
    ),
  );

  const codeLine = page.locator('.lm-md-code-block-line', {
    hasText: 'const value = 1',
  });
  await expect(codeLine).toBeVisible();

  await codeLine.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(';');

  await expect(editor).toContainText('const value = 1;');

  const layout = await page.evaluate(() => {
    const codeRows = [...document.querySelectorAll('.lm-md-code-block-line')];
    const plainRow = [...document.querySelectorAll('.cm-line')].find((line) =>
      line.textContent?.includes('plain'),
    );

    return {
      codeHeights: codeRows.map((row) => row.getBoundingClientRect().height),
      plainHeight: plainRow?.getBoundingClientRect().height ?? 0,
    };
  });

  expect(layout.plainHeight).toBeGreaterThan(0);
  expect(layout.codeHeights.length).toBeGreaterThanOrEqual(3);
  for (const height of layout.codeHeights) {
    expect(height).toBeLessThanOrEqual(layout.plainHeight * 1.2);
  }
});

test('leaves a final fenced code block when Enter is pressed on its closing fence', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(['```ts', 'const value = 1', '```'].join('\n'));
  await page.locator('.cm-line', { hasText: '```' }).last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Outside the code block');

  await expect(editor).toContainText('Outside the code block');
  await expect(page.locator('.lm-md-code-block-line')).toHaveCount(3);
});

test('creates a paragraph below a final fenced code block when the caret moves down', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(['```ts', 'const value = 1', '```'].join('\n'));
  await page.locator('.cm-line', { hasText: '```' }).last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('Outside the code block');

  await expect(page.locator('.lm-md-code-block-line')).toHaveCount(3);
  await page.getByRole('menuitem', { name: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();
  await expect(page.locator('.cm-line')).toHaveText([
    '```ts',
    'const value = 1',
    '```',
    'Outside the code block',
  ]);
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

test('toggles a selected unordered list from the paragraph menu', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('first');
  await page.keyboard.press('Control+A');
  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  await page.getByRole('menuitem', { name: '无序列表' }).click();

  await expect(editor).toContainText('- first');
  await page.keyboard.press('Control+A');
  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  await page.getByRole('menuitem', { name: '无序列表' }).click();

  await expect(page.locator('.cm-line').allTextContents()).resolves.toEqual(['first']);
});

test('formats selected text with standard bold and italic keyboard shortcuts', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('plain');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+B');

  await expect(editor).toContainText('**plain**');
  await page.keyboard.press('Control+B');
  await expect(editor).toHaveText('plain');
  await page.keyboard.press('Control+Z');
  await expect(editor).toContainText('**plain**');
  await page.keyboard.press('Control+Z');
  await expect(editor).toHaveText('plain');

  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+I');
  await expect(editor).toContainText('*plain*');
  await page.keyboard.press('Control+Z');
  await expect(editor).toHaveText('plain');
});

test('changes the current line heading level with standard keyboard shortcuts', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Heading');
  await page.keyboard.press('Control+1');

  await expect(editor).toContainText('# Heading');
  await page.keyboard.press('Control+2');
  await expect(editor).toContainText('## Heading');
  await page.keyboard.press('Control+Z');
  await expect(editor).toContainText('# Heading');
});

test('undoes and redoes a Markdown command from the edit menu', async ({ page }) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('plain');
  await page.keyboard.press('Control+A');

  await page.locator('.lm-menu-trigger', { hasText: '格式' }).click();
  await page.getByRole('menuitem', { name: '加粗' }).click();
  await expect(editor).toContainText('**plain**');

  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '撤销' }).click();
  await expect(editor).toContainText('plain');
  await expect(editor).not.toContainText('**plain**');

  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '重做' }).click();
  await expect(editor).toContainText('**plain**');
});

test('opens the built-in search panel from the edit menu', async ({ page }) => {
  await page.goto('/');

  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '查找' }).click();

  const searchInput = page.locator('.cm-search [name="search"]');
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toHaveAttribute('placeholder', '查找');
  await expect(searchInput).toBeFocused();
});

test('opens the built-in search panel from the command palette', async ({
  page,
}) => {
  await page.goto('/');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '查找' }).click();

  await expect(page.locator('.cm-search [name="search"]')).toBeFocused();
});

test('opens the built-in search panel when the command palette confirms Find by keyboard', async ({
  page,
}) => {
  await page.goto('/');

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.lm-command-palette-input')).toBeFocused();
  await page.keyboard.type('查找');
  await page.keyboard.press('Enter');

  await expect(page.locator('.cm-search [name="search"]')).toBeFocused();
});

test('returns focus to the editor when the command palette closes without a command', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.lm-command-palette-input')).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(editor).toBeFocused();
});

test('preserves the command palette opener when its shortcut is pressed again', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.lm-command-palette-input')).toBeFocused();
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Escape');

  await expect(editor).toBeFocused();
});

test('creates strikethrough and ordered list Markdown from standard command entry points', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('plain');
  await page.keyboard.press('Control+A');

  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '删除线' }).click();
  await expect(page.locator('.lm-md-strikethrough')).toContainText('plain');

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('item');
  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  await page.getByRole('menuitem', { name: '有序列表' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();
  await expect(editor).toContainText('1. item');
});

test('creates image Markdown from the format menu and command palette', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('cover');
  await page.keyboard.press('Control+A');

  await page.locator('.lm-menu-trigger', { hasText: '格式' }).click();
  await page.getByRole('menuitem', { name: '图片' }).click();
  await expect(editor).toContainText('![cover](url)');

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('banner');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '图片' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();
  await expect(editor).toContainText('![banner](url)');
});

test('inserts a horizontal rule from the paragraph menu and command palette', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Before\nAfter');
  await page.keyboard.press('Control+Home');

  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  await page.getByRole('menuitem', { name: '分割线' }).click();
  await expect(page.locator('.lm-md-horizontal-rule')).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Before\n\nAfter');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '分割线' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual([
    'Before',
    '',
    '---',
    '',
    'After',
  ]);
});

test('creates and undoes an ordered list from the command palette', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('item');

  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '有序列表' }).click();
  await expect(editor).toContainText('1. item');

  await editor.click();
  await page.keyboard.press('Control+Z');
  await expect(editor).toContainText('item');
  await expect(editor).not.toContainText('1. item');
});

test('creates advanced heading levels through the menu and command palette', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Title');

  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  await page.getByRole('menuitem', { name: '标题 3' }).click();
  await expect(page.locator('.lm-md-heading-3')).toContainText('Title');

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Title');
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '标题 6' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();
  await expect(editor).toContainText('###### Title');
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

test('opens the built-in search panel and navigates to a Markdown match', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n\nneedle\n\nafter');

  await page.keyboard.press('Control+F');

  const searchPanel = page.locator('.cm-search');
  const searchInput = searchPanel.getByRole('textbox').first();
  await expect(searchPanel).toBeVisible();
  await expect(searchInput).toBeFocused();
  await searchInput.fill('needle');
  await page.keyboard.press('Enter');

  await expect(editor).toContainText('needle');
  await expect(page.locator('.cm-searchMatch')).not.toHaveCount(0);
});

test('localizes the built-in search panel after an application language change', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n\nneedle\n\nafter');

  await page.keyboard.press('Control+F');
  await expect(
    page.locator('.cm-search [name="search"]'),
  ).toHaveAttribute('placeholder', '查找');
  await expect(page.locator('.cm-search [name="next"]')).toHaveText('下一个');
  await page.keyboard.press('Escape');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByRole('tab', { name: '语言' }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  await editor.click();
  await page.keyboard.press('Control+F');
  await expect(
    page.locator('.cm-search [name="search"]'),
  ).toHaveAttribute('placeholder', 'Find');
  await expect(page.locator('.cm-search [name="next"]')).toHaveText('next');
  await expect(editor).toContainText('needle');
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

test('reveals table cell markdown source on hover and edits the raw cell content', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      'intro',
      '',
      '| Inline    | Link                          | Code   |',
      '| --------- | ----------------------------- | ------ |',
      '| **bold**  | [site](https://example.com)   | `code` |',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const table = page.locator('.tbl-table-widget');
  const boldCell = table.locator('.tbl-data-cell').filter({ hasText: 'bold' });
  const boldCellSource = boldCell.locator('.tbl-cell-view');
  const boldCellPreview = boldCell.locator('.lm-table-inline-preview');

  await expect(table).toBeVisible();
  await expect(boldCellPreview.locator('strong', { hasText: 'bold' })).toBeVisible();
  await expect(
    table.locator('.lm-table-inline-preview code', { hasText: 'code' }),
  ).toBeVisible();
  await expect(boldCellSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'preview',
  );

  await boldCell.hover();

  await expect(boldCellSource).toContainText('**bold**');
  await expect(boldCellSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'source',
  );

  await boldCell.click();

  const cellEditor = page.locator('.tbl-cell-editor .cm-content').first();
  await expect(cellEditor).toBeVisible();
  await expect(cellEditor).toContainText('**bold**');

  await cellEditor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');

  await expect(cellEditor).toContainText('**bold**!');

  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(boldCellPreview).toContainText('bold!');
  await expect(
    boldCellPreview.locator('strong', { hasText: 'bold' }),
  ).toBeVisible();
  await expect(boldCellSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'preview',
  );

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitem', { name: '源码模式' }).click();

  await expect(editor).toContainText('**bold**!');
  await expect(editor).toContainText('[site](https://example.com)');
  await expect(editor).toContainText('`code`');
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
