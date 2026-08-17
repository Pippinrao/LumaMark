import { expect, test, type Locator, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';
import {
  installRootEditorHistoryTestBridge,
  installRootEditorViewTestBridge,
  readRootEditorHistoryDepth,
  type RootEditorContentTestBridge,
} from './support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

type Point = { x: number; y: number };

type DevNavigationState = {
  files: Record<string, string>;
  lastWrite: null | { path: string; text: string };
  openDialogPath: string;
  openedUrls: string[];
  readPaths: string[];
};

type DevNavigationWindow = Window & {
  __LUMAMARK_LINK_NAVIGATION_DEV_STATE__?: DevNavigationState;
};

type EditorSnapshot = {
  history: { redo: number; undo: number };
  selection: { anchor: number; head: number };
  source: string;
};

async function installDevNavigationFixture(
  page: Page,
  fixture: {
    files: Record<string, string>;
    openDialogPath: string;
  },
): Promise<void> {
  await page.addInitScript(({ files, openDialogPath }) => {
    const state: DevNavigationState = {
      files,
      lastWrite: null,
      openDialogPath,
      openedUrls: [],
      readPaths: [],
    };
    const testWindow = window as DevNavigationWindow;
    testWindow.__LUMAMARK_LINK_NAVIGATION_DEV_STATE__ = state;
    window.__LUMAMARK_E2E_STATE__ = { files, lastWrite: null };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async (path) => {
        state.readPaths.push(path);
        const text = state.files[path];
        if (text === undefined) {
          return {
            ok: false,
            error: {
              code: 'file.not_found',
              message: `Missing E2E file: ${path}`,
              recoverable: true,
            },
          };
        }
        return {
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(text).length,
            path,
            text,
          },
        };
      },
      showOpenDialog: async () => ({ ok: true, data: state.openDialogPath }),
      showSaveDialog: async () => ({ ok: true, data: null }),
      writeText: async (path, text) => {
        state.files[path] = text;
        state.lastWrite = { path, text };
        window.__LUMAMARK_E2E_STATE__!.lastWrite = { path, text };
        return {
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(text).length,
            path,
          },
        };
      },
    };
    window.__LUMAMARK_E2E_OPENER_COMMANDS__ = {
      openUrl: async (url) => {
        state.openedUrls.push(url);
        return { ok: true, data: { opened: true } };
      },
    };
  }, fixture);
}

async function openFixtureDocument(
  page: Page,
  expectedTitle: string,
  visibleText: string,
): Promise<Locator> {
  await page.goto('/');
  await openBlankDocument(page);
  await page.keyboard.press(`${primaryModifier}+O`);

  const editor = page.locator('.cm-content').first();
  await expect(page.locator('.lm-editor-title')).toHaveText(expectedTitle);
  await expect(editor).toContainText(visibleText);
  await installRootEditorViewTestBridge(editor);
  await installRootEditorHistoryTestBridge(editor);
  return editor;
}

async function switchEditorMode(
  page: Page,
  mode: 'livePreview' | 'source',
): Promise<void> {
  const rootClass = mode === 'source'
    ? '.lm-editor-source-mode'
    : '.lm-editor-live-preview-mode';
  if (await page.locator(rootClass).isVisible()) {
    return;
  }

  await page
    .getByRole('menuitem', { name: /^(?:View|视图)$/ })
    .click();
  await page
    .getByRole('menuitemradio', {
      name: mode === 'source'
        ? /^(?:Source Mode|源码模式)/
        : /^(?:Live Preview|实时预览)/,
    })
    .click();
  await expect(page.locator(rootClass)).toBeVisible();
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

async function pointAtSourcePosition(
  editor: Locator,
  position: number,
): Promise<Point> {
  return editor.evaluate((content, sourcePosition) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    const start = view.coordsAtPos(sourcePosition, 1);
    const end = view.coordsAtPos(
      Math.min(sourcePosition + 1, view.state.doc.toString().length),
      -1,
    );
    if (!start || !end) {
      throw new Error(`No rendered coordinates for source position ${sourcePosition}.`);
    }

    const left = Math.min(start.left, end.left);
    const right = Math.max(start.left, end.left);
    return {
      x: right - left >= 2 ? (left + right) / 2 : start.left + 1,
      y: (start.top + start.bottom) / 2,
    };
  }, position);
}

