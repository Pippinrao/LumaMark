import { expect, test, type Locator, type Page } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

type SelectionSnapshot = {
  caretRect: { height: number; left: number; top: number };
  dom: {
    anchorOffset: number;
    anchorType: string;
    focusOffset: number;
    focusType: string;
    withinCellEditor: boolean;
  };
  nested: {
    anchor: number;
    caretRect: { height: number; left: number; top: number } | null;
    head: number;
    text: string;
  };
  root: { anchor: number; head: number; text: string };
};

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

function headerCell(page: Page, col: number): Locator {
  return page.locator('.tbl-table-head .tbl-header-cell').nth(col);
}

async function readRootSource(page: Page): Promise<{
  anchor: number;
  head: number;
  text: string;
}> {
  return page.locator('.cm-content').first().evaluate((content) => {
    type RootViewBridge = {
      state: {
        doc: { toString(): string };
        selection: { main: { anchor: number; head: number } };
      };
    };
    const tile = (
      content as HTMLElement & {
        cmTile: { root?: { view: RootViewBridge }; view: RootViewBridge };
      }
    ).cmTile;
    const view = tile.root?.view ?? tile.view;

    return {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      text: view.state.doc.toString(),
    };
  });
}

async function switchEditorMode(
  page: Page,
  mode: 'livePreview' | 'source',
): Promise<void> {
  const rootClass =
    mode === 'source'
      ? '.lm-editor-source-mode'
      : '.lm-editor-live-preview-mode';

  if (await page.locator(rootClass).isVisible()) {
    return;
  }

  const viewMenu = page.getByRole('menuitem', { exact: true, name: '视图' });
  await viewMenu.focus();
  await viewMenu.press('ArrowDown');
  await expect(viewMenu).toHaveAttribute('data-state', 'open');
  await page
    .getByRole('menuitemradio', {
      name: mode === 'source' ? /^源码模式/ : '实时预览',
    })
    .click();
  await expect(page.locator(rootClass)).toBeVisible();
}

async function clickCellAtVisualEdge(
  page: Page,
  cell: Locator,
  edge: 'start' | 'end',
): Promise<void> {
  const point = await cell.locator('.tbl-cell-view').evaluate((surface, side) => {
    const rect = surface.getBoundingClientRect();

    return {
      x: side === 'start' ? rect.left + 2 : rect.right - 2,
      y: rect.top + Math.min(rect.height / 2, 12),
    };
  }, edge);

  await page.mouse.click(point.x, point.y);
}

async function clickVisibleGlyph(
  page: Page,
  cell: Locator,
  glyph: string,
  horizontalFraction = 0.7,
): Promise<void> {
  const point = await cell.locator('.tbl-cell-view').evaluate(
    (surface, target) => {
      const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);

      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        const index = textNode.data.indexOf(target.glyph);

        if (index < 0 || getComputedStyle(textNode.parentElement!).display === 'none') {
          continue;
        }

        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + target.glyph.length);
        const rect = range.getBoundingClientRect();

        return {
          x: rect.left + rect.width * target.horizontalFraction,
          y: rect.top + rect.height / 2,
        };
      }

      throw new Error(`Visible glyph ${target.glyph} was not found`);
    },
    { glyph, horizontalFraction },
  );

  await page.mouse.click(point.x, point.y);
}

async function clickActiveCellAtStart(page: Page): Promise<void> {
  const point = await page
    .locator('.tbl-cell-editor .cm-content:visible')
    .evaluate((content) => {
      const rect = content.getBoundingClientRect();

      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });

  await page.mouse.click(point.x, point.y);
}

