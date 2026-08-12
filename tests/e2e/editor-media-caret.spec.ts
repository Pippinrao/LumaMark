import { expect, test, type Page } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="#4488cc"/></svg>`;
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const responsiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="640"><rect width="1600" height="640" fill="#7a5cc7"/></svg>`;
const responsiveDataUrl = `data:image/svg+xml;base64,${Buffer.from(responsiveSvg).toString('base64')}`;
const brokenDataUrl = 'data:image/png;base64,AAAA';

async function openNewDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /^(?:New Document|新建文档)$/ })
    .click();
}

async function replaceEditorSource(page: Page, source: string): Promise<void> {
  const editor = page.locator('.cm-content').first();
  await editor.click();
  await page.keyboard.press(`${primaryModifier}+A`);
  await page.keyboard.insertText(source);
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

  await page.getByRole('menuitem', { name: /View|视图/ }).click();
  await page
    .getByRole('menuitemradio', {
      name: mode === 'source'
        ? /Source Mode|源码模式/
        : /Live Preview|实时预览/,
    })
    .click();
  await expect(page.locator(rootClass)).toBeVisible();
}

async function moveEditorToDocumentStart(page: Page): Promise<void> {
  await page.locator('.cm-content').first().evaluate((content) => {
    type ViewBridge = {
      dispatch(spec: {
        scrollIntoView: boolean;
        selection: { anchor: number };
      }): void;
      scrollDOM: HTMLElement;
    };
    const tile = (
      content as HTMLElement & {
        cmTile: { root?: { view: ViewBridge }; view: ViewBridge };
      }
    ).cmTile;
    const view = tile.root?.view ?? tile.view;
    view.dispatch({
      scrollIntoView: true,
      selection: { anchor: 0 },
    });
    view.scrollDOM.scrollTop = 0;
  });
}

function tallMermaidBody(prefix: string, edges: number): string[] {
  return [
    'flowchart TD',
    ...Array.from(
      { length: edges },
      (_, index) => `  ${prefix}${index} --> ${prefix}${index + 1}`,
    ),
  ];
}

type LineProbe = {
  drift: number;
  expectedPosition: number;
  name: string;
  ok: boolean;
  position: number | null;
  resolved: string | null;
};

async function waitForMediaWidgets(page: Page): Promise<void> {
  await expect(page.locator('.lm-image-preview img')).toBeVisible();
  await expect(page.locator('.lm-mermaid-preview')).toHaveAttribute(
    'data-status',
    'success',
  );
}

async function probeNamedLines(page: Page, names: string[]): Promise<{
  contentInnerHeight: number;
  docHeight: number;
  rows: LineProbe[];
}> {
  return page.evaluate((lineNames) => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    if (!(content instanceof HTMLElement)) {
      throw new Error('Expected live-preview content');
    }

    type ViewBridge = {
      contentDOM: HTMLElement;
      lineBlockAt(pos: number): { top: number };
      posAtCoords(coords: { x: number; y: number }): number | null;
      state: {
        doc: {
          indexOf(text: string): number;
          lineAt(pos: number): { from: number; text: string };
          toString(): string;
        };
      };
      viewState: {
        docHeight: number;
        paddingBottom: number;
        paddingTop: number;
      };
    };

    const tile = (
      content as HTMLElement & {
        cmTile: { root?: { view: ViewBridge }; view: ViewBridge };
      }
    ).cmTile;
    const view = tile.root?.view ?? tile.view;
    const contentRect = view.contentDOM.getBoundingClientRect();
    const docTop = contentRect.top + view.viewState.paddingTop;
    const text = view.state.doc.toString();

    const rows = lineNames.map((name) => {
      const index = text.indexOf(name);
      if (index < 0) {
        throw new Error(`Missing probe line ${name}`);
      }

      const line = view.state.doc.lineAt(index);
      const block = view.lineBlockAt(line.from);
      const el = [
        ...document.querySelectorAll('.lm-editor-live-preview-mode .cm-line'),
      ].find((node) => node.textContent === name);

      if (!(el instanceof HTMLElement)) {
        throw new Error(`Missing DOM line ${name}`);
      }

      const rect = el.getBoundingClientRect();
      const pos = view.posAtCoords({
        x: rect.left + 1,
        y: rect.top + rect.height / 2,
      });

      return {
        drift: rect.top - docTop - block.top,
        expectedPosition: line.from,
        name,
        ok:
          Number.isFinite(rect.top - docTop - block.top) &&
          pos === line.from,
        position: pos,
        resolved:
          pos == null ? null : view.state.doc.lineAt(pos).text.slice(0, 24),
      };
    });

    return {
      contentInnerHeight:
        contentRect.height -
        view.viewState.paddingTop -
        view.viewState.paddingBottom,
      docHeight: view.viewState.docHeight,
      rows,
    };
  }, names);
}

