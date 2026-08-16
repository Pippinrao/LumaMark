import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
  type RootEditorViewTestBridge,
} from './support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

function canonicalTable(rows: readonly (readonly string[])[]): string {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  const formatRow = (row: readonly string[]) =>
    `| ${row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join(' | ')} |`;

  return [
    formatRow(rows[0]),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.slice(1).map(formatRow),
  ].join('\n');
}

async function replaceEditorSource(
  page: Page,
  source: string,
): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
}

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  const newDocumentButton = page.getByRole('button', {
    name: /^(?:New Document|新建文档)$/,
  });

  await newDocumentButton.click();
  await expect(newDocumentButton).toBeHidden();
}

async function clickAfterVisibleTableCellCharacter(
  page: Page,
  cellText: string,
  targetCharacter: string,
): Promise<void> {
  const cell = page
    .locator('.tbl-data-cell')
    .filter({ hasText: cellText })
    .first();
  const point = await cell.evaluate((element, character) => {
    const visibleRoot = element.querySelector<HTMLElement>('.tbl-cell-view');

    if (!visibleRoot) {
      throw new Error('Expected a visible table cell text surface');
    }

    const walker = document.createTreeWalker(
      visibleRoot,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const parent = textNode.parentElement;
      const style = parent ? window.getComputedStyle(parent) : null;
      const targetOffset = textNode.data.indexOf(character);

      if (
        style?.display === 'none' ||
        style?.visibility === 'hidden' ||
        targetOffset < 0
      ) {
        continue;
      }

      const range = document.createRange();
      range.setStart(textNode, targetOffset);
      range.setEnd(textNode, targetOffset + character.length);
      const rect = range.getBoundingClientRect();

      return {
        x: rect.left + rect.width * 0.9,
        y: (rect.top + rect.bottom) / 2,
      };
    }

    throw new Error(`Visible character ${character} was not found`);
  }, targetCharacter);

  await page.mouse.click(point.x, point.y);
}

