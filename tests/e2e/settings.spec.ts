import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

const reportDirectory = resolve('artifacts/settings-report');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => ({
        ok: true,
        data: {
          byteLength: 0,
          path,
          text: '',
        },
      }),
      showOpenDialog: async () => ({ ok: true, data: null }),
      showOpenImageDialog: async () => ({ ok: true, data: [] }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => ({
        ok: true,
        data: { byteLength: text.length, path },
      }),
    };
  });
});

async function ensureEditorDocument(page: Page): Promise<void> {
  await openBlankDocument(page);
}

async function openSettings(page: Page): Promise<void> {
  await ensureEditorDocument(page);
  const fileMenu = page.getByRole('menuitem', {
    exact: true,
    name: /^(?:File|文件)$/,
  });
  await fileMenu.focus();
  await fileMenu.press('ArrowDown');
  await page.getByRole('menuitem', { name: /^(?:Settings|设置)$/ }).click();
  await expect(
    page.getByRole('dialog', { name: /^(?:Settings|设置)$/ }),
  ).toBeVisible();
}

async function closeSettings(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', {
    name: /^(?:Settings|设置)$/,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Dialog focus restoration is intentionally deferred by one animation frame.
  // Wait for it before opening another menubar group so the deferred focus cannot
  // race this test and reopen the original File menu under parallel load.
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => resolveFrame()),
      ),
  );
}

async function expectDialogInsideViewport(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /^(?:Settings|设置)$/ });
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();

  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
}

test('keeps font zoom after reload through vertical settings navigation', async ({
  page,
}) => {
  await page.goto('/');
  await openSettings(page);
  await expectDialogInsideViewport(page);

  const dialog = page.getByRole('dialog', { name: /^(?:Settings|设置)$/ });
  const tabs = dialog.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  await expect(dialog.getByRole('tablist')).toHaveAttribute(
    'aria-orientation',
    'vertical',
  );
  const autoCheckUpdates = dialog.getByRole('switch', {
    name: /^(?:Check for updates when LumaMark starts|启动时检查更新)$/,
  });
  await expect(autoCheckUpdates).toBeChecked();
  await autoCheckUpdates.click();
  await expect(autoCheckUpdates).not.toBeChecked();

  await tabs.nth(0).focus();
  await page.keyboard.press('ArrowDown');
  await expect(tabs.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tabs.nth(1)).toHaveAttribute('data-state', 'active');

  const zoom = dialog.getByLabel(/^(?:Font zoom \(%\)|字体缩放（%）)$/);
  await zoom.fill('130');
  await expect(zoom).toHaveAttribute('aria-valuenow', '130');
  await page.waitForFunction(() => {
    const raw = window.localStorage.getItem('lumamark.settings.v1');
    return Boolean(
      raw &&
        raw.includes('"fontZoomPercent":130') &&
        raw.includes('"autoCheckOnStartup":false'),
    );
  });

  await page.keyboard.press('Escape');
  await page.reload();
  await openSettings(page);
  const reopened = page.getByRole('dialog', { name: /^(?:Settings|设置)$/ });
  await reopened.getByRole('tab', { name: /^(?:Appearance|外观)$/ }).click();
  await expect(
    reopened.getByLabel(/^(?:Font zoom \(%\)|字体缩放（%）)$/),
  ).toHaveAttribute('aria-valuenow', '130');
  await reopened.getByRole('tab', { name: /^(?:General|通用)$/ }).click();
  await expect(
    reopened.getByRole('switch', {
      name: /^(?:Check for updates when LumaMark starts|启动时检查更新)$/,
    }),
  ).not.toBeChecked();
});

test('persists the system theme while following live OS color-scheme changes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await openSettings(page);

  const dialog = page.getByRole('dialog', { name: /^(?:Settings|设置)$/ });
  await dialog.getByRole('tab', { name: /^(?:Appearance|外观)$/ }).click();
  const systemTheme = dialog.getByRole('radio', {
    name: /^(?:System|跟随系统)$/,
  });
  await systemTheme.click();

  await expect(systemTheme).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('lumamark.settings.v1');
        return raw ? JSON.parse(raw).appearance?.theme : null;
      }),
    )
    .toBe('system');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await ensureEditorDocument(page);
  const themeMenu = page.getByRole('menuitem', {
    exact: true,
    name: /^(?:Theme|主题)$/,
  });
  await themeMenu.click();
  await expect(
    page.getByRole('menuitemradio', {
      checked: true,
      name: /^(?:System|跟随系统)$/,
    }),
  ).toBeVisible();
});

