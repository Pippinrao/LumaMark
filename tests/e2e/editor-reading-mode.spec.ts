import { expect, test, type Page } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
}

async function setDisplayMode(
  page: Page,
  mode: 'livePreview' | 'reading' | 'source',
): Promise<void> {
  const rootClass =
    mode === 'source'
      ? '.lm-editor-source-mode'
      : mode === 'reading'
        ? '.lm-editor-reading-mode'
        : '.lm-editor-live-preview-mode';

  if (await page.locator(rootClass).isVisible()) {
    return;
  }

  const viewMenu = page.getByRole('menuitem', { exact: true, name: '视图' });
  await viewMenu.click();
  await expect(viewMenu).toHaveAttribute('data-state', 'open');
  await page
    .getByRole('menuitemradio', {
      name:
        mode === 'source'
          ? /^源码模式/
          : mode === 'reading'
            ? /^阅读模式/
            : '实时预览',
    })
    .click();
  await expect(page.locator(rootClass)).toBeVisible();
}

test('locks the rendered view and refuses edits in reading mode', async ({
  page,
}) => {
  await openNewDocument(page);
  await page.locator('.cm-content').fill('**Bold** and more');
  await setDisplayMode(page, 'reading');

  await expect(page.locator('.lm-editor-reading-mode')).toBeVisible();
  await expect(page.getByTestId('status-readonly')).toBeVisible();
  await expect(page.locator('.cm-content')).not.toContainText('**Bold**');
  await expect(page.locator('.cm-content')).toContainText('Bold');

  await page.locator('.cm-content').click();
  await page.keyboard.type('should-not-appear');
  await expect(page.getByTestId('status-readonly')).toContainText(/只读|Read-only|无法修改|read-only/i);
  await expect(page.locator('.cm-content')).not.toContainText('should-not-appear');

  await page.keyboard.press(`${primaryModifier}+B`);
  await expect(page.locator('.cm-content')).not.toContainText('****');
});

test('does not activate nested table editors while reading', async ({
  page,
}) => {
  await openNewDocument(page);
  await page.locator('.cm-content').fill(
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| cell    | value |',
      '',
      'after',
    ].join('\n'),
  );
  await expect(page.locator('.tbl-table-widget')).toBeVisible();
  await setDisplayMode(page, 'reading');

  await page.locator('.tbl-cell-view').first().click();
  await expect(page.locator('.tbl-cell-editor .cm-content:visible')).toHaveCount(
    0,
  );
  await expect(page.getByTestId('status-readonly')).toBeVisible();
});

test('cycles live preview, source, and reading with Ctrl+/', async ({
  page,
}) => {
  await openNewDocument(page);
  await expect(page.locator('.lm-editor-live-preview-mode')).toBeVisible();

  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();

  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-reading-mode')).toBeVisible();
  await expect(page.getByTestId('status-readonly')).toBeVisible();

  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-live-preview-mode')).toBeVisible();
  await expect(page.getByTestId('status-readonly')).toHaveCount(0);
});