async function editorSource(page: Page): Promise<string> {
  return page.locator('.cm-content').first().evaluate((content) => {
    type ViewBridge = {
      state: { doc: { toString(): string } };
    };
    const tile = (
      content as HTMLElement & {
        cmTile: { root?: { view: ViewBridge }; view: ViewBridge };
      }
    ).cmTile;
    return (tile.root?.view ?? tile.view).state.doc.toString();
  });
}

async function expectNamedLinesAligned(
  page: Page,
  names: string[],
): Promise<void> {
  await expect
    .poll(async () => {
      const probe = await probeNamedLines(page, names);
      return probe.rows.map((row) => {
        const aligned =
          Number.isFinite(row.drift) &&
          Math.abs(row.drift) <= 0.75 &&
          row.ok &&
          row.position === row.expectedPosition;
        return aligned ? `${row.name}:ok` : JSON.stringify(row);
      });
    })
    .toEqual(names.map((name) => `${name}:ok`));
}

async function insertMarkerAtLineStart(
  page: Page,
  name: string,
  marker: string,
): Promise<void> {
  const line = page.locator('.lm-editor-live-preview-mode .cm-line', {
    hasText: new RegExp(`^${name}$`),
  });
  await expect(line).toBeVisible();
  await expectNamedLinesAligned(page, [name]);
  const point = await line.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText(marker);
}

async function scrollUntilLineVisible(
  page: Page,
  name: string,
  direction: 'down' | 'up',
): Promise<void> {
  const scroller = page.locator('.cm-scroller').first();
  const line = page.locator('.lm-editor-live-preview-mode .cm-line', {
    hasText: new RegExp(`^${name}$`),
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const target = (await line.count()) > 0
      ? await line.evaluate((element) => {
          const scrollRoot = element.closest('.cm-scroller');
          if (!(scrollRoot instanceof HTMLElement)) {
            return { delta: 0, inside: false };
          }
          const lineRect = element.getBoundingClientRect();
          const scrollRect = scrollRoot.getBoundingClientRect();
          return {
            delta:
              lineRect.top -
              scrollRect.top -
              Math.max(0, (scrollRoot.clientHeight - lineRect.height) / 2),
            inside:
              lineRect.top >= scrollRect.top &&
              lineRect.bottom <= scrollRect.bottom,
          };
        })
      : null;
    if (target?.inside) {
      return;
    }
    await scroller.evaluate((element, delta) => {
      element.scrollTop += delta;
      element.dispatchEvent(new Event('scroll'));
    }, target?.delta ?? (direction === 'down' ? 520 : -520));
    await page.waitForTimeout(20);
  }

  throw new Error(`Could not scroll ${direction} to ${name}`);
}

async function waitForVisibleMediaToSettle(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const images = [
          ...document.querySelectorAll<HTMLImageElement>(
            '.lm-image-preview img',
          ),
        ];
        const mermaid = [
          ...document.querySelectorAll<HTMLElement>('.lm-mermaid-preview'),
        ];
        return (
          images.length + mermaid.length > 0 &&
          images.every((image) => image.complete && image.naturalWidth > 0) &&
          mermaid.every((root) => root.dataset.status === 'success')
        );
      }),
    )
    .toBe(true);
}