test('shows a retryable write error and persists the retained setting snapshot', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    let failedOnce = false;
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === 'lumamark.settings.v1' && !failedOnce) {
        failedOnce = true;
        throw new DOMException('storage unavailable', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    };
  });
  await page.goto('/');
  await openSettings(page);

  const dialog = page.getByRole('dialog', { name: /^(?:Settings|设置)$/ });
  await dialog.getByRole('tab', { name: /^(?:Appearance|外观)$/ }).click();
  await dialog
    .getByRole('radio', { name: /^(?:System|跟随系统)$/ })
    .click();

  const failure = dialog.getByRole('alert').filter({
    hasText:
      /(?:could not save settings|无法保存设置)/,
  });
  await expect(failure).toHaveAttribute(
    'data-error-code',
    'settings.write_failed',
  );
  await failure
    .getByRole('button', { name: /^(?:Retry saving|重试保存)$/ })
    .click();
  await expect(failure).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('lumamark.settings.v1');
        return raw ? JSON.parse(raw).appearance?.theme : null;
      }),
    )
    .toBe('system');
});

test('recovers corrupt browser settings visibly without hiding the preserved contract', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lumamark.settings.v1', '{not-json');
  });
  await page.goto('/');
  await openSettings(page);

  const dialog = page.getByRole('dialog', { name: /^(?:Settings|设置)$/ });
  await expect(dialog.getByRole('alert')).toContainText(
    /(?:settings file was damaged|设置文件已损坏)/,
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('lumamark.settings.v1');
        return raw ? JSON.parse(raw).version : null;
      }),
    )
    .toBe(4);
});

test('applies editor defaults to new documents without rebuilding the ready editor', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'lumamark.settings.v1',
      JSON.stringify({
        appearance: {
          fontZoomPercent: 100,
          pageWidth: 'standard',
          sidebarOpenOnStartup: true,
          theme: 'light',
        },
        editor: {
          defaultDisplayMode: 'source',
          focusModeOnStartup: true,
        },
        general: { language: 'zh-CN', startupBehavior: 'home' },
        images: { copyImagesToAssets: false },
        updates: { autoCheckOnStartup: true },
        version: 2,
      }),
    );
  });
  await page.goto('/');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = window.localStorage.getItem('lumamark.settings.v1');
        return raw ? JSON.parse(raw).editor?.defaultDisplayMode : null;
      }),
    )
    .toBe('source');

  const shell = page.getByTestId('app-shell');
  await expect(shell).toHaveClass(/lm-focus-mode/);
  const editor = page.locator('.cm-editor');
  await expect(editor).toHaveClass(/lm-editor-source-mode/);
  const editorHandle = await editor.elementHandle();
  expect(editorHandle).not.toBeNull();

  await ensureEditorDocument(page);
  await expect(editor).toHaveClass(/lm-editor-source-mode/);

  await page.getByRole('button', { name: '退出专注模式' }).click();
  await expect(shell).not.toHaveClass(/lm-focus-mode/);
  await openSettings(page);
  const dialog = page.getByRole('dialog', { name: '设置' });
  await dialog.getByRole('tab', { name: '编辑器' }).click();
  const focusModeSwitch = dialog.getByRole('switch', {
    name: '启动时进入专注模式',
  });
  await expect(focusModeSwitch).toBeChecked();
  await focusModeSwitch.click();
  await expect(focusModeSwitch).not.toBeChecked();
  const livePreview = dialog.getByRole('radio', { name: '实时预览' });
  await livePreview.click();
  await expect(livePreview).toBeChecked();

  await expect(shell).not.toHaveClass(/lm-focus-mode/);
  await expect(editor).toHaveClass(/lm-editor-source-mode/);
  expect(await editorHandle!.evaluate((element) => element.isConnected)).toBe(
    true,
  );

  await page.keyboard.press('Escape');
  const fileMenu = page.getByRole('menuitem', { exact: true, name: '文件' });
  await fileMenu.focus();
  await fileMenu.press('ArrowDown');
  await page.getByRole('menuitem', { name: '新建文档' }).click();

  await expect(editor).toHaveClass(/lm-editor-live-preview-mode/);
  expect(await editorHandle!.evaluate((element) => element.isConnected)).toBe(
    true,
  );
});

