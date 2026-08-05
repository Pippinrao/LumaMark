import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from './support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';


async function openNewDocument(page: Page): Promise<Locator> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();

  const editor = page.locator('.cm-content').first();
  await installRootEditorViewTestBridge(editor);
  return editor;
}

async function replaceSource(editor: Locator, page: Page, source: string): Promise<void> {
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
}

async function editorState(editor: Locator): Promise<{
  anchor: number;
  head: number;
  source: string;
}> {
  return editor.evaluate((content) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    return {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      source: view.state.doc.toString(),
    };
  });
}

async function moveSelection(
  editor: Locator,
  anchor: number,
  head = anchor,
): Promise<void> {
  await editor.evaluate(
    (content, selection) => {
      const view = (
        content as RootEditorContentTestBridge
      ).resolveRootEditorViewForTest();
      view.dispatch({ scrollIntoView: true, selection });
      view.focus();
    },
    { anchor, head },
  );
}

test('opens an H1 with a quiet editable source marker at the real initial caret', async ({
  page,
}) => {
  const path = 'E:/lumamark-fixtures/source-reveal-heading.md';
  const source = '# 中文标题\n\n正文';
  await page.addInitScript(
    ({ documentPath, markdown }) => {
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (requestedPath) => ({
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(markdown).length,
            path: requestedPath,
            text: markdown,
          },
        }),
        showOpenDialog: async () => ({ ok: true, data: documentPath }),
        showSaveDialog: async () => ({ ok: true, data: null }),
        writeText: async (requestedPath, text) => ({
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(text).length,
            path: requestedPath,
          },
        }),
      };
    },
    { documentPath: path, markdown: source },
  );

  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
  await page.getByRole('menuitem', { name: /^(?:File|文件)$/ }).click();
  await page
    .getByRole('menuitem', { name: /^(?:Open File|打开文件)/ })
    .click();

  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('中文标题');
  await installRootEditorViewTestBridge(editor);
  expect(await editorState(editor)).toEqual({ anchor: 0, head: 0, source });

  const heading = page.locator('.lm-md-heading-1').first();
  const marker = heading.locator('.lm-md-source-mark-block');
  await expect(marker).toHaveText('#');
  const typography = await marker.evaluate((element) => {
    const markerStyle = getComputedStyle(element);
    const headingStyle = getComputedStyle(element.parentElement as HTMLElement);
    return {
      headingSize: Number.parseFloat(headingStyle.fontSize),
      headingWeight: Number.parseInt(headingStyle.fontWeight, 10),
      markerSize: Number.parseFloat(markerStyle.fontSize),
      markerWeight: Number.parseInt(markerStyle.fontWeight, 10),
    };
  });
  expect(typography.markerSize).toBeLessThan(typography.headingSize * 0.7);
  expect(typography.markerWeight).toBeLessThan(typography.headingWeight);

  await marker.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  expect((await editorState(editor)).source).toBe(' 中文标题\n\n正文');
  await page.keyboard.press(`${primaryModifier}+Z`);
  expect((await editorState(editor)).source).toBe(source);
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y',
  );
  expect((await editorState(editor)).source).toBe(' 中文标题\n\n正文');
});

test('a real link click reveals only that link and not adjacent emphasis', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const source = '[Link](https://example.com)*邻接* and `code`';
  await replaceSource(editor, page, source);
  const line = page.locator('.cm-line').first();

  const linkBox = await line.locator('.lm-md-link').boundingBox();
  expect(linkBox).not.toBeNull();
  if (!linkBox) {
    throw new Error('Expected the rendered link to have a bounding box.');
  }
  await page.mouse.move(
    linkBox.x + linkBox.width / 2,
    linkBox.y + linkBox.height / 2,
  );
  await page.mouse.down();
  await expect(line).toHaveText('Link邻接 and code');
  await page.mouse.up();
  const releasedState = await editorState(editor);
  expect(releasedState.anchor).toBe(releasedState.head);
  expect(releasedState.head).toBeGreaterThan(0);
  expect(releasedState.head).toBeLessThan(source.indexOf('*'));

  await expect(line).toContainText('[Link](https://example.com)邻接 and code');
  await expect(line).not.toContainText('*邻接*');
  await expect(line).not.toContainText('`code`');
  await expect(line.locator('.lm-md-source-mark-inline')).toHaveText([
    '[',
    ']',
    '(',
    'https://example.com',
    ')',
  ]);

  expect((await editorState(editor)).source).toBe(source);

  const dragLinkBox = await line.locator('.lm-md-link').boundingBox();
  const emphasisBox = await line.locator('.lm-md-emphasis').boundingBox();
  expect(dragLinkBox).not.toBeNull();
  expect(emphasisBox).not.toBeNull();
  if (!dragLinkBox || !emphasisBox) {
    throw new Error('Expected adjacent inline owners to have bounding boxes.');
  }
  await page.mouse.move(
    dragLinkBox.x + dragLinkBox.width / 2,
    dragLinkBox.y + dragLinkBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    emphasisBox.x + emphasisBox.width / 2,
    emphasisBox.y + emphasisBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();

  const dragState = await editorState(editor);
  expect(dragState.anchor).not.toBe(dragState.head);
  await expect(line).toContainText('[Link](https://example.com)*邻接*');
  expect(dragState.source).toBe(source);
});

