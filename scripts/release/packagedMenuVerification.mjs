import { expect } from '@playwright/test';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ persistViaReload?: boolean }} [options]
 *   persistViaReload defaults to true for backward-compatible smoke.
 *   Cold-start scripts should pass false and assert after a real process restart.
 */
export async function verifyPackagedMenuWorkflows(
  page,
  { persistViaReload = true } = {},
) {
  await openTopMenuWithMouse(page, '视图');
  const sourceMode = page.getByRole('menuitemradio', { name: /^源码模式/ });
  await expect(sourceMode).toHaveAttribute('aria-checked', 'false');
  await sourceMode.click();
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await openTopMenuWithMouse(page, '视图');
  await expect(
    page.getByRole('menuitemradio', { name: /^源码模式/ }),
  ).toHaveAttribute('aria-checked', 'true');

  await openTopMenuWithMouse(page, '主题');
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openTopMenuWithMouse(page, '主题');
  await expect(
    page.getByRole('menuitemradio', { name: '暗色' }),
  ).toHaveAttribute('aria-checked', 'true');

  await openTopMenuWithMouse(page, '语言');
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await openTopMenuWithMouse(page, 'Language');
  await expect(
    page.getByRole('menuitemradio', { name: 'English' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(
    page.getByRole('menuitem', { exact: true, name: 'Language' }),
  ).toHaveAttribute('data-state', 'closed');

  await openTopMenuWithMouse(page, 'Help');
  await page.getByRole('menuitem', { name: 'About LumaMark' }).click();
  await expect(page.getByRole('dialog', { name: 'About LumaMark' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /Settings|设置/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();

  if (!persistViaReload) {
    return;
  }

  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

async function openTopMenuWithMouse(page, name) {
  const trigger = page.getByRole('menuitem', { exact: true, name });
  await trigger.hover();
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('data-state', 'open');
}
