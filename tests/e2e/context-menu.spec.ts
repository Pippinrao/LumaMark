import { expect, test, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

type RootEditorSnapshot = {
  doc: string;
  selection: { anchor: number; from: number; head: number; to: number };
};

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  await openBlankDocument(page);
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
}

async function setRootSelection(
  page: Page,
  anchor: number,
  head: number,
): Promise<void> {
  await page.locator('.cm-content').first().evaluate(
    (content, selection) => {
      type ViewBridge = {
        dispatch(spec: { selection: { anchor: number; head: number } }): void;
        focus(): void;
      };
      const tile = (
        content as HTMLElement & {
          cmTile: { root?: { view: ViewBridge }; view: ViewBridge };
        }
      ).cmTile;
      const view = tile.root?.view ?? tile.view;
      view.dispatch({ selection });
      view.focus();
    },
    { anchor, head },
  );
}

async function readRootEditor(page: Page): Promise<RootEditorSnapshot> {
  return page.locator('.cm-content').first().evaluate((content) => {
    type ViewBridge = {
      state: {
        doc: { length: number; toString(): string };
        selection: {
          main: { anchor: number; from: number; head: number; to: number };
        };
      };
    };
    const tile = (
      content as HTMLElement & {
        cmTile: { root?: { view: ViewBridge }; view: ViewBridge };
      }
    ).cmTile;
    const view = tile.root?.view ?? tile.view;
    const selection = view.state.selection.main;
    return {
      doc: view.state.doc.toString(),
      selection: {
        anchor: selection.anchor,
        from: selection.from,
        head: selection.head,
        to: selection.to,
      },
    };
  });
}

function contextItem(page: Page, label: RegExp) {
  return page
    .locator('.lm-context-menu-content[data-state="open"]')
    .getByRole('menuitem', { name: label });
}

test('executes ordinary edit commands without losing the selected range', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openNewDocument(page);
  await replaceEditorSource(page, 'alpha beta gamma');

  const editor = page.locator('.cm-content').first();
  const line = page.locator('.cm-line').filter({ hasText: 'alpha beta gamma' });
  await setRootSelection(page, 0, 16);
  await line.click({ button: 'right', position: { x: 24, y: 8 } });

  await contextItem(page, /^(?:Copy|复制)(?:\s|$)/).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('alpha beta gamma');
  expect((await readRootEditor(page)).selection).toEqual({
    anchor: 0,
    from: 0,
    head: 16,
    to: 16,
  });

  await page.evaluate(() => navigator.clipboard.writeText('replacement'));
  await line.click({ button: 'right', position: { x: 24, y: 8 } });
  await contextItem(page, /^(?:Paste|粘贴)(?:\s|$)/).click();
  await expect.poll(async () => (await readRootEditor(page)).doc).toBe('replacement');

  await setRootSelection(page, 0, 'replacement'.length);
  await page.locator('.cm-line').click({ button: 'right', position: { x: 24, y: 8 } });
  await contextItem(page, /^(?:Cut|剪切)(?:\s|$)/).click();
  await expect.poll(async () => (await readRootEditor(page)).doc).toBe('');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('replacement');

  await page.evaluate(() => navigator.clipboard.writeText('final text'));
  await editor.click({ button: 'right', position: { x: 24, y: 8 } });
  await expect(contextItem(page, /^(?:Cut|剪切)(?:\s|$)/)).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(contextItem(page, /^(?:Copy|复制)(?:\s|$)/)).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await contextItem(page, /^(?:Paste|粘贴)(?:\s|$)/).click();
  await expect.poll(async () => (await readRootEditor(page)).doc).toBe('final text');

  await editor.click({ button: 'right', position: { x: 24, y: 8 } });
  await contextItem(page, /^(?:Select All|全选)(?:\s|$)/).click();
  expect((await readRootEditor(page)).selection).toEqual({
    anchor: 0,
    from: 0,
    head: 10,
    to: 10,
  });
});

