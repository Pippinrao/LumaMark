import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const reportDirectory = resolve('artifacts/menu-system-report');
const packageVersion = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8'),
).version as string;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'lumamark.recent-files.v1',
      JSON.stringify([
        {
          name: 'Recent menu note.md',
          openedAt: 1_700_000_000_000,
          path: 'E:/notes/recent-menu-note.md',
        },
      ]),
    );
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => ({
        ok: true,
        data: {
          byteLength: 20,
          path,
          text: '# Opened from recent',
        },
      }),
      showOpenDialog: async () => ({ ok: true, data: null }),
      showOpenImageDialog: async () => ({
        ok: true,
        data: ['C:\\Pictures\\menu-cover.png'],
      }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => ({
        ok: true,
        data: { byteLength: text.length, path },
      }),
    };
  });
});

test('executes menu state, recent-file, and About workflows end to end', async ({
  page,
}) => {
  await page.goto('/');

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

  await openTopMenu(page, '视图');
  await expect(
    page.getByRole('menuitemradio', { name: /^实时预览/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByRole('menuitemradio', { name: /^源码模式/ }),
  ).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.getByRole('menuitemcheckbox', { name: /^切换侧边栏/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '视图', exact: true })).toBeFocused();

  await openTopMenu(page, '主题');
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('menuitem', { name: '主题', exact: true })).toBeFocused();

  await openTopMenu(page, '语言');
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible();

  await openTopMenu(page, 'File');
  const recentFiles = page.getByRole('menuitem', { name: 'Recent Files' });
  await recentFiles.hover();
  await page.getByRole('menuitem', { name: 'Recent menu note.md' }).click();
  await expect(page.locator('.cm-content')).toContainText('# Opened from recent');

  await openTopMenu(page, 'Help');
  await page.getByRole('menuitem', { name: 'About LumaMark' }).click();
  const about = page.getByRole('dialog', { name: 'About LumaMark' });
  await expect(about).toBeVisible();
  await expect(about).toContainText(packageVersion);
  await expect(about).toContainText('A high-performance Typora-like Markdown editor');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('menuitem', { name: 'Help', exact: true })).toBeFocused();
});

test('returns editor focus after menu formatting and keeps one-step undo', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.locator('.cm-content');

  await replaceEditorText(page, editor, 'focus contract');
  await editor.press('Control+A');
  await openTopMenu(page, '格式');
  await page.getByRole('menuitem', { name: /^加粗/ }).click();

  await expect(editor).toBeFocused();
  await expect(editor).toContainText('**focus contract**');
  await editor.press('Control+Z');
  await expect(editor).toHaveText('focus contract');
});

test('returns to the File trigger when cancelling dirty new-document confirmation', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.locator('.cm-content');

  await replaceEditorText(page, editor, 'keep this draft');
  await openTopMenu(page, '文件');
  await page.getByRole('menuitem', { name: /^新建文档/ }).click();
  await page.getByRole('button', { name: '取消' }).click();

  await expect(editor).toHaveText('keep this draft');
  await expect(page.getByRole('menuitem', { exact: true, name: '文件' })).toBeFocused();
});

test('keeps editor focus after confirming dirty new-document creation', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.locator('.cm-content');

  await replaceEditorText(page, editor, 'discard this draft');
  await openTopMenu(page, '文件');
  await page.getByRole('menuitem', { name: /^新建文档/ }).click();
  await page.getByRole('button', { name: '放弃修改' }).click();

  await expect(editor).toHaveText('');
  await expect(editor).toBeFocused();
});

test('routes Typora-aligned and migration shortcuts to real editor commands', async ({
  page,
}) => {
  await page.goto('/');
  const editor = page.locator('.cm-content');

  await replaceEditorText(page, editor, 'palette code');
  await page.keyboard.press('Control+K');
  const paletteInput = page.locator('.lm-command-palette-input');
  await paletteInput.fill('代码块');
  await page.getByRole('option', { name: /代码块/ }).click();
  await expect(editor).toContainText('```');
  await editor.press('Control+Z');
  await expect(editor).toHaveText('palette code');

  await replaceEditorText(page, editor, 'const answer = 42');
  await page.keyboard.press('Control+Shift+K');
  await page.keyboard.press('Control+/');
  await expect(editor).toContainText('```');
  await expect(editor).toContainText('const answer = 42');

  await replaceEditorText(page, editor, 'before');
  await page.keyboard.press('Control+T');
  await expect(editor).toContainText('| - | - |');

  await replaceEditorText(page, editor, 'legacy');
  await page.keyboard.press('Control+Alt+T');
  await expect(editor).toContainText('| - | - |');

  await replaceEditorText(page, editor, 'image');
  await page.keyboard.press('Control+Shift+I');
  await expect(editor).toContainText(
    '![menu-cover.png](C:\\Pictures\\menu-cover.png)',
  );
});

test('captures the approved light, dark, nested, and English menu states', async ({
  page,
}) => {
  await mkdir(reportDirectory, { recursive: true });
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto('/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);

  await openTopMenu(page, '文件');
  await expect(page.locator('.lm-menu-content')).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'menu-light-file-zh.png'),
  });

  await page.keyboard.press('Escape');
  await openTopMenu(page, '主题');
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await openTopMenu(page, '视图');
  await expect(
    page.getByRole('menuitemcheckbox', { name: /^切换侧边栏/ }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'menu-dark-view-states-zh.png'),
  });

  await page.keyboard.press('Escape');
  await openTopMenu(page, '段落');
  const insert = page.getByRole('menuitem', { name: '插入' });
  await insert.press('ArrowRight');
  await expect(
    page.getByRole('menuitem', { name: /^表格\s*Ctrl\+T$/ }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'menu-dark-nested-keyboard-zh.png'),
  });

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await openTopMenu(page, '语言');
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await openTopMenu(page, 'File');
  await expect(page.getByRole('menuitem', { name: /^Open File/ })).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'menu-dark-file-en.png'),
  });
});

async function openTopMenu(page: Page, name: string): Promise<void> {
  const trigger = page.getByRole('menuitem', { exact: true, name });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(trigger).toHaveAttribute('data-state', 'open');
}

async function replaceEditorText(
  page: Page,
  editor: ReturnType<Page['locator']>,
  text: string,
): Promise<void> {
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(text);
}