async function readSelectionSnapshot(page: Page): Promise<SelectionSnapshot> {
  const cellEditor = page.locator('.tbl-cell-editor .cm-content:visible');
  await expect(cellEditor).toHaveCount(1);

  return cellEditor.evaluate((content) => {
    type EditorViewBridge = {
      coordsAtPos(position: number, side?: -1 | 1): DOMRect | null;
      state: {
        doc: { toString(): string };
        selection: { main: { anchor: number; head: number } };
      };
    };
    type ContentBridge = HTMLElement & {
      cmTile: {
        root?: { view: EditorViewBridge };
        view: EditorViewBridge;
      };
    };

    const selection = document.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rangeRect = range?.getBoundingClientRect();
    const nestedView = (content as ContentBridge).cmTile.view;
    const nestedSelection = nestedView.state.selection.main;
    const nestedCaret =
      nestedView.coordsAtPos(nestedSelection.head, -1) ??
      nestedView.coordsAtPos(nestedSelection.head, 1) ??
      nestedView.coordsAtPos(nestedSelection.head);
    const rootContent = document.querySelector<HTMLElement>(
      '.lm-editor-live-preview-mode .cm-content',
    );

    if (!selection || !range || !rangeRect || !rootContent) {
      throw new Error('Expected live DOM, nested editor, and root editor selections');
    }

    const rootTile = (rootContent as ContentBridge).cmTile;
    const rootView = rootTile.root?.view ?? rootTile.view;
    const rootSelection = rootView.state.selection.main;

    return {
      caretRect: {
        height: rangeRect.height,
        left: rangeRect.left,
        top: rangeRect.top,
      },
      dom: {
        anchorOffset: selection.anchorOffset,
        anchorType: selection.anchorNode?.nodeName ?? '',
        focusOffset: selection.focusOffset,
        focusType: selection.focusNode?.nodeName ?? '',
        withinCellEditor:
          selection.anchorNode !== null && content.contains(selection.anchorNode),
      },
      nested: {
        anchor: nestedSelection.anchor,
        caretRect: nestedCaret
          ? {
              height: nestedCaret.bottom - nestedCaret.top,
              left: nestedCaret.left,
              top: nestedCaret.top,
            }
          : null,
        head: nestedSelection.head,
        text: nestedView.state.doc.toString(),
      },
      root: {
        anchor: rootSelection.anchor,
        head: rootSelection.head,
        text: rootView.state.doc.toString(),
      },
    };
  });
}

function expectCaretGeometry(snapshot: SelectionSnapshot): void {
  expect(snapshot.dom.withinCellEditor).toBe(true);
  expect(snapshot.dom.anchorOffset).toBe(snapshot.dom.focusOffset);
  expect(snapshot.nested.anchor).toBe(snapshot.nested.head);
  expect(snapshot.root.anchor).toBe(snapshot.root.head);
  expect(snapshot.nested.caretRect).not.toBeNull();
  expect(snapshot.nested.caretRect?.height).toBeGreaterThan(0);
  if (snapshot.caretRect.height > 0) {
    expect(
      Math.abs(snapshot.caretRect.left - (snapshot.nested.caretRect?.left ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(snapshot.caretRect.top - (snapshot.nested.caretRect?.top ?? 0)),
    ).toBeLessThanOrEqual(1);
  }
}

test('maps a real click at a nested formatted boundary to the visual source end', async ({
  page,
}) => {
  await openNewDocument(page);
  const source = [
    'before',
    '',
    '| Styled      | Other |',
    '| ----------- | ----- |',
    '| **中文**尾部 | value |',
    '',
    'after',
  ].join('\n');
  await replaceEditorSource(page, source);

  const cell = dataCell(page, 0, 0);
  await clickVisibleGlyph(page, cell, '部', 0.95);

  const snapshot = await readSelectionSnapshot(page);
  expect(snapshot.nested).toMatchObject({
    anchor: '**中文**尾部'.length,
    head: '**中文**尾部'.length,
    text: '**中文**尾部',
  });
  expectCaretGeometry(snapshot);

  await page.keyboard.insertText('X');
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({ nested: { text: '**中文**尾部X' } });
  await expect
    .poll(() => page.locator('.cm-content').first().textContent())
    .toContain('**中文**尾部X');
});

test('keeps click point and caret aligned after activating a formatted cell', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Styled    | Other |',
      '| --------- | ----- |',
      '| **alpha** | value |',
      '',
      'after',
    ].join('\n'),
  );

  const cell = dataCell(page, 0, 0);
  const click = await cell.locator('.tbl-cell-view').evaluate((surface) => {
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const index = textNode.data.indexOf('a');

      if (index < 0 || getComputedStyle(textNode.parentElement!).display === 'none') {
        continue;
      }

      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      const rect = range.getBoundingClientRect();

      return {
        x: rect.left + 1,
        y: rect.top + rect.height / 2,
      };
    }

    throw new Error('Visible glyph a was not found');
  });

  await page.mouse.click(click.x, click.y);

  const cellEditor = page.locator('.tbl-cell-editor .cm-content:visible');
  await expect(cellEditor).toHaveText('**alpha**');
  await expect(cellEditor.locator('.lm-table-token-mark')).toHaveCount(2);
  await expect(cellEditor.locator('.lm-table-token-mark').first()).toBeHidden();

  const snapshot = await readSelectionSnapshot(page);
  expectCaretGeometry(snapshot);
  expect(snapshot.nested.caretRect).not.toBeNull();
  expect(
    Math.abs((snapshot.nested.caretRect?.left ?? 0) - click.x),
  ).toBeLessThanOrEqual(3);
  expect(
    Math.abs((snapshot.nested.caretRect?.top ?? 0) - click.y),
  ).toBeLessThanOrEqual(12);

  const insertionOffset = snapshot.nested.head;
  await page.keyboard.insertText('X');
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({
      nested: {
        head: insertionOffset + 1,
        text: `${snapshot.nested.text.slice(0, insertionOffset)}X${snapshot.nested.text.slice(insertionOffset)}`,
      },
    });
});

