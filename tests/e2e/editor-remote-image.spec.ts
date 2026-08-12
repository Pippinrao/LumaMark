import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  invalidDecodedImage,
  remoteImageDocumentPath,
  remoteImageFixtures,
  remoteMarkdown,
  tinyDecodedImage,
} from './fixtures/remoteImageData';

type CacheMode =
  | 'decode-failure'
  | 'deferred'
  | 'fail-once'
  | 'reject'
  | 'structured-failure'
  | 'success';

type RemoteImageState = {
  cacheCalls: Array<{ documentPath: string; source: string }>;
  cacheHits: boolean[];
  releasePending: () => void;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_REMOTE_IMAGE_STATE__?: RemoteImageState;
  }
}

const browserDiagnostics = new WeakMap<
  Page,
  { consoleErrors: string[]; pageErrors: string[] }
>();

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

  const viewMenu = page
    .locator('.lm-menu-trigger')
    .filter({ hasText: /View|视图/ });
  await viewMenu.focus();
  await viewMenu.press('ArrowDown');
  await expect(viewMenu).toHaveAttribute('data-state', 'open');
  await page
    .getByRole('menuitemradio', {
      name:
        mode === 'source'
          ? /Source Mode|源码模式/
          : /Live Preview|实时预览/,
    })
    .click();
  await expect(page.locator(rootClass)).toBeVisible();
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
}

// This suite exercises the Vite/Web UI against a deterministic mocked Tauri
// command boundary. Public network availability is gated separately by test:live-assets.

test.afterEach(async ({ page }) => {
  const diagnostics = browserDiagnostics.get(page);

  if (!diagnostics) {
    return;
  }

  expect(
    diagnostics.pageErrors,
    `Unexpected page errors:\n${diagnostics.pageErrors.join('\n')}`,
  ).toEqual([]);
  expect(
    diagnostics.consoleErrors,
    `Unexpected console errors:\n${diagnostics.consoleErrors.join('\n')}`,
  ).toEqual([]);
});

async function openRemoteDocument(
  page: Page,
  options: {
    cacheHitUrls?: readonly string[];
    markdown: string;
    mode?: CacheMode;
    path?: string;
  },
): Promise<void> {
  const mode = options.mode ?? 'success';
  const path = options.path ?? remoteImageDocumentPath;
  const fixtures = Object.values(remoteImageFixtures);
  const diagnostics = { consoleErrors: [] as string[], pageErrors: [] as string[] };
  browserDiagnostics.set(page, diagnostics);
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      diagnostics.consoleErrors.push(message.text());
    }
  });

  await page.addInitScript(
    ({
      cacheHitUrls,
      decodedImage,
      fixtures,
      invalidImage,
      markdown,
      mode,
      path,
    }) => {
      let releasePending: (() => void) | undefined;
      const pendingGate = new Promise<void>((resolve) => {
        releasePending = resolve;
      });
      const state: RemoteImageState = {
        cacheCalls: [],
        cacheHits: [],
        releasePending: () => releasePending?.(),
      };
      window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__ = state;
      (
        window as Window & {
          __TAURI_INTERNALS__?: {
            convertFileSrc: (path: string) => string;
          };
        }
      ).__TAURI_INTERNALS__ = {
        convertFileSrc: () =>
          mode === 'decode-failure' ? invalidImage : decodedImage,
      };
      window.__LUMAMARK_E2E_FILE_WATCH__ = {
        listen: async () => () => undefined,
        replaceLocalImageTargets: async () => ({ ok: true, data: undefined }),
        unwatchDocument: async () => ({ ok: true, data: undefined }),
        watchDocument: async () => ({ ok: true, data: undefined }),
      };
      window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
        readText: async () => ({
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(markdown).length,
            path,
            text: markdown,
          },
        }),
        showOpenDialog: async () => ({ ok: true, data: path }),
        showSaveDialog: async () => ({ ok: true, data: path }),
        writeText: async (filePath, text) => ({
          ok: true,
          data: {
            byteLength: new TextEncoder().encode(text).length,
            path: filePath,
          },
        }),
      };
      window.__LUMAMARK_E2E_ASSET_COMMANDS__ = {
        authorizeLocalImage: async ({ source }) => ({ ok: true, data: source }),
        cacheRemoteImage: async (input) => {
          state.cacheCalls.push(input);

          if (mode === 'deferred') {
            await pendingGate;
          }

          if (mode === 'reject') {
            throw new Error('remote image cache rejected');
          }

          if (
            mode === 'structured-failure' ||
            (mode === 'fail-once' && state.cacheCalls.length === 1)
          ) {
            return {
              ok: false,
              error: {
                code: 'asset.remote_download_failed',
                message: 'Remote image cache failed.',
                recoverable: true,
              },
            };
          }

          const fixture = fixtures.find(({ url }) => url === input.source);
          const cacheHit = cacheHitUrls.includes(input.source);
          state.cacheHits.push(cacheHit);
          return {
            ok: true,
            data: {
              byteLength: 128,
              cacheHit,
              path:
                fixture?.cachePath ??
                'E:/lumamark-fixtures/.lumamark/assets/remote-cache/fallback.png',
            },
          };
        },
      };
    },
    {
      cacheHitUrls: [...(options.cacheHitUrls ?? [])],
      decodedImage: tinyDecodedImage,
      fixtures,
      invalidImage: invalidDecodedImage,
      markdown: options.markdown,
      mode,
      path,
    },
  );

  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByTestId('editor-host')).toBeVisible();
  await page.getByRole('menuitem', { name: /File|文件/ }).click();
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();
  await expect(page.locator('.lm-editor-title')).toHaveText('remote-images.md');
}

