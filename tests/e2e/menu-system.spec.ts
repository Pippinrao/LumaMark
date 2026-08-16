import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { verifyPackagedMenuWorkflows } from '../../scripts/release/packagedMenuVerification.mjs';

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

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  const newDocumentButton = page.getByRole('button', {
    name: /^(?:New Document|新建文档)$/,
  });

  await newDocumentButton.click();
  await expect(newDocumentButton).toBeHidden();
}

test('executes menu state, recent-file, and About workflows end to end', async ({
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

  await openTopMenu(page, '视图');
  await expect(
    page.getByRole('menuitemradio', { name: /^实时预览/ }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(
    page.getByRole('menuitemradio', { name: /^源码模式/ }),
  ).toHaveAttribute('aria-checked', 'false');
  await expect(
    page.getByRole('menuitemradio', { name: /^阅读模式/ }),
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
  await expect(about).toContainText('A modern, high-performance Markdown editor');
  await expect(about).not.toContainText(/typora/i);
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('menuitem', { name: 'Help', exact: true })).toBeFocused();

  await openTopMenu(page, 'Theme');
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await openTopMenu(page, 'Language');
  await page.getByRole('menuitemradio', { name: '简体中文' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await openTopMenu(page, '视图');
  await page.getByRole('menuitem', { name: '聚焦编辑器' }).click();
  await expect(page.locator('.cm-content').first()).toBeFocused();
});

test('opens the check-for-updates dialog from the Help menu', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await openTopMenu(page, '帮助');
  await page.getByRole('menuitem', { name: '检查更新' }).click();

  const dialog = page.getByRole('dialog', { name: '检查更新' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(packageVersion);
  await expect(dialog).toContainText('应用内更新仅在已安装的桌面应用中可用');
  await dialog.locator('.lm-dialog-actions').getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
});

test('persists language and theme after a mouse-only menu workflow', async ({
  page,
}) => {
  await openNewDocument(page);
  await verifyPackagedMenuWorkflows(page);
});

test('returns editor focus after menu formatting and keeps one-step undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
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

test('executes every Paragraph menu command against the real editor', async ({
  page,
}) => {
  await openNewDocument(page);
  const editor = page.locator('.cm-content').first();

  const lineCommands = [
    ['普通段落', '### Title', 'Title'],
    ['标题 1', 'Title', '# Title'],
    ['标题 2', 'Title', '## Title'],
    ['标题 3', 'Title', '### Title'],
    ['标题 4', 'Title', '#### Title'],
    ['标题 5', 'Title', '##### Title'],
    ['标题 6', 'Title', '###### Title'],
  ] as const;

  for (const [item, source, expected] of lineCommands) {
    await replaceEditorText(page, editor, source);
    await runNestedMenuAction(page, '段落', [], item);
    await expect(editor).toHaveText(expected);
    await expect(editor).toBeFocused();
  }

  const nestedLineCommands = [
    ['列表', '有序列表', 'item', '1. item'],
    ['列表', '无序列表', 'item', '- item'],
    ['列表', '任务列表', 'item', '- [ ] item'],
    ['块', '引用', 'quote', '> quote'],
  ] as const;

  for (const [submenu, item, source, expected] of nestedLineCommands) {
    await replaceEditorText(page, editor, source);
    await runNestedMenuAction(page, '段落', [submenu], item);
    await expect(editor).toHaveText(expected);
    await expect(editor).toBeFocused();
  }

  await replaceEditorText(page, editor, 'const value = 1');
  await runNestedMenuAction(page, '段落', ['块'], '代码块');
  await page.keyboard.press('Control+/');
  await expect(editor).toContainText('```');
  await expect(editor).toContainText('const value = 1');

  await replaceEditorText(page, editor, 'before');
  await runNestedMenuAction(page, '段落', ['插入'], '表格');
  await expect(editor).toContainText('| - | - |');

  await replaceEditorText(page, editor, 'Before');
  await runNestedMenuAction(page, '段落', ['插入'], '分割线');
  await expect(editor).toContainText('---');
});

test('executes every Format menu command against the real editor', async ({
  page,
}) => {
  await openNewDocument(page);
  const editor = page.locator('.cm-content');
  const formatCommands = [
    ['加粗', '**plain**'],
    ['斜体', '*plain*'],
    ['删除线', '~~plain~~'],
    ['行内代码', '`plain`'],
    ['链接', '[plain]()'],
  ] as const;

  for (const [item, expected] of formatCommands) {
    await replaceEditorText(page, editor, 'plain');
    await editor.press('Control+A');
    await runNestedMenuAction(page, '格式', [], item);
    await expect(editor).toHaveText(expected);
    await expect(editor).toBeFocused();
  }

  await replaceEditorText(page, editor, '');
  await runNestedMenuAction(page, '格式', [], '图片');
  await page.keyboard.press('Control+/');
  await expect(editor).toContainText(
    '![menu-cover.png](C:\\Pictures\\menu-cover.png)',
  );
});

test('executes every Markdown shortcut advertised by the menu', async ({
  page,
}) => {
  await openNewDocument(page);
  const editor = page.locator('.cm-content').first();
  const shortcuts = [
    ['Control+0', '### Title', 'Title'],
    ['Control+1', 'Title', '# Title'],
    ['Control+2', 'Title', '## Title'],
    ['Control+3', 'Title', '### Title'],
    ['Control+4', 'Title', '#### Title'],
    ['Control+5', 'Title', '##### Title'],
    ['Control+6', 'Title', '###### Title'],
    ['Control+B', 'plain', '**plain**'],
    ['Control+I', 'plain', '*plain*'],
  ] as const;

  for (const [shortcut, source, expected] of shortcuts) {
    await replaceEditorText(page, editor, source);
    if (shortcut === 'Control+B' || shortcut === 'Control+I') {
      await editor.press('Control+A');
    }
    await editor.press(shortcut);
    await expect(editor).toHaveText(expected);
  }

  await replaceEditorText(page, editor, 'code');
  await editor.press('Control+Shift+K');
  await page.keyboard.press('Control+/');
  await expect(editor).toContainText('```');
  await expect(editor).toContainText('code');

  await replaceEditorText(page, editor, 'before');
  await editor.press('Control+T');
  await expect(editor).toContainText('| - | - |');

  await replaceEditorText(page, editor, '');
  await editor.press('Control+Shift+I');
  await expect(editor).toContainText(
    '![menu-cover.png](C:\\Pictures\\menu-cover.png)',
  );
});

test('returns to the File trigger when cancelling dirty new-document confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
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
  await page.getByRole('button', { name: '新建文档' }).click();
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
  await page.getByRole('button', { name: '新建文档' }).click();
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
  await page.getByRole('button', { name: '新建文档' }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);

  await openTopMenu(page, '文件');
  await expect(page.locator('.lm-menu-content')).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'menu-light-file-zh.png'),
  });

  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('menuitem', { exact: true, name: '文件' }),
  ).toBeFocused();
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
  await expect(
    page.getByRole('menuitem', { exact: true, name: '视图' }),
  ).toBeFocused();
  await openTopMenu(page, '段落');
  await expect(
    page.getByRole('menuitem', { name: /^普通段落\s/ }),
  ).toBeFocused();
  const insert = page.getByRole('menuitem', { name: '插入' });
  await page.keyboard.press('End');
  await expect(insert).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const table = page.getByRole('menuitem', { name: /^表格\s*Ctrl\+T$/ });
  await expect(table).toBeVisible();
  await page.screenshot({
    path: resolve(reportDirectory, 'menu-dark-nested-keyboard-zh.png'),
  });

  await page.keyboard.press('Escape');
  await expect(table).toBeHidden();
  const paragraph = page.getByRole('menuitem', {
    exact: true,
    name: '段落',
  });
  if ((await paragraph.getAttribute('data-state')) === 'open') {
    await expect(insert).toBeFocused();
    await insert.press('Escape');
  }
  await expect(paragraph).toHaveAttribute('data-state', 'closed');
  await expect(paragraph).toBeFocused();
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

async function runNestedMenuAction(
  page: Page,
  topMenu: string,
  submenus: readonly string[],
  item: string,
): Promise<void> {
  await openTopMenu(page, topMenu);

  for (const submenuName of submenus) {
    const submenu = page.getByRole('menuitem', {
      exact: true,
      name: submenuName,
    });
    await submenu.hover();
  }

  await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
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
