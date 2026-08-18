import { expect, test, type Locator, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from './support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const source = [
  '# 标题一级文本',
  '',
  '前缀文本 **加粗内容** 与 [链接文本](https://example.com) 与 `codeSpan` 后缀文字',
  '',
  '第二段落普通文字内容用于对照观察',
  '',
  '- 列表项文字内容',
].join('\n');

type Selection = {
  anchor: number;
  domCollapsed: boolean;
  head: number;
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

async function readSelection(editor: Locator): Promise<Selection> {
  return editor.evaluate((content) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    const selection = view.state.selection.main;
    const domSelection = window.getSelection();
    return {
      anchor: selection.anchor,
      domCollapsed: domSelection ? domSelection.isCollapsed : true,
      head: selection.head,
      selectedText: view.state.doc.sliceString(selection.from, selection.to),
    };
  });
}

async function moveSelection(editor: Locator, anchor: number): Promise<void> {
  await editor.evaluate((content, position) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    view.dispatch({ selection: { anchor: position } });
    view.focus();
  }, anchor);
}

async function afterLayout(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
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

test('a live-preview single click never paints a transient selection', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
  await afterLayout(page);

  const targets = [
    { caretBefore: source.indexOf('列表项文字'), text: '标题一级文本' },
    { caretBefore: 1, text: '加粗内容' },
    { caretBefore: 1, text: '链接文本' },
    { caretBefore: 1, text: '第二段落普通文字' },
    { caretBefore: source.indexOf('标题一级文本'), text: '列表项文字内容' },
  ] as const;

  for (const target of targets) {
    const from = source.indexOf(target.text);
    const to = from + target.text.length;

    for (const jitter of [0, 1, 2, 3]) {
      await moveSelection(editor, target.caretBefore);
      await afterLayout(page);
      const point = await centerOfRenderedText(page, target.text);

      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      const pressed = await readSelection(editor);
      if (jitter > 0) {
        await page.mouse.move(point.x + jitter, point.y);
      }
      const jittered = await readSelection(editor);
      await page.mouse.up();
      await afterLayout(page);
      const released = await readSelection(editor);

      const context = JSON.stringify({
        jitter,
        jittered,
        pressed,
        released,
        text: target.text,
      });
      for (const phase of [pressed, jittered, released]) {
        expect(phase.selectedText, context).toBe('');
        expect(phase.anchor, context).toBe(phase.head);
        expect(phase.domCollapsed, context).toBe(true);
      }
      expect(released.head, context).toBeGreaterThanOrEqual(from);
      expect(released.head, context).toBeLessThanOrEqual(to);
      expect(pressed.head, context).toBe(released.head);
    }
  }
});

test('a live-preview drag past the click slop still selects a range', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
  await afterLayout(page);
  await moveSelection(editor, 1);
  await afterLayout(page);

  const start = await centerOfRenderedText(page, '第二段落普通文字');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y, { steps: 4 });
  const dragging = await readSelection(editor);
  await page.mouse.up();
  await afterLayout(page);
  const released = await readSelection(editor);

  expect(dragging.selectedText.length).toBeGreaterThan(0);
  expect(released.selectedText).toBe(dragging.selectedText);
  expect(released.anchor).toBe(dragging.anchor);
});