async function readVisibleTableCellState(page: Page): Promise<{
  anchor: number;
  head: number;
  text: string;
}> {
  return page
    .locator('.tbl-cell-editor .cm-content:visible')
    .evaluate((content) => {
      const state = (
        content as HTMLElement & {
          cmTile: {
            view: {
              state: {
                doc: { toString(): string };
                selection: { main: { anchor: number; head: number } };
              };
            };
          };
        }
      ).cmTile.view.state;

      return {
        anchor: state.selection.main.anchor,
        head: state.selection.main.head,
        text: state.doc.toString(),
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
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
}

async function expectEditorSource(
  page: Page,
  source: string,
): Promise<void> {
  await switchEditorMode(page, 'source');
  await expect(
    page.locator('.lm-editor-source-mode .cm-line'),
  ).toHaveText(source.split('\n'));
}

type CodeBlockGeometry = {
  backgroundColor: string;
  language: string | null;
  pseudoColor: string;
  pseudoContent: string;
  rows: Array<{
    blockTop: number;
    drift: number;
    height: number;
    marginBottom: string;
    marginTop: string;
    paddingBottom: string;
    paddingTop: string;
    top: number;
  }>;
};

async function readCodeBlockGeometry(
  editor: Locator,
): Promise<CodeBlockGeometry> {
  return editor.evaluate((content) => {
    type GeometryView = RootEditorViewTestBridge & {
      contentDOM: HTMLElement;
      lineBlockAt(position: number): { top: number };
      state: RootEditorViewTestBridge['state'] & {
        doc: RootEditorViewTestBridge['state']['doc'] & {
          line(number: number): { from: number };
          lineAt(position: number): { number: number };
        };
      };
      viewState: { paddingTop: number };
    };

    const view = (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest() as GeometryView;
    const source = view.state.doc.toString();
    const openingFrom = source.indexOf('```ts');
    const rows = [
      ...content.querySelectorAll<HTMLElement>('.lm-md-code-block-line'),
    ];

    if (openingFrom < 0 || rows.length !== 3) {
      throw new Error('Expected one three-line TypeScript code block.');
    }

    const firstLineNumber = view.state.doc.lineAt(openingFrom).number;

    const contentBounds = view.contentDOM.getBoundingClientRect();
    const documentTop = contentBounds.top + view.viewState.paddingTop;
    const surfaceStyle = getComputedStyle(rows[0], '::before');
    const pseudoStyle = getComputedStyle(rows[0], '::after');

    return {
      backgroundColor: surfaceStyle.backgroundColor,
      language: rows[0].getAttribute('data-lm-code-language'),
      pseudoColor: pseudoStyle.color,
      pseudoContent: pseudoStyle.content,
      rows: rows.map((row, index) => {
        const bounds = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        const block = view.lineBlockAt(
          view.state.doc.line(firstLineNumber + index).from,
        );

        return {
          blockTop: block.top,
          drift: bounds.top - documentTop - block.top,
          height: bounds.height,
          marginBottom: style.marginBottom,
          marginTop: style.marginTop,
          paddingBottom: style.paddingBottom,
          paddingTop: style.paddingTop,
          top: bounds.top,
        };
      }),
    };
  });
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = parseCssColor(color).map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function parseCssColor(color: string): [number, number, number] {
  const channels = color.match(/\d*\.?\d+/g)?.slice(0, 3).map(Number);

  if (!channels || channels.length !== 3) {
    throw new Error(`Unsupported CSS color: ${color}`);
  }

  return color.startsWith('rgb')
    ? [channels[0] / 255, channels[1] / 255, channels[2] / 255]
    : [channels[0], channels[1], channels[2]];
}

async function moveCaretToOffset(page: Page, offset: number): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+Home`);

  for (let index = 0; index < offset; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
}

async function openParagraphSubmenu(
  page: Page,
  submenuName: string,
): Promise<void> {
  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  const submenu = page.getByRole('menuitem', {
    exact: true,
    name: submenuName,
  });
  await submenu.focus();
  await page.keyboard.press('ArrowRight');
}

test('renders basic markdown visually and keeps task source editable', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  const source = [
    '# 标题',
    '',
    '**粗体**',
    '',
    '> 引用内容',
    '',
    '- item',
    '  - nested item',
    '- [ ] task',
    '',
    '[Luma](https://example.com)',
    '',
    '![Tiny](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
    '',
    '---',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    'plain',
  ].join('\n');
  await page.keyboard.insertText(source);
  await page.locator('.cm-line', { hasText: 'plain' }).click();

  await expect(page.locator('.lm-md-heading-1')).toContainText('标题');
  await expect(page.locator('.lm-md-strong')).toContainText('粗体');
  await expect(page.locator('.lm-md-hidden-mark')).not.toHaveCount(0);
  await expect(page.locator('.lm-md-blockquote')).toContainText('引用内容');
  await expect(page.locator('.lm-md-unordered-list-line')).toHaveCount(2);
  await expect(page.locator('.lm-md-list-bullet')).toHaveCount(2);
  await expect(page.locator('.lm-md-task-checkbox')).toBeVisible();
  await expect(page.locator('.lm-md-link')).toContainText('Luma');
  await expect(page.getByRole('img', { name: 'Tiny' })).toBeVisible();
  await expect(page.locator('.lm-md-horizontal-rule')).toBeVisible();
  await expect(
    page.locator('.lm-md-code-block-line', { hasText: 'const x = 1' }),
  ).toBeVisible();

  await page.locator('.lm-md-task-checkbox').click();
  await expectEditorSource(page, source.replace('- [ ] task', '- [x] task'));

  await page.keyboard.press('Control+Z');
  await expectEditorSource(page, source);
});

for (const { expected, key, name } of [
  {
    expected: 'plain\n\n',
    key: 'Enter',
    name: 'Enter creates a new paragraph',
  },
  {
    expected: 'plain\n',
    key: 'Shift+Enter',
    name: 'Shift+Enter creates a soft line break',
  },
] as const) {
  test(`${name} in an ordinary paragraph`, async ({ page }) => {
    await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
    await replaceEditorSource(page, 'plain');

    await page.keyboard.press(key);

    await expectEditorSource(page, expected);
  });
}

test('Enter adds only one line break when the caret is already on an empty line', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await replaceEditorSource(page, 'before\n\nafter');
  await page.keyboard.press(`${primaryModifier}+Home`);
  await page.keyboard.press('ArrowDown');

  await page.keyboard.press('Enter');

  await expectEditorSource(page, 'before\n\n\nafter');
});

test('reveals only the current adjacent or nested inline owner', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  const source = '**outer *内层* tail** and **second**';
  await replaceEditorSource(page, source);
  const line = page.locator('.cm-line').first();

  await moveCaretToOffset(page, source.indexOf('内层') + 1);
  await expect(line).toHaveText(
    'outer *内层* tail and second',
  );
  await expect(line.locator('.lm-md-source-mark-inline')).toHaveCount(2);

  await moveCaretToOffset(page, source.indexOf('second') + 1);
  await expect(line).toHaveText(
    'outer 内层 tail and **second**',
  );

  await expectEditorSource(page, source);
});

for (const {
  expectedAfterExit,
  expectedContinuation,
  initial,
  name,
} of [
  {
    expectedAfterExit: '- item\n- next\n\n',
    expectedContinuation: '- item\n- next',
    initial: '- item',
    name: 'unordered list',
  },
  {
    expectedAfterExit: '> quote\n> next\n\n',
    expectedContinuation: '> quote\n> next',
    initial: '> quote',
    name: 'blockquote',
  },
] as const) {
  test(`uses official continuation and exit behavior for ${name}`, async ({
    page,
  }) => {
    await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
    await replaceEditorSource(page, initial);

    await page.keyboard.press('Enter');
    await page.keyboard.insertText('next');
    await expectEditorSource(page, expectedContinuation);

    await switchEditorMode(page, 'livePreview');
    const editor = page.locator('.cm-content').first();
    await editor.click();
    await page.keyboard.press(`${primaryModifier}+End`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    await expectEditorSource(page, expectedAfterExit);
  });
}

test('indents and unindents the current list item with Tab and Shift+Tab', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  const flatList = '- parent\n- child';
  const nestedList = '- parent\n  - child';
  await replaceEditorSource(page, flatList);

  await page.keyboard.press('Tab');
  await expectEditorSource(page, nestedList);

  await switchEditorMode(page, 'livePreview');
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+End`);
  await page.keyboard.press('Shift+Tab');

  await expectEditorSource(page, flatList);
});

for (const { key, name } of [
  {
    key: 'Space',
    name: 'Space',
  },
  {
    key: 'Enter',
    name: 'Enter',
  },
] as const) {
  test(`focuses a task checkbox with Tab and toggles it with ${name}`, async ({
    page,
  }) => {
    await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
    await replaceEditorSource(page, '- [ ] task\n\nplain');
    const editor = page.locator('.cm-content').first();
    const checkbox = page.getByRole('checkbox', {
      name: /切换任务完成状态|Toggle task completion/,
    });
    await expect(checkbox).toBeVisible();

    await page.locator('.cm-line', { hasText: 'plain' }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(checkbox).toBeFocused();

    await page.keyboard.press(key);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeFocused();

    await page.keyboard.press(key);
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeFocused();
    await expectEditorSource(page, '- [ ] task\n\nplain');
  });
}

for (const { expected, initial, name } of [
  {
    expected: '- parent\n    - [x] nested task',
    initial: '- parent\n    - [ ] nested task',
    name: 'a deeply nested task',
  },
  {
    expected: '> - [x] quoted task',
    initial: '> - [ ] quoted task',
    name: 'a task inside a blockquote',
  },
] as const) {
  test(`toggles ${name} with Mod-Enter`, async ({ page }) => {
    await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
    await replaceEditorSource(page, initial);

    await page.keyboard.press(`${primaryModifier}+Enter`);

    await expectEditorSource(page, expected);
  });
}

test('reveals the complete marker path for nested blockquote content', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await replaceEditorSource(
    page,
    '> > nested\n\n> - [ ] quoted task',
  );

  const nestedLine = page.locator('.cm-line', { hasText: 'nested' });
  await nestedLine.click();
  await expect(nestedLine).toHaveText('> > nested');

  const quotedTaskLine = page.locator('.cm-line', {
    hasText: 'quoted task',
  });
  await quotedTaskLine.click();
  await expect(quotedTaskLine).toHaveText('> - [ ] quoted task');
});

test('reveals only the active marker path in a multi-line blockquote', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(page, '> first\n> second\n\nplain');

  const firstLine = page.locator('.cm-line', { hasText: 'first' });
  const secondLine = page.locator('.cm-line', { hasText: 'second' });
  await moveCaretToOffset(page, '> first\n> '.length);

  await expect(firstLine).toHaveText(' first');
  await expect(secondLine).toHaveText('> second');
  await expect(secondLine.locator('.lm-md-source-mark-block')).toHaveText('>');
});

test('creates one multi-paragraph blockquote from the paragraph menu', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await replaceEditorSource(page, 'first\n\nsecond');
  await page.keyboard.press(`${primaryModifier}+A`);

  await openParagraphSubmenu(page, '块');
  await page.getByRole('menuitem', { name: '引用' }).click();

  await expectEditorSource(page, '> first\n>\n> second');
});

