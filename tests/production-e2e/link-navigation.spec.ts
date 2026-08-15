import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
} from '../e2e/support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

type Point = { x: number; y: number };

type ProductionNavigationState = {
  files: Record<string, string>;
  lastWrite: null | { path: string; text: string };
  openDialogPath: string;
  openedUrls: string[];
  readPaths: string[];
};

type ProductionNavigationWindow = Window & {
  __LUMAMARK_LINK_NAVIGATION_PRODUCTION_STATE__?: ProductionNavigationState;
  __TAURI_INTERNALS__?: Record<string, unknown> & {
    invoke?: (
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
};

type ProductionEditorSnapshot = {
  selection: { anchor: number; head: number };
  source: string;
};

async function installProductionTauriMock(
  page: Page,
  fixture: {
    files: Record<string, string>;
    openDialogPath: string;
  },
): Promise<void> {
  await page.evaluate(({ files, openDialogPath }) => {
    const testWindow = window as ProductionNavigationWindow;
    const state: ProductionNavigationState = {
      files,
      lastWrite: null,
      openDialogPath,
      openedUrls: [],
      readPaths: [],
    };
    const existingInternals = testWindow.__TAURI_INTERNALS__ ?? {};
    testWindow.__LUMAMARK_LINK_NAVIGATION_PRODUCTION_STATE__ = state;
    testWindow.__TAURI_INTERNALS__ = {
      ...existingInternals,
      invoke: async (command, args = {}) => {
        switch (command) {
          case 'files_show_open_file_dialog':
            return state.openDialogPath;
          case 'files_show_save_file_dialog':
            return null;
          case 'files_read_text': {
            const path = args.path;
            if (typeof path !== 'string') {
              throw new Error('files_read_text did not receive a string path.');
            }
            state.readPaths.push(path);
            const text = state.files[path];
            if (text === undefined) {
              throw {
                code: 'file.not_found',
                message: `Missing production E2E file: ${path}`,
                recoverable: true,
              };
            }
            return {
              byteLength: new TextEncoder().encode(text).length,
              path,
              text,
            };
          }
          case 'files_write_text': {
            const path = args.path;
            const text = args.text;
            if (typeof path !== 'string' || typeof text !== 'string') {
              throw new Error('files_write_text received invalid arguments.');
            }
            state.files[path] = text;
            state.lastWrite = { path, text };
            return {
              byteLength: new TextEncoder().encode(text).length,
              path,
            };
          }
          case 'opener_open_url': {
            const url = args.url;
            if (typeof url !== 'string') {
              throw new Error('opener_open_url did not receive a string URL.');
            }
            state.openedUrls.push(url);
            return { opened: true };
          }
          default:
            throw new Error(`Unexpected production invoke command: ${command}`);
        }
      },
    };
  }, fixture);
}

async function openProductionFixture(
  page: Page,
  fixture: {
    files: Record<string, string>;
    openDialogPath: string;
  },
  expectedTitle: string,
  visibleText: string,
): Promise<Locator> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();

  // Install the raw Tauri invoke boundary only after application startup so
  // production code cannot fall back to the dev-only browser command clients.
  await installProductionTauriMock(page, fixture);
  await page.keyboard.press(`${primaryModifier}+O`);

  const editor = page.locator('.cm-content').first();
  await expect(page.locator('.lm-editor-title')).toHaveText(expectedTitle);
  await expect(editor).toContainText(visibleText);
  await installRootEditorViewTestBridge(editor);
  return editor;
}

async function moveSelection(
  editor: Locator,
  anchor: number,
  scrollIntoView = false,
): Promise<void> {
  await editor.evaluate(
    (content, options) => {
      const view = (
        content as RootEditorContentTestBridge
      ).resolveRootEditorViewForTest();
      view.dispatch({
        scrollIntoView: options.scrollIntoView,
        selection: { anchor: options.anchor },
      });
      view.focus();
    },
    { anchor, scrollIntoView },
  );
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
      throw new Error(`No production coordinates for source position ${sourcePosition}.`);
    }

    const left = Math.min(start.left, end.left);
    const right = Math.max(start.left, end.left);
    return {
      x: right - left >= 2 ? (left + right) / 2 : start.left + 1,
      y: (start.top + start.bottom) / 2,
    };
  }, position);
}

async function primaryClick(
  page: Page,
  editor: Locator,
  sourcePosition: number,
): Promise<void> {
  const point = await pointAtSourcePosition(editor, sourcePosition);
  await page.keyboard.down(primaryModifier);
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    await page.keyboard.up(primaryModifier);
  }
}