test('captures approved settings panel screenshots', async ({ page }) => {
  await mkdir(reportDirectory, { recursive: true });
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  await openSettings(page);

  await page.screenshot({
    path: resolve(reportDirectory, 'settings-light-zh.png'),
  });

  await closeSettings(page);
  const themeMenu = page.getByRole('menuitem', { exact: true, name: '主题' });
  await themeMenu.click();
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await openSettings(page);
  await page.getByRole('dialog', { name: '设置' }).getByRole('tab', {
    name: '外观',
  }).click();
  await page.screenshot({
    path: resolve(reportDirectory, 'settings-dark-zh.png'),
  });

  await closeSettings(page);
  const languageMenu = page.getByRole('menuitem', { exact: true, name: '语言' });
  await languageMenu.click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await openSettings(page);
  await expectDialogInsideViewport(page);
  await page.screenshot({
    path: resolve(reportDirectory, 'settings-dark-en.png'),
  });

  const startupLabel = page.getByText('When LumaMark starts', { exact: true });
  const labelMetrics = await startupLabel.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  expect(labelMetrics.height).toBeLessThanOrEqual(labelMetrics.lineHeight * 1.25);
  const restoreOption = page.getByRole('radio', {
    name: 'Restore last file or workspace',
  });
  await expect(restoreOption).toHaveCSS('white-space', 'nowrap');
  expect(
    await restoreOption.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test('renders the approved Mica workspace and visual appearance choices', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto('/');
  await openSettings(page);

  const dialog = page.getByRole('dialog', { name: '设置' });
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(920);
  expect(bounds!.height).toBeGreaterThanOrEqual(620);
  await expect(dialog).toHaveCSS('backdrop-filter', /blur\(/);

  await dialog.getByRole('tab', { name: '外观' }).click();
  const themeGroup = dialog.getByRole('radiogroup', { name: '主题' });
  const lightTheme = themeGroup.getByRole('radio', { name: '亮色' });
  await expect(lightTheme).toBeChecked();
  await expect(
    lightTheme.locator('[data-lm-settings-theme-preview]'),
  ).toHaveCount(1);

  const widthGroup = dialog.getByRole('radiogroup', { name: '页面宽度' });
  const fluidWidth = widthGroup.getByRole('radio', { name: '适应窗口' });
  await expect(fluidWidth).toBeChecked();
  await expect(
    fluidWidth.locator('[data-lm-settings-page-width-preview]'),
  ).toHaveCount(1);
});

test('keeps vertical settings usable in a narrow forced-colors viewport', async ({
  page,
}) => {
  await page.setViewportSize({ height: 620, width: 520 });
  await page.emulateMedia({
    forcedColors: 'active',
    reducedMotion: 'reduce',
  });
  await page.goto('/');
  await openSettings(page);

  const dialog = page.getByRole('dialog', { name: /^(?:Settings|设置)$/ });
  await expectDialogInsideViewport(page);
  await expect(dialog.getByRole('tablist')).toHaveAttribute(
    'aria-orientation',
    'vertical',
  );
  const settingsLayout = dialog.locator('.lm-settings-tabs-vertical');
  expect(
    await settingsLayout.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  const activeTab = dialog.getByRole('tab', { selected: true });
  expect(await activeTab.evaluate((element) => getComputedStyle(element).outlineStyle))
    .not.toBe('none');
  const updateSwitch = dialog.getByRole('switch', {
    name: /^(?:Check for updates when LumaMark starts|启动时检查更新)$/,
  });
  await expect(updateSwitch).toBeChecked();
  expect(
    await updateSwitch.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    ),
  ).not.toBe('none');
  await expect(dialog).toHaveCSS('backdrop-filter', 'none');
});

test('traps keyboard focus in the clear recent files confirmation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const storageKey = 'lumamark.recent-files.v1';
    window.localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          name: 'keyboard.md',
          openedAt: 1,
          path: 'E:/notes/keyboard.md',
        },
      ]),
    );

    const originalSetItem = Storage.prototype.setItem;
    Reflect.set(window, '__LUMAMARK_E2E_RECENT_FILE_WRITES__', 0);
    Storage.prototype.setItem = function setItem(key, value) {
      if (key === storageKey) {
        const writes = Number(
          Reflect.get(window, '__LUMAMARK_E2E_RECENT_FILE_WRITES__'),
        );
        Reflect.set(window, '__LUMAMARK_E2E_RECENT_FILE_WRITES__', writes + 1);
      }
      return originalSetItem.call(this, key, value);
    };
  });

  await page.goto('/');
  await openSettings(page);

  const settingsDialog = page.getByRole('dialog', {
    name: /^(?:Settings|设置)$/,
  });
  const trigger = settingsDialog.getByRole('button', {
    name: /^(?:Clear recent files|清空最近文件)$/,
  });
  await trigger.press('Enter');

  const confirmation = page.getByRole('alertdialog', {
    name: /^(?:Clear recent files|清空最近文件)$/,
  });
  const cancel = confirmation.getByRole('button', {
    name: /^(?:Cancel|取消)$/,
  });
  const confirm = confirmation.getByRole('button', {
    name: /^(?:Clear|清空)$/,
  });
  await expect(cancel).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(settingsDialog).toBeVisible();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(confirmation).toBeHidden();
  await expect(settingsDialog).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        recentFiles: window.localStorage.getItem('lumamark.recent-files.v1'),
        writes: Reflect.get(
          window,
          '__LUMAMARK_E2E_RECENT_FILE_WRITES__',
        ),
      })),
    )
    .toEqual({ recentFiles: '[]', writes: 1 });
});
