import { expect, test, type Locator, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

const primary = process.platform === 'darwin' ? 'Meta' : 'Control';
const source = 'before\n\n| Name | Value |\n| --- | --- |\n| alpha bravo charlie | 中文词语测试 |\n\nafter';

async function readEditor(content: Locator) {
  return content.evaluate((element) => {
    type View = {
      state: {
        doc: { toString(): string; sliceString(from: number, to: number): string };
        selection: { main: { from: number; to: number } };
      };
    };
    const tile = (element as HTMLElement & {
      cmTile: { root?: { view: View }; view: View };
    }).cmTile;
    const view = tile.root?.view ?? tile.view;
    const { from, to } = view.state.selection.main;
    return { text: view.state.doc.toString(), selected: view.state.doc.sliceString(from, to) };
  });
}

async function wordPoint(surface: Locator, word: string) {
  return surface.evaluate((element, text) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const index = node.textContent?.indexOf(text) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index + 2);
      range.setEnd(node, index + 3);
      const rect = range.getBoundingClientRect();
      if (rect.width > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error(`Visible word not found: ${text}`);
  }, word);
}

async function setup(page: Page) {
  await page.goto('/');
  await openBlankDocument(page);
  const root = page.locator('.cm-content').first();
  await root.click();
  await page.keyboard.press(`${primary}+A`);
  await page.keyboard.insertText(source);
  await page.locator('.cm-line').filter({ hasText: /^after$/ }).click();
  const cell = page.locator('.tbl-data-cell').filter({ hasText: 'alpha bravo charlie' });
  await expect(cell).toBeVisible();
  return { cell, root, nested: page.locator('.tbl-cell-editor .cm-content') };
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

for (const active of [false, true]) {
  test(`double-click selects and copies a word in an ${active ? 'active' : 'inactive'} table cell`, async ({ page }) => {
    const { cell, root, nested } = await setup(page);
    if (active) {
      await cell.click();
      await expect(nested).toBeFocused();
    }
    const point = await wordPoint(active ? nested : cell.locator('.tbl-cell-view'), 'bravo');
    await page.mouse.dblclick(point.x, point.y);
    // Windows native word selection may include the trailing space.
    await expect.poll(async () => (await readEditor(nested)).selected.trim()).toBe('bravo');
    const selected = (await readEditor(nested)).selected;
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
    expect((await readEditor(root)).text).toBe(source);
  });
}

for (const active of [false, true]) {
  test(`drag-selects and copies text in an ${active ? 'active' : 'inactive'} table cell`, async ({ page }) => {
    const { cell, root, nested } = await setup(page);
    if (active) {
      await cell.click();
      await expect(nested).toBeFocused();
    }
    const surface = active ? nested : cell.locator('.tbl-cell-view');
    const start = await wordPoint(surface, 'alpha');
    const end = await wordPoint(surface, 'charlie');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await readEditor(nested)).selected).toContain('bravo');
    const selected = (await readEditor(nested)).selected;
    await page.keyboard.press(`${primary}+C`);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
    expect((await readEditor(root)).text).toBe(source);
  });
}

test('copies a keyboard-selected table word through shortcut and context menu', async ({ page }) => {
  const { cell, root, nested } = await setup(page);
  await cell.click();
  await expect(nested).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Control+Shift+ArrowRight');
  const selected = (await readEditor(nested)).selected;
  expect(selected.trim()).toBe('alpha');
  await expect.poll(async () => (await readEditor(root)).selected).toBe(selected);
  await page.keyboard.press(`${primary}+C`);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
  const point = await wordPoint(nested, 'alpha');
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.locator('.lm-context-menu-content[data-state="open"]')
    .getByRole('menuitem', { name: /^(?:Copy|复制)(?:\s|$)/ }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(selected);
  expect((await readEditor(root)).text).toBe(source);
});