async function readEditorSnapshot(
  editor: Locator,
): Promise<ProductionEditorSnapshot> {
  return editor.evaluate((content) => {
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
}

async function readProductionState(
  page: Page,
): Promise<ProductionNavigationState> {
  return page.evaluate(() => {
    const state = (window as ProductionNavigationWindow)
      .__LUMAMARK_LINK_NAVIGATION_PRODUCTION_STATE__;
    if (!state) {
      throw new Error('The production link-navigation state is unavailable.');
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

test('routes external, fragment, and dangerous links through production code without creating undo edits', async ({
  page,
}) => {
  const documentPath = 'E:/lumamark-fixtures/production-links.md';
  const source = [
    '[External](https://production.example/docs)',
    '[Internal](#target-heading)',
    '[Unsafe](javascript:alert(1))',
    '',
    '# Start',
    ...Array.from({ length: 90 }, (_, index) => `Before target ${index + 1}`),
    '',
    '# Target Heading',
    ...Array.from({ length: 90 }, (_, index) => `After target ${index + 1}`),
    '',
    '# End',
  ].join('\n\n');
  const targetPosition = source.indexOf('# Target Heading');
  const editor = await openProductionFixture(
    page,
    {
      files: { [documentPath]: source },
      openDialogPath: documentPath,
    },
    'production-links.md',
    'External',
  );

  await moveSelection(editor, 0);
  const beforeExternal = await readEditorSnapshot(editor);
  await primaryClick(page, editor, source.indexOf('External') + 2);
  await expect.poll(async () =>
    (await readProductionState(page)).openedUrls,
  ).toEqual(['https://production.example/docs']);
  expect(await readEditorSnapshot(editor)).toEqual(beforeExternal);
  await page.keyboard.press(`${primaryModifier}+Z`);
  expect((await readEditorSnapshot(editor)).source).toBe(source);

  await moveSelection(editor, 0);
  await primaryClick(page, editor, source.indexOf('Internal') + 2);
  await expect.poll(async () =>
    (await readEditorSnapshot(editor)).selection.anchor,
  ).toBe(targetPosition);
  await expectPositionCentered(editor, targetPosition);
  await page.keyboard.press(`${primaryModifier}+Z`);
  const afterInternalUndo = await readEditorSnapshot(editor);
  expect(afterInternalUndo.source).toBe(source);
  expect(afterInternalUndo.selection.anchor).toBe(targetPosition);

  const unsafePosition = source.indexOf('Unsafe') + 2;
  await moveSelection(editor, unsafePosition, true);
  const beforeUnsafe = await readEditorSnapshot(editor);
  await primaryClick(page, editor, unsafePosition);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('不允许打开 javascript: 链接。');
  await expect(alert).toContainText('当前文档内容未被更改。');
  expect(await readEditorSnapshot(editor)).toEqual(beforeUnsafe);
  await alert
    .getByRole('button', { name: /^(?:Close|关闭)$/ })
    .click();
  await page.keyboard.press(`${primaryModifier}+Z`);
  expect((await readEditorSnapshot(editor)).source).toBe(source);

  const state = await readProductionState(page);
  expect(state.openedUrls).toEqual(['https://production.example/docs']);
  expect(state.readPaths).toEqual([documentPath]);
  expect(state.lastWrite).toBeNull();
  await expect(page.locator('.lm-editor-title')).toHaveText(
    'production-links.md',
  );
});

test('opens a canonical cross-document fragment through raw production Tauri invoke', async ({
  page,
}) => {
  const initialPath = 'E:/lumamark-fixtures/production/index.md';
  const targetPath =
    'E:/lumamark-fixtures/production/guides/Production Guide.md';
  const initialSource =
    '[Open production guide](./guides/Production%20Guide.md#release-target)';
  const targetSource = [
    '# Production Guide',
    ...Array.from({ length: 90 }, (_, index) => `Before release ${index + 1}`),
    '',
    '# Release Target',
    ...Array.from({ length: 90 }, (_, index) => `After release ${index + 1}`),
    '',
    '# Production End',
  ].join('\n\n');
  const targetPosition = targetSource.indexOf('# Release Target');
  const editor = await openProductionFixture(
    page,
    {
      files: {
        [initialPath]: initialSource,
        [targetPath]: targetSource,
      },
      openDialogPath: initialPath,
    },
    'index.md',
    'Open production guide',
  );

  await primaryClick(
    page,
    editor,
    initialSource.indexOf('Open production guide') + 3,
  );
  await expect(page.locator('.lm-editor-title')).toHaveText(
    'Production Guide.md',
  );
  await expect(editor).toContainText('Release Target');
  await installRootEditorViewTestBridge(editor);
  await expect.poll(async () =>
    (await readEditorSnapshot(editor)).selection.anchor,
  ).toBe(targetPosition);
  await expectPositionCentered(editor, targetPosition);

  await page.keyboard.press(`${primaryModifier}+Z`);
  expect((await readEditorSnapshot(editor)).source).toBe(targetSource);
  const state = await readProductionState(page);
  expect(state.readPaths).toEqual([initialPath, targetPath]);
  expect(state.openedUrls).toEqual([]);
  expect(state.lastWrite).toBeNull();
});