async function imageIsDecoded(page: Page, alt: string): Promise<void> {
  const image = page.getByRole('img', { name: alt });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((node) => {
        const element = node as HTMLImageElement;
        return [element.complete, element.naturalWidth, element.naturalHeight];
      }),
    )
    .toEqual([true, 2, 2]);
}

async function expectRemoteImageSentinelAligned(
  page: Page,
  sentinel: string,
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((text) => {
        const content = document.querySelector(
          '.lm-editor-live-preview-mode .cm-content',
        );
        if (!(content instanceof HTMLElement)) {
          return 'missing live preview';
        }
        type ViewBridge = {
          contentDOM: HTMLElement;
          lineBlockAt(pos: number): { top: number };
          posAtCoords(coords: { x: number; y: number }): number | null;
          state: {
            doc: {
              lineAt(pos: number): { from: number };
              toString(): string;
            };
          };
          viewState: { paddingTop: number };
        };
        const tile = (
          content as HTMLElement & {
            cmTile: { root?: { view: ViewBridge }; view: ViewBridge };
          }
        ).cmTile;
        const view = tile.root?.view ?? tile.view;
        const index = view.state.doc.toString().indexOf(text);
        const line = index < 0 ? null : view.state.doc.lineAt(index);
        const element = [
          ...document.querySelectorAll('.lm-editor-live-preview-mode .cm-line'),
        ].find((node) => node.textContent === text);
        if (!line || !(element instanceof HTMLElement)) {
          return 'missing sentinel';
        }
        const rect = element.getBoundingClientRect();
        const docTop =
          view.contentDOM.getBoundingClientRect().top +
          view.viewState.paddingTop;
        const drift = rect.top - docTop - view.lineBlockAt(line.from).top;
        const position = view.posAtCoords({
          x: rect.left + 1,
          y: rect.top + rect.height / 2,
        });
        return Number.isFinite(drift) &&
          Math.abs(drift) <= 0.75 &&
          position === line.from
          ? 'aligned'
          : JSON.stringify({ drift, expected: line.from, position });
      }, sentinel),
    )
    .toBe('aligned');
}

async function currentEditorSource(page: Page): Promise<string> {
  return page.locator('.cm-content').evaluate((content) => {
    type ViewBridge = { state: { doc: { toString(): string } } };
    const tile = (
      content as HTMLElement & {
        cmTile: { root?: { view: ViewBridge }; view: ViewBridge };
      }
    ).cmTile;
    return (tile.root?.view ?? tile.view).state.doc.toString();
  });
}

test('opens the registered fixture without a white screen and renders remote PNG and SVG previews', async ({
  page,
}) => {
  const markdown = await readFile(
    join(process.cwd(), 'tests', 'fixtures', 'markdown', 'remote-images.md'),
    'utf8',
  );
  await openRemoteDocument(page, { markdown });

  await imageIsDecoded(page, remoteImageFixtures.png.alt);
  await imageIsDecoded(page, remoteImageFixtures.svg.alt);
  await expect(page.locator('.lm-editor-pane')).toBeVisible();
});

test('shows loading before a cache miss resolves and sends exact command arguments', async ({
  page,
}) => {
  const fixture = remoteImageFixtures.png;
  await openRemoteDocument(page, {
    markdown: remoteMarkdown([fixture]),
    mode: 'deferred',
  });

  await expect(page.getByText(/Downloading image|正在下载图片/)).toBeVisible();
  expect(
    await page.evaluate(
      () => window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.cacheCalls,
    ),
  ).toEqual([{ documentPath: remoteImageDocumentPath, source: fixture.url }]);

  await page.evaluate(() => {
    window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.releasePending();
  });
  await imageIsDecoded(page, fixture.alt);
});

test('renders cache hits and common remote formats through one deterministic boundary', async ({
  page,
}) => {
  const fixtures = [
    remoteImageFixtures.png,
    remoteImageFixtures.svg,
    remoteImageFixtures.jpeg,
    remoteImageFixtures.gif,
    remoteImageFixtures.webpWithQuery,
  ];
  await openRemoteDocument(page, {
    cacheHitUrls: [remoteImageFixtures.svg.url],
    markdown: remoteMarkdown(fixtures),
  });

  for (const fixture of fixtures) {
    await imageIsDecoded(page, fixture.alt);
  }
  expect(
    await page.evaluate(
      () => window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.cacheHits,
    ),
  ).toEqual([false, true, false, false, false]);
});

