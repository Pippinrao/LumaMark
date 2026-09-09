import { expect, test } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

test('tables fit the page through resize and cell activation without rewriting source', async ({ page }, testInfo) => {
  await page.goto('/');
  await openBlankDocument(page);
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name: '外观', exact: true }).click();
  await page.getByRole('radiogroup', { name: '页面宽度' }).getByRole('radio', { name: '窄', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const source = [
    '# Table width', '',
    '| Header | LongUnbrokenHeader'.padEnd(130, 'x') + ' | 中文标题 | Fourth |',
    '| --- | --- | --- | --- |',
    '| hello world | ' + 'https://example.com/'.repeat(18) + ' | ' + '中文内容'.repeat(8) + ' | end |',
    '', 'after', '',
  ].join('\n');
  const root = page.locator('.lm-codemirror > .cm-editor > .cm-scroller > .cm-content');
  await root.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
  await page.locator('.cm-line', { hasText: 'after' }).click();
  const widget = page.locator('.tbl-table-widget');
  await expect(widget).toBeVisible();

  for (const width of [1280, 900, 720]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(async () => {
      const geometry = await root.evaluate((element) => {
        const table = element.querySelector('.tbl-table')!;
        const track = element.getBoundingClientRect();
        const bounds = table.getBoundingClientRect();
        return { left: bounds.left - track.left, right: bounds.right - track.right };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(1);
    }).toPass();
    if (width === 1280) await page.screenshot({ path: testInfo.outputPath('table-page-fit.png') });
    const cell = page.locator('.tbl-data-cell').first();
    await cell.click();
    await expect(cell.locator('.cm-editor')).toBeVisible();
    const overflow = await cell.locator('.cm-content').evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(widget).toHaveCSS('overflow-x', 'visible');
    await page.locator('.cm-line', { hasText: 'after' }).click();
  }
  const actual = await root.evaluate((element) => {
    const tile = (element as HTMLElement & { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } }).cmTile;
    return tile.root.view.state.doc.toString();
  });
  expect(actual).toBe(source);
});