test('keeps foundational markdown source available in source mode', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      '> quote',
      '',
      '- bullet',
      '',
      '[Luma](https://example.com)',
      '',
      '![Tiny](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
      '',
      '---',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
      'plain',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'plain' }).click();

  await expect(page.locator('.lm-md-blockquote')).toContainText('quote');
  await expect(page.locator('.lm-md-list-bullet')).toBeVisible();
  await expect(page.locator('.lm-md-link')).toContainText('Luma');
  await expect(page.getByRole('img', { name: 'Tiny' })).toBeVisible();
  await expect(page.locator('.lm-md-horizontal-rule')).toBeVisible();
  await expect(
    page.locator('.lm-md-code-block-line', { hasText: 'const x = 1' }),
  ).toBeVisible();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();

  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await expect(editor).toContainText('> quote');
  await expect(editor).toContainText('- bullet');
  await expect(editor).toContainText('[Luma](https://example.com)');
  await expect(editor).toContainText('![Tiny]');
  await expect(editor).toContainText('---');
  await expect(editor).toContainText('```js');
});

test('keeps fenced code blocks editable with stable preview row layout', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['```ts', 'const value = 1', 'console.log(value)', '```', '', 'plain'].join(
      '\n',
    ),
  );

  const codeLine = page.locator('.lm-md-code-block-line', {
    hasText: 'const value = 1',
  });
  await expect(codeLine).toBeVisible();

  await codeLine.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(';');

  await expect(editor).toContainText('const value = 1;');

  const layout = await page.evaluate(() => {
    const codeRows = [...document.querySelectorAll('.lm-md-code-block-line')];
    const plainRow = [...document.querySelectorAll('.cm-line')].find((line) =>
      line.textContent?.includes('plain'),
    );

    return {
      codeHeights: codeRows.map((row) => row.getBoundingClientRect().height),
      plainHeight: plainRow?.getBoundingClientRect().height ?? 0,
    };
  });

  expect(layout.plainHeight).toBeGreaterThan(0);
  expect(layout.codeHeights.length).toBeGreaterThanOrEqual(3);
  for (const height of layout.codeHeights) {
    expect(height).toBeLessThanOrEqual(layout.plainHeight * 1.2);
  }
});

test('auto-completes a genuinely typed fence as one undoable live-preview event', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(page, 'anchor');

  const editor = page.locator('.cm-content').first();
  await page.keyboard.press('Enter');
  await page.keyboard.type('```ts');
  await page.keyboard.press('Enter');
  await installRootEditorViewTestBridge(editor);

  const readState = () =>
    editor.evaluate((content) => {
      const view = (content as RootEditorContentTestBridge)
        .resolveRootEditorViewForTest();

      return {
        anchor: view.state.selection.main.anchor,
        source: view.state.doc.toString(),
      };
    });
  const completedSource = 'anchor\n\n```ts\n\n```';

  await expect.poll(readState).toEqual({
    anchor: 'anchor\n\n```ts\n'.length,
    source: completedSource,
  });
  await expect(page.locator('.lm-md-code-block-line')).toHaveCount(3);

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect.poll(readState).toMatchObject({ source: 'anchor\n\n```ts' });

  const redoShortcut =
    process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
  await page.keyboard.press(redoShortcut);
  await expect.poll(readState).toEqual({
    anchor: 'anchor\n\n```ts\n'.length,
    source: completedSource,
  });

  await page.keyboard.press(`${primaryModifier}+End`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('outside');
  await expect.poll(readState).toMatchObject({
    source: `${completedSource}\n\noutside`,
  });

  await switchEditorMode(page, 'source');
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type('~~~shell');
  await page.keyboard.press('Enter');

  await expect.poll(readState).toMatchObject({ source: '~~~shell\n' });
});