test('does not restore a stale click position after an IME commit mid-gesture', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await replaceSource(
    editor,
    page,
    '[Link](https://example.com)*邻接* and plain',
  );
  const linkBox = await page
    .locator('.cm-line')
    .first()
    .locator('.lm-md-link')
    .boundingBox();
  expect(linkBox).not.toBeNull();
  if (!linkBox) {
    throw new Error('Expected the rendered link to have a bounding box.');
  }

  await page.mouse.move(
    linkBox.x + linkBox.width / 2,
    linkBox.y + linkBox.height / 2,
  );
  await page.mouse.down();
  await editor.dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText('中');
  await editor.dispatchEvent('compositionend', { data: '中' });
  const beforeRelease = await editorState(editor);
  expect(beforeRelease.source).toContain('中');
  expect(beforeRelease.anchor).toBe(beforeRelease.head);

  await page.mouse.up();

  expect(await editorState(editor)).toEqual(beforeRelease);
});

test('settles source decorations when a drag is released over the sidebar', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const source = '[Link](https://example.com)*邻接* and plain';
  await replaceSource(editor, page, source);
  const line = page.locator('.cm-line').first();
  const linkBox = await line.locator('.lm-md-link').boundingBox();
  const sidebarTarget = page.getByRole('tab', { name: /^(?:Files|文件)$/ });
  const sidebarBox = await sidebarTarget.boundingBox();
  expect(linkBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  if (!linkBox || !sidebarBox) {
    throw new Error('Expected the link and sidebar release target to be visible.');
  }

  await page.mouse.move(
    linkBox.x + linkBox.width / 2,
    linkBox.y + linkBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sidebarBox.x + sidebarBox.width / 2,
    sidebarBox.y + sidebarBox.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();

  await expect(line).toContainText('[Link](https://example.com)');
  await expect(line.locator('.lm-md-source-mark-inline')).not.toHaveCount(0);
});

test('keeps pointer decorations frozen through edge auto-scroll and settles after release', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const linkSource = '[Link](https://example.com)*邻接*';
  const source = [
    linkSource,
    '',
    ...Array.from({ length: 160 }, (_, index) => `paragraph ${index + 1}`),
  ].join('\n');
  await replaceSource(editor, page, source);
  const firstLine = page.locator('.cm-line').first();
  const scroller = page.locator('.cm-scroller');
  const scrollerBox = await scroller.boundingBox();
  const sidebar = page.getByRole('complementary');
  const sidebarBox = await sidebar.boundingBox();
  expect(scrollerBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  if (!scrollerBox || !sidebarBox) {
    throw new Error('Expected the editor scroller and sidebar to be visible.');
  }
  const selectionHead = source.indexOf('paragraph 40') + 4;
  let completedUninterruptedGesture = false;

  // Headless repeat runs can move focus between browser contexts. A real
  // window blur correctly settles the production gesture, so discard only
  // that externally interrupted attempt and still require a complete drag.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await scroller.evaluate((node) => {
      node.scrollTop = 0;
    });
    await moveSelection(editor, 0);
    await expect(firstLine).toHaveText('Link邻接');
    await page.bringToFront();
    await expect
      .poll(() => page.evaluate(() => document.hasFocus()))
      .toBe(true);
    await page.evaluate(() => {
      document.documentElement.dataset.lmWindowBlurred = 'false';
      window.addEventListener(
        'blur',
        () => {
          document.documentElement.dataset.lmWindowBlurred = 'true';
        },
        { capture: true, once: true },
      );
    });

    const linkBox = await firstLine.locator('.lm-md-link').boundingBox();
    expect(linkBox).not.toBeNull();
    if (!linkBox) {
      throw new Error('Expected the rendered link to be visible.');
    }
    await page.mouse.move(
      linkBox.x + linkBox.width / 2,
      linkBox.y + linkBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      scrollerBox.x + scrollerBox.width / 2,
      Math.min(
        page.viewportSize()!.height - 2,
        scrollerBox.y + scrollerBox.height + 48,
      ),
      { steps: 8 },
    );
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await page.mouse.move(
      scrollerBox.x + scrollerBox.width / 2,
      scrollerBox.y + scrollerBox.height / 2,
      { steps: 4 },
    );

    let previousScrollTop = -1;
    let stableScrollSamples = 0;
    await expect
      .poll(
        async () => {
          const currentScrollTop = await scroller.evaluate(
            (node) => node.scrollTop,
          );
          stableScrollSamples =
            Math.abs(currentScrollTop - previousScrollTop) < 1
              ? stableScrollSamples + 1
              : 0;
          previousScrollTop = currentScrollTop;
          return stableScrollSamples;
        },
        { intervals: [50, 50, 50, 50, 50], timeout: 5_000 },
      )
      .toBeGreaterThanOrEqual(3);
    expect(previousScrollTop).toBeGreaterThan(0);

    const windowBlurred = async () =>
      page.evaluate(
        () => document.documentElement.dataset.lmWindowBlurred === 'true',
      );
    if (await windowBlurred()) {
      await page.mouse.up();
      continue;
    }

    await moveSelection(editor, 1, selectionHead);
    expect(await editorState(editor)).toMatchObject({
      anchor: 1,
      head: selectionHead,
    });
    await scroller.evaluate((node) => {
      node.scrollTop = 0;
    });
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollTop))
      .toBe(0);

    const frozenLineText = await firstLine.textContent();
    if (await windowBlurred()) {
      await page.mouse.up();
      continue;
    }
    expect(frozenLineText).toBe('Link邻接');

    await page.mouse.move(sidebarBox.x + 8, sidebarBox.y + 8, { steps: 4 });
    await page.mouse.up();
    completedUninterruptedGesture = true;
    break;
  }

  expect(completedUninterruptedGesture).toBe(true);

  await expect(firstLine).toContainText(
    '[Link](https://example.com)',
  );
});

