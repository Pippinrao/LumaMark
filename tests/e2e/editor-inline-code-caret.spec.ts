import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  installRootEditorHistoryTestBridge,
  installRootEditorViewTestBridge,
  readRootEditorHistoryDepth,
  type RootEditorContentTestBridge,
} from './support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const inlineSource = '异行锚点\n\n前缀文本 `alphaBeta` 中间中文 `gamma_delta` 后缀文字';

type Point = { x: number; y: number };
type InlinePointName =
  | 'leftPadding'
  | 'left'
  | 'middle'
  | 'right'
  | 'rightPadding';

type TraceEntry = {
  cm: {
    anchor: number;
    head: number;
    selectedText: string;
  };
  detail: number;
  dom: {
    collapsed: boolean;
    text: string;
  } | null;
  owner: {
    from: number;
    left: number;
    right: number;
    text: string;
    to: number;
  } | null;
  phase: string;
  pointPosition: number | null;
  selectionHeadLeft: number | null;
  type: string;
};

type InlineTraceWindow = Window & {
  __LUMAMARK_INLINE_TRACE__?: TraceEntry[];
};

type PointerCandidateSnapshot = {
  caretNodeText: string | null;
  caretOffset: number | null;
  detail: number;
  from: number;
  targetText: string;
  to: number;
  x: number;
  y: number;
};

async function openNewDocument(page: Page): Promise<Locator> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();

  const editor = page.locator('.cm-content').first();
  await installRootEditorViewTestBridge(editor);
  return editor;
}

async function openCleanDocument(page: Page): Promise<Locator> {
  const path = 'E:/lumamark-fixtures/issue-14-inline-code.md';
  await page.addInitScript(
    ({ documentPath, markdown }) => {
      const files = { [documentPath]: markdown };
      window.__LUMAMARK_E2E_STATE__ = { files, lastWrite: null };
      const readFile = async (requestedPath: string) => ({
        ok: true as const,
        data: {
          byteLength: new TextEncoder().encode(files[requestedPath] ?? '')
            .length,
          path: requestedPath,
          text: files[requestedPath] ?? '',
        },
      });
      window.__LUMAMARK_E2E_DOCUMENT_CLAIMS__ = {
        beginSession: async () => ({
          ok: true,
          data: { sessionGeneration: 1, status: 'began' },
        }),
        commitReservation: async () => ({
          ok: true,
          data: { status: 'committed' },
        }),
        focusWindow: async () => ({ ok: true, data: { status: 'focused' } }),
        releaseOwnedDocument: async () => ({
          ok: true,
          data: { status: 'released' },
        }),
        releaseReservation: async () => ({
          ok: true,
          data: { status: 'released' },
        }),
        releaseSession: async () => ({
          ok: true,
          data: { releasedReservations: 0, status: 'released' },
        }),
        readTextClaimed: async (_operationId, requestedPath) =>
          readFile(requestedPath),
        reserveDocument: async () => ({
          ok: true,
          data: { status: 'reserved' },
        }),
        takeoverSession: async () => ({
          ok: true,
          data: {
            releasedReservations: 0,
            sessionGeneration: 2,
            status: 'takenOver',
          },
        }),
        writeTextClaimed: async (_operationId, requestedPath, text) => {
          files[requestedPath] = text;
          window.__LUMAMARK_E2E_STATE__!.lastWrite = {
            path: requestedPath,
            text,
          };
          return {
            ok: true,
            data: {
              byteLength: new TextEncoder().encode(text).length,
              path: requestedPath,
            },
          };
        },
      };
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (requestedPath) => readFile(requestedPath),
        showOpenDialog: async () => ({ ok: true, data: documentPath }),
        showSaveDialog: async () => ({ ok: true, data: null }),
        writeText: async (requestedPath, text) => {
          files[requestedPath] = text;
          window.__LUMAMARK_E2E_STATE__!.lastWrite = {
            path: requestedPath,
            text,
          };
          return {
            ok: true,
            data: {
              byteLength: new TextEncoder().encode(text).length,
              path: requestedPath,
            },
          };
        },
      };
    },
    { documentPath: path, markdown: inlineSource },
  );

  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
  await page.keyboard.press(`${primaryModifier}+O`);
  const editor = page.locator('.cm-content').first();
  await expect(editor).toContainText('gamma_delta');
  await expect(page.locator('.lm-editor-title')).toHaveText(
    'issue-14-inline-code.md',
  );
  await installRootEditorViewTestBridge(editor);
  return editor;
}