test('keeps clipboard paste and IME composition literal until explicit Enter', async ({
  context,
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(page, '');

  const editor = page.locator('.cm-content').first();
  await installRootEditorViewTestBridge(editor);
  const readSource = () =>
    editor.evaluate((content) =>
      (content as RootEditorContentTestBridge)
        .resolveRootEditorViewForTest()
        .state.doc.toString(),
    );

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await editor.click();
  await page.evaluate(async (text) => navigator.clipboard.writeText(text), '```ts');
  await page.keyboard.press(`${primaryModifier}+V`);
  await expect.poll(readSource).toBe('```ts');

  await page.keyboard.press('Enter');
  await expect.poll(readSource).toBe('```ts\n\n```');
  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect.poll(readSource).toBe('```ts');

  await replaceEditorSource(page, '');
  await editor.click();
  const cdp = await context.newCDPSession(page);

  try {
    await cdp.send('Input.imeSetComposition', {
      selectionEnd: '~~~shell'.length,
      selectionStart: '~~~shell'.length,
      text: '~~~shell',
    });
    await expect.poll(readSource).toBe('~~~shell');
    await page.keyboard.press('Enter');
    await expect
      .poll(readSource)
      .toMatch(/^~~~shell(?:\n\n)?$/);

    await replaceEditorSource(page, '');
    await editor.click();
    await cdp.send('Input.imeSetComposition', {
      selectionEnd: '~~~shell'.length,
      selectionStart: '~~~shell'.length,
      text: '~~~shell',
    });
    await expect.poll(readSource).toBe('~~~shell');
    await cdp.send('Input.insertText', { text: '~~~shell' });
    await expect.poll(readSource).toBe('~~~shell');
  } finally {
    await cdp.detach();
  }

  await page.keyboard.press('Enter');
  await expect.poll(readSource).toBe('~~~shell\n\n~~~');
  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect.poll(readSource).toBe('~~~shell');
});

test('shows a focused language badge without changing code block geometry', async ({
  page,
}) => {
  await openNewDocument(page);
  const source = [
    'before',
    '',
    '```ts',
    'const value = 1',
    '```',
    '',
    'after',
  ].join('\n');
  await replaceEditorSource(page, source);

  const editor = page.locator('.cm-content').first();
  await installRootEditorViewTestBridge(editor);
  await page.locator('.cm-line', { hasText: 'after' }).click();
  const inactive = await readCodeBlockGeometry(editor);

  expect(inactive.language).toBeNull();
  for (const row of inactive.rows) {
    expect(Math.abs(row.drift)).toBeLessThanOrEqual(0.5);
    expect(row).toMatchObject({
      marginBottom: '0px',
      marginTop: '0px',
    });
    expect(row.paddingBottom).toBe(inactive.rows[0].paddingBottom);
    expect(row.paddingTop).toBe(inactive.rows[0].paddingTop);
  }

  const codeBody = page.locator('.lm-md-code-block-line').nth(1);
  await codeBody.click();
  await expect(page.locator('.lm-md-code-block-active')).toHaveCount(3);
  const openingLine = page.locator('.lm-md-code-block-start');
  await expect(openingLine).toHaveAttribute(
    'data-lm-code-language',
    'TypeScript',
  );
  await expect(openingLine).toHaveAttribute('aria-description', 'TypeScript');
  await expect(codeBody).toHaveAttribute('aria-description', 'TypeScript');
  await expect(editor).toHaveAttribute('aria-description', 'TypeScript');

  const lightActive = await readCodeBlockGeometry(editor);
  expect(lightActive.pseudoContent.replaceAll('"', '')).toBe('TypeScript');
  expect(
    contrastRatio(lightActive.pseudoColor, lightActive.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);

  for (const [index, row] of lightActive.rows.entries()) {
    expect(Math.abs(row.top - inactive.rows[index].top)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(row.height - inactive.rows[index].height)).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(row.blockTop - inactive.rows[index].blockTop)).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(row.drift)).toBeLessThanOrEqual(0.5);
    expect(row.paddingBottom).toBe(inactive.rows[index].paddingBottom);
    expect(row.paddingTop).toBe(inactive.rows[index].paddingTop);
  }

  await page.getByRole('menuitem', { exact: true, name: '主题' }).click();
  await page.getByRole('menuitemradio', { name: '暗色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await codeBody.click();

  const darkActive = await readCodeBlockGeometry(editor);
  expect(
    contrastRatio(darkActive.pseudoColor, darkActive.backgroundColor),
  ).toBeGreaterThanOrEqual(4.5);

  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(page.locator('.lm-md-code-block-active')).toHaveCount(0);
  await expect(openingLine).not.toHaveAttribute('data-lm-code-language', /.+/);
  await expect(editor).not.toHaveAttribute('aria-description', /.+/);

  const readSelectionLineNumber = () =>
    editor.evaluate((content) => {
      const view = (content as RootEditorContentTestBridge)
        .resolveRootEditorViewForTest();
      const head = view.state.selection.main.head;

      return view.state.doc.toString().slice(0, head).split('\n').length;
    });
  await page.locator('.cm-line').nth(1).click({ position: { x: 4, y: 4 } });
  await expect.poll(readSelectionLineNumber).toBe(2);
  await page.locator('.cm-line').nth(5).click({ position: { x: 4, y: 4 } });
  await expect.poll(readSelectionLineNumber).toBe(6);

  await switchEditorMode(page, 'source');
  await expect(
    editor.evaluate((content) =>
      (content as RootEditorContentTestBridge)
        .resolveRootEditorViewForTest()
        .state.doc.toString(),
    ),
  ).resolves.toBe(source);
});

test('leaves a final fenced code block when Enter is pressed on its closing fence', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(['```ts', 'const value = 1', '```'].join('\n'));
  await page.locator('.cm-line', { hasText: '```' }).last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Outside the code block');

  await expect(editor).toContainText('Outside the code block');
  await expect(page.locator('.lm-md-code-block-line')).toHaveCount(3);
});

test('creates a paragraph below a final fenced code block when the caret moves down', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(['```ts', 'const value = 1', '```'].join('\n'));
  await page.locator('.cm-line', { hasText: '```' }).last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.insertText('Outside the code block');

  await expect(page.locator('.lm-md-code-block-line')).toHaveCount(3);
  await page.getByRole('menuitem', { name: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();
  await expect(page.locator('.cm-line')).toHaveText([
    '```ts',
    'const value = 1',
    '```',
    'Outside the code block',
  ]);
});

test('toggles tasks with keyboard and ignores fenced code task literals', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await replaceEditorSource(
    page,
    ['```md', '- [ ] literal', '```', '', '- [ ] task'].join('\n'),
  );

  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.lm-md-task-checkbox')).toHaveCount(1);

  await page.locator('.cm-line').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Enter');
  await expectEditorSource(
    page,
    ['```md', '- [ ] literal', '```', '', '- [x] task'].join('\n'),
  );

  await switchEditorMode(page, 'livePreview');
  await page.locator('.cm-line', { hasText: '- [ ] literal' }).click();
  await page.keyboard.press('Control+Enter');
  await expectEditorSource(
    page,
    ['```md', '- [ ] literal', '', '```', '', '- [x] task'].join('\n'),
  );
  await switchEditorMode(page, 'livePreview');
  await expect(page.locator('.lm-md-task-checkbox')).toHaveCount(1);
});

test('applies basic markdown formatting from the top menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('plain');
  await page.keyboard.press('Control+A');

  await page.locator('.lm-menu-trigger', { hasText: '格式' }).click();
  await page.getByRole('menuitem', { name: '加粗' }).click();

  await expect(editor).toContainText('**plain**');
  await expect(page.locator('.lm-md-strong')).toContainText('plain');
});

test('toggles a selected unordered list from the paragraph menu', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('first');
  await page.keyboard.press('Control+A');
  await openParagraphSubmenu(page, '列表');
  await page.getByRole('menuitem', { name: '无序列表' }).click();

  await expect(editor).toContainText('- first');
  await page.keyboard.press('Control+A');
  await openParagraphSubmenu(page, '列表');
  await page.getByRole('menuitem', { name: '无序列表' }).click();

  await expect(page.locator('.cm-line').allTextContents()).resolves.toEqual(['first']);
});

test('formats selected text with standard bold and italic keyboard shortcuts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('plain');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+B');

  await expect(editor).toContainText('**plain**');
  await page.keyboard.press('Control+B');
  await expect(editor).toHaveText('plain');
  await page.keyboard.press('Control+Z');
  await expect(editor).toContainText('**plain**');
  await page.keyboard.press('Control+Z');
  await expect(editor).toHaveText('plain');

  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+I');
  await expect(editor).toContainText('*plain*');
  await page.keyboard.press('Control+Z');
  await expect(editor).toHaveText('plain');
});

test('changes the current line heading level with standard keyboard shortcuts', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Heading');
  await page.keyboard.press('Control+1');

  await expect(editor).toContainText('# Heading');
  await page.keyboard.press('Control+2');
  await expect(editor).toContainText('## Heading');
  await page.keyboard.press('Control+Z');
  await expect(editor).toContainText('# Heading');
});

test('undoes and redoes a Markdown command from the edit menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('plain');
  await page.keyboard.press('Control+A');

  await page.locator('.lm-menu-trigger', { hasText: '格式' }).click();
  await page.getByRole('menuitem', { name: '加粗' }).click();
  await expect(editor).toContainText('**plain**');

  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '撤销' }).click();
  await expect(editor).toContainText('plain');
  await expect(editor).not.toContainText('**plain**');

  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '重做' }).click();
  await expect(editor).toContainText('**plain**');
});

test('opens the built-in search panel from the edit menu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await page.getByRole('menuitem', { name: '查找' }).click();

  const searchInput = page.locator('.cm-search [name="search"]');
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toHaveAttribute('placeholder', '查找');
  await expect(searchInput).toBeFocused();
});

