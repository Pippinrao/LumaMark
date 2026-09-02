import { expect, test, type Locator, type Page } from '@playwright/test';
import { canonicalizeTableFixtures } from './support/canonicalTableFixture';
import { openBlankDocument } from './support/openBlankDocument';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from './support/rootEditorViewTestBridge';

const SELECTION_CARET_HIDDEN_CLASS = 'lm-editor-selection-caret-hidden';
const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

type CaretSample = {
  caretColor: string;
  hiddenClass: boolean;
  selectedText: string;
};

type Point = { x: number; y: number };

async function openNewDocument(page: Page): Promise<Locator> {
  await page.goto('/');
  await openBlankDocument(page);
  const editor = page.locator('.cm-content').first();
  await installRootEditorViewTestBridge(editor);
  return editor;
}

async function afterLayout(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function replaceSource(editor: Locator, page: Page, source: string): Promise<void> {
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
  await afterLayout(page);
}

async function readCaretSample(editor: Locator): Promise<CaretSample> {
  return editor.evaluate((content, hiddenClass) => {
    const view = (content as RootEditorContentTestBridge).resolveRootEditorViewForTest();
    const selection = view.state.selection.main;
    return {
      caretColor: getComputedStyle(content).caretColor,
      hiddenClass: content.classList.contains(hiddenClass),
      selectedText: view.state.doc.sliceString(selection.from, selection.to),
    };
  }, SELECTION_CARET_HIDDEN_CLASS);
}

function expectCaretHidden(sample: CaretSample, context: string): void {
  expect(sample.selectedText.length, context).toBeGreaterThan(0);
  expect(sample.hiddenClass, context).toBe(true);
  expect(isTransparentCaret(sample.caretColor), context).toBe(true);
}

function expectCaretVisible(sample: CaretSample, context: string): void {
  expect(sample.selectedText, context).toBe('');
  expect(sample.hiddenClass, context).toBe(false);
  expect(isTransparentCaret(sample.caretColor), context).toBe(false);
}

function isTransparentCaret(color: string): boolean {
  const normalized = color.replaceAll(' ', '').toLowerCase();
  return (
    normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === '#0000' ||
    normalized === '#00000000'
  );
}

async function centerOfRenderedText(page: Page, text: string): Promise<Point> {
  return page.evaluate((targetText) => {
    const content = document.querySelector('.cm-content');
    if (!content) {
      throw new Error('Expected editor content.');
    }
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue ?? '';
      const start = value.indexOf(targetText);
      if (start < 0) {
        continue;
      }
      const index = start + Math.floor(targetText.length / 2);
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    throw new Error(`Unable to locate rendered text: ${targetText}`);
  }, text);
}

test('a non-empty keyboard selection hides the native caret until it collapses', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await replaceSource(editor, page, 'hello world');

  await page.keyboard.press(`${primaryModifier}+A`);
  await afterLayout(page);
  expectCaretHidden(await readCaretSample(editor), 'select-all');

  await page.keyboard.press('ArrowRight');
  await afterLayout(page);
  expectCaretVisible(await readCaretSample(editor), 'collapse-after-select-all');
});

test('a live-preview drag samples a hidden caret while the button is held and after release', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await replaceSource(editor, page, '前缀文本 第二段落普通文字 后缀文字');

  const start = await centerOfRenderedText(page, '第二段落普通文字');
  await page.mouse.move(start.x - 40, start.y);
  await page.mouse.down();
  const pressed = await readCaretSample(editor);
  await page.mouse.move(start.x + 40, start.y, { steps: 4 });
  const dragging = await readCaretSample(editor);
  await page.mouse.up();
  await afterLayout(page);
  const released = await readCaretSample(editor);

  expectCaretHidden(dragging, `dragging ${JSON.stringify({ dragging, pressed })}`);
  expectCaretHidden(released, `released ${JSON.stringify(released)}`);

  await page.mouse.click(start.x, start.y);
  await afterLayout(page);
  expectCaretVisible(await readCaretSample(editor), 'collapsed-after-click');
});

test('a nested table editor hides only its own caret for a cell selection', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await replaceSource(
    editor,
    page,
    canonicalizeTableFixtures(
      [
        'before',
        '',
        '| Content | Other |',
        '| ------- | ----- |',
        '| hello world | value |',
        '',
        'after',
      ].join('\n'),
    ),
  );
  await expect(page.locator('.tbl-table-widget')).toBeVisible();

  await page.locator('.tbl-table-body .tbl-data-cell').first().click();
  const nested = page.locator('.tbl-cell-editor .cm-content:visible');
  await expect(nested).toHaveCount(1);

  await nested.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await afterLayout(page);

  const nestedSample = await nested.evaluate((content, hiddenClass) => {
    const tile = (
      content as HTMLElement & {
        cmTile?: {
          view?: {
            state: {
              doc: { sliceString(from: number, to: number): string };
              selection: { main: { from: number; to: number } };
            };
          };
        };
      }
    ).cmTile;
    const selection = tile?.view?.state.selection.main;
    if (!selection) {
      throw new Error('Nested table editor view is unavailable.');
    }
    return {
      caretColor: getComputedStyle(content).caretColor,
      hiddenClass: content.classList.contains(hiddenClass),
      selectedText: tile.view!.state.doc.sliceString(selection.from, selection.to),
    };
  }, SELECTION_CARET_HIDDEN_CLASS);
  expectCaretHidden(nestedSample, 'nested-select-all');

  const rootWhileNestedSelected = await readCaretSample(editor);
  expect(
    rootWhileNestedSelected.hiddenClass,
    `root caret class must follow the root selection, not the nested editor: ${JSON.stringify(rootWhileNestedSelected)}`,
  ).toBe(rootWhileNestedSelected.selectedText.length > 0);

  await page.keyboard.press('ArrowRight');
  await afterLayout(page);
  const nestedCollapsed = await nested.evaluate((content, hiddenClass) => ({
    caretColor: getComputedStyle(content).caretColor,
    hiddenClass: content.classList.contains(hiddenClass),
    selectedText: '',
  }), SELECTION_CARET_HIDDEN_CLASS);
  expect(nestedCollapsed.hiddenClass).toBe(false);
  expect(isTransparentCaret(nestedCollapsed.caretColor)).toBe(false);
});