async function switchEditorMode(
  page: Page,
  mode: 'livePreview' | 'source',
): Promise<void> {
  const rootClass = mode === 'source'
    ? '.lm-editor-source-mode'
    : '.lm-editor-live-preview-mode';
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

async function replaceSource(
  editor: Locator,
  page: Page,
  source: string,
): Promise<void> {
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
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

async function systemDoubleClickWithJitter(
  page: Page,
  point: Point,
  deltaX: number,
): Promise<void> {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down({ button: 'left', clickCount: 1 });
  await page.mouse.up({ button: 'left', clickCount: 1 });
  await page.mouse.move(point.x + deltaX, point.y);
  await page.mouse.down({ button: 'left', clickCount: 2 });
  await page.mouse.up({ button: 'left', clickCount: 2 });
}

async function editorState(editor: Locator): Promise<{
  anchor: number;
  head: number;
  selectedText: string;
  source: string;
}> {
  return editor.evaluate((content) => {
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    const selection = view.state.selection.main;
    return {
      anchor: selection.anchor,
      head: selection.head,
      selectedText: view.state.doc.sliceString(selection.from, selection.to),
      source: view.state.doc.toString(),
    };
  });
}

async function domSelection(page: Page): Promise<{
  collapsed: boolean;
  text: string;
} | null> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    return selection
      ? { collapsed: selection.isCollapsed, text: selection.toString() }
      : null;
  });
}

async function textRect(owner: Locator, text: string): Promise<DOMRect> {
  return owner.evaluate((element, targetText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue ?? '';
      const start = value.indexOf(targetText);
      if (start < 0) {
        continue;
      }

      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + targetText.length);
      return range.getBoundingClientRect().toJSON();
    }

    throw new Error(`Unable to locate visible inline text: ${targetText}`);
  }, text);
}

async function inlinePoints(
  owner: Locator,
  text: string,
): Promise<Record<InlinePointName, Point>> {
  const ownerBox = await owner.boundingBox();
  const contentBox = await textRect(owner, text);
  expect(ownerBox).not.toBeNull();
  if (!ownerBox) {
    throw new Error(`Expected inline-code geometry for ${text}.`);
  }

  const y = contentBox.top + contentBox.height / 2;
  const contentLeft = contentBox.left;
  const contentRight = contentBox.right;
  return {
    leftPadding: {
      x: ownerBox.x + Math.max(1, (contentLeft - ownerBox.x) / 2),
      y,
    },
    left: { x: contentLeft + Math.min(2, contentBox.width / 6), y },
    middle: { x: contentLeft + contentBox.width / 2, y },
    right: { x: contentRight - Math.min(2, contentBox.width / 6), y },
    rightPadding: {
      x: contentRight + Math.max(1, (ownerBox.x + ownerBox.width - contentRight) / 2),
      y,
    },
  };
}

function inlineOwnerForSource(
  page: Page,
  source: string,
  text: string,
): Locator {
  const contentFrom = source.indexOf(text);
  const ownerFrom = contentFrom - 1;
  const ownerTo = contentFrom + text.length + 1;
  return page.locator(
    `.lm-md-inline-code[data-lm-inline-owner-from="${ownerFrom}"]` +
      `[data-lm-inline-owner-to="${ownerTo}"]`,
  ).first();
}

function inlineOwner(page: Page, text: string): Locator {
  return inlineOwnerForSource(page, inlineSource, text);
}

async function captureNextPointerTarget(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-lm-pointer-candidate');
    document.addEventListener('mousedown', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const owner = target?.closest<HTMLElement>(
        '[data-lm-inline-owner-from]',
      );
      const from = Number(owner?.dataset.lmInlineOwnerFrom);
      const to = Number(owner?.dataset.lmInlineOwnerTo);
      const caretRange = document.caretRangeFromPoint(
        event.clientX,
        event.clientY,
      );
      document.documentElement.dataset.lmPointerCandidate = JSON.stringify({
        caretNodeText: caretRange?.startContainer.nodeValue ?? null,
        caretOffset: caretRange?.startOffset ?? null,
        detail: event.detail,
        from,
        targetText: owner?.textContent ?? '',
        to,
        x: event.clientX,
        y: event.clientY,
      } satisfies PointerCandidateSnapshot);
    }, { capture: true, once: true });
  });
}

function expectedPosition(text: string, pointName: InlinePointName): number {
  const contentFrom = inlineSource.indexOf(text);
  if (pointName === 'leftPadding' || pointName === 'left') {
    return contentFrom;
  }
  if (pointName === 'middle') {
    return contentFrom + Math.floor(text.length / 2);
  }
  return contentFrom + text.length;
}