test('opens the built-in search panel from the command palette', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '查找' }).click();

  await expect(page.locator('.cm-search [name="search"]')).toBeFocused();
});

test('opens the built-in search panel when the command palette confirms Find by keyboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.lm-command-palette-input')).toBeFocused();
  await page.keyboard.type('查找');
  await page.keyboard.press('Enter');

  await expect(page.locator('.cm-search [name="search"]')).toBeFocused();
});

test('returns focus to the editor when the command palette closes without a command', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.lm-command-palette-input')).toBeFocused();
  await page.keyboard.press('Escape');

  await expect(editor).toBeFocused();
});

test('preserves the command palette opener when its shortcut is pressed again', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+K');
  await expect(page.locator('.lm-command-palette-input')).toBeFocused();
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Escape');

  await expect(editor).toBeFocused();
});

test('creates strikethrough and ordered list Markdown from standard command entry points', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('plain');
  await page.keyboard.press('Control+A');

  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '删除线' }).click();
  await expect(page.locator('.lm-md-strikethrough')).toContainText('plain');

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('item');
  await openParagraphSubmenu(page, '列表');
  await page.getByRole('menuitem', { name: '有序列表' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();
  await expect(editor).toContainText('1. item');
});

test('creates local image Markdown from the format menu and command palette', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => ({
        ok: true,
        data: { byteLength: 0, path, text: '' },
      }),
      showOpenDialog: async () => ({ ok: true, data: null }),
      showOpenImageDialog: async () => ({
        ok: true,
        data: ['C:\\Pictures\\cover.png'],
      }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => ({
        ok: true,
        data: { byteLength: text.length, path },
      }),
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('cover');
  await page.keyboard.press('Control+A');

  await page.locator('.lm-menu-trigger', { hasText: '格式' }).click();
  await page.getByRole('menuitem', { name: '图片' }).click();
  await switchEditorMode(page, 'source');
  await expect(editor).toContainText(
    '![cover.png](C:\\Pictures\\cover.png)',
  );

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('banner');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '图片' }).click();

  await expect(editor).toContainText(
    '![cover.png](C:\\Pictures\\cover.png)',
  );
});

test('inserts a horizontal rule from the paragraph menu and command palette', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Before\nAfter');
  await page.keyboard.press('Control+Home');

  await openParagraphSubmenu(page, '插入');
  await page.getByRole('menuitem', { name: '分割线' }).click();
  await expect(page.locator('.lm-md-horizontal-rule')).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Before\n\nAfter');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '分割线' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual([
    'Before',
    '',
    '---',
    '',
    'After',
  ]);
});

test('creates and undoes an ordered list from the command palette', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('item');

  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '有序列表' }).click();
  await expect(editor).toContainText('1. item');

  await editor.click();
  await page.keyboard.press('Control+Z');
  await expect(editor).toContainText('item');
  await expect(editor).not.toContainText('1. item');
});

test('creates advanced heading levels through the menu and command palette', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Title');

  await page.locator('.lm-menu-trigger', { hasText: '段落' }).click();
  await page.getByRole('menuitem', { name: '标题 3' }).click();
  await expect(page.locator('.lm-md-heading-3')).toContainText('Title');

  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('Title');
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '标题 6' }).click();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();
  await expect(editor).toContainText('###### Title');
});

test('switches between live preview and source mode without changing markdown source', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('# Title\n\n**bold**\n\nplain');
  await page.locator('.cm-line', { hasText: 'plain' }).click();
  await expect(page.locator('.lm-md-heading-1')).toContainText('Title');
  await expect(page.locator('.lm-md-heading-1')).not.toContainText('#');
  await expect(page.locator('.lm-md-strong')).toContainText('bold');
  await expect(page.locator('.lm-md-strong')).not.toContainText('**');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();

  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await expect(page.locator('.lm-md-heading-1')).toHaveCount(0);
  await expect(editor).toContainText('# Title');
  await expect(editor).toContainText('**bold**');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: '实时预览' }).click();

  await expect(page.locator('.lm-editor-live-preview-mode')).toBeVisible();
  await expect(page.locator('.lm-md-heading-1')).toContainText('Title');
  await expect(page.locator('.lm-md-heading-1')).not.toContainText('#');
  await expect(page.locator('.lm-md-strong')).toContainText('bold');
  await expect(page.locator('.lm-md-strong')).not.toContainText('**');
});

test('cycles display modes with Mod+/ without changing editor state', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  const scroller = page.locator('.cm-scroller').first();
  const documentBeforeEdit = Array.from({ length: 140 }, (_, index) => {
    if (index === 92) {
      return 'viewport ANCHOR_SELECTION stays stable';
    }

    return `plain paragraph line ${String(index + 1).padStart(3, '0')}`;
  }).join('\n');
  const documentAfterEdit = `${documentBeforeEdit}!`;
  const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const modeShortcut = `${primaryModifier}+/`;
  const redoShortcut =
    process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';

  const readSourceFromClipboard = async () => {
    await editor.click();
    await page.keyboard.press(`${primaryModifier}+A`);
    await page.keyboard.press(`${primaryModifier}+C`);

    return page.evaluate(() =>
      navigator.clipboard.readText().then((text) => text.replace(/\r\n/g, '\n')),
    );
  };
  const readSelection = () =>
    page.evaluate(() => globalThis.getSelection()?.toString() ?? '');
  const readViewport = () =>
    scroller.evaluate((node) => {
      const scrollerBounds = node.getBoundingClientRect();
      const firstVisibleLine = [
        ...node.querySelectorAll<HTMLElement>('.cm-line'),
      ].find((line) => {
        const bounds = line.getBoundingClientRect();

        return (
          bounds.bottom > scrollerBounds.top &&
          bounds.top < scrollerBounds.bottom
        );
      });
      const firstVisibleBounds = firstVisibleLine?.getBoundingClientRect();

      return {
        firstVisibleText: firstVisibleLine?.textContent ?? null,
        firstVisibleTop:
          firstVisibleBounds === undefined
            ? null
            : firstVisibleBounds.top - scrollerBounds.top,
        scrollTop: node.scrollTop,
      };
    });
  const settleEditorLayout = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        }),
    );
  const expectViewportMatches = async (
    expected: Awaited<ReturnType<typeof readViewport>>,
  ) => {
    expect(await readSelection()).toBe('ANCHOR_SELECTION');
    const viewport = await readViewport();
    expect(viewport.firstVisibleText).toBe(expected.firstVisibleText);
    expect(Math.abs(viewport.scrollTop - expected.scrollTop)).toBeLessThanOrEqual(
      1,
    );
    expect(
      Math.abs((viewport.firstVisibleTop ?? 0) - (expected.firstVisibleTop ?? 0)),
    ).toBeLessThanOrEqual(1);
  };

  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(documentBeforeEdit);
  await page.keyboard.press(`${primaryModifier}+End`);
  await page.keyboard.insertText('!');
  expect(await readSourceFromClipboard()).toBe(documentAfterEdit);

  await editor.click();
  await page.keyboard.press(`${primaryModifier}+Home`);
  for (let index = 0; index < 92; index += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Home');
  for (let index = 0; index < 'viewport '.length; index += 1) {
    await page.keyboard.press('ArrowRight');
  }
  for (let index = 0; index < 'ANCHOR_SELECTION'.length; index += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
  await expect.poll(readSelection).toBe('ANCHOR_SELECTION');
  const initialViewport = await readViewport();
  expect(initialViewport.scrollTop).toBeGreaterThan(0);
  expect(initialViewport.firstVisibleText).not.toBeNull();
  expect(initialViewport.firstVisibleTop).not.toBeNull();

  // livePreview → source → reading → livePreview
  await page.keyboard.press(modeShortcut);
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await settleEditorLayout();
  await expectViewportMatches(initialViewport);

  await page.keyboard.press(modeShortcut);
  await expect(page.locator('.lm-editor-reading-mode')).toBeVisible();
  await settleEditorLayout();
  await expectViewportMatches(initialViewport);

  await page.keyboard.press(modeShortcut);
  await expect(page.locator('.lm-editor-live-preview-mode')).toBeVisible();
  await settleEditorLayout();
  await expectViewportMatches(initialViewport);
  expect(await readSourceFromClipboard()).toBe(documentAfterEdit);

  await page.keyboard.press(`${primaryModifier}+Z`);
  expect(await readSourceFromClipboard()).toBe(documentBeforeEdit);
  await page.keyboard.press(redoShortcut);
  expect(await readSourceFromClipboard()).toBe(documentAfterEdit);
});