test('keeps click targets aligned after image and mermaid widgets settle', async ({
  page,
}) => {
  await openNewDocument(page);
  const initialSource = [
    'alpha line',
    '',
    `![pic](${dataUrl})`,
    '',
    'beta line',
    '',
    '```mermaid',
    'graph TD;',
    '  A-->B;',
    '  B-->C;',
    '```',
    '',
    'gamma line',
    '',
    'delta line',
  ].join('\n');
  await replaceEditorSource(page, initialSource);

  await waitForMediaWidgets(page);
  await expectNamedLinesAligned(page, [
    'alpha line',
    'beta line',
    'gamma line',
    'delta line',
  ]);

  const settled = await probeNamedLines(page, [
    'alpha line',
    'beta line',
    'gamma line',
    'delta line',
  ]);
  expect(Math.abs(settled.contentInnerHeight - settled.docHeight)).toBeLessThanOrEqual(
    2,
  );

  let expectedSource = initialSource;
  for (const [name, marker] of [
    ['alpha line', 'ALPHA'],
    ['beta line', 'BETA'],
    ['gamma line', 'GAMMA'],
    ['delta line', 'DELTA'],
  ] as const) {
    const line = page.locator('.lm-editor-live-preview-mode .cm-line', {
      hasText: new RegExp(`^${name}$`),
    });
    await line.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => {
        const probe = await probeNamedLines(page, [name]);
        const row = probe.rows[0];
        return (
          Number.isFinite(row.drift) &&
          Math.abs(row.drift) <= 0.75 &&
          row.ok &&
          row.position === row.expectedPosition
        );
      })
      .toBe(true);

    const point = await line.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.keyboard.insertText(marker);
    expectedSource = expectedSource.replace(name, `${marker}${name}`);
    expect(await editorSource(page)).toBe(expectedSource);
  }
});

test('refreshes the shared height map when nested media finishes loading later', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before async media',
      '',
      `![pic](${dataUrl})`,
      '',
      'between async media',
      '',
      '```mermaid',
      'graph TD;',
      '  A-->B;',
      '```',
      '',
      'after async media',
    ].join('\n'),
  );
  await waitForMediaWidgets(page);

  await expectNamedLinesAligned(page, [
    'before async media',
    'between async media',
    'after async media',
  ]);

  await page.route('**/geometry-probe.svg*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      body: svg,
      contentType: 'image/svg+xml',
      status: 200,
    });
  });

  await page.evaluate(async () => {
    const roots = [
      document.querySelector('.lm-image-preview'),
      document.querySelector('.lm-mermaid-preview'),
    ];
    if (roots.some((root) => !(root instanceof HTMLElement))) {
      throw new Error('Expected image and Mermaid widget roots');
    }

    await Promise.all(
      roots.map(
        (root, index) =>
          new Promise<void>((resolve, reject) => {
            const delayedMedia = document.createElement('img');
            delayedMedia.alt = '';
            delayedMedia.dataset.geometryProbe = String(index);
            delayedMedia.style.display = 'block';
            delayedMedia.addEventListener('load', () => resolve(), {
              once: true,
            });
            delayedMedia.addEventListener(
              'error',
              () => reject(new Error('Geometry probe image failed to load')),
              { once: true },
            );
            root?.appendChild(delayedMedia);
            window.setTimeout(() => {
              delayedMedia.src = `/geometry-probe.svg?widget=${index}`;
            }, 0);
          }),
      ),
    );
  });

  await expectNamedLinesAligned(page, [
    'before async media',
    'between async media',
    'after async media',
  ]);

  await scrollUntilLineVisible(page, 'after async media', 'down');
  await insertMarkerAtLineStart(page, 'after async media', 'ASYNC');
  expect(await editorSource(page)).toBe(
    [
      'before async media',
      '',
      `![pic](${dataUrl})`,
      '',
      'between async media',
      '',
      '```mermaid',
      'graph TD;',
      '  A-->B;',
      '```',
      '',
      'ASYNCafter async media',
    ].join('\n'),
  );
});