async function pointerCandidate(page: Page): Promise<PointerCandidateSnapshot> {
  return page.evaluate(() => {
    const serialized = document.documentElement.dataset.lmPointerCandidate;
    if (!serialized) {
      throw new Error('Expected a captured inline pointer candidate.');
    }
    return JSON.parse(serialized) as PointerCandidateSnapshot;
  });
}

async function installTrace(
  editor: Locator,
  point: Point,
): Promise<void> {
  await editor.evaluate((content, fixedPoint) => {
    const traceWindow = window as InlineTraceWindow;
    const view = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest();
    traceWindow.__LUMAMARK_INLINE_TRACE__ = [];

    const snapshot = (event: MouseEvent, phase: string) => {
      const selection = view.state.selection.main;
      const domSelection = window.getSelection();
      const target = event.target instanceof Element ? event.target : null;
      const owner = target?.closest<HTMLElement>(
        '[data-lm-inline-owner-from]',
      ) ?? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(
        '[data-lm-inline-owner-from]',
      ) ?? null;
      const ownerRect = owner?.getBoundingClientRect() ?? null;
      const headRect = view.coordsAtPos(selection.head);

      traceWindow.__LUMAMARK_INLINE_TRACE__?.push({
        cm: {
          anchor: selection.anchor,
          head: selection.head,
          selectedText: view.state.doc.sliceString(selection.from, selection.to),
        },
        detail: event.detail,
        dom: domSelection
          ? { collapsed: domSelection.isCollapsed, text: domSelection.toString() }
          : null,
        owner: ownerRect
          ? {
              from: Number(owner?.dataset.lmInlineOwnerFrom),
              left: ownerRect.left,
              right: ownerRect.right,
              text: owner?.textContent ?? '',
              to: Number(owner?.dataset.lmInlineOwnerTo),
            }
          : null,
        phase,
        pointPosition: view.posAtCoords(fixedPoint),
        selectionHeadLeft: headRect?.left ?? null,
        type: event.type,
      });
    };

    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick'] as const) {
      document.addEventListener(type, (event) => {
        snapshot(event, 'capture');
        queueMicrotask(() => snapshot(event, 'capture-microtask'));
      }, true);
      document.addEventListener(type, (event) => {
        snapshot(event, 'bubble');
        queueMicrotask(() => snapshot(event, 'bubble-microtask'));
        requestAnimationFrame(() => snapshot(event, 'bubble-frame'));
      });
    }
  }, point);
}

test('traces the inline-code selection geometry across a real browser double click', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const source = inlineSource;
  await replaceSource(editor, page, source);
  await moveSelection(editor, 1);

  const owners = page.locator('.lm-md-inline-code');
  await expect(owners).toHaveCount(2);
  const owner = owners.first();
  const ownerBox = await owner.boundingBox();
  const contentBox = await textRect(owner, 'alphaBeta');
  expect(ownerBox).not.toBeNull();
  if (!ownerBox) {
    throw new Error('Expected inline-code owner geometry.');
  }

  const point = {
    x: ownerBox.x + 2,
    y: contentBox.top + contentBox.height / 2,
  };
  await installTrace(editor, point);
  await page.mouse.dblclick(point.x, point.y, { delay: 20 });
  await afterLayout(page);

  const trace = await page.evaluate(
    () => (window as InlineTraceWindow).__LUMAMARK_INLINE_TRACE__ ?? [],
  );
  await test.info().attach('inline-code-event-trace', {
    body: JSON.stringify({ contentBox, ownerBox, point, trace }, null, 2),
    contentType: 'application/json',
  });

  const captureSequence = trace
    .filter((entry) => entry.phase === 'capture')
    .map((entry) => `${entry.type}:${entry.detail}`);
  expect(captureSequence).toEqual([
    'mousedown:1',
    'mouseup:1',
    'click:1',
    'mousedown:2',
    'mouseup:2',
    'click:2',
    'dblclick:2',
  ]);

  const firstMouseDown = trace.find(
    (entry) => entry.phase === 'capture' &&
      entry.type === 'mousedown' &&
      entry.detail === 1,
  );
  const secondMouseDown = trace.find(
    (entry) => entry.phase === 'capture' &&
      entry.type === 'mousedown' &&
      entry.detail === 2,
  );
  expect(firstMouseDown?.owner?.text).toBe('alphaBeta');
  expect(firstMouseDown?.pointPosition).toBe(source.indexOf('alphaBeta'));
  expect(secondMouseDown?.owner?.text).toBe('`alphaBeta`');
  expect(secondMouseDown?.pointPosition).toBe(source.indexOf('`alphaBeta`'));

  const finalState = trace.at(-1);
  expect(finalState?.cm.selectedText).toBe('alphaBeta');
  expect(finalState?.dom?.text).toBe('alphaBeta');
});

