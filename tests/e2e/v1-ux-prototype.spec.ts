import { expect, test } from '@playwright/test';

const prototypePath = '/docs/product/prototypes/v1-apple-file-mode/';

test('locks the V1 Typora-like file management UX prototype constraints', async ({
  page,
}) => {
  await page.goto(prototypePath);

  await expect(page.getByTestId('v1-ux-prototype')).toBeVisible();
  await expect(page.getByTestId('v1-file-sidebar')).toBeVisible();
  await expect(page.getByTestId('v1-editor-pane')).toBeVisible();

  await expect(page.locator('.menu-trigger')).toHaveText([
    '文件',
    '编辑',
    '段落',
    '格式',
    '视图',
    '主题',
    '帮助',
  ]);
  await expect(page.locator('.tab-trigger')).toHaveText(['文件', '大纲']);
  await expect(page.locator('.sidebar-search')).toHaveCount(0);
  await expect(page.locator('.eyebrow')).toHaveCount(0);

  await expect(
    page.getByTestId('v1-file-sidebar').getByText('V1 UX Review.md'),
  ).toBeVisible();
  await expect(page.locator('.outline-list')).toBeHidden();
  await page.getByRole('tab', { name: '大纲' }).click();
  await expect(page.locator('.outline-item')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'LumaMark V1 UX' })).toBeVisible();

  const sidebarWidth = await page
    .getByTestId('v1-file-sidebar')
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(sidebarWidth).toBeGreaterThanOrEqual(236);
  expect(sidebarWidth).toBeLessThanOrEqual(380);

  const paperWidth = await page
    .getByTestId('v1-document-paper')
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(paperWidth).toBeLessThanOrEqual(820);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.getByRole('button', { name: '折叠侧栏' }).click();
  await expect(page.getByTestId('v1-file-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(page.getByTestId('v1-file-sidebar')).toBeVisible();

  await page.getByRole('button', { name: '切换到暗色' }).click();
  await expect(page.getByTestId('v1-ux-prototype')).toHaveAttribute(
    'data-theme',
    'dark',
  );

  await page.getByRole('button', { name: '切换源码模式' }).click();
  await expect(page.locator('.source-document')).toBeVisible();
  await expect(page.locator('.source-document')).toContainText('```mermaid');
  await expect(page.locator('.status-strip').getByText('源码模式')).toBeVisible();
});

test('keeps the editor usable without horizontal overflow on compact desktop widths', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 760 });
  await page.goto(prototypePath);

  await expect(page.getByTestId('v1-ux-prototype')).toBeVisible();
  await expect(page.getByTestId('v1-file-sidebar')).toHaveCount(0);
  await expect(page.getByTestId('v1-editor-pane')).toBeVisible();

  const wrappedMenuLabels = await page.locator('.menu-trigger').evaluateAll(
    (nodes) =>
      nodes
        .filter((node) => node.scrollHeight > node.clientHeight)
        .map((node) => node.textContent?.trim()),
  );
  expect(wrappedMenuLabels).toEqual([]);
  const firstMenuLeft = await page
    .locator('.menu-trigger')
    .first()
    .evaluate((node) => node.getBoundingClientRect().left);
  expect(firstMenuLeft).toBeGreaterThanOrEqual(8);

  const paperWidth = await page
    .getByTestId('v1-document-paper')
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(paperWidth).toBeLessThanOrEqual(724);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(page.getByTestId('v1-file-sidebar')).toBeVisible();
});