test('keeps the reading anchor and caret geometry stable across zoom and page-width changes', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  const scroller = page.locator('.cm-scroller').first();
  await installRootEditorViewTestBridge(editor);
  const documentBeforeEdit = Array.from({ length: 180 }, (_, index) => {
    if (index === 118) {
      return 'viewport ANCHOR_SELECTION stays stable';
    }

    return `paragraph ${String(index + 1).padStart(3, '0')} ${'wrapped reading text '.repeat(8)}`;
  }).join('\n');
  const documentAfterEdit = `${documentBeforeEdit}!`;
  const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const redoShortcut =
    process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
  const settleEditorLayout = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        }),
    );
  const readEditorSnapshot = () =>
    editor.evaluate((content) => {
      const view = (
        content as RootEditorContentTestBridge
      ).resolveRootEditorViewForTest();
      const { anchor, from, head, to } = view.state.selection.main;
      const scrollerBounds = view.scrollDOM.getBoundingClientRect();
      const caretBounds = view.coordsAtPos(head, head >= anchor ? -1 : 1);
      const firstVisibleLine = [
        ...view.scrollDOM.querySelectorAll<HTMLElement>('.cm-line'),
      ].find((line) => {
        const bounds = line.getBoundingClientRect();

        return (
          bounds.bottom > scrollerBounds.top &&
          bounds.top < scrollerBounds.bottom
        );
      });
      const styles = getComputedStyle(view.scrollDOM.closest('.cm-editor')!);

      return {
        anchor,
        caretLeft:
          caretBounds === null ? null : caretBounds.left - scrollerBounds.left,
        caretTop:
          caretBounds === null ? null : caretBounds.top - scrollerBounds.top,
        documentText: view.state.doc.toString(),
        firstVisibleText: firstVisibleLine?.textContent ?? null,
        fontScale: styles.getPropertyValue('--lm-editor-font-scale').trim(),
        head,
        pageWidth: styles.getPropertyValue('--lm-editor-page-width').trim(),
        scrollHeight: view.scrollDOM.scrollHeight,
        scrollTop: view.scrollDOM.scrollTop,
        selectedText: view.state.doc.sliceString(from, to),
        viewportHeight: view.scrollDOM.clientHeight,
        viewportWidth: view.scrollDOM.clientWidth,
      };
    });
  const focusEditor = () =>
    editor.evaluate((content) => {
      (content as RootEditorContentTestBridge)
        .resolveRootEditorViewForTest()
        .focus();
    });

  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(documentBeforeEdit);
  await page.keyboard.press(`${primaryModifier}+End`);
  await page.keyboard.insertText('!');
  await editor.evaluate((content, selectedText) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    const start = view.state.doc.toString().indexOf(selectedText);

    if (start < 0) {
      throw new Error('Reading appearance selection anchor is missing.');
    }

    view.dispatch({
      scrollIntoView: true,
      selection: { anchor: start, head: start + selectedText.length },
    });
    view.focus();
  }, 'ANCHOR_SELECTION');
  await settleEditorLayout();
  await scroller.evaluate((node) => {
    const selection = globalThis.getSelection();

    if (!selection || selection.rangeCount === 0) {
      throw new Error('Reading appearance selection is unavailable.');
    }

    const selectionBounds = selection.getRangeAt(0).getBoundingClientRect();
    const scrollerBounds = node.getBoundingClientRect();

    node.scrollTop += selectionBounds.top - scrollerBounds.top - 8;
  });
  await settleEditorLayout();

  const initial = await readEditorSnapshot();
  expect(initial.documentText).toBe(documentAfterEdit);
  expect(initial.selectedText).toBe('ANCHOR_SELECTION');
  expect(initial.scrollTop).toBeGreaterThan(0);
  expect(initial.firstVisibleText).not.toBeNull();
  expect(initial.caretTop).not.toBeNull();

  await scroller.dispatchEvent('wheel', {
    ctrlKey: process.platform !== 'darwin',
    deltaY: -100,
    metaKey: process.platform === 'darwin',
  });
  await expect
    .poll(async () => (await readEditorSnapshot()).fontScale)
    .toBe('1.1');
  await settleEditorLayout();

  const zoomed = await readEditorSnapshot();
  expect(zoomed.documentText).toBe(documentAfterEdit);
  expect(zoomed.anchor).toBe(initial.anchor);
  expect(zoomed.head).toBe(initial.head);
  expect(zoomed.selectedText).toBe('ANCHOR_SELECTION');
  expect(zoomed.firstVisibleText).toBe(initial.firstVisibleText);
  expect(
    Math.abs((zoomed.caretTop ?? 0) - (initial.caretTop ?? 0)),
  ).toBeLessThanOrEqual(8);
  expect(zoomed.caretLeft).toBeGreaterThanOrEqual(0);
  expect(zoomed.caretLeft).toBeLessThanOrEqual(zoomed.viewportWidth);

  await page.getByRole('menuitem', { name: '文件' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByRole('tab', { name: '外观' }).click();
  const widthGroup = page.getByRole('radiogroup', { name: '页面宽度' });
  await widthGroup.getByRole('radio', { name: '宽', exact: true }).click();
  await expect
    .poll(async () => (await readEditorSnapshot()).pageWidth)
    .toBe('1040px');
  await page.getByRole('button', { name: '关闭' }).click();
  await settleEditorLayout();

  const widened = await readEditorSnapshot();
  expect(widened.documentText).toBe(documentAfterEdit);
  expect(widened.anchor).toBe(initial.anchor);
  expect(widened.head).toBe(initial.head);
  expect(widened.selectedText).toBe('ANCHOR_SELECTION');
  expect(widened.firstVisibleText).toBe(initial.firstVisibleText);
  expect(
    Math.abs((widened.caretTop ?? 0) - (zoomed.caretTop ?? 0)),
  ).toBeLessThanOrEqual(8);
  expect(widened.caretLeft).toBeGreaterThanOrEqual(0);
  expect(widened.caretLeft).toBeLessThanOrEqual(widened.viewportWidth);
  expect(widened.scrollTop).toBeLessThan(widened.scrollHeight - widened.viewportHeight);

  await focusEditor();
  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect.poll(async () => (await readEditorSnapshot()).documentText).toBe(
    documentBeforeEdit,
  );
  await page.keyboard.press(redoShortcut);
  await expect.poll(async () => (await readEditorSnapshot()).documentText).toBe(
    documentAfterEdit,
  );
});

