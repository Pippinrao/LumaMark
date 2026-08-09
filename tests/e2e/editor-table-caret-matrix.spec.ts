/**
 * Full-matrix caret contract for table clicks (plan A).
 * - On-text clicks: caret stays within half a glyph of the click.
 * - Empty padding clicks: caret snaps to text end (no fabricated spaces).
 * - inactive/active geometry stays shared (padding + hidden marks).
 * - Blank lines around tables stay selectable (no decorative widget chrome).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(page.locator('.tbl-table-widget')).toBeVisible();
}

function dataCell(page: Page, row: number, col: number): Locator {
  return page
    .locator('.tbl-table-body .tbl-table-row')
    .nth(row)
    .locator('.tbl-data-cell')
    .nth(col);
}

async function blurTable(page: Page): Promise<void> {
  await page.locator('.cm-line', { hasText: 'after' }).click();
}

async function clickGlyph(
  page: Page,
  cell: Locator,
  glyph: string,
  horizontalFraction = 0.5,
): Promise<{ x: number; y: number; glyphWidth: number }> {
  const point = await cell.locator('.tbl-cell-view').evaluate(
    (surface, target) => {
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        const index = textNode.data.indexOf(target.glyph);
        if (index < 0) continue;
        if (getComputedStyle(textNode.parentElement!).display === 'none') {
          continue;
        }
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + target.glyph.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width * target.horizontalFraction,
          y: rect.top + rect.height / 2,
          glyphWidth: rect.width,
        };
      }
      throw new Error(`glyph ${target.glyph} missing`);
    },
    { glyph, horizontalFraction },
  );
  await page.mouse.click(point.x, point.y);
  return point;
}

async function readNestedCaret(page: Page): Promise<{
  head: number;
  left: number;
  text: string;
  markDisplay: string[];
  contentPadding: string;
}> {
  const editor = page.locator('.tbl-cell-editor .cm-content:visible');
  await expect(editor).toHaveCount(1);
  return editor.evaluate((content) => {
    type ViewBridge = {
      coordsAtPos(pos: number, side?: -1 | 1): { left: number; top: number } | null;
      state: {
        doc: { toString(): string };
        selection: { main: { head: number } };
      };
    };
    const view = (content as HTMLElement & { cmTile: { view: ViewBridge } }).cmTile
      .view;
    const head = view.state.selection.main.head;
    const caret =
      view.coordsAtPos(head, -1) ??
      view.coordsAtPos(head, 1) ??
      view.coordsAtPos(head);
    if (!caret) {
      throw new Error('missing caret coords');
    }
    return {
      head,
      left: caret.left,
      text: view.state.doc.toString(),
      markDisplay: [...content.querySelectorAll('.lm-table-token-mark')].map(
        (el) => getComputedStyle(el).display,
      ),
      contentPadding: getComputedStyle(content).padding,
    };
  });
}

async function readInactivePadding(cell: Locator): Promise<string> {
  return cell.locator('.tbl-cell-view').evaluate((surface) => {
    return getComputedStyle(surface).padding;
  });
}

test('keeps inactive and active cell padding identical after a real click', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    ['before', '', '| A | B |', '| --- | --- |', '| hello | x |', '', 'after'].join(
      '\n',
    ),
  );

  const cell = dataCell(page, 0, 0);
  const inactivePadding = await readInactivePadding(cell);
  await blurTable(page);
  await clickGlyph(page, cell, 'e');
  const active = await readNestedCaret(page);
  expect(active.contentPadding).toBe(inactivePadding);
});

test('keeps formatted marks hidden after activation and caret near the glyph click', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| A | B |',
      '| --- | --- |',
      '| **alpha** | x |',
      '',
      'after',
    ].join('\n'),
  );

  const cell = dataCell(page, 0, 0);
  await blurTable(page);
  const click = await clickGlyph(page, cell, 'a', 0.05);
  const active = await readNestedCaret(page);
  expect(active.markDisplay.every((display) => display === 'none')).toBe(true);
  expect(Math.abs(active.left - click.x)).toBeLessThanOrEqual(
    Math.max(3, click.glyphWidth / 2 + 1),
  );
});

test('maps plain, CJK, code, and link glyph clicks within half a glyph', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| A | B |',
      '| --- | --- |',
      '| plain | x |',
      '| 中文词 | x |',
      '| `code` | x |',
      '| [lab](https://example.com) | x |',
      '',
      'after',
    ].join('\n'),
  );

  const cases: Array<{ row: number; glyph: string; fraction?: number }> = [
    { row: 0, glyph: 'a' },
    { row: 1, glyph: '文' },
    { row: 2, glyph: 'o' },
    { row: 3, glyph: 'a', fraction: 0.2 },
  ];

  for (const item of cases) {
    await blurTable(page);
    const cell = dataCell(page, item.row, 0);
    const click = await clickGlyph(page, cell, item.glyph, item.fraction ?? 0.5);
    const active = await readNestedCaret(page);
    expect(
      Math.abs(active.left - click.x),
      `row ${item.row} glyph ${item.glyph}`,
    ).toBeLessThanOrEqual(Math.max(3, click.glyphWidth / 2 + 1));
  }
});

test('places empty-cell clicks at the start and accepts typed input', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    ['before', '', '| A | B |', '| --- | --- |', '|  | x |', '', 'after'].join('\n'),
  );

  const cell = dataCell(page, 0, 0);
  await blurTable(page);
  const box = await cell.locator('.tbl-cell-view').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + 8, box!.y + box!.height / 2);
  const active = await readNestedCaret(page);
  expect(active).toMatchObject({ head: 0, text: '' });
  await page.keyboard.insertText('空');
  await expect.poll(async () => (await readNestedCaret(page)).text).toBe('空');
});

test('snaps wide-cell padding clicks to the text end without inventing spaces', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Very wide column title goes here forever | B |',
      '| ---------------------------------------- | - |',
      '| hi | x |',
      '',
      'after',
    ].join('\n'),
  );

  const cell = dataCell(page, 0, 0);
  await blurTable(page);
  const box = await cell.locator('.tbl-cell-view').boundingBox();
  expect(box).not.toBeNull();
  // Click trailing empty area of a wide column — Plan A snaps to text end.
  await page.mouse.click(box!.x + box!.width - 3, box!.y + box!.height / 2);
  const active = await readNestedCaret(page);
  expect(active.text).toBe('hi');
  expect(active.head).toBe(2);
});

test('keeps wide tables fully visible without an inner horizontal scrollbar', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Name | Description | Status | Notes |',
      '| --- | --- | --- | --- |',
      '| alpha | short | ok | x |',
      '| beta | this is a longer description that users expect to see fully without a horizontal scrollbar inside the table widget | pending | y |',
      '',
      'after',
    ].join('\n'),
  );

  const metrics = await page.evaluate(() => {
    const wrapper = document.querySelector('.tbl-table-wrapper');
    if (!wrapper) {
      throw new Error('missing table wrapper');
    }
    const style = getComputedStyle(wrapper);
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      clientWidth: wrapper.clientWidth,
      scrollWidth: wrapper.scrollWidth,
      headerMaxWidths: [...document.querySelectorAll('.tbl-header-cell')].map(
        (el) => getComputedStyle(el).maxWidth,
      ),
    };
  });

  expect(metrics.overflowX).toBe('visible');
  expect(metrics.overflowY).toBe('visible');
  // With overflow:visible there is no inner scrollbar even if content is wider.
  expect(metrics.headerMaxWidths.every((value) => value === 'none')).toBe(true);
});

test('keeps clicks in the blank lines around a table out of the first and last rows', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| A | B |',
      '| --- | --- |',
      '| hello | world |',
      '',
      'after',
    ].join('\n'),
  );

  const geometry = await page.evaluate(() => {
    const widget = document.querySelector('.tbl-table-widget');
    const before = [...document.querySelectorAll('.cm-line')].find((line) =>
      line.textContent?.includes('before'),
    );
    const after = [...document.querySelectorAll('.cm-line')].find((line) =>
      line.textContent?.includes('after'),
    );
    const header = document.querySelector('.tbl-header-cell');
    const lastCell = document.querySelector(
      '.tbl-table-body .tbl-table-row:last-child .tbl-cell-view',
    );
    if (!widget || !before || !after || !header || !lastCell) {
      throw new Error('missing table surround geometry');
    }

    const style = getComputedStyle(widget);
    const beforeBox = before.getBoundingClientRect();
    const afterBox = after.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const lastBox = lastCell.getBoundingClientRect();
    const widgetBox = widget.getBoundingClientRect();
    const midX = widgetBox.left + Math.min(64, widgetBox.width / 2);

    return {
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      paddingTop: style.paddingTop,
      paddingBottom: style.paddingBottom,
      above: { x: midX, y: (beforeBox.bottom + headerBox.top) / 2 },
      below: { x: midX, y: (lastBox.bottom + afterBox.top) / 2 },
      gapAbove: headerBox.top - beforeBox.bottom,
      gapBelow: afterBox.top - lastBox.bottom,
    };
  });

  // Decorative widget chrome must not invent large unselectable "blank lines".
  expect(Number.parseFloat(geometry.marginTop)).toBe(0);
  expect(Number.parseFloat(geometry.marginBottom)).toBe(0);
  expect(Number.parseFloat(geometry.paddingTop)).toBe(0);
  expect(Number.parseFloat(geometry.paddingBottom)).toBe(0);
  // Real blank cm-lines (~one line-height) remain; no double-gap chrome.
  expect(geometry.gapAbove).toBeLessThan(48);
  expect(geometry.gapBelow).toBeLessThan(48);

  await page.mouse.click(geometry.above.x, geometry.above.y);
  await expect(page.locator('.tbl-cell-editor .cm-content:visible')).toHaveCount(0);

  await page.mouse.click(geometry.below.x, geometry.below.y);
  await expect(page.locator('.tbl-cell-editor .cm-content:visible')).toHaveCount(0);
});

test('keeps left/center/right aligned glyph clicks near the caret', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| L | C | R |',
      '| :--- | :---: | ---: |',
      '| xx | xx | xx |',
      '',
      'after',
    ].join('\n'),
  );

  for (let col = 0; col < 3; col += 1) {
    await blurTable(page);
    const cell = dataCell(page, 0, col);
    const click = await clickGlyph(page, cell, 'x', 0.05);
    const active = await readNestedCaret(page);
    expect(Math.abs(active.left - click.x)).toBeLessThanOrEqual(
      Math.max(3, click.glyphWidth / 2 + 1),
    );
  }
});
