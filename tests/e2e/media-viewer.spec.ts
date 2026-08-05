import { expect, test, type Locator, type Page } from '@playwright/test';
import { tinySvgDataUrl } from './fixtures/livePreviewData';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const imageMarkdown = [
  `![Keyboard zoom target](${tinySvgDataUrl})`,
  '',
  'after',
].join('\n');
const wideSvgDataUrl =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="240" viewBox="0 0 2400 240"><rect width="2400" height="240" fill="#173d5f"/><path d="M80 120h2240" stroke="#f2c94c" stroke-width="20"/></svg>',
  );

async function openMarkdown(page: Page, markdown: string): Promise<Locator> {
  await page.goto('/');
  await page.getByRole('button', { name: /^(?:New Document|新建文档)$/ }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(markdown);
  await page.locator('.cm-line').last().click();
  return editor;
}

async function expectExpandAnchoredToMedia(image: Locator): Promise<void> {
  const preview = image.locator('xpath=ancestor::figure');
  const expand = preview.getByRole('button', {
    name: /^(?:Expand preview|展开查看)$/,
  });
  await image.hover();
  await expect(expand).toBeVisible();

  await expect
    .poll(async () => {
      const imageBox = await image.boundingBox();
      const buttonBox = await expand.boundingBox();
      if (!imageBox || !buttonBox) {
        return null;
      }

      return {
        rightInset: Math.round(
          imageBox.x + imageBox.width - (buttonBox.x + buttonBox.width),
        ),
        topInset: Math.round(buttonBox.y - imageBox.y),
      };
    })
    .toEqual({ rightInset: 8, topInset: 8 });
}

async function openImageViewer(page: Page): Promise<{
  dialog: Locator;
  expand: Locator;
  image: Locator;
}> {
  await openMarkdown(
    page,
    imageMarkdown,
  );
  const image = page.getByRole('img', { name: 'Keyboard zoom target' });
  await expect(image).toBeVisible();
  const preview = image.locator('xpath=ancestor::figure');
  await image.hover();
  const expand = preview.getByRole('button', { name: '展开查看' });
  await expand.focus();
  await expect(expand).toBeFocused();
  await expand.click();

  const dialog = page.getByRole('dialog', { name: '图片查看器' });
  await expect(dialog).toBeVisible();
  return { dialog, expand, image };
}

test('anchors image expand actions to the visible media after scrolling and resize', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  await openMarkdown(
    page,
    [
      '# Media geometry',
      '',
      `![A deliberately long caption around a small image](${tinySvgDataUrl})`,
      '',
      ...Array.from({ length: 18 }, (_, index) => `paragraph ${index}`),
      '',
      `![Ultra wide](${wideSvgDataUrl})`,
      '',
      'after',
    ].join('\n'),
  );

  const smallImage = page.getByRole('img', {
    name: 'A deliberately long caption around a small image',
  });
  const wideImage = page.getByRole('img', { name: 'Ultra wide' });
  await expect(smallImage).toBeVisible();
  await expectExpandAnchoredToMedia(smallImage);

  await wideImage.scrollIntoViewIfNeeded();
  await expect(wideImage).toBeVisible();
  await expectExpandAnchoredToMedia(wideImage);

  await page.locator('.cm-scroller').evaluate((scroller) => {
    scroller.scrollTop = Math.max(0, scroller.scrollTop - 48);
  });
  await expectExpandAnchoredToMedia(wideImage);

  await page.setViewportSize({ width: 820, height: 640 });
  await wideImage.scrollIntoViewIfNeeded();
  await expectExpandAnchoredToMedia(wideImage);

  const renderedWidth = await wideImage.evaluate(
    (image) => image.getBoundingClientRect().width,
  );
  expect(renderedWidth).toBeLessThan(2400);
  expect(renderedWidth).toBeGreaterThan(100);
});

test('clamps image zoom across keyboard, wheel, and toolbar paths and restores focus', async ({
  page,
}) => {
  const { dialog, expand } = await openImageViewer(page);
  const zoomLevel = dialog.getByRole('status', { name: '缩放比例' });
  const zoomIn = dialog.getByRole('button', { name: '放大' });
  const zoomOut = dialog.getByRole('button', { name: '缩小' });
  const reset = dialog.getByRole('button', { name: '重置缩放' });
  const close = dialog.getByRole('button', { name: '关闭' });

  await expect(zoomLevel).toHaveText('100%');
  await expect(zoomOut).toBeFocused();
  await expect(zoomIn).toHaveAttribute('aria-keyshortcuts', '+');
  await expect(zoomOut).toHaveAttribute('aria-keyshortcuts', '-');
  await expect(reset).toHaveAttribute('aria-keyshortcuts', '0');

  await page.keyboard.press('Shift+Equal');
  await expect(zoomLevel).toHaveText('150%');
  await page.keyboard.press('Digit0');
  await expect(zoomLevel).toHaveText('100%');

  for (let percent = 150; percent <= 800; percent += 50) {
    await zoomIn.click();
    await expect(zoomLevel).toHaveText(`${percent}%`);
  }
  await expect(zoomLevel).toHaveText('800%');
  await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');

  for (let percent = 750; percent >= 50; percent -= 50) {
    await zoomOut.click();
    await expect(zoomLevel).toHaveText(`${percent}%`);
  }
  await zoomOut.click();
  await expect(zoomLevel).toHaveText('25%');
  await expect(zoomOut).toHaveAttribute('aria-disabled', 'true');

  await reset.click();
  await expect(zoomLevel).toHaveText('100%');

  await page.setViewportSize({ width: 840, height: 620 });
  await expect(dialog).toBeVisible();
  const viewerImageBox = await dialog.locator('img').boundingBox();
  expect(viewerImageBox).not.toBeNull();
  expect(viewerImageBox!.width).toBeLessThanOrEqual(840);
  expect(viewerImageBox!.height).toBeLessThanOrEqual(620);
  const canvas = dialog.locator('.lm-media-viewer-transform');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(
    canvasBox!.x + canvasBox!.width / 2,
    canvasBox!.y + canvasBox!.height / 2,
  );
  await page.mouse.wheel(0, -240);
  await expect(zoomLevel).not.toHaveText('100%');
  await reset.click();
  await expect(zoomLevel).toHaveText('100%');

  await zoomOut.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(zoomOut).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(zoomLevel).toHaveText('100%');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-source-mode .cm-line')).toHaveText(
    imageMarkdown.split('\n'),
  );
});