test('routes standard edit shortcuts through the shared editor command port', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openNewDocument(page);
  await replaceEditorSource(page, 'alpha beta');
  await setRootSelection(page, 0, 5);

  await page.keyboard.press(`${primaryModifier}+C`);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('alpha');

  await page.keyboard.press(`${primaryModifier}+X`);
  await expect.poll(async () => (await readRootEditor(page)).doc).toBe(' beta');

  await page.evaluate(() => navigator.clipboard.writeText('omega'));
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect.poll(async () => (await readRootEditor(page)).doc).toBe('omega beta');

  await page.keyboard.press(`${primaryModifier}+A`);
  expect((await readRootEditor(page)).selection).toEqual({
    anchor: 0,
    from: 0,
    head: 10,
    to: 10,
  });
});

test('keeps the Radix context menu horizontal, portaled, keyboard navigable, and focus-safe', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(page, 'layout marker');
  const editor = page.locator('.cm-content').first();
  await editor.click({ button: 'right', position: { x: 24, y: 8 } });

  const menu = page.locator('.lm-context-menu-content[data-state="open"]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('data-lm-window-interactive', 'true');
  expect(
    await menu.evaluate(
      (element) => element.closest('.lm-editor-pane') === null,
    ),
  ).toBe(true);

  const geometry = await menu.getByRole('menuitem').evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      const label = item.querySelector('.lm-menu-label') ?? item;
      const style = getComputedStyle(label);
      return {
        height: rect.height,
        whiteSpace: style.whiteSpace,
        width: rect.width,
        writingMode: style.writingMode,
      };
    }),
  );
  expect(geometry.length).toBeGreaterThanOrEqual(4);
  for (const item of geometry) {
    expect(item.width).toBeGreaterThan(item.height * 3);
    expect(item.whiteSpace).toBe('nowrap');
    expect(item.writingMode).toContain('horizontal');
  }

  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[role="menuitem"]:focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(editor).toBeFocused();
});

test('copies and deletes the right-clicked table range while the outer selection is elsewhere', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openNewDocument(page);
  const firstTable = [
    '| First      | Value |',
    '| ---------- | ----- |',
    '| FIRST_ONLY | 1     |',
  ].join('\n');
  const secondTable = [
    '| Second      | Value |',
    '| ----------- | ----- |',
    '| SECOND_ONLY | 2     |',
  ].join('\n');
  await replaceEditorSource(
    page,
    ['before', '', firstTable, '', 'between', '', secondTable, '', 'after'].join('\n'),
  );
  await expect(page.locator('.tbl-table-widget')).toHaveCount(2);
  await setRootSelection(page, 0, 0);

  const secondCell = page.locator('.tbl-data-cell').filter({ hasText: 'SECOND_ONLY' });
  await secondCell.click({ button: 'right' });
  await contextItem(page, /^(?:Copy table|复制表格)(?:\s|$)/i).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('SECOND_ONLY');
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(
    'FIRST_ONLY',
  );

  await setRootSelection(page, 0, 0);
  await secondCell.click({ button: 'right' });
  await contextItem(page, /^(?:Delete table|删除表格)(?:\s|$)/i).click();
  await expect(page.locator('.tbl-table-widget')).toHaveCount(1);
  const snapshot = await readRootEditor(page);
  expect(snapshot.doc).toContain('FIRST_ONLY');
  expect(snapshot.doc).not.toContain('SECOND_ONLY');
  expect(snapshot.doc).toContain('after');
});

test('keeps live-preview image context commands available on secondary click', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openNewDocument(page);

  const imageSource = '![Local logo](/fixtures/logo.png)';
  await replaceEditorSource(page, ['before', imageSource, 'after'].join('\n'));
  const preview = page.locator('.lm-image-preview');
  await expect(preview).toBeVisible();
  await preview.click({ button: 'right' });

  await expect(contextItem(page, /^(?:Copy image path|复制图片路径)$/)).toBeVisible();
  await expect(
    contextItem(page, /^(?:Reveal in file manager|在文件管理器中显示)$/i),
  ).toBeVisible();
  await expect(contextItem(page, /^(?:Delete reference|删除引用)$/)).toBeVisible();
  await contextItem(page, /^(?:Copy image path|复制图片路径)$/).click();
  await expect
    .poll(async () => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('/fixtures/logo.png');

  await preview.click({ button: 'right' });
  await contextItem(page, /^(?:Delete reference|删除引用)$/).click();
  await expect(preview).toHaveCount(0);
  await expect.poll(async () => (await readRootEditor(page)).doc).not.toContain(
    imageSource,
  );
});