async function withPressedKeys(
  page: Page,
  keys: readonly string[],
  action: () => Promise<void>,
): Promise<void> {
  for (const key of keys) {
    await page.keyboard.down(key);
  }
  try {
    await action();
  } finally {
    for (const key of [...keys].reverse()) {
      await page.keyboard.up(key);
    }
  }
}

async function primaryClick(
  page: Page,
  editor: Locator,
  sourcePosition: number,
): Promise<void> {
  const point = await pointAtSourcePosition(editor, sourcePosition);
  await withPressedKeys(page, [primaryModifier], () =>
    page.mouse.click(point.x, point.y),
  );
}

async function settleBrowserFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function readEditorSnapshot(editor: Locator): Promise<EditorSnapshot> {
  const editorState = await editor.evaluate((content) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    return {
      selection: {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
      },
      source: view.state.doc.toString(),
    };
  });
  return {
    ...editorState,
    history: await readRootEditorHistoryDepth(editor),
  };
}

async function readDevNavigationState(page: Page): Promise<DevNavigationState> {
  return page.evaluate(() => {
    const state = (window as DevNavigationWindow)
      .__LUMAMARK_LINK_NAVIGATION_DEV_STATE__;
    if (!state) {
      throw new Error('The link-navigation E2E state is unavailable.');
    }
    return structuredClone(state);
  });
}

async function expectPositionCentered(
  editor: Locator,
  position: number,
): Promise<void> {
  await expect.poll(() =>
    editor.evaluate((content, sourcePosition) => {
      const view = (
        content as RootEditorContentTestBridge
      ).resolveRootEditorViewForTest();
      const target = view.coordsAtPos(sourcePosition, 1);
      if (!target) {
        return Number.POSITIVE_INFINITY;
      }
      const viewport = view.scrollDOM.getBoundingClientRect();
      return Math.abs(
        (target.top + target.bottom) / 2 -
          (viewport.top + viewport.bottom) / 2,
      );
    }, position),
  ).toBeLessThanOrEqual(96);
}

test('opens every external Markdown link form exactly once and rejects invalid gestures', async ({
  page,
}) => {
  const documentPath = 'E:/lumamark-fixtures/issue-15-external-links.md';
  const source = [
    '[Inline](https://inline.example/path)',
    '[Reference][remote]',
    '<https://autolink.example/docs>',
    'reader@example.com',
    '',
    '[remote]: https://reference.example/guide',
  ].join('\n\n');
  const linkCases = [
    {
      href: 'https://inline.example/path',
      position: source.indexOf('Inline') + 2,
    },
    {
      href: 'https://reference.example/guide',
      position: source.indexOf('Reference') + 2,
    },
    {
      href: 'https://autolink.example/docs',
      position: source.indexOf('autolink') + 2,
    },
    {
      href: 'mailto:reader@example.com',
      position: source.indexOf('reader') + 2,
    },
  ] as const;

  await installDevNavigationFixture(page, {
    files: { [documentPath]: source },
    openDialogPath: documentPath,
  });
  const editor = await openFixtureDocument(
    page,
    'issue-15-external-links.md',
    'Inline',
  );
  const expectedOpenedUrls: string[] = [];

  for (const mode of ['livePreview', 'source'] as const) {
    await switchEditorMode(page, mode);
    for (const linkCase of linkCases) {
      await moveSelection(editor, 0);
      const before = await readEditorSnapshot(editor);
      await primaryClick(page, editor, linkCase.position);
      expectedOpenedUrls.push(linkCase.href);
      await expect.poll(async () =>
        (await readDevNavigationState(page)).openedUrls,
      ).toEqual(expectedOpenedUrls);
      expect(await readEditorSnapshot(editor)).toEqual(before);
    }
  }

  await switchEditorMode(page, 'livePreview');
  const beforeInvalidGestures = await readEditorSnapshot(editor);
  const baselineCallCount = expectedOpenedUrls.length;

  let invalidTarget = await pointAtSourcePosition(
    editor,
    linkCases[0].position,
  );
  await page.mouse.click(invalidTarget.x, invalidTarget.y);
  invalidTarget = await pointAtSourcePosition(editor, linkCases[0].position);
  await withPressedKeys(page, [primaryModifier, 'Shift'], () =>
    page.mouse.click(invalidTarget.x, invalidTarget.y),
  );
  invalidTarget = await pointAtSourcePosition(editor, linkCases[0].position);
  await withPressedKeys(page, [primaryModifier, 'Alt'], () =>
    page.mouse.click(invalidTarget.x, invalidTarget.y),
  );
  invalidTarget = await pointAtSourcePosition(editor, linkCases[0].position);
  await withPressedKeys(page, [primaryModifier], () =>
    page.mouse.click(invalidTarget.x, invalidTarget.y, { button: 'right' }),
  );
  await page.keyboard.press('Escape');
  invalidTarget = await pointAtSourcePosition(editor, linkCases[0].position);
  await withPressedKeys(page, [primaryModifier], async () => {
    await page.mouse.move(invalidTarget.x, invalidTarget.y);
    await page.mouse.down();
    await page.mouse.move(invalidTarget.x + 5, invalidTarget.y, { steps: 2 });
    await page.mouse.up();
  });
  await settleBrowserFrames(page);

  const afterInvalidGestures = await readDevNavigationState(page);
  expect(afterInvalidGestures.openedUrls).toHaveLength(baselineCallCount);
  expect(afterInvalidGestures.lastWrite).toBeNull();
  const finalEditorSnapshot = await readEditorSnapshot(editor);
  expect(finalEditorSnapshot.source).toBe(beforeInvalidGestures.source);
  expect(finalEditorSnapshot.history).toEqual(beforeInvalidGestures.history);
});