test('coalesces concurrent duplicate URLs while rendering both previews', async ({
  page,
}) => {
  const fixture = remoteImageFixtures.png;
  await openRemoteDocument(page, {
    markdown: remoteMarkdown([
      fixture,
      { alt: 'Duplicate preview', url: fixture.url },
    ]),
    mode: 'deferred',
  });

  await expect
    .poll(() =>
      page.evaluate(
        () => window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.cacheCalls.length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => {
    window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.releasePending();
  });
  await imageIsDecoded(page, fixture.alt);
  await imageIsDecoded(page, 'Duplicate preview');
});

for (const mode of ['structured-failure', 'reject'] as const) {
  test(`keeps the editor usable after ${mode}`, async ({ page }) => {
    await openRemoteDocument(page, {
      markdown: remoteMarkdown([remoteImageFixtures.png]),
      mode,
    });

    await expect(page.getByText(/Remote image cache failed|远程图片缓存失败/)).toBeVisible();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('editor-host')).toBeVisible();
  });
}

test('retries a failed remote image after leaving and returning to live preview', async ({
  page,
}) => {
  const fixture = remoteImageFixtures.png;
  const sentinel = 'after retry image';
  const markdown = `${remoteMarkdown([fixture])}\n\n${sentinel}`;
  await openRemoteDocument(page, {
    markdown,
    mode: 'fail-once',
  });

  await expect(page.getByText(/Remote image cache failed|远程图片缓存失败/)).toBeVisible();
  await expectRemoteImageSentinelAligned(page, sentinel);
  await switchEditorMode(page, 'source');
  await switchEditorMode(page, 'livePreview');

  await imageIsDecoded(page, fixture.alt);
  await expectRemoteImageSentinelAligned(page, sentinel);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.cacheCalls.length,
      ),
    )
    .toBe(2);

  const line = page.locator('.lm-editor-live-preview-mode .cm-line', {
    hasText: new RegExp(`^${sentinel}$`),
  });
  const point = await line.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.insertText('RETRIED_');
  expect(await currentEditorSource(page)).toBe(
    markdown.replace(sentinel, `RETRIED_${sentinel}`),
  );
});

test('shows a decode error for a corrupt cached asset without blanking the app', async ({
  page,
}) => {
  await openRemoteDocument(page, {
    markdown: remoteMarkdown([remoteImageFixtures.png]),
    mode: 'decode-failure',
  });

  await expect(page.getByText(/Image failed to load|图片加载失败/)).toBeVisible();
  await expect(page.locator('.lm-image-preview-error')).toBeVisible();
  await expect(page.getByTestId('app-shell')).toBeVisible();
});

test('does not call the cache command for a remote image in an unsaved document', async ({
  page,
}) => {
  await openRemoteDocument(page, { markdown: '' });
  await page.getByRole('menuitem', { name: /File|文件/ }).click();
  await page.getByRole('menuitem', { name: /New Document|新建文档/ }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText(
    `${remoteMarkdown([remoteImageFixtures.png])}\n\nafter`,
  );

  await expect(
    page.getByText(/Save the document before caching|保存文档后才能缓存/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.cacheCalls,
    ),
  ).toEqual([]);
});

test('reveals editable markdown on click while keeping the preview and preserves source-mode bytes', async ({
  page,
}) => {
  const fixture = remoteImageFixtures.webpWithQuery;
  const markdown = remoteMarkdown([fixture]);
  await openRemoteDocument(page, { markdown });
  const image = page.getByRole('img', { name: fixture.alt });
  await imageIsDecoded(page, fixture.alt);

  await image.click();
  await expect(image).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText(markdown);

  await switchEditorMode(page, 'source');
  await expect(page.locator('.cm-content')).toContainText(markdown);

  await switchEditorMode(page, 'livePreview');
  await imageIsDecoded(page, fixture.alt);
  await expect(page.locator('.cm-content')).toContainText(fixture.url);
});

test('renders a block image without alt text but leaves inline image markdown untouched', async ({
  page,
}) => {
  const blockUrl = 'https://images.example.test/no-alt.gif';
  const inlineUrl = 'https://images.example.test/inline.jpg';
  const markdown = [
    `![](${blockUrl})`,
    '',
    `Inline image stays source-only: ![Inline remote](${inlineUrl}).`,
  ].join('\n');
  await openRemoteDocument(page, { markdown });

  await expect(page.locator('.lm-image-preview img')).toHaveCount(1);
  await expect(page.getByText('Inline image stays source-only:')).toBeVisible();
  await switchEditorMode(page, 'source');
  await expect(page.locator('.cm-content')).toContainText(
    `![Inline remote](${inlineUrl})`,
  );
  expect(
    await page.evaluate(
      () => window.__LUMAMARK_E2E_REMOTE_IMAGE_STATE__?.cacheCalls,
    ),
  ).toEqual([{ documentPath: remoteImageDocumentPath, source: blockUrl }]);
});
