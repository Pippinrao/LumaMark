import { expect, test, type Page } from '@playwright/test';

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="#4488cc"/></svg>`;
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

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

type LineProbe = {
  drift: number;
  name: string;
  ok: boolean;
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
        x: rect.left + 5,
        y: rect.top + rect.height / 2,
      });

      return {
        drift: Math.round(rect.top - docTop - block.top),
        name,
        ok: pos != null && view.state.doc.lineAt(pos).text === name,
        resolved:
          pos == null ? null : view.state.doc.lineAt(pos).text.slice(0, 24),
      };
    });

    return {
      contentInnerHeight: Math.round(
        contentRect.height -
          view.viewState.paddingTop -
          view.viewState.paddingBottom,
      ),
      docHeight: Math.round(view.viewState.docHeight),
      rows,
    };
  }, names);
}

test('keeps click targets aligned after image and mermaid widgets settle', async ({
  page,
}) => {
  await openNewDocument(page);
  await replaceEditorSource(
    page,
    [
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
    ].join('\n'),
  );

  await waitForMediaWidgets(page);
  await expect
    .poll(async () => {
      const probe = await probeNamedLines(page, [
        'alpha line',
        'beta line',
        'gamma line',
        'delta line',
      ]);
      return probe.rows.map(({ drift, name, ok }) => ({ drift, name, ok }));
    })
    .toEqual([
      { drift: 0, name: 'alpha line', ok: true },
      { drift: 0, name: 'beta line', ok: true },
      { drift: 0, name: 'gamma line', ok: true },
      { drift: 0, name: 'delta line', ok: true },
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

  for (const [name, marker] of [
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
        return probe.rows[0];
      })
      .toMatchObject({ drift: 0, name, ok: true });

    const point = await line.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.keyboard.insertText(marker);
  }

  const source = await page.locator('.cm-content').first().evaluate((content) => {
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

  expect(source).toMatch(/BETAbeta line/);
  expect(source).toMatch(/GAMMAgamma line/);
  expect(source).toMatch(/DELTAdelta line/);
});

test('block media widgets do not invent vertical margins', async ({ page }) => {
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

  const margins = await page.evaluate(() => {
    const image = document.querySelector('.lm-image-preview');
    const mermaid = document.querySelector('.lm-mermaid-preview');
    if (!(image instanceof HTMLElement) || !(mermaid instanceof HTMLElement)) {
      throw new Error('Expected image and mermaid widgets');
    }

    const imageStyle = getComputedStyle(image);
    const mermaidStyle = getComputedStyle(mermaid);
    return {
      image: {
        marginBottom: imageStyle.marginBottom,
        marginTop: imageStyle.marginTop,
      },
      mermaid: {
        marginBottom: mermaidStyle.marginBottom,
        marginTop: mermaidStyle.marginTop,
      },
    };
  });

  expect(margins).toEqual({
    image: { marginBottom: '0px', marginTop: '0px' },
    mermaid: { marginBottom: '0px', marginTop: '0px' },
  });
});
