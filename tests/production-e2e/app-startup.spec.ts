import { expect, test } from '@playwright/test';

test('keeps the production menu keyboard-accessible and functional', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await expect(page.locator('.lm-top-chrome .lm-menu-trigger')).toHaveText([
    '文件',
    '编辑',
    '段落',
    '格式',
    '视图',
    '主题',
    '语言',
    '帮助',
  ]);

  const paragraph = page.getByRole('menuitem', {
    exact: true,
    name: '段落',
  });
  await paragraph.focus();
  await paragraph.press('ArrowDown');
  const insert = page.getByRole('menuitem', { exact: true, name: '插入' });
  await insert.press('ArrowRight');
  await expect(
    page.getByRole('menuitem', { name: /^表格\s+Ctrl\+T$/ }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { exact: true, name: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();

  await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('menuitem', { exact: true, name: '帮助' }).click();
  await page.getByRole('menuitem', { name: '关于 LumaMark' }).click();
  await expect(page.getByRole('dialog', { name: '关于 LumaMark' })).toBeVisible();
});

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
  await page.getByRole('button', { name: '新建文档' }).click();

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
