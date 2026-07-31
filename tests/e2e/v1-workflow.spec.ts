import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const fixturePath = 'E:/lumamark-fixtures/v1.md';
const saveAsPath = 'E:/lumamark-fixtures/v1-copy.md';
const fixtureText = [
  '# Fixture Title',
  '',
  '- [ ] existing task',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  'After diagram',
].join('\n');

test('covers the V1 open edit save save-as mermaid language and theme workflow', async ({
  page,
}) => {
  const storageKey = `lumamark-e2e-files-${Date.now()}`;

  await page.addInitScript(
    ({ path, saveAsPath, storageKey, text }) => {
      const persistedFiles = JSON.parse(
        localStorage.getItem(storageKey) ?? '{}',
      ) as Record<string, string>;
      const files: Record<string, string> = {
        [path]: text,
        ...persistedFiles,
      };
      const state = {
        files,
        lastWrite: null as null | { path: string; text: string },
      };
      const byteLength = (value: string) => new TextEncoder().encode(value).length;
      const persist = () => {
        localStorage.setItem(storageKey, JSON.stringify(files));
      };

      window.__LUMAMARK_E2E_STATE__ = state;
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (filePath: string) => {
          const source = files[filePath] ?? '';

          return {
            ok: true,
            data: {
              byteLength: byteLength(source),
              path: filePath,
              text: source,
            },
          };
        },
        showOpenDialog: async () => ({
          ok: true,
          data: path,
        }),
        showSaveDialog: async () => ({
          ok: true,
          data: saveAsPath,
        }),
        writeText: async (filePath: string, nextText: string) => {
          files[filePath] = nextText;
          persist();
          state.lastWrite = {
            path: filePath,
            text: nextText,
          };

          return {
            ok: true,
            data: {
              byteLength: byteLength(nextText),
              path: filePath,
            },
          };
        },
      };
    },
    {
      path: fixturePath,
      saveAsPath,
      storageKey,
      text: fixtureText,
    },
  );

  await page.goto('/');

  await clickFirstVisibleMenuItem(page, ['视图', 'View']);
  await clickFirstVisibleMenuItem(page, ['设置', 'Settings']);
  await page.getByRole('tab', { name: '语言' }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Settings' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('menuitem', { name: 'File' })).toBeVisible();

  await page.keyboard.press('Control+O');
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('Fixture Title');
  await page.getByRole('tab', { name: 'Outline' }).click();
  await expect(page.getByRole('button', { name: 'Fixture Title' })).toBeVisible();
  await expect(page.locator('.lm-mermaid-svg svg')).toBeVisible();

  await editor.click();
  await page.keyboard.type('\n\n# V1 E2E Title\n\n- [ ] verified task');
  await expect(page.locator('.lm-md-heading-1').last()).toContainText(
    'V1 E2E Title',
  );
  await expect(page.getByRole('button', { name: 'V1 E2E Title' })).toBeVisible();
  await page.locator('.cm-line', { hasText: 'V1 E2E Title' }).click();
  const verifiedTaskCheckbox = page
    .locator('.cm-line', { hasText: 'verified task' })
    .locator('.lm-md-task-checkbox');
  await verifiedTaskCheckbox.click();
  await expect(verifiedTaskCheckbox).toBeChecked();

  await page.keyboard.press('Control+S');
  await expect(page.getByRole('status')).toHaveText('Saved');
  let saved = await page.evaluate(() => window.__LUMAMARK_E2E_STATE__?.lastWrite);
  expect(saved?.path).toBe(fixturePath);
  expect(saved?.text).toContain('# V1 E2E Title');
  expect(saved?.text).toContain('- [x] verified task');
  expect(saved?.text).toContain('```mermaid');
  expect(saved?.text).toContain('flowchart TD');
  expect(saved?.text).toContain('A --> B');

  await page.keyboard.press('Control+Shift+S');
  await expect(page.getByRole('status')).toHaveText('Saved');
  saved = await page.evaluate(() => window.__LUMAMARK_E2E_STATE__?.lastWrite);
  expect(saved?.path).toBe(saveAsPath);
  expect(saved?.text).toContain('# V1 E2E Title');
  await expect(page.locator('.lm-editor-title')).toHaveText('v1-copy.md');

  await editor.click();
  await page.keyboard.type('\n\n# Save As Current File');
  await runFileMenuAction(page, 'save');
  await expect(page.getByRole('status')).toHaveText('Saved');
  saved = await page.evaluate(() => window.__LUMAMARK_E2E_STATE__?.lastWrite);
  expect(saved?.path).toBe(saveAsPath);
  expect(saved?.text).toContain('# Save As Current File');

  const savedFiles = await page.evaluate(
    ({ originalPath, savedAsPath }) => {
      const files = window.__LUMAMARK_E2E_STATE__?.files ?? {};

      return {
        copy: files[savedAsPath],
        original: files[originalPath],
      };
    },
    {
      originalPath: fixturePath,
      savedAsPath: saveAsPath,
    },
  );
  expect(savedFiles.original).toContain('# V1 E2E Title');
  expect(savedFiles.original).not.toContain('# Save As Current File');
  expect(savedFiles.copy).toContain('# Save As Current File');

  await page.reload();
  await runFileMenuAction(page, 'openFile');
  await expect(editor).toContainText('Fixture Title');
  await expect(editor).toContainText('V1 E2E Title');
  await expect(editor).not.toContainText('Save As Current File');
  await expect(page.locator('.lm-mermaid-svg svg')).toBeVisible();

  await clickFirstVisibleMenuItem(page, ['View', '视图']);
  await clickFirstVisibleMenuItem(page, ['Source Mode', '源码模式']);
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await expect(editor).toContainText('flowchart TD');
  await expect(editor).toContainText('A --> B');

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('# temporary overwrite');
  await runFileMenuAction(page, 'openFile');

  await expect(editor).toContainText('Fixture Title');
  await expect(editor).toContainText('V1 E2E Title');
  await expect(editor).not.toContainText('temporary overwrite');
});