test('opens the built-in search panel and navigates to a Markdown match', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n\nneedle\n\nafter');

  await page.keyboard.press('Control+F');

  const searchPanel = page.locator('.cm-search');
  const searchInput = searchPanel.getByRole('textbox').first();
  await expect(searchPanel).toBeVisible();
  await expect(searchInput).toBeFocused();
  await searchInput.fill('needle');
  await page.keyboard.press('Enter');

  await expect(editor).toContainText('needle');
  await expect(page.locator('.cm-searchMatch')).not.toHaveCount(0);
});

test('localizes the built-in search panel after an application language change', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n\nneedle\n\nafter');

  await page.keyboard.press('Control+F');
  await expect(
    page.locator('.cm-search [name="search"]'),
  ).toHaveAttribute('placeholder', '查找');
  await expect(page.locator('.cm-search [name="next"]')).toHaveText('下一个');
  await page.keyboard.press('Escape');

  await page.locator('.lm-menu-trigger', { hasText: '文件' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  await editor.click();
  await page.keyboard.press('Control+F');
  await expect(
    page.locator('.cm-search [name="search"]'),
  ).toHaveAttribute('placeholder', 'Find');
  await expect(page.locator('.cm-search [name="next"]')).toHaveText('next');
  await expect(editor).toContainText('needle');
});

test('renders markdown tables through the mature component and keeps table menu commands thin', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['intro', '', canonicalTable([['A', 'B'], ['1', '2']]), '', 'after'].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await expect(page.locator('.tbl-table-widget .tbl-table')).toBeVisible();
  await expect(page.locator('.tbl-table-widget')).toContainText('A');
  await expect(page.locator('.tbl-table-widget')).toContainText('2');
  await expect(page.locator('.lm-table-widget')).toHaveCount(0);
  await expect(page.locator('.lm-table-toolbar')).toHaveCount(0);

  const tableCell = page.locator('.tbl-data-cell').filter({ hasText: '2' });
  await tableCell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '复制表格' }).click();
  await expect
    .poll(async () => {
      const text = await page.evaluate(() => navigator.clipboard.readText());

      return text.replace(/\r\n/g, '\n');
    })
    .toBe(['| A | B |', '| - | - |', '| 1 | 2 |'].join('\n'));

  await tableCell.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除表格' }).click();
  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
  await expect(editor).toContainText('intro');
  await expect(editor).toContainText('after');

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();

  await expect(editor).not.toContainText('| A | B |');
  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
});

test('renders table markdown from the cell source DOM and preserves undo-redo', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      'intro',
      '',
      canonicalTable([
        ['Inline', 'Link', 'Code'],
        ['**bold**', '[site](https://example.com)', '`code`'],
      ]),
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const table = page.locator('.tbl-table-widget');
  const boldCell = table.locator('.tbl-data-cell').filter({ hasText: 'bold' });
  const boldCellSource = boldCell.locator('.tbl-cell-view');

  await expect(table).toBeVisible();
  await expect(table.locator('.lm-table-inline-preview')).toHaveCount(0);
  await expect(
    boldCell.locator(
      '.lm-table-token-strong:not(.lm-table-token-mark)',
      { hasText: 'bold' },
    ),
  ).toBeVisible();
  await expect(
    table.locator('.lm-table-token-code:not(.lm-table-token-mark)', {
      hasText: 'code',
    }),
  ).toBeVisible();
  await expect(
    table.locator(
      '.lm-table-token-link:not(.lm-table-token-mark, .lm-table-token-link-destination)',
      { hasText: 'site' },
    ),
  ).toBeVisible();
  await expect(
    table.locator('.lm-table-token-link-destination'),
  ).toBeHidden();
  await expect(boldCellSource).not.toHaveAttribute(
    'data-lm-inline-markdown-mode',
    /.+/,
  );

  await clickAfterVisibleTableCellCharacter(page, 'bold', 'd');

  const cellEditor = page.locator('.tbl-cell-editor .cm-content').first();
  await expect(cellEditor).toBeVisible();
  await expect(cellEditor).toContainText('**bold**');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: '**bold**',
    anchor: 6,
    head: 6,
  });

  await page.keyboard.insertText('!');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: '**bold!**',
    anchor: 7,
    head: 7,
  });

  await page.keyboard.press('Control+Z');
  await expect
    .poll(() => readVisibleTableCellState(page).then(({ text }) => text))
    .toBe('**bold**');

  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
  );

  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(
    boldCell.locator(
      '.lm-table-token-strong:not(.lm-table-token-mark)',
      { hasText: 'bold!' },
    ),
  ).toBeVisible();

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();

  await expect(editor).toContainText('**bold!**');
  await expect(editor).toContainText('[site](https://example.com)');
  await expect(editor).toContainText('`code`');
});

