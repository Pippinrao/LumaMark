import { expect } from '@playwright/test';

const MENU_COPY = {
  en: {
    dark: 'Dark',
    language: 'Language',
    sourceMode: /^Source Mode/,
    theme: 'Theme',
    view: 'View',
  },
  'zh-CN': {
    dark: '暗色',
    language: '语言',
    sourceMode: /^源码模式/,
    theme: '主题',
    view: '视图',
  },
};

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
  const language = await waitForPackagedMenuLanguage(page);
  const copy = MENU_COPY[language];

  await openTopMenuWithMouse(page, copy.view);
  const sourceMode = page.getByRole('menuitemradio', { name: copy.sourceMode });
  await expect(sourceMode).toHaveAttribute('aria-checked', 'false');
  await sourceMode.click();
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await openTopMenuWithMouse(page, copy.view);
  await expect(
    page.getByRole('menuitemradio', { name: copy.sourceMode }),
  ).toHaveAttribute('aria-checked', 'true');

  await openTopMenuWithMouse(page, copy.theme);
  await page.getByRole('menuitemradio', { name: copy.dark }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openTopMenuWithMouse(page, copy.theme);
  await expect(
    page.getByRole('menuitemradio', { name: copy.dark }),
  ).toHaveAttribute('aria-checked', 'true');

  await openTopMenuWithMouse(page, copy.language);
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

async function waitForPackagedMenuLanguage(page) {
  const chineseView = page.getByRole('menuitem', { exact: true, name: '视图' });
  const englishView = page.getByRole('menuitem', { exact: true, name: 'View' });
  await expect(chineseView.or(englishView)).toBeVisible({ timeout: 20_000 });
  if (await chineseView.isVisible()) {
    return 'zh-CN';
  }
  return 'en';
}

async function openTopMenuWithMouse(page, name) {
  const trigger = page.getByRole('menuitem', { exact: true, name });
  await trigger.hover();
  if ((await trigger.getAttribute('data-state')) !== 'open') {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute('data-state', 'open');
}