test('accounts for the real image error state before mapping the following text', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before broken image',
      '',
      `![broken](${brokenDataUrl})`,
      '',
      'after broken image',
    ].join('\n'),
  );
  await expect(page.locator('.lm-image-error')).toBeVisible();

  const errorPadding = await page.locator('.lm-image-preview').evaluate((root) => {
    const style = getComputedStyle(root);
    return { bottom: style.paddingBottom, top: style.paddingTop };
  });
  expect(errorPadding).toEqual({ bottom: '0px', top: '0px' });
  await expectNamedLinesAligned(page, [
    'before broken image',
    'after broken image',
  ]);
});

test('keeps exact insertion targets through image recovery and a taller Mermaid rerender', async ({
  page,
}) => {
  await openNewDocument(page);
  const failingSource = [
    'before lifecycle media',
    '',
    `![recovering image](${brokenDataUrl})`,
    '',
    'after lifecycle image',
    '',
    '```mermaid',
    'not-a-diagram',
    '```',
    '',
    'after lifecycle mermaid eof',
  ].join('\n');
  await replaceEditorSource(page, failingSource);
  await expect(page.locator('.lm-image-error')).toBeVisible();
  await expect(page.locator('.lm-mermaid-preview')).toHaveAttribute(
    'data-status',
    'error',
  );
  await expectNamedLinesAligned(page, [
    'before lifecycle media',
    'after lifecycle image',
    'after lifecycle mermaid eof',
  ]);
  const errorHeights = await page.evaluate(() => ({
    image:
      document.querySelector('.lm-image-preview')?.getBoundingClientRect()
        .height ?? 0,
    mermaid:
      document.querySelector('.lm-mermaid-preview')?.getBoundingClientRect()
        .height ?? 0,
  }));

  const recoveredSource = [
    'before lifecycle media',
    '',
    `![recovering image](${responsiveDataUrl})`,
    '',
    'after lifecycle image',
    '',
    '```mermaid',
    ...tallMermaidBody('R', 22),
    '```',
    '',
    'after lifecycle mermaid eof',
  ].join('\n');
  await replaceEditorSource(page, recoveredSource);
  await expect
    .poll(() =>
      page
        .locator('.lm-image-preview img')
        .evaluate((image: HTMLImageElement) => [
          image.complete,
          image.naturalWidth,
          image.naturalHeight,
        ]),
    )
    .toEqual([true, 1600, 640]);
  await expect(page.locator('.lm-mermaid-preview')).toHaveAttribute(
    'data-status',
    'success',
  );
  await expectNamedLinesAligned(page, [
    'before lifecycle media',
    'after lifecycle image',
  ]);
  const successHeights = await page.evaluate(() => ({
    image:
      document.querySelector('.lm-image-preview')?.getBoundingClientRect()
        .height ?? 0,
    mermaid:
      document.querySelector('.lm-mermaid-preview')?.getBoundingClientRect()
        .height ?? 0,
  }));
  expect(successHeights.image).toBeGreaterThan(errorHeights.image + 100);
  expect(successHeights.mermaid).toBeGreaterThan(errorHeights.mermaid + 100);
  await scrollUntilLineVisible(page, 'after lifecycle mermaid eof', 'down');
  await expectNamedLinesAligned(page, ['after lifecycle mermaid eof']);

  await page.setViewportSize({ height: 720, width: 640 });
  await scrollUntilLineVisible(page, 'after lifecycle mermaid eof', 'down');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, ['after lifecycle mermaid eof']);
  await scrollUntilLineVisible(page, 'before lifecycle media', 'up');
  await expectNamedLinesAligned(page, [
    'before lifecycle media',
    'after lifecycle image',
  ]);
  const narrowImageHeight = await page
    .locator('.lm-image-preview')
    .evaluate((root) => root.getBoundingClientRect().height);
  expect(Math.abs(narrowImageHeight - successHeights.image)).toBeGreaterThan(20);

  await page.setViewportSize({ height: 800, width: 1280 });
  await scrollUntilLineVisible(page, 'before lifecycle media', 'up');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, [
    'before lifecycle media',
    'after lifecycle image',
  ]);
  await scrollUntilLineVisible(page, 'after lifecycle mermaid eof', 'down');
  await expectNamedLinesAligned(page, ['after lifecycle mermaid eof']);

  let expectedSource = recoveredSource;
  for (const [name, marker] of [
    ['before lifecycle media', 'BEFORE_'],
    ['after lifecycle image', 'IMAGE_'],
    ['after lifecycle mermaid eof', 'EOF_'],
  ] as const) {
    await scrollUntilLineVisible(
      page,
      name,
      name === 'before lifecycle media' ? 'up' : 'down',
    );
    await insertMarkerAtLineStart(page, name, marker);
    expectedSource = expectedSource.replace(name, `${marker}${name}`);
    expect(await editorSource(page)).toBe(expectedSource);
  }
});