test('maps variable-width table cell clicks to the matching editor caret', async ({
  page,
}) => {
  await openNewDocument(page);

  const cellText = 'Wiil甲乙丙丁';
  await replaceEditorSource(
    page,
    [
      'intro',
      '',
      canonicalTable([
        ['First', 'Second'],
        [cellText, 'value'],
      ]),
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const tableCell = page
    .locator('.tbl-data-cell')
    .filter({ hasText: cellText })
    .first();
  const cellSource = tableCell.locator('.tbl-cell-view');
  await expect(cellSource).toBeVisible();
  await expect(tableCell.locator('.lm-table-inline-preview')).toHaveCount(0);

  await clickAfterVisibleTableCellCharacter(page, cellText, '丙');

  const cellEditor = page.locator('.tbl-cell-editor .cm-content:visible');
  await expect(cellEditor).toHaveCount(1);
  await expect(cellEditor).toBeVisible();
  const readCellSelection = () =>
    cellEditor.evaluate((content) => {
      const { anchor, head } = (
        content as HTMLElement & {
          cmTile: {
            view: {
              state: {
                selection: {
                  main: { anchor: number; head: number };
                };
              };
            };
          };
        }
      ).cmTile.view.state.selection.main;

      return { anchor, head };
    });
  await expect
    .poll(readCellSelection)
    .toEqual({ anchor: 7, head: 7 });
  await expect(cellEditor).toBeFocused();

  await page.keyboard.insertText('中');

  const editedCellText = 'Wiil甲乙丙中丁';
  await expect(cellEditor).toHaveText(editedCellText);
  await expect
    .poll(readCellSelection)
    .toEqual({ anchor: 8, head: 8 });

  const rootEditor = page.locator('.cm-content').first();
  await expect
    .poll(() =>
      rootEditor.evaluate((content, targetText) => {
        const state = (
          content as HTMLElement & {
            cmTile: {
              view: {
                state: {
                  doc: { toString(): string };
                  selection: { main: { head: number } };
                };
              };
            };
          }
        ).cmTile.view.state;
        const targetStart = state.doc.toString().indexOf(targetText);

        return {
          hasEditedCell: targetStart >= 0,
          headOffset:
            targetStart >= 0
              ? state.selection.main.head - targetStart
              : null,
        };
      }, editedCellText),
    )
    .toEqual({ hasEditedCell: true, headOffset: 8 });
});

test('maps clicks inside wrapped formatted table text to the matching source caret', async ({
  page,
}) => {
  await openNewDocument(page);

  const visibleCellText = `${'formatted content '.repeat(16)}TARGET尾部`;
  const sourceCellText = `**${visibleCellText}**`;
  const sourceTargetOffset = sourceCellText.indexOf('TARGET') + 3;
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      canonicalTable([
        ['Content', 'Other'],
        [sourceCellText, 'value'],
      ]),
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const cellSource = page
    .locator('.tbl-data-cell')
    .filter({ hasText: 'TARGET' })
    .locator('.tbl-cell-view');
  await expect
    .poll(() =>
      cellSource.evaluate((element) => {
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);

        return element.getBoundingClientRect().height > lineHeight * 1.5;
      }),
    )
    .toBe(true);

  await clickAfterVisibleTableCellCharacter(
    page,
    sourceCellText,
    'R',
  );

  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: sourceCellText,
    anchor: sourceTargetOffset,
    head: sourceTargetOffset,
  });

  await page.keyboard.insertText('X');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: `${sourceCellText.slice(0, sourceTargetOffset)}X${sourceCellText.slice(sourceTargetOffset)}`,
    anchor: sourceTargetOffset + 1,
    head: sourceTargetOffset + 1,
  });
});

test('maps formatted table cell clicks to the matching source offset', async ({
  page,
}) => {
  await openNewDocument(page);

  const source = [
    'before',
    '',
    canonicalTable([
      ['A', 'B'],
      ['**alpha**', 'beta'],
    ]),
    '',
    'after',
  ].join('\n');
  await replaceEditorSource(page, source);
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await clickAfterVisibleTableCellCharacter(page, 'alpha', 'p');

  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: '**alpha**',
    anchor: 5,
    head: 5,
  });

  await page.keyboard.insertText('X');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: '**alpXha**',
    anchor: 6,
    head: 6,
  });
  await expectEditorSource(
    page,
    [
      'before',
      '',
      '| A          | B    |',
      '| ---------- | ---- |',
      '| **alpXha** | beta |',
      '',
      'after',
    ].join('\n'),
  );
});

test('preserves the logical cell column for vertical table arrows', async ({
  page,
}) => {
  await openNewDocument(page);

  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| A      | B |',
      '| ------ | - |',
      '| abcd   | q |',
      '| 012345 | z |',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await clickAfterVisibleTableCellCharacter(page, 'abcd', 'b');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: 'abcd',
    anchor: 2,
    head: 2,
  });

  await page.keyboard.press('ArrowDown');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: '012345',
    anchor: 2,
    head: 2,
  });

  await page.keyboard.press('ArrowUp');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: 'abcd',
    anchor: 2,
    head: 2,
  });
});

test('clamps the logical table column to a shorter destination cell', async ({
  page,
}) => {
  await openNewDocument(page);

  await replaceEditorSource(
    page,
    [
      'before',
      '',
      '| A      | B |',
      '| ------ | - |',
      '| 012345 | q |',
      '| xy     | z |',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  await clickAfterVisibleTableCellCharacter(page, '012345', '4');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: '012345',
    anchor: 5,
    head: 5,
  });

  await page.keyboard.press('ArrowDown');
  await expect.poll(() => readVisibleTableCellState(page)).toEqual({
    text: 'xy',
    anchor: 2,
    head: 2,
  });
});

test('supports table insert and delete shortcuts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n');

  await page.keyboard.press('Control+Alt+T');

  await expect(page.locator('.tbl-table-widget .tbl-table')).toBeVisible();

  await page.locator('.tbl-table-widget').click();
  await page.keyboard.press('Control+Alt+Backspace');

  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
  await expect(editor).toContainText('before');
});

test('shows table shortcuts in top and editor context menus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();

  await openParagraphSubmenu(page, '插入');
  await expect(
    page.getByRole('menuitem', { name: /^表格\s+Ctrl\+T$/ }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await expect(
    page.getByRole('menuitem', { name: /^复制表格\s+Ctrl\+Alt\+C$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: /^删除表格\s+Ctrl\+Alt\+Backspace$/ }),
  ).toHaveCount(0);

  await page.keyboard.press('Escape');
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('before\n');
  await page.keyboard.press('Control+Alt+T');
  await expect(page.locator('.tbl-table-widget .tbl-table')).toBeVisible();

  await page.locator('.tbl-table-widget').click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: /^复制表格\s*Ctrl\+Alt\+C$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: /^删除表格\s*Ctrl\+Alt\+Backspace$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { exact: true, name: '插入' }),
  ).toBeDisabled();
  await page
    .getByRole('menuitem', { name: /^删除表格\s*Ctrl\+Alt\+Backspace$/ })
    .click();

  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
  await expect(editor).toContainText('before');
});