test('places a caret in an empty cell from a real click', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Empty | Other |',
      '| ----- | ----- |',
      '|       | value |',
      '',
      'after',
    ].join('\n'),
  );

  await clickCellAtVisualEdge(page, dataCell(page, 0, 0), 'start');

  const snapshot = await readSelectionSnapshot(page);
  expect(snapshot.nested).toMatchObject({
    anchor: 0,
    head: 0,
    text: '',
  });
  expectCaretGeometry(snapshot);

  await page.keyboard.insertText('空');
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({
      nested: {
        anchor: 1,
        head: 1,
        text: '空',
      },
    });
});

test('preserves the visual goal x when ArrowDown and ArrowUp move between cells', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content  | Other |',
      '| -------- | ----- |',
      '| iiiiiiQ  | one   |',
      '| WWWWWW   | two   |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 0, 0), 'Q', 0.05);
  const origin = await readSelectionSnapshot(page);
  expect(origin.nested).toMatchObject({ text: 'iiiiiiQ', anchor: 6, head: 6 });
  expectCaretGeometry(origin);

  await page.keyboard.press('ArrowDown');
  const below = await readSelectionSnapshot(page);
  expect(below.nested.text).toBe('WWWWWW');
  expectCaretGeometry(below);
  expect(
    Math.abs(
      (below.nested.caretRect?.left ?? 0) -
        (origin.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(8);

  await page.keyboard.press('ArrowUp');
  const returned = await readSelectionSnapshot(page);
  expect(returned.nested.text).toBe('iiiiiiQ');
  expectCaretGeometry(returned);
  expect(
    Math.abs(
      (returned.nested.caretRect?.left ?? 0) -
        (origin.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
});

test('maps ArrowDown from a forward non-collapsed selection by the focus x', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| iiiiiiQ | one   |',
      '| iiiiiiQ | two   |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 0, 0), 'i', 0.05);
  const activeCellEditor = page.locator(
    '.tbl-cell-editor .cm-content:visible',
  );
  await activeCellEditor.press('Home');
  await activeCellEditor.press('Shift+End');
  const selected = await readSelectionSnapshot(page);
  expect(selected.nested).toMatchObject({
    anchor: 0,
    head: 7,
    text: 'iiiiiiQ',
  });
  expect(
    Math.abs(
      selected.caretRect.left - (selected.nested.caretRect?.left ?? 0),
    ),
  ).toBeGreaterThan(8);

  await page.keyboard.press('ArrowDown');
  const moved = await readSelectionSnapshot(page);
  expect(moved.nested).toMatchObject({
    anchor: 7,
    head: 7,
    text: 'iiiiiiQ',
  });
  expect(
    Math.abs(
      (moved.nested.caretRect?.left ?? 0) -
        (selected.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
});

test('maps ArrowUp from a reverse non-collapsed selection by the focus x', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| iiiiiiQ | one   |',
      '| iiiiiiQ | two   |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 1, 0), 'Q', 0.95);
  const activeCellEditor = page.locator(
    '.tbl-cell-editor .cm-content:visible',
  );
  await activeCellEditor.press('End');
  await activeCellEditor.press('Shift+Home');
  const selected = await readSelectionSnapshot(page);
  expect(selected.nested).toMatchObject({
    anchor: 7,
    head: 0,
    text: 'iiiiiiQ',
  });

  await page.keyboard.press('ArrowUp');
  const moved = await readSelectionSnapshot(page);
  expect(moved.nested).toMatchObject({
    anchor: 0,
    head: 0,
    text: 'iiiiiiQ',
  });
  expect(
    Math.abs(
      (moved.nested.caretRect?.left ?? 0) -
        (selected.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
});

test('restores the original visual goal x after ArrowDown crosses a short cell', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| iiiiiiQ | one   |',
      '| W       | two   |',
      '| iiiiiiZ | three |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 0, 0), 'Q', 0.05);
  const origin = await readSelectionSnapshot(page);
  expect(origin.nested).toMatchObject({ text: 'iiiiiiQ', head: 6 });

  await page.keyboard.press('ArrowDown');
  const clamped = await readSelectionSnapshot(page);
  expect(clamped.nested).toMatchObject({ text: 'W', head: 1 });

  await page.keyboard.press('ArrowDown');
  const restored = await readSelectionSnapshot(page);
  expect(restored.nested.text).toBe('iiiiiiZ');
  expectCaretGeometry(restored);
  expect(
    Math.abs(
      (restored.nested.caretRect?.left ?? 0) -
        (origin.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
});

test('restores the original visual goal x after ArrowUp crosses a short cell', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| iiiiiiQ | one   |',
      '| W       | two   |',
      '| iiiiiiZ | three |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 2, 0), 'Z', 0.05);
  const origin = await readSelectionSnapshot(page);
  expect(origin.nested).toMatchObject({ text: 'iiiiiiZ', head: 6 });

  await page.keyboard.press('ArrowUp');
  const clamped = await readSelectionSnapshot(page);
  expect(clamped.nested).toMatchObject({ text: 'W', head: 1 });

  await page.keyboard.press('ArrowUp');
  const restored = await readSelectionSnapshot(page);
  expect(restored.nested.text).toBe('iiiiiiQ');
  expectCaretGeometry(restored);
  expect(
    Math.abs(
      (restored.nested.caretRect?.left ?? 0) -
        (origin.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
});

test('resets the vertical goal x after the mouse repositions the caret', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| iiiiiiQ | one   |',
      '| W       | two   |',
      '| iiiiiiZ | three |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 0, 0), 'Q', 0.05);
  const originalGoal = await readSelectionSnapshot(page);
  await page.keyboard.press('ArrowDown');

  await clickActiveCellAtStart(page);
  const relocated = await readSelectionSnapshot(page);
  expect(relocated.nested).toMatchObject({ text: 'W', head: 0 });

  await page.keyboard.press('ArrowDown');
  const below = await readSelectionSnapshot(page);
  expect(below.nested.text).toBe('iiiiiiZ');
  expect(
    Math.abs(
      (below.nested.caretRect?.left ?? 0) -
        (relocated.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (below.nested.caretRect?.left ?? 0) -
        (originalGoal.nested.caretRect?.left ?? 0),
    ),
  ).toBeGreaterThan(8);
});

test('resets the vertical goal x after editing the clamped cell', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      '| iiiiiiQ | one   |',
      '| i       | two   |',
      '| iiiiiiZ | three |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 0, 0), 'Q', 0.05);
  const originalGoal = await readSelectionSnapshot(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('X');
  const edited = await readSelectionSnapshot(page);
  expect(edited.nested).toMatchObject({ text: 'iX', head: 2 });

  await page.keyboard.press('ArrowDown');
  const below = await readSelectionSnapshot(page);
  expect(below.nested.text).toBe('iiiiiiZ');
  expect(
    Math.abs(
      (below.nested.caretRect?.left ?? 0) -
        (edited.nested.caretRect?.left ?? 0),
    ),
  ).toBeLessThanOrEqual(8);
  expect(
    Math.abs(
      (below.nested.caretRect?.left ?? 0) -
        (originalGoal.nested.caretRect?.left ?? 0),
    ),
  ).toBeGreaterThan(8);
});

test('maps real clicks in left, center, and right aligned cells to their insertions', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Left | Center | Right |',
      '| :--- | :----: | ----: |',
      '| Lx   | Cx     | Rx    |',
      '',
      'after',
    ].join('\n'),
  );

  for (const [col, original, inserted] of [
    [0, 'Lx', 'L中x'],
    [1, 'Cx', 'C中x'],
    [2, 'Rx', 'R中x'],
  ] as const) {
    await clickVisibleGlyph(page, dataCell(page, 0, col), 'x', 0.05);
    const before = await readSelectionSnapshot(page);
    expect(before.nested).toMatchObject({
      anchor: 1,
      head: 1,
      text: original,
    });
    expectCaretGeometry(before);

    await page.keyboard.insertText('中');
    await expect
      .poll(() => readSelectionSnapshot(page))
      .toMatchObject({ nested: { anchor: 2, head: 2, text: inserted } });
    await page.locator('.cm-line', { hasText: 'after' }).click();
  }

  const root = await readRootSource(page);
  expect(root.text).toContain('| L中x');
  expect(root.text).toContain('| C中x');
  expect(root.text).toContain('| R中x');
});

test('keeps wrapped formatted clicks, caret geometry, and source insertion aligned', async ({
  page,
}) => {
  await openNewDocument(page);
  const visible = `${'long wrapped content '.repeat(18)}TARGET尾`;
  const sourceCell = `**${visible}**`;
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      `| ${sourceCell} | value |`,
      '',
      'after',
    ].join('\n'),
  );

  const cell = dataCell(page, 0, 0);
  await expect
    .poll(() =>
      cell.locator('.tbl-cell-view').evaluate((surface) => {
        const style = getComputedStyle(surface);

        return (
          surface.getBoundingClientRect().height /
          Number.parseFloat(style.lineHeight)
        );
      }),
    )
    .toBeGreaterThan(2);

  await clickVisibleGlyph(page, cell, '尾', 0.05);
  const insertionOffset = sourceCell.indexOf('尾');
  const before = await readSelectionSnapshot(page);
  expect(before.nested).toMatchObject({
    anchor: insertionOffset,
    head: insertionOffset,
    text: sourceCell,
  });
  expectCaretGeometry(before);

  await page.keyboard.insertText('中');
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({
      nested: {
        anchor: insertionOffset + 1,
        head: insertionOffset + 1,
        text: `${sourceCell.slice(0, insertionOffset)}中${sourceCell.slice(insertionOffset)}`,
      },
    });
});

test('keeps End on the current visual line in a wrapped formatted cell', async ({
  page,
}) => {
  await openNewDocument(page);
  const visible = `${'long wrapped content '.repeat(18)}tail`;
  const sourceCell = `**${visible}**`;
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Content | Other |',
      '| ------- | ----- |',
      `| ${sourceCell} | value |`,
      '',
      'after',
    ].join('\n'),
  );

  const cell = dataCell(page, 0, 0);
  await expect
    .poll(() =>
      cell.locator('.tbl-cell-view').evaluate((surface) => {
        const style = getComputedStyle(surface);

        return (
          surface.getBoundingClientRect().height /
          Number.parseFloat(style.lineHeight)
        );
      }),
    )
    .toBeGreaterThan(2);

  await clickVisibleGlyph(page, cell, 'long', 0.05);
  const before = await readSelectionSnapshot(page);
  await page.keyboard.press('End');
  const after = await readSelectionSnapshot(page);

  expect(after.nested.head).toBeGreaterThan(before.nested.head);
  expect(after.nested.head).toBeLessThan(sourceCell.length - 2);
  expect(after.dom.withinCellEditor).toBe(true);
  expect(
    Math.abs(after.caretRect.top - before.caretRect.top),
  ).toBeLessThanOrEqual(1);

  let finalVisualEnd = after;
  for (
    let index = 0;
    index < 10 && finalVisualEnd.nested.head < sourceCell.length - 2;
    index += 1
  ) {
    const previousHead = finalVisualEnd.nested.head;
    await page.keyboard.press('End');
    finalVisualEnd = await readSelectionSnapshot(page);
    expect(finalVisualEnd.nested.head).toBeGreaterThan(previousHead);
  }

  expect(finalVisualEnd.nested.head).toBe(sourceCell.length - 2);
  expectCaretGeometry(finalVisualEnd);

  const insertionOffset = finalVisualEnd.nested.head;
  await page.keyboard.insertText('!');
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({
      nested: {
        head: insertionOffset + 1,
        text: `${sourceCell.slice(0, insertionOffset)}!${sourceCell.slice(
          insertionOffset,
        )}`,
      },
    });
});

test('keeps first and last table cell clicks out of surrounding text', async ({
  page,
}) => {
  await openNewDocument(page);
  const source = [
    'before',
    '',
    '| First | Last |',
    '| ----- | ---- |',
    '| one   | tail |',
    '',
    'after',
  ].join('\n');
  await replaceEditorSource(page, source);

  await clickVisibleGlyph(page, headerCell(page, 0), 'F', 0.05);
  const first = await readSelectionSnapshot(page);
  expect(first.nested).toMatchObject({ anchor: 0, head: 0, text: 'First' });
  expectCaretGeometry(first);
  await page.keyboard.insertText('首');
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await clickVisibleGlyph(page, dataCell(page, 0, 1), 'l', 0.95);
  const last = await readSelectionSnapshot(page);
  expect(last.nested).toMatchObject({ anchor: 4, head: 4, text: 'tail' });
  expectCaretGeometry(last);
  await page.keyboard.insertText('尾');
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const edited = (await readRootSource(page)).text;
  expect(edited.startsWith('before\n\n')).toBe(true);
  expect(edited.endsWith('\n\nafter')).toBe(true);
  expect(edited).toContain('首First');
  expect(edited).toContain('tail尾');
});

test('preserves IME, undo-redo, and live-source-live round trips after a real click', async ({
  context,
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| Text  | Other |',
      '| ----- | ----- |',
      '| alpha | value |',
      '',
      'after',
    ].join('\n'),
  );

  await clickVisibleGlyph(page, dataCell(page, 0, 0), 'p', 0.05);
  const initial = await readSelectionSnapshot(page);
  expectCaretGeometry(initial);
  const insertionOffset = initial.nested.head;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', {
    selectionEnd: 1,
    selectionStart: 1,
    text: '中',
  });
  await cdp.send('Input.insertText', { text: '中' });

  const composedText = `${initial.nested.text.slice(0, insertionOffset)}中${initial.nested.text.slice(insertionOffset)}`;
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({
      nested: {
        anchor: insertionOffset + 1,
        head: insertionOffset + 1,
        text: composedText,
      },
    });

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({ nested: { text: initial.nested.text } });

  const afterCompositionUndo = await readSelectionSnapshot(page);
  expectCaretGeometry(afterCompositionUndo);
  await page.keyboard.insertText('X');
  const regularOffset = afterCompositionUndo.nested.head;
  const regularText = `${initial.nested.text.slice(0, regularOffset)}X${initial.nested.text.slice(regularOffset)}`;
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({ nested: { text: regularText } });
  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect
    .poll(() => readSelectionSnapshot(page))
    .toMatchObject({ nested: { text: initial.nested.text } });
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
  );

  await page.locator('.cm-line', { hasText: 'after' }).click();
  const editedSource = (await readRootSource(page)).text;
  expect(editedSource).toContain(regularText);
  await switchEditorMode(page, 'source');
  expect((await readRootSource(page)).text).toBe(editedSource);
  await switchEditorMode(page, 'livePreview');
  await expect(page.locator('.tbl-table-widget')).toBeVisible();
  expect((await readRootSource(page)).text).toBe(editedSource);
});