test('centers same-document fragments and outline selections without editing history', async ({
  page,
}) => {
  const documentPath = 'E:/lumamark-fixtures/issue-15-fragments.md';
  const source = [
    '[Jump](#target-heading)',
    '',
    '# Start',
    ...Array.from({ length: 90 }, (_, index) => `Paragraph before ${index + 1}`),
    '',
    '# Target Heading',
    ...Array.from({ length: 90 }, (_, index) => `Paragraph after ${index + 1}`),
    '',
    '# End',
  ].join('\n\n');
  const targetPosition = source.indexOf('# Target Heading');

  await installDevNavigationFixture(page, {
    files: { [documentPath]: source },
    openDialogPath: documentPath,
  });
  const editor = await openFixtureDocument(
    page,
    'issue-15-fragments.md',
    'Jump',
  );
  const beforeNavigation = await readEditorSnapshot(editor);

  await primaryClick(page, editor, source.indexOf('Jump') + 1);
  await expect.poll(async () =>
    (await readEditorSnapshot(editor)).selection.anchor,
  ).toBe(targetPosition);
  await expectPositionCentered(editor, targetPosition);
  const afterFragment = await readEditorSnapshot(editor);
  expect(afterFragment.source).toBe(source);
  expect(afterFragment.history).toEqual(beforeNavigation.history);

  await editor.evaluate((content) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    view.scrollDOM.scrollTop = 0;
    view.dispatch({ selection: { anchor: 0 } });
  });
  await page.getByRole('tab', { name: /^(?:Outline|大纲)$/ }).click();
  const targetOutlineItem = page.getByRole('button', {
    exact: true,
    name: 'Target Heading',
  });
  await expect(targetOutlineItem).toBeVisible();
  const outlineBox = await targetOutlineItem.boundingBox();
  if (!outlineBox) {
    throw new Error('The target outline item has no pointer geometry.');
  }
  await page.mouse.click(
    outlineBox.x + outlineBox.width / 2,
    outlineBox.y + outlineBox.height / 2,
  );
  await expect.poll(async () =>
    (await readEditorSnapshot(editor)).selection.anchor,
  ).toBe(targetPosition);
  await expectPositionCentered(editor, targetPosition);

  const finalState = await readDevNavigationState(page);
  expect(finalState.openedUrls).toEqual([]);
  expect(finalState.lastWrite).toBeNull();
  const finalEditor = await readEditorSnapshot(editor);
  expect(finalEditor.source).toBe(source);
  expect(finalEditor.history).toEqual(beforeNavigation.history);
});