test('localizes viewer controls and keeps them usable across theme changes', async ({
  page,
}) => {
  const { dialog } = await openImageViewer(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await dialog.getByRole('button', { name: '关闭' }).click();

  await page.getByRole('menuitem', { name: '主题', exact: true }).click();
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('menuitem', { name: '语言', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  const image = page.getByRole('img', { name: 'Keyboard zoom target' });
  await image.hover();
  const expand = image
    .locator('xpath=ancestor::figure')
    .getByRole('button', { name: 'Expand preview' });
  await expand.click();

  const englishDialog = page.getByRole('dialog', { name: 'Media viewer' });
  await expect(englishDialog.getByRole('button', { name: 'Zoom in' })).toHaveAttribute(
    'title',
    'Zoom in',
  );
  await expect(
    englishDialog.getByRole('button', { name: 'Zoom out' }),
  ).toBeVisible();
  await expect(
    englishDialog.getByRole('button', { name: 'Reset zoom' }),
  ).toBeVisible();
  await expect(
    englishDialog.getByRole('status', { name: 'Zoom level' }),
  ).toHaveText('100%');
});

test('opens the exact asynchronously rendered Mermaid SVG in the shared zoom viewer', async ({
  page,
}) => {
  const source = [
    '```mermaid',
    'flowchart LR',
    '  SOURCE_NODE --> RENDERED_NODE',
    '```',
    '',
    'after',
  ].join('\n');
  await openMarkdown(page, source);

  const preview = page.locator('.lm-mermaid-preview[data-status="success"]');
  const renderedSvg = preview.locator('.lm-mermaid-svg > svg');
  await expect(renderedSvg).toBeVisible();
  const renderedMarkup = await renderedSvg.evaluate((svg) => svg.outerHTML);

  await preview.hover();
  const expand = preview.getByRole('button', { name: '展开查看' });
  await expect(expand).toBeVisible();
  await expand.focus();
  await expect(expand).toBeFocused();
  await expand.click();

  const dialog = page.getByRole('dialog', { name: '图片查看器' });
  const viewerSvg = dialog.locator('.lm-media-viewer-mermaid > svg');
  await expect(viewerSvg).toBeVisible();
  await expect(dialog.locator('img')).toHaveCount(0);
  expect(await viewerSvg.evaluate((svg) => svg.outerHTML)).toBe(renderedMarkup);
  await expect(dialog).not.toContainText('```mermaid');
  await expect(dialog).not.toContainText('正在渲染 Mermaid');

  const zoomLevel = dialog.getByRole('status', { name: '缩放比例' });
  await expect(zoomLevel).toHaveText('100%');
  await page.keyboard.press('Shift+Equal');
  await expect(zoomLevel).toHaveText('150%');
  await dialog.getByRole('button', { name: '重置缩放' }).click();
  await expect(zoomLevel).toHaveText('100%');

  const zoomIn = dialog.getByRole('button', { name: '放大' });
  const zoomOut = dialog.getByRole('button', { name: '缩小' });
  for (let percent = 150; percent <= 800; percent += 50) {
    await zoomIn.click();
    await expect(zoomLevel).toHaveText(`${percent}%`);
  }
  await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
  for (let percent = 750; percent >= 50; percent -= 50) {
    await zoomOut.click();
    await expect(zoomLevel).toHaveText(`${percent}%`);
  }
  await zoomOut.click();
  await expect(zoomLevel).toHaveText('25%');
  await expect(zoomOut).toHaveAttribute('aria-disabled', 'true');
  await dialog.getByRole('button', { name: '重置缩放' }).click();
  await expect(zoomLevel).toHaveText('100%');

  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-source-mode .cm-line')).toHaveText(
    source.split('\n'),
  );
});

test('never exposes a viewer action or overlay for a failed Mermaid render', async ({
  page,
}) => {
  await openMarkdown(
    page,
    ['```mermaid', 'this is not valid mermaid', '```', '', 'after'].join('\n'),
  );

  const failed = page.locator('.lm-mermaid-preview[data-status="error"]');
  await expect(failed).toBeVisible();
  await expect(failed).toContainText('Mermaid 渲染失败');
  await expect(failed.getByRole('button', { name: '展开查看' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '图片查看器' })).toHaveCount(0);
  await expect(page.locator('.lm-media-viewer-overlay')).toHaveCount(0);
});

test('removes a cancelled Mermaid preview without leaving an action or overlay', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(
    page.locator('.lm-mermaid-preview[data-status="loading"]'),
  ).toBeVisible();

  await page.keyboard.press(`${primaryModifier}+N`);
  await expect(
    page.getByRole('dialog', { name: '放弃未保存的修改？' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '放弃修改' }).click();

  await expect(page.locator('.lm-mermaid-preview')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开查看' })).toHaveCount(0);
  await expect(page.locator('.lm-media-viewer-overlay')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '图片查看器' })).toHaveCount(0);
  await expect(editor).toHaveText('');
  await editor.click();
  await page.keyboard.insertText('still responsive');
  await expect(editor).toContainText('still responsive');
});
