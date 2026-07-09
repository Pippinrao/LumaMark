import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  mermaidTestSamples,
  requiredMermaidRenderSamples,
} from '../fixtures/mermaidSamples';

test.describe.configure({ mode: 'serial' });

async function inlineMermaidCaretOffset(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector('.lm-mermaid-editor .cm-content');
    const selection = window.getSelection();

    if (!editor || !selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      return -1;
    }

    const range = document.createRange();
    range.setStart(editor, 0);
    range.setEnd(selection.anchorNode, selection.anchorOffset);

    return range.toString().length;
  });
}

async function inlineMermaidTextLength(page: Page) {
  return page.locator('.lm-mermaid-editor .cm-content').evaluate((editor) =>
    editor.textContent?.length ?? 0,
  );
}

test('renders mermaid asynchronously while normal text remains editable', async ({
  page,
}) => {
  await page.goto('/');

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
  await expect(page.locator('.lm-mermaid-editor .cm-content')).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('flowchart TD');
  await page.keyboard.press('Enter');
  await page.keyboard.type('  A --> C');
  await expect(page.locator('.lm-mermaid-svg > svg')).toBeVisible();
  await expect(page.locator('.lm-mermaid-editor .cm-content')).toContainText(
    'A --> C',
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(page.locator('.lm-mermaid-editor')).toBeHidden();
  await preview.hover();
  await page.getByRole('button', { name: '删除' }).click();

  await expect(page.locator('.lm-mermaid-preview')).toHaveCount(0);
  await expect(editor).toContainText('before');
  await expect(editor).toContainText('after');
});

test('keeps the inline cursor position after invalid mermaid validation', async ({
  page,
}) => {
  await page.goto('/');

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

  const mermaidSource = page.locator('.lm-mermaid-editor .cm-content');
  await expect(mermaidSource).toBeVisible();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('not valid mermaid');
  await expect(page.locator('.lm-mermaid-preview[data-status="error"]')).toBeVisible();
  await expect.poll(() => inlineMermaidCaretOffset(page)).toBe(await inlineMermaidTextLength(page));

  await page.keyboard.type(' tail');
  await expect(mermaidSource).toContainText('not valid mermaid tail');
  await expect(mermaidSource).not.toContainText('tailnot valid mermaid');
});

test('keeps typing at the caret after an intermediate mermaid render failure', async ({
  page,
}) => {
  await page.goto('/');

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

  const mermaidSource = page.locator('.lm-mermaid-editor .cm-content');
  await expect(mermaidSource).toBeVisible();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('  A --');
  await expect(page.locator('.lm-mermaid-preview[data-status="error"]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect.poll(() => inlineMermaidCaretOffset(page)).toBe(await inlineMermaidTextLength(page));

  await page.keyboard.type('> B');
  await expect(mermaidSource).toContainText('flowchart TD  A --> B');
  await expect(mermaidSource).not.toContainText('> Bflowchart TD');
});

test('keeps the inline cursor position after successful live mermaid render', async ({
  page,
}) => {
  await page.goto('/');

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

  const mermaidSource = page.locator('.lm-mermaid-editor .cm-content');
  await expect(mermaidSource).toBeVisible();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('  B --> C');

  await expect(preview).toHaveAttribute('data-status', 'success');
  await page.waitForTimeout(500);
  await expect.poll(() => inlineMermaidCaretOffset(page)).toBe(await inlineMermaidTextLength(page));
  await page.keyboard.insertText('\n  C --> D');

  await expect(mermaidSource).toContainText('B --> C  C --> D');
  await expect(mermaidSource).not.toContainText('C --> Dflowchart TD');
});

test('places the live mermaid preview below the source editor while editing', async ({
  page,
}) => {
  await page.goto('/');

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

  await expect(page.locator('.lm-mermaid-editor .cm-content')).toBeVisible();
  await expect(
    preview.evaluate((element) => {
      const sourceEditor = element.querySelector('.lm-mermaid-editor');
      const previewImage = element.querySelector('.lm-mermaid-svg');

      if (!sourceEditor || !previewImage) {
        return false;
      }

      return Boolean(
        sourceEditor.compareDocumentPosition(previewImage) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).resolves.toBe(true);
});

for (const sample of requiredMermaidRenderSamples) {
  test(`renders required Mermaid sample: ${sample.title}`, async ({ page }) => {
    await page.goto('/');

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
  await expect(failedPreview.locator('.lm-mermaid-editor .cm-content')).toBeVisible();
  await expect(failedPreview.locator('.lm-mermaid-editor .cm-content')).toContainText(
    'this is not valid mermaid',
  );

  await editor.click();
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
  await page.getByRole('menuitem', { name: '源码模式' }).click();

  await page.locator('.cm-scroller').evaluate((scroller) => {
    scroller.scrollTop = 0;
  });

  await expect(page.locator('.lm-mermaid-preview')).toHaveCount(0);
  await expect(editor).toContainText('```mermaid');
  await expect(editor).toContainText('flowchart TD');
});