test('reopens a recent file from the files sidebar', async ({ page }) => {
  const path = 'E:/lumamark-fixtures/recent.md';
  const text = '# Recent document';

  await page.addInitScript(
    ({ path, text }) => {
      const byteLength = (value: string) => new TextEncoder().encode(value).length;

      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (filePath: string) => ({
          ok: true,
          data: {
            byteLength: byteLength(text),
            path: filePath,
            text,
          },
        }),
        showOpenDialog: async () => ({ ok: true, data: path }),
        showSaveDialog: async () => ({ ok: true, data: null }),
        writeText: async () => ({
          ok: false,
          error: {
            code: 'not-needed',
            message: 'Not needed for this test',
            recoverable: true,
          },
        }),
      };
    },
    { path, text },
  );
  await page.goto('/');

  await runFileMenuAction(page, 'openFile');
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('Recent document');
  await expect(page.getByRole('button', { name: 'recent.md' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'recent.md' })).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('# Temporary overwrite');
  await page.getByRole('button', { name: 'recent.md' }).click();

  await expect(editor).toContainText('Recent document');
  await expect(editor).not.toContainText('Temporary overwrite');
});

test('keeps the current draft and explains a failed file open', async ({ page }) => {
  const missingPath = 'E:/lumamark-fixtures/missing.md';

  await page.addInitScript((path) => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async () => ({
        ok: false,
        error: {
          code: 'file.not_found',
          message: 'File was not found.',
          recoverable: true,
        },
      }),
      showOpenDialog: async () => ({ ok: true, data: path }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async () => ({
        ok: false,
        error: {
          code: 'not-needed',
          message: 'Not needed for this test',
          recoverable: true,
        },
      }),
    };
  }, missingPath);
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('保留草稿');

  await runFileMenuAction(page, 'openFile');

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('找不到该文件');
  await expect(alert).toContainText('当前文档内容未被更改。');
  await expect(editor).toContainText('保留草稿');

  await alert.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(alert).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('未保存');
});

test('creates a new document only after confirming discarded changes', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('draft');

  await page.keyboard.press('Control+N');
  await expect(
    page.getByRole('dialog', { name: '放弃未保存的修改？' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(editor).toContainText('draft');

  await clickFirstVisibleMenuItem(page, ['文件', 'File']);
  await clickFirstVisibleMenuItem(page, ['新建文档', 'New Document']);
  await page.getByRole('button', { name: '放弃修改' }).click();

  await expect(editor).toHaveText('');
  await expect(page.locator('.lm-editor-title')).toHaveText('未命名');
});

test('creates a new document from the command palette through the same confirmation flow', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('draft');
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '新建文档' }).click();

  await expect(
    page.getByRole('dialog', { name: '放弃未保存的修改？' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '放弃修改' }).click();
  await expect(editor).toHaveText('');
});

async function runFileMenuAction(
  page: Page,
  actionName: 'openFile' | 'save' | 'saveAs',
) {
  await clickFirstVisibleMenuItem(page, ['File', '文件']);
  await clickFirstVisibleMenuItem(
    page,
    {
      openFile: ['Open File', '打开文件'],
      save: ['Save', '保存'],
      saveAs: ['Save As', '另存为'],
    }[actionName],
  );
}

async function clickFirstVisibleMenuItem(page: Page, names: string[]) {
  for (const name of names) {
    const item = page.getByRole('menuitem', { exact: true, name }).first();
    try {
      await expect(item).toBeVisible({ timeout: 2_000 });
      await item.click();
      return;
    } catch {
      // Try the next localized label.
    }
  }

  throw new Error(`Unable to find a visible menu item: ${names.join(' / ')}`);
}