test('opens a canonical relative document path and then centers its decoded fragment', async ({
  page,
}) => {
  const initialPath = 'E:/lumamark-fixtures/notes/index.md';
  const targetPath = 'E:/lumamark-fixtures/notes/guides/Target Doc.md';
  const initialSource = '[Open guide](./guides/Target%20Doc.md#target-section)';
  const dirtySource = `${initialSource}\n\nUnsaved local edit`;
  const targetSource = [
    '# Guide Start',
    ...Array.from({ length: 90 }, (_, index) => `Before target ${index + 1}`),
    '',
    '# Target Section',
    ...Array.from({ length: 90 }, (_, index) => `After target ${index + 1}`),
    '',
    '# Guide End',
  ].join('\n\n');
  const targetPosition = targetSource.indexOf('# Target Section');

  await installDevNavigationFixture(page, {
    files: {
      [initialPath]: initialSource,
      [targetPath]: targetSource,
    },
    openDialogPath: initialPath,
  });
  const editor = await openFixtureDocument(
    page,
    'index.md',
    'Open guide',
  );

  await editor.evaluate((content) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert: '\n\nUnsaved local edit',
      },
    });
  });
  await expect(page.locator('.lm-editor-title')).toContainText('*');
  const beforeBlockedOpen = await readEditorSnapshot(editor);
  await primaryClick(page, editor, initialSource.indexOf('Open guide') + 2);
  await expect(page.getByRole('alert')).toContainText(
    '请先保存或丢弃当前修改，再打开其他文档。',
  );
  expect(await readEditorSnapshot(editor)).toEqual(beforeBlockedOpen);
  expect((await readDevNavigationState(page)).readPaths).toEqual([initialPath]);
  await page
    .getByRole('alert')
    .getByRole('button', { name: /^(?:Close|关闭)$/ })
    .click();

  await page.keyboard.press(`${primaryModifier}+S`);
  await expect.poll(async () =>
    (await readDevNavigationState(page)).lastWrite?.text,
  ).toBe(dirtySource);
  await expect(page.locator('.lm-editor-title')).toHaveText('index.md');

  await primaryClick(page, editor, initialSource.indexOf('Open guide') + 2);
  await expect(page.locator('.lm-editor-title')).toHaveText('Target Doc.md');
  await expect(editor).toContainText('Target Section');
  await installRootEditorViewTestBridge(editor);
  await expect.poll(async () =>
    (await readEditorSnapshot(editor)).selection.anchor,
  ).toBe(targetPosition);
  await expectPositionCentered(editor, targetPosition);

  const state = await readDevNavigationState(page);
  expect(state.readPaths).toEqual([initialPath, targetPath]);
  expect(state.openedUrls).toEqual([]);
  expect(state.lastWrite).toEqual({ path: initialPath, text: dirtySource });
  expect((await readEditorSnapshot(editor)).source).toBe(targetSource);
});

test('blocks dangerous protocols with localized alerts and zero navigation side effects', async ({
  page,
}) => {
  const documentPath = 'E:/lumamark-fixtures/issue-15-dangerous-links.md';
  const source = [
    '[Script](javascript:alert(1))',
    '[Data](data:text/plain;base64,SGVsbG8=)',
    '[File](file:///C:/Windows/win.ini)',
    '[Other](ftp://example.com/archive.zip)',
  ].join('\n\n');
  const cases = [
    { label: 'Script', message: '不允许打开 javascript: 链接。' },
    { label: 'Data', message: '不允许打开 data: 链接。' },
    { label: 'File', message: '不允许打开 file: 链接。' },
    { label: 'Other', message: '不允许打开此协议的链接。' },
  ] as const;

  await installDevNavigationFixture(page, {
    files: { [documentPath]: source },
    openDialogPath: documentPath,
  });
  const editor = await openFixtureDocument(
    page,
    'issue-15-dangerous-links.md',
    'Script',
  );

  for (const blockedCase of cases) {
    await moveSelection(editor, 0);
    const before = await readEditorSnapshot(editor);
    await primaryClick(
      page,
      editor,
      source.indexOf(blockedCase.label) + 1,
    );
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(blockedCase.message);
    await expect(alert).toContainText('当前文档内容未被更改。');
    expect(await readEditorSnapshot(editor)).toEqual(before);
    const state = await readDevNavigationState(page);
    expect(state.openedUrls).toEqual([]);
    expect(state.readPaths).toEqual([documentPath]);
    expect(state.lastWrite).toBeNull();

    await alert
      .getByRole('button', { name: /^(?:Close|关闭)$/ })
      .click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});
