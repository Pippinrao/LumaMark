import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authorizeLocalImage,
  importDocumentImage,
  cacheRemoteImage,
  copyLocalImage,
  createLocalImageReferences,
  createRemoteImageAssetResolver,
  finalizeAllDraftImages,
} from './assetCommands';

describe('asset commands', () => {
  afterEach(() => {
    delete window.__LUMAMARK_E2E_FILE_WATCH__;
  });

  it('finalizes every distinct draft image batch in document order', async () => {
    const finalize = vi.fn()
      .mockImplementationOnce(async ({ text }: { text: string }) => ({
        ok: true,
        data: text.replaceAll(
          'lumamark-draft://draft-old/',
          'note.assets/',
        ),
      }))
      .mockImplementationOnce(async ({ text }: { text: string }) => ({
        ok: true,
        data: text.replaceAll(
          'lumamark-draft://draft-new/',
          'note.assets/',
        ),
      }));
    const text = [
      '![Old](lumamark-draft://draft-old/image-001.png)',
      '![New](lumamark-draft://draft-new/image-002.png)',
      '![Old again](lumamark-draft://draft-old/image-003.png)',
    ].join('\n');

    const result = await finalizeAllDraftImages(
      { documentPath: 'E:\\notes\\note.md', text },
      { finalize },
    );

    expect(finalize).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenNthCalledWith(1, {
      documentPath: 'E:\\notes\\note.md',
      draftId: 'draft-old',
      text,
    });
    expect(finalize).toHaveBeenNthCalledWith(2, {
      documentPath: 'E:\\notes\\note.md',
      draftId: 'draft-new',
      text: expect.not.stringContaining('lumamark-draft://draft-old/'),
    });
    expect(result).not.toContain('lumamark-draft://');
  });

  it('authorizes a relative image against its document without granting a directory', async () => {
    const invokeFn = vi.fn().mockResolvedValue('E:\\notes\\assets\\pic.png');

    const result = await authorizeLocalImage(
      {
        documentPath: 'E:\\notes\\doc.md',
        source: './assets/pic.png',
      },
      { invokeFn },
    );

    expect(invokeFn).toHaveBeenCalledWith('assets_authorize_local_image', {
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });
    expect(result).toEqual({ ok: true, data: 'E:\\notes\\assets\\pic.png' });
  });

  it('invokes the local image copy command with source and document paths', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      markdownSource: 'note.assets/image-001.png',
      path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
    });

    const result = await copyLocalImage(
      {
        documentPath: 'E:\\workspace\\notes\\note.md',
        sourcePath: 'C:\\Pictures\\source.png',
      },
      { invokeFn },
    );

    expect(invokeFn).toHaveBeenCalledWith('assets_copy_local_image', {
      documentPath: 'E:\\workspace\\notes\\note.md',
      sourcePath: 'C:\\Pictures\\source.png',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        markdownSource: 'note.assets/image-001.png',
        path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
      },
    });
  });
  it('keeps original local image paths when copy-to-assets is disabled', async () => {
    const copyImage = vi.fn();
    const paths = [
      'C:\\Users\\pippin\\Pictures\\魔法森林动漫.png',
      'C:\\Users\\pippin\\Pictures\\魔法森林真人.png',
    ];

    const result = await createLocalImageReferences(
      {
        copyToAssets: false,
        documentPath: 'E:\\workspace\\notes\\note.md',
        paths,
      },
      { copyImage },
    );

    expect(copyImage).not.toHaveBeenCalled();
    expect(result).toEqual([
      { alt: '魔法森林动漫.png', markdownSource: paths[0] },
      { alt: '魔法森林真人.png', markdownSource: paths[1] },
    ]);
  });

  it('copies local images only after the user opts in and the document has a path', async () => {
    const copyImage = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        data: {
          markdownSource: 'note.assets/image-001.png',
          path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          markdownSource: 'note.assets/image-002.png',
          path: 'E:\\workspace\\notes\\note.assets\\image-002.png',
        },
      });
    const paths = ['C:\\Pictures\\first.png', 'C:\\Pictures\\second.png'];

    const result = await createLocalImageReferences(
      {
        copyToAssets: true,
        documentPath: 'E:\\workspace\\notes\\note.md',
        paths,
      },
      { copyImage },
    );

    expect(copyImage).toHaveBeenNthCalledWith(1, {
      documentPath: 'E:\\workspace\\notes\\note.md',
      sourcePath: paths[0],
    });
    expect(copyImage).toHaveBeenNthCalledWith(2, {
      documentPath: 'E:\\workspace\\notes\\note.md',
      sourcePath: paths[1],
    });
    expect(result).toEqual([
      { alt: 'first.png', markdownSource: 'note.assets/image-001.png' },
      { alt: 'second.png', markdownSource: 'note.assets/image-002.png' },
    ]);
  });

  it('serializes multi-image copies so generated asset names cannot race', async () => {
    let resolveFirst:
      | ((value: {
          ok: true;
          data: { markdownSource: string; path: string };
        }) => void)
      | undefined;
    const copyImage = vi.fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        data: {
          markdownSource: 'note.assets/image-002.png',
          path: 'E:\\notes\\note.assets\\image-002.png',
        },
      });

    const task = createLocalImageReferences(
      {
        copyToAssets: true,
        documentPath: 'E:\\notes\\note.md',
        paths: ['C:\\Pictures\\first.png', 'C:\\Pictures\\second.png'],
      },
      { copyImage },
    );

    expect(copyImage).toHaveBeenCalledTimes(1);
    resolveFirst?.({
      ok: true,
      data: {
        markdownSource: 'note.assets/image-001.png',
        path: 'E:\\notes\\note.assets\\image-001.png',
      },
    });
    await Promise.resolve();
    expect(copyImage).toHaveBeenCalledTimes(2);
    await expect(task).resolves.toEqual([
      { alt: 'first.png', markdownSource: 'note.assets/image-001.png' },
      { alt: 'second.png', markdownSource: 'note.assets/image-002.png' },
    ]);
  });
  it('sends clipboard or drop image bytes to the document asset importer', async () => {
    const invokeBinaryFn = vi.fn().mockResolvedValue({
      markdownSource: 'note.assets/image-001.png',
      path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
    });

    const result = await importDocumentImage(
      {
        bytes: Uint8Array.from([137, 80, 78, 71]),
        documentPath: 'E:\\workspace\\notes\\note.md',
        mimeType: 'image/png',
      },
      { invokeBinaryFn },
    );

    expect(result).toEqual({
      ok: true,
      data: {
        markdownSource: 'note.assets/image-001.png',
        path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
      },
    });
    const payload = invokeBinaryFn.mock.calls[0][1] as Uint8Array;
    const metadataLength = new DataView(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength,
    ).getUint32(0, true);
    const metadata = JSON.parse(
      new TextDecoder().decode(payload.subarray(4, 4 + metadataLength)),
    );
    expect(invokeBinaryFn).toHaveBeenCalledWith(
      'assets_import_document_image',
      expect.any(Uint8Array),
    );
    expect(metadata).toEqual({
      documentPath: 'E:\\workspace\\notes\\note.md',
      mimeType: 'image/png',
    });
    expect([...payload.subarray(4 + metadataLength)]).toEqual([137, 80, 78, 71]);
  });

  it('invokes the remote image cache command with document path and source', async () => {
    const invokeFn = vi.fn().mockResolvedValue({
      byteLength: 128,
      cacheHit: false,
      path: 'E:\\workspace\\notes\\.lumamark\\assets\\remote-cache\\pic.png',
    });

    const result = await cacheRemoteImage(
      {
        documentPath: 'E:\\workspace\\notes\\doc.md',
        source: 'https://example.com/pic.png',
      },
      { invokeFn },
    );

    expect(invokeFn).toHaveBeenCalledWith('assets_cache_remote_image', {
      documentPath: 'E:\\workspace\\notes\\doc.md',
      source: 'https://example.com/pic.png',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        byteLength: 128,
        cacheHit: false,
        path: 'E:\\workspace\\notes\\.lumamark\\assets\\remote-cache\\pic.png',
      },
    });
  });

  it('shares a pending cache request for the same document image', async () => {
    let resolveCacheRequest:
      | ((value: {
          ok: true;
          data: {
            byteLength: number;
            cacheHit: boolean;
            path: string;
          };
        }) => void)
      | undefined;
    const cacheImage = vi.fn(
      () =>
        new Promise<{
          ok: true;
          data: { byteLength: number; cacheHit: boolean; path: string };
        }>((resolve) => {
          resolveCacheRequest = resolve;
        }),
    );
    const resolver = createRemoteImageAssetResolver({
      cacheImage,
      toAssetUrl: (path) => `asset://localhost/${path}`,
    });
    const request = {
      documentPath: 'E:\\workspace\\notes\\doc.md',
      source: 'https://example.com/pic.png',
    };

    const first = resolver(request);
    const second = resolver(request);

    expect(cacheImage).toHaveBeenCalledTimes(1);
    resolveCacheRequest?.({
      ok: true,
      data: {
        byteLength: 128,
        cacheHit: false,
        path: 'E:\\workspace\\notes\\.lumamark\\assets\\remote-cache\\pic.png',
      },
    });

    await expect(first).resolves.toEqual({
      kind: 'resolved',
      src: 'asset://localhost/E:\\workspace\\notes\\.lumamark\\assets\\remote-cache\\pic.png',
    });
    await expect(second).resolves.toEqual({
      kind: 'resolved',
      src: 'asset://localhost/E:\\workspace\\notes\\.lumamark\\assets\\remote-cache\\pic.png',
    });
  });

  it('authorizes relative local images instead of sending them to the remote cache', async () => {
    const authorizeImage = vi.fn().mockResolvedValue({
      ok: true,
      data: 'E:\\notes\\assets\\pic.png',
    });
    const cacheImage = vi.fn();
    const resolver = createRemoteImageAssetResolver({
      authorizeImage,
      cacheImage,
      toAssetUrl: (path) => `asset://localhost/${path}`,
    });

    await expect(
      resolver({
        documentPath: 'E:\\notes\\doc.md',
        source: './assets/pic.png',
      }),
    ).resolves.toEqual({
      kind: 'resolved',
      src: 'asset://localhost/E:\\notes\\assets\\pic.png',
    });
    expect(authorizeImage).toHaveBeenCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });
    expect(cacheImage).not.toHaveBeenCalled();
  });

  it('authorizes restored draft image references without an in-memory path map', async () => {
    const authorizeImage = vi.fn().mockResolvedValue({
      ok: true,
      data: 'C:\\AppData\\LumaMark\\draft-assets\\draft-old\\image-001.png',
    });
    const resolver = createRemoteImageAssetResolver({
      authorizeImage,
      toAssetUrl: (path) => `asset://localhost/${path}`,
    });

    await expect(
      resolver({
        documentPath: null,
        source: 'lumamark-draft://draft-old/image-001.png',
      }),
    ).resolves.toEqual({
      kind: 'resolved',
      src: 'asset://localhost/C:\\AppData\\LumaMark\\draft-assets\\draft-old\\image-001.png',
    });
    expect(authorizeImage).toHaveBeenCalledWith({
      documentPath: null,
      source: 'lumamark-draft://draft-old/image-001.png',
    });
  });

  it('tracks authorized local image targets and removes sources no longer referenced', async () => {
    const replaceLocalImageTargets = vi.fn().mockResolvedValue(undefined);
    const authorizeImage = vi.fn().mockResolvedValue({
      ok: true,
      data: 'E:\\notes\\assets\\pic.png',
    });
    const resolver = createRemoteImageAssetResolver({
      authorizeImage,
      replaceLocalImageTargets,
      toAssetUrl: (path) => `asset://localhost/${path}`,
    });
    const syncLocalSources = (
      resolver as typeof resolver & {
        syncLocalSources?: (input: {
          documentPath: string | null;
          sources: readonly string[];
        }) => Promise<void>;
      }
    ).syncLocalSources;
    expect(syncLocalSources).toBeTypeOf('function');

    if (!syncLocalSources) {
      return;
    }

    await syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/pic.png'],
    });
    await resolver({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });

    expect(replaceLocalImageTargets).toHaveBeenLastCalledWith([
      'E:\\notes\\assets\\pic.png',
    ]);

    await syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: [],
    });

    expect(replaceLocalImageTargets).toHaveBeenLastCalledWith([]);
  });

  it('reauthorizes a local image after its watched path changes', async () => {
    const path = 'E:\\notes\\assets\\pic.png';
    const authorizeImage = vi.fn().mockResolvedValue({
      ok: true,
      data: path,
    });
    const resolver = createRemoteImageAssetResolver({
      authorizeImage,
      replaceLocalImageTargets: vi.fn().mockResolvedValue(undefined),
      toAssetUrl: (authorizedPath) => `asset://localhost/${authorizedPath}`,
    });

    await resolver.syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/pic.png'],
    });
    await resolver({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });

    resolver.invalidateLocalPath(path);
    await resolver({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });

    expect(authorizeImage).toHaveBeenCalledTimes(2);
  });

  it('treats lexically equivalent Windows image paths as the same watched target', async () => {
    const authorizeImage = vi.fn().mockResolvedValue({
      ok: true,
      data: 'E:\\notes\\.\\assets\\pic.png',
    });
    const resolver = createRemoteImageAssetResolver({
      authorizeImage,
      replaceLocalImageTargets: vi.fn().mockResolvedValue(undefined),
      toAssetUrl: (authorizedPath) => `asset://localhost/${authorizedPath}`,
    });

    await resolver.syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/pic.png'],
    });
    await resolver({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });

    resolver.invalidateLocalPath('e:/notes/assets/pic.png');
    await resolver({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });

    expect(authorizeImage).toHaveBeenCalledTimes(2);
  });

  it('serializes local image watcher updates so the newest targets win', async () => {
    const completedTargets: string[][] = [];
    let releaseOldTargets: (() => void) | undefined;
    const replaceLocalImageTargets = vi.fn(
      async (paths: readonly string[]) => {
        if (paths.length > 0) {
          await new Promise<void>((resolve) => {
            releaseOldTargets = resolve;
          });
        }
        completedTargets.push([...paths]);
      },
    );
    const resolver = createRemoteImageAssetResolver({
      authorizeImage: vi.fn().mockResolvedValue({
        ok: true,
        data: 'E:\\notes\\assets\\pic.png',
      }),
      replaceLocalImageTargets,
      toAssetUrl: (path) => `asset://localhost/${path}`,
    });

    await resolver.syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/pic.png'],
    });
    completedTargets.length = 0;
    const oldResolution = resolver({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });
    await vi.waitFor(() => {
      expect(releaseOldTargets).toBeTypeOf('function');
    });

    const removeTargets = resolver.syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: [],
    });
    releaseOldTargets?.();
    await Promise.all([oldResolution, removeTargets]);

    expect(completedTargets).toEqual([
      ['E:\\notes\\assets\\pic.png'],
      [],
    ]);
  });

  it('reports a failed local image watcher command instead of hiding it', async () => {
    const onLocalImageWatchError = vi.fn();
    const resolver = createRemoteImageAssetResolver({
      onLocalImageWatchError,
      replaceLocalImageTargets: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: 'file.watch_error',
          message: 'watcher unavailable',
          recoverable: true,
        },
      }),
    });

    await resolver.syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/pic.png'],
    });

    expect(onLocalImageWatchError).toHaveBeenCalledOnce();
  });

  it('excludes remote, data, blob, and draft sources from local watcher targets', async () => {
    const replaceLocalImageTargets = vi.fn().mockResolvedValue(undefined);
    const authorizeImage = vi.fn();
    const resolver = createRemoteImageAssetResolver({
      authorizeImage,
      replaceLocalImageTargets,
    });
    const syncLocalSources = (
      resolver as typeof resolver & {
        syncLocalSources?: (input: {
          documentPath: string | null;
          sources: readonly string[];
        }) => Promise<void>;
      }
    ).syncLocalSources;
    expect(syncLocalSources).toBeTypeOf('function');

    if (!syncLocalSources) {
      return;
    }

    await syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: [
        'https://example.com/pic.png',
        'data:image/png;base64,AA==',
        'blob:https://example.com/id',
        'lumamark-draft://draft-1/image.png',
      ],
    });

    expect(authorizeImage).not.toHaveBeenCalled();
    expect(replaceLocalImageTargets).toHaveBeenLastCalledWith([]);
  });

  it('adds the current local image revision without losing asset URL query or fragment', async () => {
    const authorizeImage = vi.fn().mockResolvedValue({
      ok: true,
      data: 'E:\\notes\\assets\\pic.png',
    });
    const resolver = createRemoteImageAssetResolver({
      authorizeImage,
      getLocalImageRevision: (path) =>
        path === 'E:\\notes\\assets\\pic.png' ? 7 : undefined,
      toAssetUrl: () => 'asset://localhost/pic.png?size=full#preview',
    });

    await expect(
      resolver({
        documentPath: 'E:\\notes\\doc.md',
        source: './assets/pic.png',
      }),
    ).resolves.toEqual({
      kind: 'resolved',
      src: 'asset://localhost/pic.png?size=full&lmv=7#preview',
    });
  });

  it('uses the file-watch facade for local targets by default', async () => {
    const replaceLocalImageTargets = vi.fn().mockResolvedValue({
      ok: true,
      data: undefined,
    });
    window.__LUMAMARK_E2E_FILE_WATCH__ = {
      listen: async () => () => undefined,
      replaceLocalImageTargets,
      unwatchDocument: async () => ({ ok: true, data: undefined }),
      watchDocument: async () => ({ ok: true, data: undefined }),
    };
    const resolver = createRemoteImageAssetResolver({
      authorizeImage: async () => ({
        ok: true,
        data: 'E:\\notes\\assets\\pic.png',
      }),
      toAssetUrl: (path) => `asset://localhost/${path}`,
    });

    await resolver.syncLocalSources({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/pic.png'],
    });
    await resolver({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });

    expect(replaceLocalImageTargets).toHaveBeenLastCalledWith([
      'E:\\notes\\assets\\pic.png',
    ]);
  });
});
