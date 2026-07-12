import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../shared/i18n';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import * as imagePreviewModule from './imagePreviewExtension';
import {
  collectImageBlocksInRanges,
  imagePreviewExtension,
  resolveMarkdownImageSource,
} from './imagePreviewExtension';
import { createImageCapability } from './createImageCapability';

async function waitForMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('image preview extension', () => {
  afterEach(() => {
    delete (
      globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: unknown;
      }
    ).__TAURI_INTERNALS__;
  });

  it('collects markdown image blocks from the syntax tree', () => {
    const doc = ['before', '![Alt text](./assets/pic.png)', 'after'].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
    });

    const blocks = collectImageBlocksInRanges(state, [
      {
        from: 0,
        to: doc.length,
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        alt: 'Alt text',
        from: 7,
        source: './assets/pic.png',
        to: 36,
      }),
    ]);
  });

  it('collects only image-only paragraphs for block previews', () => {
    const doc = [
      'before ![Inline](https://example.com/inline.png) after',
      '',
      '  ![Block](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)  ',
    ].join('\n');
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
    });

    const blocks = collectImageBlocksInRanges(state, [
      {
        from: 0,
        to: doc.length,
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        alt: 'Block',
        from: doc.indexOf('  ![Block]'),
        source: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
        to: doc.length,
      }),
    ]);
  });

  it('resolves local absolute and relative image sources through Tauri asset URLs', () => {
    const convertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`);
    (
      globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: {
          convertFileSrc: (filePath: string, protocol?: string) => string;
        };
      }
    ).__TAURI_INTERNALS__ = { convertFileSrc };

    expect(
      resolveMarkdownImageSource({
        documentPath: 'E:\\workspace\\notes\\doc.md',
        source: './assets/pic.png',
      }),
    ).toEqual({
      kind: 'resolved',
      src: 'asset://localhost/E:\\workspace\\notes\\assets\\pic.png',
    });
    expect(convertFileSrc).toHaveBeenCalledWith(
      'E:\\workspace\\notes\\assets\\pic.png',
    );

    expect(
      resolveMarkdownImageSource({
        documentPath: null,
        source: 'E:\\workspace\\notes\\assets\\pic.png',
      }),
    ).toEqual({
      kind: 'resolved',
      src: 'asset://localhost/E:\\workspace\\notes\\assets\\pic.png',
    });
  });

  it('resolves remote data and unsaved relative image sources without changing source text', () => {
    expect(
      resolveMarkdownImageSource({
        documentPath: null,
        source: './assets/pic.png',
      }),
    ).toEqual({
      kind: 'error',
      reason: 'relative_without_document',
    });
    expect(
      resolveMarkdownImageSource({
        documentPath: null,
        source: 'https://example.com/pic.png',
      }),
    ).toEqual({
      kind: 'resolved',
      src: 'https://example.com/pic.png',
    });
  });

  it('renders image preview outside the active markdown image line', () => {
    const doc = ['![Alt](https://example.com/pic.png)', '', 'after'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({ documentPath: null }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });

    expect(parent.querySelector('.lm-image-preview img')).not.toBeNull();
    expect(parent.querySelector('.lm-image-caption')?.textContent).toContain(
      'Alt',
    );

    view.destroy();
    parent.remove();
  });

  it('reveals the markdown source when the image preview is clicked', () => {
    const doc = ['![Alt](data:image/png;base64,AA==)', '', 'after'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({ documentPath: null }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });

    parent
      .querySelector('.lm-image-preview')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    expect(parent.textContent).toContain('![Alt](data:image/png;base64,AA==)');
    expect(view.state.selection.main.head).toBe(0);

    view.destroy();
    parent.remove();
  });

  it('keeps the image preview visible while its active markdown line is editable', () => {
    const doc = ['![Alt](https://example.com/pic.png)', '', 'after'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({ documentPath: null }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('Alt')),
      }),
    });

    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    expect(parent.textContent).toContain('![Alt](https://example.com/pic.png)');

    view.destroy();
    parent.remove();
  });

  it('does not replace inline markdown images inside normal paragraphs', () => {
    const doc = 'before ![Alt](https://example.com/pic.png) after';
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({ documentPath: null }),
        ],
      }),
    });

    expect(parent.querySelector('.lm-image-preview')).toBeNull();
    expect(parent.textContent).toContain(doc);

    view.destroy();
    parent.remove();
  });

  it('uses an injected resolver to preview remote images from the local cache without changing source text', async () => {
    const doc = ['![Remote](https://example.com/pic.png)', '', 'after'].join('\n');
    const resolver = vi.fn().mockResolvedValue({
      kind: 'resolved',
      src: 'asset://localhost/cache/pic.png',
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: 'E:\\workspace\\notes\\doc.md',
            imageAssetResolver: resolver,
          }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });

    expect(parent.querySelector('.lm-image-caption')?.textContent).toContain(
      i18n.t('image.downloading'),
    );

    await waitForMicrotasks();

    expect(resolver).toHaveBeenCalledWith({
      documentPath: 'E:\\workspace\\notes\\doc.md',
      source: 'https://example.com/pic.png',
    });
    expect(parent.querySelector<HTMLImageElement>('.lm-image-preview img')?.src).toBe(
      'asset://localhost/cache/pic.png',
    );
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('uses the injected resolver to authorize relative local images one file at a time', async () => {
    const doc = ['![Local](./assets/pic.png)', '', 'after'].join('\n');
    const resolver = vi.fn().mockResolvedValue({
      kind: 'resolved',
      src: 'asset://localhost/E:/notes/assets/pic.png',
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: 'E:\\notes\\doc.md',
            imageAssetResolver: resolver,
          }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });

    await waitForMicrotasks();

    expect(resolver).toHaveBeenCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      source: './assets/pic.png',
    });
    expect(parent.querySelector<HTMLImageElement>('.lm-image-preview img')?.src).toBe(
      'asset://localhost/E:/notes/assets/pic.png',
    );
    expect(view.state.doc.toString()).toBe(doc);

    view.destroy();
    parent.remove();
  });

  it('passes the injected resolver through the image capability factory', async () => {
    const doc = ['![Remote](https://example.com/pic.png)', '', 'after'].join('\n');
    const resolver = vi.fn().mockResolvedValue({
      kind: 'resolved',
      src: 'asset://localhost/cache/pic.png',
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          ...createImageCapability({
            imageAssetResolver: resolver,
            path: 'E:\\workspace\\notes\\doc.md',
          }).extensions,
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });

    await waitForMicrotasks();

    expect(resolver).toHaveBeenCalledWith({
      documentPath: 'E:\\workspace\\notes\\doc.md',
      source: 'https://example.com/pic.png',
    });
    expect(parent.querySelector<HTMLImageElement>('.lm-image-preview img')?.src).toBe(
      'asset://localhost/cache/pic.png',
    );

    view.destroy();
    parent.remove();
  });

  it('does not cache remote images before the document has a path', async () => {
    const doc = ['![Remote](https://example.com/pic.png)', '', 'after'].join('\n');
    const resolver = vi.fn();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: null,
            imageAssetResolver: resolver,
          }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });

    await waitForMicrotasks();

    expect(resolver).not.toHaveBeenCalled();
    expect(parent.querySelector('.lm-image-preview-error')).not.toBeNull();
    expect(parent.querySelector('.lm-image-caption')?.textContent).toContain(
      i18n.t('image.unsavedRemoteCacheUnavailable'),
    );
    expect(parent.querySelector('.lm-image-preview img')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('refreshes image widgets on demand without changing markdown bytes', async () => {
    const refreshImagePreviews = (
      imagePreviewModule as typeof imagePreviewModule & {
        refreshImagePreviews?: {
          of: (value: string) => unknown;
        };
      }
    ).refreshImagePreviews;
    expect(refreshImagePreviews).toBeDefined();

    if (!refreshImagePreviews) {
      return;
    }

    const doc = [
      '![Changed](./assets/changed.png)',
      '',
      '![Stable](./assets/stable.png)',
      '',
      'after',
    ].join('\n');
    const revisions = new Map<string, number>();
    const resolver = Object.assign(
      vi.fn(async ({ source }: { source: string }) => ({
        kind: 'resolved' as const,
        src: `asset://localhost/${source}`,
      })),
      {
        getLocalSourceRevision: (source: string) => revisions.get(source),
      },
    );
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: 'E:\\notes\\doc.md',
            imageAssetResolver: resolver,
          }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });

    await waitForMicrotasks();
    const initialImages = [
      ...parent.querySelectorAll<HTMLImageElement>('.lm-image-preview img'),
    ];
    expect(resolver).toHaveBeenCalledTimes(2);

    revisions.set('./assets/changed.png', 7);
    view.dispatch({
      effects: refreshImagePreviews.of('E:/notes/assets/changed.png'),
    });
    await waitForMicrotasks();

    const refreshedImages = [
      ...parent.querySelectorAll<HTMLImageElement>('.lm-image-preview img'),
    ];
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(view.state.doc.toString()).toBe(doc);
    expect(refreshedImages[0]).not.toBe(initialImages[0]);
    expect(refreshedImages[1]).toBe(initialImages[1]);

    view.destroy();
    parent.remove();
  });

  it('syncs only block-level local image sources when decorations rebuild', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = [
      '![Relative](./assets/local.png)',
      '',
      '![Absolute](/tmp/absolute.png)',
      '',
      '![Remote](https://example.com/remote.png)',
      '',
      '![Data](data:image/png;base64,AA==)',
      '',
      '![Blob](blob:https://example.com/id)',
      '',
      '![Draft](lumamark-draft://draft-1/image.png)',
      '',
      'inline ![Ignored](./assets/inline.png) text',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: 'E:\\notes\\doc.md',
            imageAssetResolver: resolver,
          }),
        ],
      }),
    });

    expect(syncLocalSources).toHaveBeenCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/local.png', '/tmp/absolute.png'],
    });

    view.destroy();
    parent.remove();
  });
});
