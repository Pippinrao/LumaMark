import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  mermaidTestSamples,
  requiredMermaidRenderSamples,
} from '../fixtures/mermaidSamples';

test.describe.configure({ mode: 'serial' });

test('renders mermaid asynchronously while normal text remains editable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();
  await page.keyboard.type('\nfast input');

  await expect(editor).toContainText('fast input');
  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(preview).toBeVisible();
  await expect(page.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await page.mouse.move(20, 20);
  await expect(preview.locator('.lm-mermaid-actions')).toBeHidden();
  await preview.hover();
  await expect(page.getByRole('button', { name: '编辑源码' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '删除' })).toBeVisible();
});

test('edits and deletes mermaid from explicit preview actions', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['before', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(page.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await preview.hover();
  await page.getByRole('button', { name: '编辑源码' }).click();
  await expect(page.locator('.lm-mermaid-editor')).toHaveCount(0);
  await expect(editor).toContainText('flowchart TD');
  await page.keyboard.insertText(['flowchart TD', '  A --> C'].join('\n'));
  await expect(page.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await expect(editor).toContainText('A --> C');
  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(editor).not.toContainText('A --> C');
  await preview.hover();
  await page.getByRole('button', { name: '删除' }).click();

  await expect(page.locator('.lm-mermaid-preview')).toHaveCount(0);
  await expect(editor).toContainText('before');
  await expect(editor).toContainText('after');
});

test('keeps mermaid source edits in the main undo history', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await preview.hover();
  await page.getByRole('button', { name: '编辑源码' }).click();
  await page.keyboard.insertText(['flowchart TD', '  A --> C'].join('\n'));
  await expect(editor).toContainText('A --> C');

  await page.keyboard.press('Control+Z');

  await expect(editor).toContainText('A --> B');
  await expect(editor).not.toContainText('A --> C');
  await expect(page.locator('.lm-mermaid-preview-editing')).toBeVisible();
});

test('keeps the main-editor cursor position after invalid mermaid validation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await preview.hover();
  await page.getByRole('button', { name: '编辑源码' }).click();

  await expect(editor).toContainText('flowchart TD');
  await page.keyboard.insertText('not valid mermaid');
  await expect(page.locator('.lm-mermaid-preview[data-status="error"]')).toBeVisible();

  await page.keyboard.type(' tail');
  await expect(editor).toContainText('not valid mermaid tail');
  await expect(editor).not.toContainText('tailnot valid mermaid');
});

test('keeps typing at the caret after an intermediate mermaid render failure', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await preview.hover();
  await page.getByRole('button', { name: '编辑源码' }).click();

  await expect(editor).toContainText('flowchart TD');
  await page.keyboard.insertText('flowchart TD');
  await page.keyboard.press('Enter');
  await page.keyboard.type('  A --');
  await expect(page.locator('.lm-mermaid-preview[data-status="error"]')).toBeVisible();

  await page.keyboard.type('> B');
  await expect(editor).toContainText('flowchart TD  A --> B');
  await expect(editor).not.toContainText('> Bflowchart TD');
});

test('keeps the main-editor cursor position after successful live mermaid render', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await preview.hover();
  await page.getByRole('button', { name: '编辑源码' }).click();

  await expect(editor).toContainText('flowchart TD');
  await page.keyboard.insertText(['flowchart TD', '  B --> C'].join('\n'));

  await expect(preview).toHaveAttribute('data-status', 'success');
  await page.keyboard.insertText('\n  C --> D');

  await expect(editor).toContainText('B --> C  C --> D');
  await expect(editor).not.toContainText('C --> Dflowchart TD');
});

test('places the live mermaid preview below the main-editor source while editing', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```mermaid', 'flowchart TD', '  A --> B', '```', '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await preview.hover();
  await page.getByRole('button', { name: '编辑源码' }).click();

  await expect(editor).toContainText('flowchart TD');
  await expect(
    editor.evaluate((element) => {
      const sourceLine = [...element.querySelectorAll('.cm-line')]
        .find((line) => line.textContent?.includes('A --> B'));
      const previewElement = element.querySelector('.lm-mermaid-preview');

      if (!sourceLine || !previewElement) {
        return false;
      }

      return Boolean(
        sourceLine.compareDocumentPosition(previewElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).resolves.toBe(true);
});

for (const sample of requiredMermaidRenderSamples) {
  test(`renders required Mermaid sample: ${sample.title}`, async ({ page }) => {
    await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(
      ['before', '', '```mermaid', sample.source, '```', '', 'after'].join('\n'),
    );
    await page.locator('.cm-line', { hasText: 'after' }).click();

    const preview = page.locator('.lm-mermaid-preview').first();
    await expect(preview).toHaveAttribute('data-status', 'success');
    await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();
  });
}

for (const sample of mermaidTestSamples.filter(
  (candidate) => candidate.renderGate === 'fixture-only',
)) {
  test(`renders extended Mermaid sample: ${sample.title}`, async ({ page }) => {
    await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(
      ['before', '', '```mermaid', sample.source, '```', '', 'after'].join('\n'),
    );
    await page.locator('.cm-line', { hasText: 'after' }).click();

    const preview = page.locator('.lm-mermaid-preview').first();
    await expect(preview).toHaveAttribute('data-status', 'success');
    await expect(preview.locator('.lm-mermaid-svg > svg')).toBeVisible();
  });
}

test('isolates an invalid mermaid block while the document remains editable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      '```mermaid',
      'this is not valid mermaid',
      '```',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await expect(
    page.locator('.lm-mermaid-preview[data-status="success"] .lm-mermaid-svg > svg'),
  ).toBeVisible();
  const failedPreview = page.locator('.lm-mermaid-preview[data-status="error"]');
  await expect(failedPreview).toBeVisible();
  await failedPreview.hover();
  await failedPreview.getByRole('button', { name: '编辑源码' }).click();
  await expect(editor).toContainText(
    'this is not valid mermaid',
  );

  await page.locator('.cm-line', { hasText: 'after' }).click();
  await page.keyboard.insertText('\nstill editable');
  await expect(editor).toContainText('still editable');
});

test('renders mermaid gallery fixture and keeps source mode faithful', async ({
  page,
}) => {
  const fixture = await readFile(
    join(process.cwd(), 'tests', 'fixtures', 'markdown', 'mermaid-gallery.md'),
    'utf8',
  );
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(fixture);
  await page.locator('.cm-line').last().click();

  await expect
    .poll(async () =>
      page.locator('.lm-mermaid-preview[data-status="success"]').count(),
    )
    .toBeGreaterThan(1);

  await page.locator('.cm-scroller').evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(page.locator('.lm-mermaid-preview[data-status="success"]').first()).toBeVisible();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();

  await page.locator('.cm-scroller').evaluate((scroller) => {
    scroller.scrollTop = 0;
  });

  await expect(page.locator('.lm-mermaid-preview')).toHaveCount(0);
  await expect(editor).toContainText('```mermaid');
  await expect(editor).toContainText('flowchart TD');
});
