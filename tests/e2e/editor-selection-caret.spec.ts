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

type GestureSample = CaretSample & {
  collapsed: boolean;
  from: number;
  head: number;
  type: string;
};

type DragScenario = {
  id: string;
  source: string;
  startText: string;
  endText: string;
  ready?: (page: Page) => Promise<void>;
};

async function installGestureObserver(page: Page): Promise<void> {
  await page.evaluate((hiddenClass) => {
    const samples: Array<{
      caretColor: string;
      collapsed: boolean;
      from: number;
      head: number;
      hiddenClass: boolean;
      selectedText: string;
      type: string;
    }> = [];
    (
      window as Window & {
        __lumamarkSelectionCaretSamples?: typeof samples;
      }
    ).__lumamarkSelectionCaretSamples = samples;
    const record = (type: string) => {
      const content = document.querySelector('.cm-content');
      const view = (
        content as RootEditorContentTestBridge | null
      )?.resolveRootEditorViewForTest?.();
      if (!content || !view) {
        return;
      }
      const selection = view.state.selection.main;
      samples.push({
        caretColor: getComputedStyle(content).caretColor,
        collapsed: selection.from === selection.to,
        from: selection.from,
        head: selection.head,
        hiddenClass: content.classList.contains(hiddenClass),
        selectedText: view.state.doc.sliceString(selection.from, selection.to),
        type,
      });
    };
    for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
      window.addEventListener(type, (event) => {
        if (type === 'mousemove' && event.buttons === 0) {
          return;
        }
        record(type);
      });
    }
  }, SELECTION_CARET_HIDDEN_CLASS);
}

async function readGestureSamples(page: Page): Promise<GestureSample[]> {
  return page.evaluate(() => {
    const samples = (
      window as Window & {
        __lumamarkSelectionCaretSamples?: GestureSample[];
      }
    ).__lumamarkSelectionCaretSamples;
    return samples ? [...samples] : [];
  });
}

async function resetGestureSamples(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as Window & {
      __lumamarkSelectionCaretSamples?: GestureSample[];
    };
    if (holder.__lumamarkSelectionCaretSamples) {
      holder.__lumamarkSelectionCaretSamples.length = 0;
    }
  });
}

async function pointOnRenderedText(
  page: Page,
  text: string,
  fraction: number,
): Promise<Point> {
  return page.evaluate(
    ({ fraction: horizontalFraction, targetText }) => {
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
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + targetText.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width * horizontalFraction,
          y: rect.top + rect.height / 2,
        };
      }

      throw new Error(`Unable to locate rendered text: ${targetText}`);
    },
    { fraction, targetText: text },
  );
}

function expectHeldRangeStable(samples: GestureSample[], context: string): void {
  const heldIndex = samples.findIndex(
    (sample) => sample.type === 'mousemove' && !sample.collapsed,
  );
  expect(heldIndex, `never expanded: ${context}`).toBeGreaterThanOrEqual(0);
  const mouseupIndex = samples.findIndex((sample) => sample.type === 'mouseup');
  const held = samples.slice(
    heldIndex,
    mouseupIndex < 0 ? samples.length : mouseupIndex + 1,
  );
  const collapsedAfterExpand = held.filter((sample) => sample.collapsed);
  expect(
    collapsedAfterExpand,
    `collapsed during hold: ${context}`,
  ).toEqual([]);
  const first = held[0];
  for (const sample of held) {
    expect(sample.from, context).toBe(first.from);
    expect(sample.hiddenClass, context).toBe(true);
    expect(isTransparentCaret(sample.caretColor), context).toBe(true);
    expect(sample.selectedText.length, context).toBeGreaterThan(0);
  }
  const heads = held.map((sample) => sample.head);
  for (let index = 1; index < heads.length; index += 1) {
    const delta = heads[index] - first.from;
    const previousDelta = heads[index - 1] - first.from;
    expect(
      Math.abs(delta),
      `head jumped backward: ${context} ${JSON.stringify(heads)}`,
    ).toBeGreaterThanOrEqual(Math.abs(previousDelta));
  }
}

const tinySvgDataUrl =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#247c5a"/></svg>',
  );

