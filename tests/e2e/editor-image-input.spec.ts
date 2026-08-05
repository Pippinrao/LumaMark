import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const documentPath = 'E:/lumamark-fixtures/note.md';
const pixelSvg =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"%3E%3Crect width="2" height="2" fill="%2300aaff"/%3E%3C/svg%3E';

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

  await openTopMenu(page, /View|视图/);
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

async function openTopMenu(page: Page, name: RegExp): Promise<void> {
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
  const trigger = page.locator('.lm-menu-trigger').filter({ hasText: name });
  await trigger.focus();
  await trigger.press('ArrowDown');
  await expect(trigger).toHaveAttribute('data-state', 'open');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ documentPath, pixelSvg }) => {
    window.__TAURI_INTERNALS__ = {
      convertFileSrc: () => pixelSvg,
    };
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: async () => ({
        ok: true,
        data: { byteLength: 0, path: documentPath, text: '' },
      }),
      showOpenDialog: async () => ({ ok: true, data: documentPath }),
      showSaveDialog: async () => ({ ok: true, data: documentPath }),
      writeText: async (path, text) => ({
        ok: true,
        data: { byteLength: new TextEncoder().encode(text).length, path },
      }),
    };
    window.__LUMAMARK_E2E_ASSET_COMMANDS__ = {
      authorizeLocalImage: async ({ source }) => ({ ok: true, data: source }),
      finalizeDraftImages: async ({ text }) => ({
        ok: true,
        data: text.replace(/lumamark-draft:\/\/[^/]+\/image-001\.png/g, 'note.assets/image-001.png'),
      }),
      importDraftImage: async ({ draftId, mimeType }) => ({
        ok: true,
        data: {
          markdownSource: `lumamark-draft://${draftId}/image-001.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
          path: 'E:/lumamark-drafts/draft/image-001.png',
        },
      }),
      importDocumentImage: async ({ mimeType }) => ({
        ok: true,
        data: {
          markdownSource: `note.assets/image-001.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`,
          path: 'E:/lumamark-fixtures/note.assets/image-001.png',
        },
      }),
    };
  }, { documentPath, pixelSvg });
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档' }).click();
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
  await expect(page.locator('.lm-editor-title')).toHaveText('note.md');
});

test('drops an image into a saved document, preserves raw markdown, and renders it', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();

  await editor.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'drop.png', { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });

  await switchEditorMode(page, 'source');
  await expect(editor.locator('.cm-line')).toHaveText('![drop.png](note.assets/image-001.png)');
  await switchEditorMode(page, 'livePreview');

  const image = page.getByRole('img', { name: 'drop.png' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => {
    const element = node as HTMLImageElement;
    return [element.complete, element.naturalWidth, element.naturalHeight];
  })).toEqual([true, 2, 2]);

  await switchEditorMode(page, 'source');
  await expect(editor).toContainText('![drop.png](note.assets/image-001.png)');
});

test('pastes an image into a saved document and persists a local asset reference', async ({ page }) => {
  const editor = page.locator('.cm-content');

  await editor.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([255, 216, 255])], 'paste.jpg', { type: 'image/jpeg' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });

  await switchEditorMode(page, 'source');
  await expect(editor.locator('.cm-line')).toHaveText('![paste.jpg](note.assets/image-001.jpg)');
  await switchEditorMode(page, 'livePreview');

  const image = page.getByRole('img', { name: 'paste.jpg' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => {
    const element = node as HTMLImageElement;
    return [element.complete, element.naturalWidth, element.naturalHeight];
  })).toEqual([true, 2, 2]);

  await switchEditorMode(page, 'source');
  await expect(editor).toContainText('![paste.jpg](note.assets/image-001.jpg)');
});

test('renders a remote image from the local cache without rewriting its markdown URL', async ({ page }) => {
  const remoteUrl = 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Fronalpstock_big.jpg';
  await page.evaluate(({ documentPath, remoteUrl }) => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__!.readText = async () => ({
      ok: true,
      data: {
        byteLength: remoteUrl.length + 12,
        path: documentPath,
        text: `![Remote fixture](${remoteUrl})`,
      },
    });
    window.__LUMAMARK_E2E_ASSET_COMMANDS__!.cacheRemoteImage = async () => ({
      ok: true,
      data: {
        byteLength: 128,
        cacheHit: false,
        path: 'E:/lumamark-fixtures/note.assets/remote-cache/fixture.jpg',
      },
    });
  }, { documentPath, remoteUrl });
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.press('End');
  await editor.press('Enter');

  const image = page.getByRole('img', { name: 'Remote fixture' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => {
    const element = node as HTMLImageElement;
    return [element.complete, element.naturalWidth, element.naturalHeight];
  })).toEqual([true, 2, 2]);
  await switchEditorMode(page, 'source');
  await expect(editor).toContainText(remoteUrl);
});

test('renders a relative local image link from the document asset directory', async ({ page }) => {
  await page.evaluate((documentPath) => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__!.readText = async () => ({
      ok: true,
      data: {
        byteLength: 39,
        path: documentPath,
        text: '![Local fixture](note.assets/local.png)',
      },
    });
  }, documentPath);
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.press('End');
  await editor.press('Enter');

  const image = page.getByRole('img', { name: 'Local fixture' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node) => {
    const element = node as HTMLImageElement;
    return [element.complete, element.naturalWidth, element.naturalHeight];
  })).toEqual([true, 2, 2]);
  await image.click();
  await expect(image).toBeVisible();
  await expect(editor).toContainText('![Local fixture](note.assets/local.png)');
  await switchEditorMode(page, 'source');
  await expect(editor).toContainText('![Local fixture](note.assets/local.png)');
});

test('renders the repository links fixture after its local image assets are restored', async ({
  page,
}) => {
  const markdown = await readFile(
    join(process.cwd(), 'tests', 'fixtures', 'markdown', 'links-images.md'),
    'utf8',
  );
  await page.evaluate(({ documentPath, markdown }) => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__!.readText = async () => ({
      ok: true,
      data: {
        byteLength: new TextEncoder().encode(markdown).length,
        path: documentPath,
        text: markdown,
      },
    });
  }, { documentPath, markdown });
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();

  await expect(
    page.getByRole('img', { name: 'LumaMark logo alt text' }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: 'image.png' })).toBeVisible();
  await expect(page.getByTestId('app-shell')).toBeVisible();
});

test('authorizes and renders Windows local image links without changing source markdown', async ({ page }) => {
  const firstSource = String.raw`C:\Users\pippin\Pictures\autodl\image\魔法森林动漫.png`;
  const secondSource = String.raw`C:\Users\pippin\Pictures\autodl\image\魔法森林真人.png`;
  const markdown = [
    `![魔法森林动漫](${firstSource})`,
    '',
    `![魔法森林真人](${secondSource})`,
  ].join('\n');
  await page.evaluate(({ documentPath, markdown }) => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__!.readText = async () => ({
      ok: true,
      data: {
        byteLength: new TextEncoder().encode(markdown).length,
        path: documentPath,
        text: markdown,
      },
    });
  }, { documentPath, markdown });
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /Open File|打开文件/ }).click();
  const editor = page.locator('.cm-content');
  await editor.click();
  await editor.press('Control+End');
  await editor.press('Enter');
  await expect(page.getByRole('img', { name: '魔法森林动漫' })).toBeVisible();
  await expect(page.getByRole('img', { name: '魔法森林真人' })).toBeVisible();
  await switchEditorMode(page, 'source');
  await expect(editor).toContainText(`![魔法森林动漫](${firstSource})`);
  await expect(editor).toContainText(`![魔法森林真人](${secondSource})`);
});

test('exposes an opt-in setting for copying local images to document assets', async ({ page }) => {
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /Settings|设置/ }).click();
  await page.getByRole('tab', { name: /Images|图片/ }).click();
  const checkbox = page.getByRole('checkbox', {
    name: /Copy inserted local images|复制插入的本地图片/,
  });

  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
});

test('pastes an image into an unsaved document and renders its draft asset', async ({ page }) => {
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /New Document|新建文档/ }).click();
  await expect(page.locator('.lm-menu-content')).toHaveCount(0);
  const editor = page.locator('.cm-content');
  await editor.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'draft.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });

  await switchEditorMode(page, 'source');
  await expect(editor.locator('.cm-line')).toContainText('![draft.png](lumamark-draft://draft-');
  await switchEditorMode(page, 'livePreview');

  await expect(page.getByRole('img', { name: 'draft.png' })).toBeVisible();
});

test('migrates an unsaved draft image to document assets on first save', async ({ page }) => {
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /New Document|新建文档/ }).click();
  const editor = page.locator('.cm-content');
  await editor.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'first-save.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });

  await switchEditorMode(page, 'source');
  await expect(editor.locator('.cm-line')).toContainText('lumamark-draft://');
  await openTopMenu(page, /File|文件/);
  await page.getByRole('menuitem', { name: /Save As|另存为/ }).click();
  await expect(page.locator('.lm-editor-title')).toHaveText('note.md');
  await expect(editor.locator('.cm-line')).toHaveText('![first-save.png](note.assets/image-001.png)');
  await expect(editor.locator('.cm-line')).not.toContainText('lumamark-draft://');
});
