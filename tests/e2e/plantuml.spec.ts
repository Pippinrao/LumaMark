import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const newDocumentName = /^(?:New Document|新建文档)$/;
const editSourceName = /^(?:Edit source|编辑源码)$/;
const deleteName = /^(?:Delete|删除)$/;
const expandName = /^(?:Expand preview|展开查看)$/;

test('renders a PlantUML sequence diagram locally in the preview', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: newDocumentName }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      'before',
      '',
      '```plantuml',
      '@startuml',
      'Alice -> Bob : Hello',
      'Bob --> Alice : Hi',
      '@enduml',
      '```',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-plantuml-preview').first();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('data-status', 'success');
  await expect(preview.locator('.lm-plantuml-svg > svg')).toBeVisible();

  await preview.hover();
  await expect(page.getByRole('button', { name: editSourceName }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: deleteName })).toBeVisible();
  await expect(page.getByRole('button', { name: expandName }).first()).toBeVisible();
});

test('keeps PlantUML source in the main undo history while editing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: newDocumentName }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      '```plantuml',
      '@startuml',
      'Alice -> Bob : Hello',
      '@enduml',
      '```',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-plantuml-preview').first();
  await expect(preview).toHaveAttribute('data-status', 'success');
  await preview.hover();
  await page.getByRole('button', { name: editSourceName }).click();

  await expect(editor).toContainText('Alice -> Bob : Hello');
  await page.keyboard.insertText('Alice -> Carol : Hi');

  await expect(editor).toContainText('Alice -> Carol : Hi');
  await page.keyboard.press('Control+Z');
  await expect(editor).not.toContainText('Alice -> Carol : Hi');
  await expect(editor).toContainText('Alice -> Bob : Hello');
});

test('keeps dark-mode PlantUML on the editor surface instead of a white paper', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: newDocumentName }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      '```plantuml',
      '@startuml',
      'Alice -> Bob : Hello',
      'Bob --> Alice : Hi',
      '@enduml',
      '```',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-plantuml-preview').first();
  await expect(preview).toHaveAttribute('data-status', 'success');
  const lightSvg = await preview.locator('.lm-plantuml-svg > svg').innerHTML();

  await page.getByRole('menuitem', { exact: true, name: /^(?:主题|Theme)$/ }).click();
  await page.getByRole('menuitemradio', { name: /^(?:暗色|Dark)$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect
    .poll(async () => preview.locator('.lm-plantuml-svg > svg').innerHTML())
    .not.toBe(lightSvg);

  const canvasBackground = await preview
    .locator('.lm-plantuml-svg')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  const channels = canvasBackground.match(/[\d.]+/g)?.map(Number) ?? [];
  const luminance =
    0.2126 * (channels[0] ?? 255) +
    0.7152 * (channels[1] ?? 255) +
    0.0722 * (channels[2] ?? 255);

  expect(canvasBackground, canvasBackground).not.toMatch(/rgb\(255,\s*255,\s*255\)/);
  expect(luminance).toBeLessThan(80);

  await page.getByRole('menuitem', { exact: true, name: /^(?:主题|Theme)$/ }).click();
  await page.getByRole('menuitemradio', { name: /^(?:亮色|Light)$/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('expands the rendered PlantUML diagram in the media viewer', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: newDocumentName }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      '```plantuml',
      '@startuml',
      'class Animal',
      'class Cat',
      'Animal <|-- Cat',
      '@enduml',
      '```',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-plantuml-preview').first();
  await expect(preview).toHaveAttribute('data-status', 'success');
  await preview.hover();
  await page.getByRole('button', { name: expandName }).first().click();

  const viewer = page.locator('.lm-media-viewer-dialog');
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('.lm-media-viewer-mermaid svg')).toBeVisible();
});