const dragScenarios: DragScenario[] = [
  {
    id: 'plain',
    source: '前缀文本 第二段落普通文字 后缀文字',
    startText: '第二段落普通文字',
    endText: '第二段落普通文字',
  },
  {
    id: 'bold',
    source: '前缀文本 **加粗内容** 后缀文字',
    startText: '前缀文本',
    endText: '后缀文字',
  },
  {
    id: 'italic',
    source: '前缀文本 *斜体内容* 后缀文字',
    startText: '前缀文本',
    endText: '后缀文字',
  },
  {
    id: 'strikethrough',
    source: '前缀文本 ~~删除内容~~ 后缀文字',
    startText: '前缀文本',
    endText: '后缀文字',
  },
  {
    id: 'inline-code',
    source: '前缀文本 `行内代码` 后缀文字',
    startText: '前缀文本',
    endText: '后缀文字',
  },
  {
    id: 'inline-math',
    source: '前缀文本 $E=mc^2$ 后缀文字',
    startText: '前缀文本',
    endText: '后缀文字',
    ready: async (page) => {
      await expect(page.locator('.lm-math-render').first()).toBeVisible({
        timeout: 15_000,
      });
    },
  },
  {
    id: 'link',
    source: '前缀文本 [链接文本](https://example.com) 后缀文字',
    startText: '前缀文本',
    endText: '后缀文字',
  },
  {
    id: 'mixed-inline',
    source: '前缀文本 **粗体字** *斜体字* ~~删除字~~ `代码字` $x$ 后缀文字',
    startText: '前缀文本',
    endText: '后缀文字',
  },
  {
    id: 'image',
    source: ['上方文字', '', `![fixture](${tinySvgDataUrl})`, '', '下方文字'].join(
      '\n',
    ),
    startText: '上方文字',
    endText: '下方文字',
    ready: async (page) => {
      await expect(page.locator('.lm-image-preview img')).toBeVisible();
    },
  },
  {
    id: 'mermaid',
    source: [
      '上方文字',
      '',
      '```mermaid',
      'flowchart LR',
      '  A-->B',
      '```',
      '',
      '下方文字',
    ].join('\n'),
    startText: '上方文字',
    endText: '下方文字',
    ready: async (page) => {
      await expect(page.locator('.lm-mermaid-svg > svg')).toBeVisible();
    },
  },
  {
    id: 'code-block',
    source: [
      '上方文字',
      '',
      '```ts',
      'const value = 1',
      '```',
      '',
      '下方文字',
    ].join('\n'),
    startText: '上方文字',
    endText: '下方文字',
    ready: async (page) => {
      await expect(page.locator('.lm-md-code-block-line').first()).toBeVisible();
    },
  },
  {
    id: 'display-math',
    source: ['上方文字', '', '$$', 'E = mc^2', '$$', '', '下方文字'].join('\n'),
    startText: '上方文字',
    endText: '下方文字',
    ready: async (page) => {
      await expect(page.locator('.lm-math-block-render').first()).toBeVisible({
        timeout: 15_000,
      });
    },
  },
];

test.describe('live-preview drag caret matrix', () => {
  for (const scenario of dragScenarios) {
    test(`drag across ${scenario.id} stays a range and hides the caret during the press`, async ({
      page,
    }) => {
      const editor = await openNewDocument(page);
      await installGestureObserver(page);
      await replaceSource(editor, page, scenario.source);
      await scenario.ready?.(page);
      await afterLayout(page);
      await resetGestureSamples(page);

      const start = await pointOnRenderedText(page, scenario.startText, 0.15);
      const end = await pointOnRenderedText(page, scenario.endText, 0.85);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      const dragging = await readCaretSample(editor);
      await page.mouse.up();
      await afterLayout(page);
      const released = await readCaretSample(editor);
      const samples = await readGestureSamples(page);
      const context = JSON.stringify({
        dragging,
        released,
        samples,
        scenario: scenario.id,
      });

      expectHeldRangeStable(samples, context);
      expectCaretHidden(dragging, `dragging ${context}`);
      expectCaretHidden(released, `released ${context}`);

      await page.mouse.click(end.x, end.y);
      await afterLayout(page);
      expectCaretVisible(await readCaretSample(editor), `collapsed ${scenario.id}`);
    });
  }
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
