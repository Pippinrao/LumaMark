import { expect, test, type Locator, type Page } from '@playwright/test';
import { tinySvgDataUrl } from './fixtures/livePreviewData';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe.configure({ mode: 'serial' });

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
}

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  const newDocumentButton = page.getByRole('button', {
    name: /^(?:New Document|新建文档)$/,
  });

  await newDocumentButton.click();
  await expect(newDocumentButton).toBeHidden();
}

async function transformMatrix(media: Locator): Promise<string> {
  return media.evaluate((element) => getComputedStyle(element).transform);
}

test('expands, zooms, resets, and closes an image without changing Markdown', async ({
  page,
}) => {
  await openNewDocument(page);
  const source = [`![Fixture](${tinySvgDataUrl})`, '', 'after'].join('\n');
  await replaceEditorSource(page, source);
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-image-preview');
  await expect(preview.getByRole('img', { name: 'Fixture' })).toBeVisible();
  await preview.hover();
  const expand = preview.getByRole('button', { name: '展开查看' });
  await expect(expand).toBeVisible();
  await expand.click();

  const dialog = page.getByRole('dialog', { name: '图片查看器' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Fixture' })).toBeVisible();
  const transformed = dialog.locator('.lm-media-viewer-transform-content');
  const initialTransform = await transformMatrix(transformed);
  await dialog.getByRole('button', { name: '放大' }).click();
  await expect.poll(() => transformMatrix(transformed)).not.toBe(initialTransform);
  await dialog.getByRole('button', { name: '重置缩放' }).click();
  await expect.poll(() => transformMatrix(transformed)).toBe(initialTransform);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeFocused();

  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-source-mode .cm-line')).toHaveText(
    source.split('\n'),
  );
});

test('expands the exact Mermaid SVG without scheduling another render', async ({
  page,
}) => {
  await openNewDocument(page);
  const source = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n');
  await replaceEditorSource(page, source);
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-mermaid-preview');
  const renderedSvg = preview.locator('.lm-mermaid-svg > svg');
  await expect(renderedSvg).toBeVisible();
  const originalMarkup = await preview.locator('.lm-mermaid-svg').innerHTML();
  await preview.hover();
  const expand = preview.getByRole('button', { name: '展开查看' });
  await expand.click();

  const dialog = page.getByRole('dialog', { name: '图片查看器' });
  await expect(dialog.locator('.lm-media-viewer-mermaid > svg')).toBeVisible();
  await expect(dialog.locator('.lm-media-viewer-mermaid')).toHaveJSProperty(
    'innerHTML',
    originalMarkup,
  );
  await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeFocused();
  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-source-mode .cm-line')).toHaveText(
    source.split('\n'),
  );
});