test('settles an active pointer gesture after cancellation or window blur', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const source = '[Link](https://example.com) and plain';
  await replaceSource(editor, page, source);
  const line = page.locator('.cm-line').first();
  const plainPosition = source.indexOf('plain') + 1;

  for (const settlement of ['pointercancel', 'touchcancel', 'blur'] as const) {
    await moveSelection(editor, plainPosition);
    await expect(line).toHaveText('Link and plain');
    const linkBox = await line.locator('.lm-md-link').boundingBox();
    expect(linkBox).not.toBeNull();
    if (!linkBox) {
      throw new Error('Expected the rendered link to have a bounding box.');
    }

    await page.mouse.move(
      linkBox.x + linkBox.width / 2,
      linkBox.y + linkBox.height / 2,
    );
    await page.mouse.down();
    await expect(line).toHaveText('Link and plain');

    await page.evaluate((eventName) => {
      if (eventName === 'blur') {
        window.dispatchEvent(new Event('blur'));
        return;
      }
      document.dispatchEvent(new Event(eventName, { bubbles: true }));
    }, settlement);

    await expect(line).toContainText('[Link](https://example.com)');
    await page.mouse.up();
  }
});

test('reveals only the syntax owned by each active Markdown node', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const image = '![Alt](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)';
  const source = [
    '# Heading',
    '',
    '- item',
    '',
    '> quote',
    '',
    '*emphasis* and `code`',
    '',
    image,
  ].join('\n');
  await replaceSource(editor, page, source);
  const lines = page.locator('.cm-line');

  await moveSelection(editor, source.indexOf('Heading') + 1);
  await expect(lines.nth(0)).toHaveText('# Heading');
  await expect(lines.nth(2)).not.toContainText('-');
  await expect(lines.nth(4)).not.toContainText('>');

  await moveSelection(editor, source.indexOf('item') + 1);
  await expect(lines.nth(0)).toHaveText('Heading');
  await expect(lines.nth(2)).toContainText('- item');
  await expect(lines.nth(4)).not.toContainText('>');

  await moveSelection(editor, source.indexOf('quote') + 1);
  await expect(lines.nth(2)).not.toContainText('-');
  await expect(lines.nth(4)).toHaveText('> quote');

  await moveSelection(editor, source.indexOf('emphasis') + 1);
  await expect(lines.nth(6)).toHaveText('*emphasis* and code');

  await moveSelection(editor, source.indexOf('code') + 1);
  await expect(lines.nth(6)).toHaveText('emphasis and `code`');

  await moveSelection(editor, source.indexOf('Alt') + 1);
  await expect(page.locator('.cm-content')).toContainText(image);
  await expect(page.getByRole('img', { name: 'Alt' })).toBeVisible();
  expect((await editorState(editor)).source).toBe(source);
});

test('fenced code reveals only the active boundary through keyboard navigation and selection', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const source = '```ts\nconst 中文 = 1\n```\n\nafter';
  await replaceSource(editor, page, source);
  const lines = page.locator('.cm-line');
  const contentOffset = source.indexOf('中文') + 1;
  await moveSelection(editor, contentOffset);

  await expect(lines.nth(0)).toHaveText('');
  await expect(lines.nth(1)).toHaveText('const 中文 = 1');
  await expect(lines.nth(2)).toHaveText('');

  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowUp');
  await expect(lines.nth(0)).toHaveText('```ts');
  await expect(lines.nth(2)).toHaveText('');

  await moveSelection(editor, 1, source.indexOf('中文'));
  await expect(lines.nth(0)).toHaveText('```ts');
  await expect(lines.nth(2)).toHaveText('');

  expect((await editorState(editor)).source).toBe(source);
});