test('keeps geometry aligned while the same Mermaid block errors and rerenders taller', async ({
  page,
}) => {
  await openNewDocument(page);
  const sentinel = 'after live Mermaid rerender';
  const initialBody = ['flowchart TD', '  A --> B'].join('\n');
  const initialSource = [
    'before live Mermaid rerender',
    '',
    '```mermaid',
    initialBody,
    '```',
    '',
    sentinel,
  ].join('\n');
  await replaceEditorSource(page, initialSource);

  const preview = page.locator('.lm-mermaid-preview').first();
  await expect(preview).toHaveAttribute('data-status', 'success');
  const initialHeight = await preview.evaluate(
    (root) => root.getBoundingClientRect().height,
  );
  await preview.hover();
  await page
    .getByRole('button', { name: /编辑源码|Edit source/ })
    .first()
    .click();
  await page.keyboard.insertText('not-a-diagram');
  await expect(preview).toHaveAttribute('data-status', 'error');
  await expectNamedLinesAligned(page, [sentinel]);

  await page.evaluate(() => {
    const content = document.querySelector(
      '.lm-editor-live-preview-mode .cm-content',
    );
    const view = (
      content as unknown as {
        cmTile?: {
          root?: { view?: { dispatch(spec: unknown): void; focus(): void; state: { doc: { toString(): string } } } };
          view?: { dispatch(spec: unknown): void; focus(): void; state: { doc: { toString(): string } } };
        };
      } | null
    )?.cmTile;
    const editorView = view?.root?.view ?? view?.view;
    if (!editorView) {
      throw new Error('Unable to resolve live-preview EditorView');
    }
    const source = editorView.state.doc.toString();
    const contentFrom = source.indexOf('```mermaid\n') + '```mermaid\n'.length;
    const contentTo = source.indexOf('\n```', contentFrom);
    if (contentFrom < '```mermaid\n'.length || contentTo < contentFrom) {
      throw new Error('Unable to resolve active Mermaid source range');
    }
    editorView.dispatch({ selection: { anchor: contentFrom, head: contentTo } });
    editorView.focus();
  });

  const tallBody = tallMermaidBody('LIVE', 24).join('\n');
  await page.keyboard.insertText(tallBody);
  await expect(preview).toHaveAttribute('data-status', 'success');
  await waitForVisibleMediaToSettle(page);
  const tallHeight = await preview.evaluate(
    (root) => root.getBoundingClientRect().height,
  );
  expect(tallHeight).toBeGreaterThan(initialHeight + 100);
  await scrollUntilLineVisible(page, sentinel, 'down');
  await expectNamedLinesAligned(page, [sentinel]);

  const rerenderedSource = initialSource.replace(initialBody, tallBody);
  expect(await editorSource(page)).toBe(rerenderedSource);
  await insertMarkerAtLineStart(page, sentinel, 'LIVE_');
  expect(await editorSource(page)).toBe(
    rerenderedSource.replace(sentinel, `LIVE_${sentinel}`),
  );
});

