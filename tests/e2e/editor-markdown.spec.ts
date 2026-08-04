import { expect, test, type Page } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function replaceEditorSource(
  page: Page,
  source: string,
): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
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
    await replaceEditorSource(page, 'plain');

    await page.keyboard.press(key);

    await expectEditorSource(page, expected);
  });
}

test('Enter adds only one line break when the caret is already on an empty line', async ({
  page,
}) => {
  await page.goto('/');
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
  const source = '**outer *内层* tail** and **second**';
  await replaceEditorSource(page, source);
  const line = page.locator('.cm-line').first();

  await page.locator('.lm-md-emphasis', { hasText: '内层' }).click();
  await expect(line).toHaveText(
    '**outer *内层* tail** and second',
  );

  await page.locator('.lm-md-strong', { hasText: 'second' }).click();
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
    await replaceEditorSource(page, initial);

    await page.keyboard.press(`${primaryModifier}+Enter`);

    await expectEditorSource(page, expected);
  });
}

test('reveals the complete marker path for nested blockquote content', async ({
  page,
}) => {
  await page.goto('/');
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

test('creates one multi-paragraph blockquote from the paragraph menu', async ({
  page,
}) => {
  await page.goto('/');
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

test('leaves a final fenced code block when Enter is pressed on its closing fence', async ({
  page,
}) => {
  await page.goto('/');

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

  await page.locator('.cm-content').first().click();
  await page.keyboard.press('Control+K');
  await page.getByRole('option', { name: '查找' }).click();

  await expect(page.locator('.cm-search [name="search"]')).toBeFocused();
});

test('opens the built-in search panel when the command palette confirms Find by keyboard', async ({
  page,
}) => {
  await page.goto('/');

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

test('toggles display mode twice with Mod+/ without changing editor state', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');

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

  await page.keyboard.press(modeShortcut);
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  await settleEditorLayout();

  expect(await readSelection()).toBe('ANCHOR_SELECTION');
  const sourceViewport = await readViewport();
  expect(sourceViewport.firstVisibleText).toBe(
    initialViewport.firstVisibleText,
  );
  expect(
    Math.abs(sourceViewport.scrollTop - initialViewport.scrollTop),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (sourceViewport.firstVisibleTop ?? 0) -
        (initialViewport.firstVisibleTop ?? 0),
    ),
  ).toBeLessThanOrEqual(1);

  await page.keyboard.press(modeShortcut);
  await expect(page.locator('.lm-editor-live-preview-mode')).toBeVisible();
  await settleEditorLayout();

  expect(await readSelection()).toBe('ANCHOR_SELECTION');
  const restoredViewport = await readViewport();
  expect(restoredViewport.firstVisibleText).toBe(
    initialViewport.firstVisibleText,
  );
  expect(
    Math.abs(restoredViewport.scrollTop - initialViewport.scrollTop),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      (restoredViewport.firstVisibleTop ?? 0) -
        (initialViewport.firstVisibleTop ?? 0),
    ),
  ).toBeLessThanOrEqual(1);
  expect(await readSourceFromClipboard()).toBe(documentAfterEdit);

  await page.keyboard.press(`${primaryModifier}+Z`);
  expect(await readSourceFromClipboard()).toBe(documentBeforeEdit);
  await page.keyboard.press(redoShortcut);
  expect(await readSourceFromClipboard()).toBe(documentAfterEdit);
});

test('opens the built-in search panel and navigates to a Markdown match', async ({
  page,
}) => {
  await page.goto('/');

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
  await page.getByRole('tab', { name: '语言' }).click();
  await page.getByRole('button', { name: 'English' }).click();
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

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    ['intro', '', '| A | B |', '| --- | --- |', '| 1 | 2 |', '', 'after'].join('\n'),
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

test('reveals table cell markdown source on hover and edits the raw cell content', async ({
  page,
}) => {
  await page.goto('/');

  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(
    [
      'intro',
      '',
      '| Inline    | Link                          | Code   |',
      '| --------- | ----------------------------- | ------ |',
      '| **bold**  | [site](https://example.com)   | `code` |',
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const table = page.locator('.tbl-table-widget');
  const boldCell = table.locator('.tbl-data-cell').filter({ hasText: 'bold' });
  const boldCellSource = boldCell.locator('.tbl-cell-view');
  const boldCellPreview = boldCell.locator('.lm-table-inline-preview');

  await expect(table).toBeVisible();
  await expect(boldCellPreview.locator('strong', { hasText: 'bold' })).toBeVisible();
  await expect(
    table.locator('.lm-table-inline-preview code', { hasText: 'code' }),
  ).toBeVisible();
  await expect(boldCellSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'preview',
  );

  await boldCell.hover();

  await expect(boldCellSource).toContainText('**bold**');
  await expect(boldCellSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'source',
  );

  await boldCell.click();

  const cellEditor = page.locator('.tbl-cell-editor .cm-content').first();
  await expect(cellEditor).toBeVisible();
  await expect(cellEditor).toContainText('**bold**');

  await cellEditor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');

  await expect(cellEditor).toContainText('**bold**!');

  await page.locator('.cm-line', { hasText: 'after' }).click();
  await expect(boldCellPreview).toContainText('bold!');
  await expect(
    boldCellPreview.locator('strong', { hasText: 'bold' }),
  ).toBeVisible();
  await expect(boldCellSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'preview',
  );

  await page.locator('.lm-menu-trigger', { hasText: '视图' }).click();
  await page.getByRole('menuitemradio', { name: /^源码模式/ }).click();

  await expect(editor).toContainText('**bold**!');
  await expect(editor).toContainText('[site](https://example.com)');
  await expect(editor).toContainText('`code`');
});

test('keeps table preview clicks aligned with the cell editor caret', async ({
  page,
}) => {
  await page.goto('/');

  const cellText = 'Wiil甲乙丙丁';
  await replaceEditorSource(
    page,
    [
      'intro',
      '',
      '| First        | Second |',
      '| ------------ | ------ |',
      `| ${cellText} | value  |`,
      '',
      'after',
    ].join('\n'),
  );
  await page.locator('.cm-line', { hasText: 'after' }).click();

  const tableCell = page
    .locator('.tbl-data-cell')
    .filter({ hasText: cellText })
    .first();
  const cellPreview = tableCell.locator('.lm-table-inline-preview');
  const cellSource = tableCell.locator('.tbl-cell-view');
  await expect(cellPreview).toBeVisible();
  await expect(cellSource).toHaveAttribute(
    'data-lm-inline-markdown-mode',
    'preview',
  );

  const geometry = await tableCell.evaluate((cell, expectedText) => {
    const preview = cell.querySelector<HTMLElement>(
      '.lm-table-inline-preview',
    );
    const source = cell.querySelector<HTMLElement>('.tbl-cell-view');

    if (!preview || !source) {
      throw new Error('Expected both table cell preview and source elements');
    }

    const measureCharacters = (root: HTMLElement) => {
      const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
      );
      const characters: Array<{
        bottom: number;
        character: string;
        left: number;
        right: number;
        top: number;
      }> = [];

      while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;

        for (let offset = 0; offset < textNode.data.length; offset += 1) {
          const range = document.createRange();
          range.setStart(textNode, offset);
          range.setEnd(textNode, offset + 1);
          const rect = range.getBoundingClientRect();
          characters.push({
            bottom: rect.bottom,
            character: textNode.data.slice(offset, offset + 1),
            left: rect.left,
            right: rect.right,
            top: rect.top,
          });
        }
      }

      return characters;
    };

    const previewCharacters = measureCharacters(preview);
    const sourceCharacters = measureCharacters(source);
    const targetIndex = previewCharacters.findIndex(
      ({ character }) => character === '丙',
    );
    const target = previewCharacters[targetIndex];

    if (
      preview.textContent !== expectedText ||
      source.textContent !== expectedText ||
      targetIndex < 0 ||
      !target
    ) {
      throw new Error('Expected matching table cell text and a visible 丙 glyph');
    }

    return {
      click: {
        x: target.left + (target.right - target.left) * 0.8,
        y: target.top + (target.bottom - target.top) / 2,
      },
      previewCharacters,
      sourceCharacters,
    };
  }, cellText);

  expect(geometry.previewCharacters).toHaveLength([...cellText].length);
  expect(geometry.sourceCharacters).toHaveLength([...cellText].length);
  geometry.previewCharacters.forEach((previewCharacter, index) => {
    const sourceCharacter = geometry.sourceCharacters[index];
    expect(sourceCharacter?.character).toBe(previewCharacter.character);

    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      expect.soft(
        Math.abs(
          previewCharacter[edge] -
            (sourceCharacter?.[edge] ?? Number.POSITIVE_INFINITY),
        ),
        `character ${index} (${previewCharacter.character}) ${edge} preview/source delta`,
      ).toBeLessThanOrEqual(1);
    }
  });

  await page.mouse.click(geometry.click.x, geometry.click.y);

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

test('supports table insert and delete shortcuts', async ({ page }) => {
  await page.goto('/');

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

  await openParagraphSubmenu(page, '插入');
  await expect(
    page.getByRole('menuitem', { name: /^表格\s+Ctrl\+T$/ }),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.locator('.lm-menu-trigger', { hasText: '编辑' }).click();
  await expect(
    page.getByRole('menuitem', { name: /^复制表格\s+Ctrl Alt C$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: /^删除表格\s+Ctrl Alt Backspace$/ }),
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
    page.getByRole('menuitem', { name: /^表格\s+Ctrl\+T$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('menuitem', { name: /^复制表格\s+Ctrl Alt C$/ }),
  ).toBeVisible();
  await page
    .getByRole('menuitem', { name: /^删除表格\s+Ctrl Alt Backspace$/ })
    .click();

  await expect(page.locator('.tbl-table-widget')).toHaveCount(0);
  await expect(editor).toContainText('before');
});
