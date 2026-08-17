import { expect, test, type Page } from '@playwright/test';
import { openBlankDocument } from './support/openBlankDocument';
import {
  installRootEditorViewTestBridge,
  type RootEditorContentTestBridge,
  type RootEditorViewTestBridge,
} from './support/rootEditorViewTestBridge';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const redoShortcut =
  process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';

type BrowserDiagnostics = {
  assertClean(): void;
};

function monitorBrowser(page: Page): BrowserDiagnostics {
  const diagnostics: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      if (message.text().includes('Outdated Optimize Dep')) {
        return;
      }
      diagnostics.push(`[console.${message.type()}] ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    diagnostics.push(`[pageerror] ${error.message}`);
  });

  return {
    assertClean() {
      expect(diagnostics, diagnostics.join('\n')).toEqual([]);
    },
  };
}

async function openNewDocument(page: Page) {
  await page.goto('/');
  await openBlankDocument(page);

  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible();
  await installRootEditorViewTestBridge(editor);
  return editor;
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.evaluate((content, value) => {
    const view = (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: value.length },
    });
    view.focus();
  }, source);
}

async function readEditorState(page: Page): Promise<{
  anchor: number;
  head: number;
  source: string;
}> {
  return page.locator('.cm-content').first().evaluate((content) => {
    const view = (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest();
    return {
      anchor: view.state.selection.main.anchor,
      head: view.state.selection.main.head,
      source: view.state.doc.toString(),
    };
  });
}

async function moveCaret(page: Page, position: number): Promise<void> {
  await page.locator('.cm-content').first().evaluate((content, offset) => {
    const view = (content as RootEditorContentTestBridge)
      .resolveRootEditorViewForTest();
    view.dispatch({ selection: { anchor: offset } });
    view.focus();
  }, position);
}

async function moveSelection(
  page: Page,
  anchor: number,
  head: number,
): Promise<void> {
  await page.locator('.cm-content').first().evaluate(
    (content, selection) => {
      const view = (content as RootEditorContentTestBridge)
        .resolveRootEditorViewForTest();
      view.dispatch({ scrollIntoView: true, selection });
      view.focus();
    },
    { anchor, head },
  );
}

async function chooseTheme(
  page: Page,
  theme: 'dark' | 'light',
): Promise<void> {
  await openTopMenu(page, /^(?:Theme|主题)$/);
  await page
    .getByRole('menuitemradio', {
      name:
        theme === 'dark'
          ? /^(?:Dark|暗色)$/
          : /^(?:Light|亮色)$/,
    })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
}

async function runFileMenuAction(
  page: Page,
  action: 'open' | 'saveAs',
): Promise<void> {
  await openTopMenu(page, /^(?:File|文件)$/);
  await page
    .getByRole('menuitem', {
      name:
        action === 'open'
          ? /^(?:Open File|打开文件)/
          : /^(?:Save As|另存为)/,
    })
    .click();
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
}

async function openTopMenu(page: Page, name: RegExp): Promise<void> {
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
  const trigger = page.locator('.lm-menu-trigger').filter({ hasText: name });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(trigger).toHaveAttribute('data-state', 'open');
}

test('renders inactive math and maps formula clicks back to exact live-preview source', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  const editor = await openNewDocument(page);
  const source = [
    'before $x^2 + 1$ after',
    '',
    '$$',
    '\\int_0^1 x^2\\,dx',
    '$$',
    '',
    'tail',
  ].join('\n');
  await replaceEditorSource(page, source);

  await expect(page.locator('[role="math"]')).toHaveCount(2, { timeout: 20_000 });
  const inlineMath = page.getByRole('math', { name: 'x^2 + 1' });
  const blockMath = page.getByRole('math', { name: '\\int_0^1 x^2\\,dx' });
  await expect(inlineMath).toBeVisible();
  await expect(inlineMath).toHaveClass(/lm-math-inline-render/);
  await expect(blockMath).toBeVisible();
  await expect(blockMath).toHaveClass(/lm-math-block-render/);
  expect(await readEditorState(page)).toMatchObject({ source });

  const inlineFrom = source.indexOf('$x^2 + 1$');
  await inlineMath.click();
  await expect(inlineMath).toHaveCount(0);
  await expect(editor).toContainText('$x^2 + 1$');
  const inlineSelection = await readEditorState(page);
  expect(inlineSelection.head).toBeGreaterThan(inlineFrom);
  expect(inlineSelection.head).toBeLessThan(inlineFrom + '$x^2 + 1$'.length);

  await moveCaret(page, source.length);
  await expect(inlineMath).toBeVisible();

  const blockFrom = source.indexOf('$$');
  await blockMath.click();
  await expect(editor).toContainText('\\int_0^1 x^2\\,dx');
  await expect(blockMath).toBeVisible();
  const blockSelection = await readEditorState(page);
  expect(blockSelection.head).toBeGreaterThan(blockFrom);
  expect(blockSelection.head).toBeLessThan(source.indexOf('$$', blockFrom + 2) + 2);
  await expect(
    editor.evaluate((content) => {
      const sourceLine = [...content.querySelectorAll('.cm-line')]
        .find((line) => line.textContent?.includes('\\int_0^1'));
      const preview = content.querySelector('.lm-math-block-render');
      return Boolean(
        sourceLine &&
        preview &&
        sourceLine.compareDocumentPosition(preview) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).resolves.toBe(true);
  expect(await readEditorState(page)).toMatchObject({ source });
  diagnostics.assertClean();
});

test('keeps source mode raw, reading mode rendered and every mode switch byte-faithful', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  await openNewDocument(page);

  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-source-mode')).toBeVisible();
  const source = [
    'inline $a+b$ source',
    '',
    '$$',
    '\\sum_{n=1}^{10} n',
    '$$',
  ].join('\n');
  await replaceEditorSource(page, source);
  await expect(page.locator('[role="math"]')).toHaveCount(0);
  expect(await readEditorState(page)).toMatchObject({ source });

  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-reading-mode')).toBeVisible();
  await expect(page.locator('[role="math"]')).toHaveCount(2);
  await expect(page.getByTestId('status-readonly')).toBeVisible();
  await page.locator('.lm-math-inline-render').click();
  await expect(page.locator('[role="math"]')).toHaveCount(2);
  await page.keyboard.type('must-not-change');
  expect(await readEditorState(page)).toMatchObject({ source });

  await moveCaret(page, source.length);
  await page.keyboard.press(`${primaryModifier}+/`);
  await expect(page.locator('.lm-editor-live-preview-mode')).toBeVisible();
  await expect(page.locator('[role="math"]')).toHaveCount(2);
  expect(await readEditorState(page)).toMatchObject({ source });
  diagnostics.assertClean();
});

test('renders document-order macros, explicit labels, forward references and mhchem', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  await openNewDocument(page);
  const source = [
    'Forward $\\eqref{eq:later}$.',
    '',
    '$$',
    '\\newcommand{\\vect}[1]{\\mathbf{#1}}\\vect{x}',
    '$$',
    '',
    'Later $\\vect{v}=\\vect{u}+\\vect{w}$ and $\\ce{H2O + CO2 -> H2CO3}$.',
    '',
    '$$',
    '\\tag{1}\\label{eq:later}E=mc^2',
    '$$',
  ].join('\n');
  await replaceEditorSource(page, source);

  await expect(page.locator('[role="math"]')).toHaveCount(5);
  await expect(page.locator('.lm-math-render-error')).toHaveCount(0);
  await expect(
    page.getByRole('math', { name: '\\vect{v}=\\vect{u}+\\vect{w}' }),
  ).toBeVisible();
  await expect(
    page.getByRole('math', { name: '\\ce{H2O + CO2 -> H2CO3}' }),
  ).toBeVisible();
  const reference = page.getByRole('math', { name: '\\eqref{eq:later}' });
  await expect(reference).toBeVisible();
  await expect(reference.locator('a[href^="#"]')).toBeVisible();
  expect(await readEditorState(page)).toMatchObject({ source });
  diagnostics.assertClean();
});

test('shows first-render errors, keeps the last successful preview and recovers automatically', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  const editor = await openNewDocument(page);

  await replaceEditorSource(page, 'first $\\notDefined$ tail');
  await expect(page.locator('.lm-math-source-error')).toBeVisible();
  await expect(editor).toContainText('$\\notDefined$');
  await expect(page.locator('[role="math"]')).toHaveCount(0);

  await replaceEditorSource(page, 'first $x$ tail');
  await expect(page.locator('.lm-math-render-error')).toHaveCount(0);
  await expect(page.getByRole('math', { name: 'x' })).toBeVisible();

  await replaceEditorSource(page, 'first $\\notDefined$ tail');
  await expect(page.locator('.lm-math-render-error')).toBeVisible();
  await expect(page.locator('[role="math"]')).toHaveCount(1);
  await expect(editor).not.toContainText('$\\notDefined$');

  await replaceEditorSource(page, 'first $y$ tail');
  await expect(page.locator('.lm-math-render-error')).toHaveCount(0);
  await expect(page.getByRole('math', { name: 'y' })).toBeVisible();
  expect(await readEditorState(page)).toMatchObject({ source: 'first $y$ tail' });
  diagnostics.assertClean();
});

test('keeps only the formula intersecting an IME composition raw until composition ends', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  const editor = await openNewDocument(page);
  const source = 'first $a+b$ between $c+d$ tail';
  await replaceEditorSource(page, source);

  const firstMath = page.getByRole('math', { name: 'a+b' });
  const secondMath = page.getByRole('math', { name: 'c+d' });
  await expect(firstMath).toBeVisible();
  await expect(secondMath).toBeVisible();

  await moveCaret(page, source.indexOf('a+b') + 1);
  await editor.dispatchEvent('compositionstart', { data: '' });
  await moveCaret(page, source.length);

  await expect(firstMath).toHaveCount(0);
  await expect(editor).toContainText('$a+b$');
  await expect(secondMath).toBeVisible();
  expect(await readEditorState(page)).toMatchObject({ source });

  await editor.dispatchEvent('compositionend', { data: '' });
  await expect(firstMath).toBeVisible();
  await expect(secondMath).toBeVisible();
  expect(await readEditorState(page)).toMatchObject({ source });
  diagnostics.assertClean();
});

test('commits a real CDP IME composition inside math without splitting undo history', async ({
  context,
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  await openNewDocument(page);
  const source = 'before $x$ after';
  const composedSource = 'before $x中$ after';
  await replaceEditorSource(page, source);
  await expect(page.getByRole('math', { name: 'x' })).toBeVisible();

  await moveCaret(page, source.indexOf('x') + 1);
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Input.imeSetComposition', {
      selectionEnd: 1,
      selectionStart: 1,
      text: '中',
    });
    await expect
      .poll(async () => (await readEditorState(page)).source)
      .toBe(composedSource);
    await expect(page.getByRole('math', { name: 'x中' })).toHaveCount(0);

    await cdp.send('Input.insertText', { text: '中' });
  } finally {
    await cdp.detach();
  }

  await expect
    .poll(async () => (await readEditorState(page)).source)
    .toBe(composedSource);
  await moveCaret(page, composedSource.length);
  await expect(page.getByRole('math', { name: 'x中' })).toBeVisible();

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect
    .poll(async () => (await readEditorState(page)).source)
    .toBe(source);
  diagnostics.assertClean();
});

test('keeps math source edits in the main undo and redo history', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  await openNewDocument(page);
  const source = 'start $x$ end';
  const editedSource = 'start $x+1$ end';
  await replaceEditorSource(page, source);
  await expect(page.getByRole('math', { name: 'x' })).toBeVisible();

  await moveCaret(page, source.indexOf('x') + 1);
  await page.keyboard.insertText('+1');
  await expect
    .poll(async () => (await readEditorState(page)).source)
    .toBe(editedSource);
  await moveCaret(page, editedSource.length);
  await expect(page.getByRole('math', { name: 'x+1' })).toBeVisible();

  await page.keyboard.press(`${primaryModifier}+Z`);
  await expect
    .poll(async () => (await readEditorState(page)).source)
    .toBe(source);
  await moveCaret(page, source.length);
  await expect(page.getByRole('math', { name: 'x' })).toBeVisible();

  await page.keyboard.press(redoShortcut);
  await expect
    .poll(async () => (await readEditorState(page)).source)
    .toBe(editedSource);
  await moveCaret(page, editedSource.length);
  await expect(page.getByRole('math', { name: 'x+1' })).toBeVisible();
  diagnostics.assertClean();
});

test('copies an exact math source selection and pastes it without source loss', async ({
  context,
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openNewDocument(page);
  const source = 'before $x+y$ after ';
  const selectedSource = '$x+y$';
  const selectedFrom = source.indexOf(selectedSource);
  await replaceEditorSource(page, source);
  await expect(page.getByRole('math', { name: 'x+y' })).toBeVisible();

  await moveSelection(
    page,
    selectedFrom,
    selectedFrom + selectedSource.length,
  );
  expect(await readEditorState(page)).toMatchObject({
    anchor: selectedFrom,
    head: selectedFrom + selectedSource.length,
    source,
  });
  await page.keyboard.press(`${primaryModifier}+C`);
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(selectedSource);

  await moveCaret(page, source.length);
  await page.keyboard.press(`${primaryModifier}+V`);
  const pastedSource = `${source}${selectedSource}`;
  await expect
    .poll(async () => (await readEditorState(page)).source)
    .toBe(pastedSource);
  await expect(page.getByRole('math', { name: 'x+y' })).toHaveCount(2);
  diagnostics.assertClean();
});

test('keeps CHTML rendered and source faithful in light and dark themes', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  await openNewDocument(page);
  const source = [
    'inline $x^2$ theme',
    '',
    '$$',
    '\\frac{a}{b}',
    '$$',
  ].join('\n');
  await replaceEditorSource(page, source);

  const inlineMath = page.getByRole('math', { name: 'x^2' });
  const blockMath = page.getByRole('math', { name: '\\frac{a}{b}' });
  await chooseTheme(page, 'light');
  await expect(inlineMath).toBeVisible();
  await expect(blockMath).toBeVisible();
  await expect(inlineMath.locator('mjx-container')).toBeVisible();
  await expect(blockMath.locator('mjx-container')).toBeVisible();

  await chooseTheme(page, 'dark');
  await expect(inlineMath).toBeVisible();
  await expect(blockMath).toBeVisible();
  await expect(inlineMath.locator('mjx-container')).toBeVisible();
  await expect(blockMath.locator('mjx-container')).toBeVisible();
  expect(await readEditorState(page)).toMatchObject({ source });
  diagnostics.assertClean();
});

test('refreshes the CodeMirror height map after a tall block formula and viewport resize', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  await page.setViewportSize({ height: 720, width: 680 });
  const editor = await openNewDocument(page);
  const marker = 'after resize marker';
  const source = [
    'before',
    '',
    '$$',
    '\\begin{aligned}',
    '\\frac{1}{\\frac{2}{\\frac{3}{4}}} &= x \\\\',
    '\\sum_{n=1}^{20} \\frac{n^2}{n+1} &= y \\\\',
    '\\int_0^1 \\frac{1}{1+t^2}\\,dt &= z',
    '\\end{aligned}',
    '$$',
    '',
    marker,
  ].join('\n');
  await replaceEditorSource(page, source);

  const blockMath = page.locator('.lm-math-block-render');
  await expect(blockMath).toBeVisible({ timeout: 20_000 });
  await expect(blockMath.locator('mjx-container')).toBeVisible();

  const readHeightMapProbe = () =>
    editor.evaluate((content, text) => {
      type GeometryView = RootEditorViewTestBridge & {
        contentDOM: HTMLElement;
        lineBlockAt(position: number): { top: number };
        posAtCoords(coordinates: { x: number; y: number }): number | null;
        state: RootEditorViewTestBridge['state'] & {
          doc: RootEditorViewTestBridge['state']['doc'] & {
            lineAt(position: number): { from: number };
          };
        };
        viewState: { paddingTop: number };
      };
      const view = (content as RootEditorContentTestBridge)
        .resolveRootEditorViewForTest() as GeometryView;
      const sourceText = view.state.doc.toString();
      const position = sourceText.indexOf(text);
      const line = [...content.querySelectorAll<HTMLElement>('.cm-line')]
        .find((candidate) => candidate.textContent?.includes(text));
      if (!line || position < 0) {
        throw new Error('Expected the post-math line to be measurable.');
      }
      const sourceLine = view.state.doc.lineAt(position);
      const lineBlock = view.lineBlockAt(sourceLine.from);
      const contentBounds = view.contentDOM.getBoundingClientRect();
      const documentTop = contentBounds.top + view.viewState.paddingTop;
      const lineBounds = line.getBoundingClientRect();
      const resolvedPosition = view.posAtCoords({
        x: lineBounds.left + 1,
        y: lineBounds.top + lineBounds.height / 2,
      });

      return {
        drift: lineBounds.top - documentTop - lineBlock.top,
        expectedPosition: sourceLine.from,
        resolvedPosition,
      };
    }, marker);

  const expectHeightMapAligned = async () => {
    await expect
      .poll(async () => {
        const probe = await readHeightMapProbe();
        return Math.abs(probe.drift) <= 0.75 &&
          probe.resolvedPosition === probe.expectedPosition
          ? 'aligned'
          : JSON.stringify(probe);
      })
      .toBe('aligned');
  };

  await expectHeightMapAligned();
  const compactHeight = await blockMath.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(compactHeight).toBeGreaterThan(48);

  await page.setViewportSize({ height: 800, width: 1280 });
  await expect(blockMath).toBeVisible();
  await expectHeightMapAligned();

  const markerLine = page.locator('.cm-line', { hasText: marker });
  await markerLine.click({ position: { x: 8, y: 8 } });
  const selection = await readEditorState(page);
  const markerFrom = source.indexOf(marker);
  expect(selection.head).toBeGreaterThanOrEqual(markerFrom);
  expect(selection.head).toBeLessThanOrEqual(markerFrom + marker.length);
  expect(selection.source).toBe(source);
  diagnostics.assertClean();
});

test('saves, reloads and reopens a math document with byte-exact source and fresh rendering', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  const documentPath = 'E:/lumamark-fixtures/math-round-trip.md';
  const storageKey = `lumamark-math-round-trip-${Date.now()}`;
  const source = [
    '中文  inline $a+b$  tail\t',
    '',
    '$$',
    '\\newcommand{\\squareit}[1]{#1^2}',
    '$$',
    '',
    'after $\\squareit{x}$  ',
    '',
  ].join('\n');
  await page.addInitScript(
    ({ path, key }) => {
      const persistedFiles = JSON.parse(
        localStorage.getItem(key) ?? '{}',
      ) as Record<string, string>;
      const files = { ...persistedFiles };
      const byteLength = (text: string) =>
        new TextEncoder().encode(text).length;
      const persist = () => {
        localStorage.setItem(key, JSON.stringify(files));
      };

      window.__LUMAMARK_E2E_STATE__ = { files, lastWrite: null };
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async (requestedPath) => {
          const text = files[requestedPath] ?? '';
          return {
            ok: true,
            data: { byteLength: byteLength(text), path: requestedPath, text },
          };
        },
        showOpenDialog: async () => ({ ok: true, data: path }),
        showSaveDialog: async () => ({ ok: true, data: path }),
        writeText: async (requestedPath, text) => {
          files[requestedPath] = text;
          persist();
          window.__LUMAMARK_E2E_STATE__ = {
            files,
            lastWrite: { path: requestedPath, text },
          };
          return {
            ok: true,
            data: { byteLength: byteLength(text), path: requestedPath },
          };
        },
      };
    },
    { key: storageKey, path: documentPath },
  );

  await openNewDocument(page);
  await replaceEditorSource(page, source);
  await expect(page.getByRole('math', { name: 'a+b' })).toBeVisible();
  await expect(
    page.getByRole('math', { name: '\\squareit{x}' }),
  ).toBeVisible();

  await runFileMenuAction(page, 'saveAs');
  await expect(page.getByRole('status')).toHaveText(/^(?:Saved|已保存)$/);
  const savedBytes = await page.evaluate((path) => {
    const text = window.__LUMAMARK_E2E_STATE__?.files[path] ?? '';
    return [...new TextEncoder().encode(text)];
  }, documentPath);
  expect(savedBytes).toEqual([...new TextEncoder().encode(source)]);

  await page.reload();
  const startButton = page.getByRole('button', {
    name: /^(?:New Document|新建文档)$/,
  });
  const reloadedEditor = page.locator('.cm-content').first();
  await expect
    .poll(async () =>
      (await startButton.isVisible()) || (await reloadedEditor.isVisible()),
    )
    .toBe(true);
  if (await startButton.isVisible()) {
    await startButton.click();
  } else {
    await page.keyboard.press(`${primaryModifier}+N`);
  }
  await expect(reloadedEditor).toBeVisible();
  await expect(reloadedEditor).toHaveText('');
  await expect(page.locator('[role="math"]')).toHaveCount(0);

  await runFileMenuAction(page, 'open');
  await expect(page.getByRole('status')).toHaveText(/^(?:Opened|已打开)$/);
  const reopenedEditor = page.locator('.cm-content').first();
  await expect(reopenedEditor).toBeVisible();
  await installRootEditorViewTestBridge(reopenedEditor);
  await expect(page.getByRole('math', { name: 'a+b' })).toBeVisible();
  await expect(
    page.getByRole('math', { name: '\\squareit{x}' }),
  ).toBeVisible();
  await expect
    .poll(async () => (await readEditorState(page)).source)
    .toBe(source);
  const reopenedBytes = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.cm-content');
    if (
      !content ||
      !('resolveRootEditorViewForTest' in content) ||
      typeof content.resolveRootEditorViewForTest !== 'function'
    ) {
      throw new Error('Expected the root editor test bridge after reopening.');
    }
    const text = (
      content as RootEditorContentTestBridge
    ).resolveRootEditorViewForTest().state.doc.toString();
    return [...new TextEncoder().encode(text)];
  });
  expect(reopenedBytes).toEqual([...new TextEncoder().encode(source)]);
  diagnostics.assertClean();
});

test('scopes document macros to formulas after their definition', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  const editor = await openNewDocument(page);
  const source = [
    'before $\\future{x}$.',
    '',
    '$$',
    '\\newcommand{\\future}[1]{\\mathbf{#1}}',
    '$$',
    '',
    'after $\\future{y}$.',
  ].join('\n');
  await replaceEditorSource(page, source);

  await expect(
    page.getByRole('math', { name: '\\future{x}' }),
  ).toHaveCount(0);
  await expect(editor).toContainText('$\\future{x}$');
  await expect(page.locator('.lm-math-source-error')).toContainText(
    /(?:Undefined control sequence|未定义)/,
  );
  await expect(
    page.getByRole('math', { name: '\\future{y}' }),
  ).toBeVisible();
  expect(await readEditorState(page)).toMatchObject({ source });
  diagnostics.assertClean();
});

test('keeps mhchem available while Physics remains disabled by default', async ({
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  const editor = await openNewDocument(page);
  const source = 'chemistry $\\ce{H2O}$ and physics $\\qty{x}$';
  await replaceEditorSource(page, source);

  await expect(
    page.getByRole('math', { name: '\\ce{H2O}' }),
  ).toBeVisible();
  await expect(
    page.getByRole('math', { name: '\\qty{x}' }),
  ).toHaveCount(0);
  await expect(editor).toContainText('$\\qty{x}$');
  await expect(page.locator('.lm-math-source-error')).toContainText(
    /(?:Undefined control sequence|未定义)/,
  );
  expect(await readEditorState(page)).toMatchObject({ source });
  diagnostics.assertClean();
});

test('keeps rare glyph and mhchem rendering available offline with same-origin assets', async ({
  context,
  page,
}) => {
  const diagnostics = monitorBrowser(page);
  const requests: string[] = [];
  const failedRequests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('requestfailed', (request) => failedRequests.push(request.url()));
  let dynamicModulesChunkLoaded = false;
  page.on('requestfinished', (request) => {
    if (/newcmDynamicModules/u.test(request.url())) {
      dynamicModulesChunkLoaded = true;
    }
  });
  await openNewDocument(page);

  await replaceEditorSource(page, 'rare $\\text{é}$ and chemistry $\\ce{H2O}$');
  await expect(page.locator('[role="math"]')).toHaveCount(2);
  await expect(page.locator('html')).toHaveAttribute(
    'data-lm-math-fonts-preloaded',
    'ready',
    { timeout: 30_000 },
  );
  await expect
    .poll(() => dynamicModulesChunkLoaded, { timeout: 30_000 })
    .toBe(true);
  const workerAndFontRequests = requests.filter((url) =>
    /(?:mathDocumentWorker|\.woff2(?:$|\?))/.test(url),
  );
  expect(workerAndFontRequests.length).toBeGreaterThan(0);
  const appOrigin = new URL(page.url()).origin;
  expect(
    workerAndFontRequests.every((url) => new URL(url).origin === appOrigin),
  ).toBe(true);

  const requestsBeforeOfflineEdit = requests.length;
  await context.setOffline(true);
  try {
    await replaceEditorSource(
      page,
      'offline rare $\\text{éé}$ and chemistry $\\ce{CO2}$',
    );
    await expect(
      page.getByRole('math', { name: '\\text{éé}' }),
    ).toBeVisible();
    await expect(
      page.getByRole('math', { name: '\\ce{CO2}' }),
    ).toBeVisible();
    await expect(page.locator('.lm-math-render-error')).toHaveCount(0);
  } finally {
    await context.setOffline(false);
  }

  expect(failedRequests).toEqual([]);
  expect(requests.slice(requestsBeforeOfflineEdit)).toEqual([]);
  diagnostics.assertClean();
});