test('keeps offscreen consecutive and mixed media aligned after scrolling and resize', async ({
  page,
}) => {
  await openNewDocument(page);
  await switchEditorMode(page, 'source');
  const filler = Array.from(
    { length: 180 },
    (_, index) => `filler ${String(index).padStart(3, '0')}`,
  );
  const source = [
    'document start',
    ...filler,
    'offscreen before media',
    `![wide one](${responsiveDataUrl})`,
    `![wide two](${responsiveDataUrl})`,
    'after consecutive images',
    '```mermaid',
    ...tallMermaidBody('A', 14),
    '```',
    `![wide three](${responsiveDataUrl})`,
    '```mermaid',
    ...tallMermaidBody('B', 18),
    '```',
    'after mixed widgets',
    'offscreen eof',
  ].join('\n');
  await replaceEditorSource(page, source);
  await moveEditorToDocumentStart(page);
  await switchEditorMode(page, 'livePreview');
  await moveEditorToDocumentStart(page);

  expect(await page.locator('.lm-image-preview, .lm-mermaid-preview').count()).toBe(
    0,
  );
  await scrollUntilLineVisible(page, 'offscreen before media', 'down');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, ['offscreen before media']);

  await scrollUntilLineVisible(page, 'after consecutive images', 'down');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, ['after consecutive images']);

  await scrollUntilLineVisible(page, 'after mixed widgets', 'down');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, [
    'after mixed widgets',
    'offscreen eof',
  ]);

  await page.setViewportSize({ height: 720, width: 680 });
  await scrollUntilLineVisible(page, 'after mixed widgets', 'down');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, [
    'after mixed widgets',
    'offscreen eof',
  ]);

  await page.setViewportSize({ height: 800, width: 1280 });
  await scrollUntilLineVisible(page, 'offscreen before media', 'up');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, ['offscreen before media']);
  await scrollUntilLineVisible(page, 'after mixed widgets', 'down');
  await waitForVisibleMediaToSettle(page);
  await expectNamedLinesAligned(page, [
    'after mixed widgets',
    'offscreen eof',
  ]);

  await insertMarkerAtLineStart(page, 'offscreen eof', 'SCROLLED_');
  expect(await editorSource(page)).toBe(
    source.replace('offscreen eof', 'SCROLLED_offscreen eof'),
  );
});

test('block media widgets do not invent vertical chrome or inner scrolling', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
      'before',
      '',
      `![pic](${dataUrl})`,
      '',
      '```mermaid',
      'graph TD;',
      '  A-->B;',
      '```',
      '',
      'after',
    ].join('\n'),
  );
  await waitForMediaWidgets(page);

  const geometry = await page.evaluate(() => {
    const image = document.querySelector('.lm-image-preview');
    const mermaid = document.querySelector('.lm-mermaid-preview');
    const mermaidSvg = document.querySelector('.lm-mermaid-svg');
    if (
      !(image instanceof HTMLElement) ||
      !(mermaid instanceof HTMLElement) ||
      !(mermaidSvg instanceof HTMLElement)
    ) {
      throw new Error('Expected image and mermaid widgets');
    }

    const imageStyle = getComputedStyle(image);
    const mermaidStyle = getComputedStyle(mermaid);
    const mermaidSvgStyle = getComputedStyle(mermaidSvg);
    return {
      image: {
        marginBottom: imageStyle.marginBottom,
        marginTop: imageStyle.marginTop,
        paddingBottom: imageStyle.paddingBottom,
        paddingTop: imageStyle.paddingTop,
      },
      mermaid: {
        marginBottom: mermaidStyle.marginBottom,
        marginTop: mermaidStyle.marginTop,
        overflowX: mermaidStyle.overflowX,
        overflowY: mermaidStyle.overflowY,
        paddingBottom: mermaidStyle.paddingBottom,
        paddingTop: mermaidStyle.paddingTop,
      },
      mermaidSvg: {
        overflowX: mermaidSvgStyle.overflowX,
        overflowY: mermaidSvgStyle.overflowY,
        paddingBottom: mermaidSvgStyle.paddingBottom,
        paddingTop: mermaidSvgStyle.paddingTop,
      },
    };
  });

  expect(geometry).toEqual({
    image: {
      marginBottom: '0px',
      marginTop: '0px',
      paddingBottom: '0px',
      paddingTop: '0px',
    },
    mermaid: {
      marginBottom: '0px',
      marginTop: '0px',
      overflowX: 'visible',
      overflowY: 'visible',
      paddingBottom: '0px',
      paddingTop: '0px',
    },
    mermaidSvg: {
      overflowX: 'visible',
      overflowY: 'visible',
      paddingBottom: '0px',
      paddingTop: '0px',
    },
  });
});