test('single clicks collapse repeatably across both inline-code owners and padding', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await replaceSource(editor, page, inlineSource);
  const owners = page.locator('.lm-md-inline-code');
  await expect(owners).toHaveCount(2);

  const alphaStart = inlineSource.indexOf('alphaBeta');
  const gammaStart = inlineSource.indexOf('gamma_delta');
  const sameLineCaret = inlineSource.indexOf('前缀文本') + 1;
  const cases: readonly {
    initialCaret: number;
    pointName: InlinePointName;
    text: string;
  }[] = [
    { initialCaret: 1, pointName: 'leftPadding', text: 'alphaBeta' },
    { initialCaret: sameLineCaret, pointName: 'left', text: 'alphaBeta' },
    { initialCaret: gammaStart + 2, pointName: 'middle', text: 'alphaBeta' },
    { initialCaret: 1, pointName: 'right', text: 'alphaBeta' },
    { initialCaret: sameLineCaret, pointName: 'rightPadding', text: 'alphaBeta' },
    { initialCaret: 1, pointName: 'leftPadding', text: 'gamma_delta' },
    { initialCaret: sameLineCaret, pointName: 'left', text: 'gamma_delta' },
    { initialCaret: alphaStart + 2, pointName: 'middle', text: 'gamma_delta' },
    { initialCaret: 1, pointName: 'right', text: 'gamma_delta' },
    { initialCaret: alphaStart + 2, pointName: 'rightPadding', text: 'gamma_delta' },
  ];

  for (const scenario of cases) {
    let repeatedPoint: Point | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await moveSelection(editor, scenario.initialCaret);
      await afterLayout(page);
      const owner = inlineOwner(page, scenario.text);
      await expect(owner).toHaveText(scenario.text);
      const point = (await inlinePoints(owner, scenario.text))[scenario.pointName];
      if (repeatedPoint) {
        expect(point.x).toBeCloseTo(repeatedPoint.x, 4);
        expect(point.y).toBeCloseTo(repeatedPoint.y, 4);
      } else {
        repeatedPoint = point;
      }
      await captureNextPointerTarget(page);
      await page.mouse.click(point.x, point.y);
      await afterLayout(page);

      const candidate = await pointerCandidate(page);
      expect(candidate.detail).toBe(1);
      expect(candidate.targetText).toBe(scenario.text);
      const expectedCaret = expectedPosition(
        scenario.text,
        scenario.pointName,
      );
      expect(
        await editorState(editor),
        JSON.stringify({
          attempt,
          candidate,
          scenario,
          stage: 'after-click',
        }),
      ).toEqual({
        anchor: expectedCaret,
        head: expectedCaret,
        selectedText: '',
        source: inlineSource,
      });
      expect(await domSelection(page)).toEqual({ collapsed: true, text: '' });
    }
  }
});

test('system double clicks select only the intended inline-code word', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  await replaceSource(editor, page, inlineSource);
  const owners = page.locator('.lm-md-inline-code');
  await expect(owners).toHaveCount(2);

  const alphaStart = inlineSource.indexOf('alphaBeta');
  const gammaStart = inlineSource.indexOf('gamma_delta');
  const sameLineCaret = inlineSource.indexOf('前缀文本') + 1;
  const pointNames: readonly InlinePointName[] = [
    'leftPadding',
    'left',
    'middle',
    'right',
    'rightPadding',
  ];

  for (const [text, initialCarets] of [
    ['alphaBeta', [1, sameLineCaret, gammaStart + 2]],
    ['gamma_delta', [1, sameLineCaret, alphaStart + 2]],
  ] as const) {
    for (const [pointIndex, pointName] of pointNames.entries()) {
      await moveSelection(
        editor,
        initialCarets[pointIndex % initialCarets.length],
      );
      await afterLayout(page);
      const point = (await inlinePoints(
        inlineOwner(page, text),
        text,
      ))[pointName];

      await page.mouse.dblclick(point.x, point.y, { delay: 20 });
      await afterLayout(page);

      const state = await editorState(editor);
      expect(state.selectedText).toBe(text);
      expect(Math.min(state.anchor, state.head)).toBe(
        inlineSource.indexOf(text),
      );
      expect(Math.max(state.anchor, state.head)).toBe(
        inlineSource.indexOf(text) + text.length,
      );
      expect(state.source).toBe(inlineSource);
      expect(await domSelection(page)).toEqual({
        collapsed: false,
        text,
      });
    }
  }

  await moveSelection(editor, 1);
  await afterLayout(page);
  const jitterPoint = (await inlinePoints(
    inlineOwner(page, 'alphaBeta'),
    'alphaBeta',
  )).middle;
  await systemDoubleClickWithJitter(page, jitterPoint, 4);
  await afterLayout(page);
  expect(await editorState(editor)).toEqual({
    anchor: alphaStart,
    head: alphaStart + 'alphaBeta'.length,
    selectedText: 'alphaBeta',
    source: inlineSource,
  });
});

