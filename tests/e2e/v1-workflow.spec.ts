import { expect, test } from '@playwright/test';

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

  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('tab', { name: '语言' }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Settings' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Open File' })).toBeVisible();

  await page.getByRole('button', { name: 'Open File' }).click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('Fixture Title');
  await expect(page.getByRole('button', { name: 'Fixture Title' })).toBeVisible();
  await expect(page.locator('.lm-mermaid-svg svg')).toBeVisible();

  await editor.click();
  await page.keyboard.type('\n\n# V1 E2E Title\n\n- [ ] verified task');
  await expect(page.locator('.lm-md-heading-1').last()).toContainText(
    'V1 E2E Title',
  );
  await expect(page.getByRole('button', { name: 'V1 E2E Title' })).toBeVisible();
  await page.locator('.lm-md-task-checkbox').last().click();
  await expect(editor).toContainText('- [x] verified task');

  await page.getByRole('button', { exact: true, name: 'Save' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  let saved = await page.evaluate(() => window.__LUMAMARK_E2E_STATE__?.lastWrite);
  expect(saved?.path).toBe(fixturePath);
  expect(saved?.text).toContain('# V1 E2E Title');
  expect(saved?.text).toContain('- [x] verified task');
  expect(saved?.text).toContain('```mermaid');
  expect(saved?.text).toContain('flowchart TD');
  expect(saved?.text).toContain('A --> B');

  await page.getByRole('button', { name: 'Save As' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved');
  saved = await page.evaluate(() => window.__LUMAMARK_E2E_STATE__?.lastWrite);
  expect(saved?.path).toBe(saveAsPath);
  expect(saved?.text).toContain('# V1 E2E Title');
  await expect(page.locator('.lm-document-title')).toHaveText('v1-copy.md');

  await editor.click();
  await page.keyboard.type('\n\n# Save As Current File');
  await page.getByRole('button', { exact: true, name: 'Save' }).click();
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
  await page.getByRole('button', { name: '打开文件' }).click();
  await expect(editor).toContainText('Fixture Title');
  await expect(editor).toContainText('V1 E2E Title');
  await expect(editor).not.toContainText('Save As Current File');
  await expect(editor).toContainText('flowchart TD');
  await expect(editor).toContainText('A --> B');
  await expect(page.locator('.lm-mermaid-svg svg')).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('# temporary overwrite');
  await page.getByRole('button', { name: '打开文件' }).click();

  await expect(editor).toContainText('Fixture Title');
  await expect(editor).toContainText('V1 E2E Title');
  await expect(editor).not.toContainText('temporary overwrite');
});
