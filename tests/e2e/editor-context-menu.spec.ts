import { expect, test, type Page } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const keyboardContextMenuKeys = [
  { label: 'Shift+F10', shortcut: 'Shift+F10' },
  { label: 'Menu key', shortcut: 'ContextMenu' },
] as const;

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  const newDocumentButton = page.getByRole('button', {
    name: /^(?:New Document|新建文档)$/,
  });
  await newDocumentButton.click();
  await expect(newDocumentButton).toBeHidden();
}

function contextItem(page: Page, label: RegExp) {
  return page
    .locator('.lm-context-menu-content[data-state="open"]')
    .getByRole('menuitem', { name: label });
}

for (const { label, shortcut } of keyboardContextMenuKeys) {
  test(`${label} keeps the selection for find, delete, and cut`, async ({
    context,
    page,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openNewDocument(page);
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.insertText('needle');
    await page.keyboard.press(`${primaryModifier}+a`);

    await page.keyboard.press(shortcut);

    const cut = contextItem(page, /^(?:Cut|剪切)(?:\s|$)/);
    const deleteSelection = contextItem(
      page,
      /^(?:Delete selected content|删除所选内容)(?:\s|$)/,
    );
    const findSelection = contextItem(
      page,
      /^(?:Find selected content|查找所选内容)(?:\s|$)/,
    );
    await expect(cut).not.toHaveAttribute('aria-disabled', 'true');
    await expect(deleteSelection).not.toHaveAttribute('aria-disabled', 'true');
    await expect(findSelection).toBeVisible();
    await findSelection.click();
    await expect(page.locator('.cm-search input[name="search"]')).toHaveValue(
      'needle',
    );

    await page.locator('.cm-search [name="close"]').click();
    await editor.click();
    await page.keyboard.press(`${primaryModifier}+a`);
    await page.keyboard.press(shortcut);
    await contextItem(
      page,
      /^(?:Delete selected content|删除所选内容)(?:\s|$)/,
    ).click();
    await expect(editor).toHaveText('');

    await editor.click();
    await page.keyboard.insertText('needle');
    await page.keyboard.press(`${primaryModifier}+a`);
    await page.keyboard.press(shortcut);
    await contextItem(page, /^(?:Cut|剪切)(?:\s|$)/).click();
    await expect(editor).toHaveText('');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('needle');
  });
}