test('pointer selection keeps an opened document clean and outside undo history', async ({
  page,
}) => {
  const editor = await openCleanDocument(page);
  await installRootEditorHistoryTestBridge(editor);
  await moveSelection(editor, 1);
  await afterLayout(page);
  const beforeClickHistory = await readRootEditorHistoryDepth(editor);

  const alphaPoint = (await inlinePoints(
    inlineOwner(page, 'alphaBeta'),
    'alphaBeta',
  )).middle;
  await page.mouse.click(alphaPoint.x, alphaPoint.y);
  await afterLayout(page);
  expect((await editorState(editor)).source).toBe(inlineSource);
  expect(await readRootEditorHistoryDepth(editor)).toEqual(beforeClickHistory);

  await moveSelection(editor, inlineSource.indexOf('前缀文本') + 1);
  await afterLayout(page);
  const beforeDoubleClickHistory = await readRootEditorHistoryDepth(editor);
  const gammaPoint = (await inlinePoints(
    inlineOwner(page, 'gamma_delta'),
    'gamma_delta',
  )).middle;
  await page.mouse.dblclick(gammaPoint.x, gammaPoint.y, { delay: 20 });
  await afterLayout(page);
  expect(await editorState(editor)).toEqual({
    anchor: inlineSource.indexOf('gamma_delta'),
    head: inlineSource.indexOf('gamma_delta') + 'gamma_delta'.length,
    selectedText: 'gamma_delta',
    source: inlineSource,
  });
  expect(await readRootEditorHistoryDepth(editor)).toEqual(
    beforeDoubleClickHistory,
  );

  await expect(page.locator('.lm-editor-title')).toHaveText(
    'issue-14-inline-code.md',
  );
  expect(
    await page.evaluate(() => window.__LUMAMARK_E2E_STATE__?.lastWrite),
  ).toBeNull();
  await page.keyboard.press(`${primaryModifier}+Z`);
  expect((await editorState(editor)).source).toBe(inlineSource);
  await expect(page.locator('.lm-editor-title')).toHaveText(
    'issue-14-inline-code.md',
  );

  await switchEditorMode(page, 'source');
  expect((await editorState(editor)).source).toBe(inlineSource);
  await expect(editor).toContainText('`alphaBeta`');
  await expect(editor).toContainText('`gamma_delta`');
  await switchEditorMode(page, 'livePreview');
  expect((await editorState(editor)).source).toBe(inlineSource);
  await expect(page.locator('.lm-md-inline-code')).toHaveCount(2);
});

test('multi-backtick inline code keeps padding hits outside its delimiters', async ({
  page,
}) => {
  const editor = await openNewDocument(page);
  const source = '前缀 ``alpha`Beta`` 后缀';
  const content = 'alpha`Beta';
  const contentFrom = source.indexOf(content);
  await replaceSource(editor, page, source);
  await moveSelection(editor, 1);
  await afterLayout(page);

  const ownerFrom = contentFrom - 2;
  const ownerTo = contentFrom + content.length + 2;
  const owner = page.locator(
    `.lm-md-inline-code[data-lm-inline-owner-from="${ownerFrom}"]` +
      `[data-lm-inline-owner-to="${ownerTo}"]`,
  );
  const points = await inlinePoints(owner, content);

  for (const [pointName, position] of [
    ['leftPadding', contentFrom],
    ['rightPadding', contentFrom + content.length],
  ] as const) {
    await moveSelection(editor, 1);
    await afterLayout(page);
    const point = points[pointName];
    await page.mouse.click(point.x, point.y);
    await afterLayout(page);
    expect(await editorState(editor)).toEqual({
      anchor: position,
      head: position,
      selectedText: '',
      source,
    });
  }

  for (const [pointName, text] of [
    ['leftPadding', 'alpha'],
    ['rightPadding', 'Beta'],
  ] as const) {
    await moveSelection(editor, 1);
    await afterLayout(page);
    const point = points[pointName];
    await page.mouse.dblclick(point.x, point.y, { delay: 20 });
    await afterLayout(page);
    expect((await editorState(editor)).selectedText).toBe(text);
    expect(await domSelection(page)).toEqual({ collapsed: false, text });
  }
});
