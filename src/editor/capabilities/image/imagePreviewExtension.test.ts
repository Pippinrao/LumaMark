import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../shared/i18n';
import { createEditorApi } from '../../core/editorApi';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { BlockWidgetGeometryCache } from '../blockWidgetGeometry';
import { ImageBlockWidget } from './ImageBlockWidget';
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

function imageWidgets(view: EditorView): ImageBlockWidget[] {
  const widgets: ImageBlockWidget[] = [];

  for (const source of view.state.facet(EditorView.decorations)) {
    const decorations = typeof source === 'function' ? source(view) : source;
    decorations.between(0, view.state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof ImageBlockWidget) {
        widgets.push(decoration.spec.widget);
      }
    });
  }

  return widgets;
}

describe('image preview extension', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('uses a geometry key precomputed by the decoration build', () => {
    const doc = '![Large](data:image/png;base64,AAAA)';
    const state = EditorState.create({
      doc,
      extensions: [markdownLanguage()],
    });
    const [block] = collectImageBlocksInRanges(state, [
      { from: 0, to: doc.length },
    ]);
    const cache = new BlockWidgetGeometryCache();
    cache.record('image:precomputed', 321, -1);

    const widget = new ImageBlockWidget(
      block,
      { documentPath: null },
      undefined,
      cache,
      'image:precomputed',
    );

    expect(widget.estimatedHeight).toBe(321);
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

  it('opens a successfully loaded image without changing source, selection, or history', () => {
    const doc = ['![Alt](data:image/png;base64,AA==)', '', 'after'].join('\n');
    const onMediaPreviewRequest = vi.fn();
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
            onMediaPreviewRequest,
          }),
        ],
        selection: EditorSelection.cursor(doc.indexOf('after')),
      }),
    });
    const selectionBefore = view.state.selection;
    const historyBefore = undoDepth(view.state);
    const image = parent.querySelector<HTMLImageElement>('.lm-image-preview img');

    expect(parent.querySelector('.lm-media-preview-expand')).toBeNull();
    image?.dispatchEvent(new Event('load'));
    const expand = parent.querySelector<HTMLButtonElement>('.lm-media-preview-expand');
    expect(expand).not.toBeNull();

    expand?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(expand?.isConnected).toBe(true);
    expand?.click();

    expect(onMediaPreviewRequest).toHaveBeenCalledWith({
      alt: 'Alt',
      kind: 'image',
      src: 'data:image/png;base64,AA==',
    });
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.state.selection.eq(selectionBefore)).toBe(true);
    expect(undoDepth(view.state)).toBe(historyBefore);

    view.destroy();
    parent.remove();
  });

  it('relabels an existing image expand action without changing editor state', async () => {
    await i18n.changeLanguage('zh-CN');
    const eqSpy = vi.spyOn(ImageBlockWidget.prototype, 'eq');
    const toDOMSpy = vi.spyOn(ImageBlockWidget.prototype, 'toDOM');
    const doc = ['![Alt](data:image/png;base64,AA==)', '', 'after'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'source',
      doc,
      extensions: [
        imagePreviewExtension({
          documentPath: null,
          onMediaPreviewRequest: vi.fn(),
        }),
      ],
      language: 'zh-CN',
      parent,
    });
    editor.view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('after')),
    });
    const image = parent.querySelector<HTMLImageElement>('.lm-image-preview img');
    image?.dispatchEvent(new Event('load'));
    const expand = parent.querySelector<HTMLButtonElement>('.lm-media-preview-expand');
    const selectionBefore = editor.view.state.selection;
    const historyBefore = undoDepth(editor.view.state);
    const widgetCallsBeforeLanguageChange = {
      eq: eqSpy.mock.calls.length,
      toDOM: toDOMSpy.mock.calls.length,
    };

    expect(expand?.getAttribute('aria-label')).toBe('展开查看');
    expect(expand?.getAttribute('title')).toBe('展开查看');

    editor.setLanguage('en');

    expect({
      eq: eqSpy.mock.calls.length,
      toDOM: toDOMSpy.mock.calls.length,
    }).toEqual(widgetCallsBeforeLanguageChange);
    expect(expand?.getAttribute('aria-label')).toBe('Expand preview');
    expect(expand?.getAttribute('title')).toBe('Expand preview');
    expect(expand?.isConnected).toBe(true);
    expect(
      parent.querySelector<HTMLButtonElement>('[data-lm-media-preview-button]'),
    ).toBe(expand);
    expect(editor.view.state.doc.toString()).toBe(doc);
    expect(editor.view.state.selection.eq(selectionBefore)).toBe(true);
    expect(undoDepth(editor.view.state)).toBe(historyBefore);

    editor.destroy();
    parent.remove();
  });

  it('uses the initial editor language for media labels when global i18n differs', async () => {
    await i18n.changeLanguage('zh-CN');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'source',
      doc: '![Alt](data:image/png;base64,AA==)',
      extensions: [
        imagePreviewExtension({
          documentPath: null,
          onMediaPreviewRequest: vi.fn(),
        }),
      ],
      language: 'en',
      parent,
    });
    parent
      .querySelector<HTMLImageElement>('.lm-image-preview img')
      ?.dispatchEvent(new Event('load'));
    const expand = parent.querySelector<HTMLButtonElement>('.lm-media-preview-expand');

    expect(expand?.getAttribute('aria-label')).toBe('Expand preview');
    expect(expand?.getAttribute('title')).toBe('Expand preview');

    editor.destroy();
    parent.remove();
  });

  it('does not expose an expand action for loading or failed images', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '![Alt](data:image/png;base64,AA==)',
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: null,
            onMediaPreviewRequest: vi.fn(),
          }),
        ],
      }),
    });
    const image = parent.querySelector<HTMLImageElement>('.lm-image-preview img');

    expect(parent.querySelector('.lm-media-preview-expand')).toBeNull();
    image?.dispatchEvent(new Event('error'));
    expect(parent.querySelector('.lm-media-preview-expand')).toBeNull();

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
    expect(view.state.selection.main.head).toBe(2);

    view.destroy();
    parent.remove();
  });

  it.each([
    {
      name: 'opening',
      position: 0,
    },
    {
      name: 'closing',
      position: '![Alt](data:image/png;base64,AA==)'.length,
    },
  ])(
    'keeps a caret on the $name boundary outside the active image owner',
    ({ position }) => {
      const doc = '![Alt](data:image/png;base64,AA==)';
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
          selection: EditorSelection.cursor(position),
        }),
      });

      expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
      expect(parent.textContent).not.toContain(doc);

      view.destroy();
      parent.remove();
    },
  );

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

  it('keeps image DOM stable across inactive and active states', () => {
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
    const inactive = parent.querySelector('.lm-image-preview');

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('Alt')),
    });
    const active = parent.querySelector('.lm-image-preview');

    expect(active).not.toBeNull();
    expect(active).toBe(inactive);
    expect(inactive?.isConnected).toBe(true);

    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('after')),
    });
    const inactiveAgain = parent.querySelector('.lm-image-preview');

    expect(inactiveAgain).not.toBeNull();
    expect(inactiveAgain).toBe(active);
    expect(active?.isConnected).toBe(true);

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

  it('opens the resolved asset URL for a remotely cached image', async () => {
    const onMediaPreviewRequest = vi.fn();
    const resolver = vi.fn().mockResolvedValue({
      kind: 'resolved',
      src: 'asset://localhost/cache/pic.png',
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: '![Remote](https://example.com/pic.png)',
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: 'E:\\notes\\doc.md',
            imageAssetResolver: resolver,
            onMediaPreviewRequest,
          }),
        ],
      }),
    });

    await waitForMicrotasks();
    const image = parent.querySelector<HTMLImageElement>('.lm-image-preview img');
    image?.dispatchEvent(new Event('load'));
    parent.querySelector<HTMLButtonElement>('.lm-media-preview-expand')?.click();

    expect(onMediaPreviewRequest).toHaveBeenCalledWith({
      alt: 'Remote',
      kind: 'image',
      src: 'asset://localhost/cache/pic.png',
    });

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
    const onMediaPreviewRequest = vi.fn();
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
            onMediaPreviewRequest,
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
    const image = parent.querySelector<HTMLImageElement>('.lm-image-preview img');
    image?.dispatchEvent(new Event('load'));
    parent.querySelector<HTMLButtonElement>('.lm-media-preview-expand')?.click();
    expect(onMediaPreviewRequest).toHaveBeenCalledWith({
      alt: 'Remote',
      kind: 'image',
      src: 'asset://localhost/cache/pic.png',
    });

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
    const initialWidget = imageWidgets(view)[0];
    const changedRoot = initialImages[0].closest('.lm-image-preview');
    if (!(changedRoot instanceof HTMLElement)) {
      throw new Error('Expected changed image widget root.');
    }
    vi.spyOn(changedRoot, 'getBoundingClientRect').mockReturnValue({
      height: 240,
    } as DOMRect);
    initialImages[0].dispatchEvent(new Event('load'));
    await waitForMicrotasks();
    view.posAtCoords({ x: 0, y: 0 }, false);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(initialWidget.estimatedHeight).toBe(240);

    revisions.set('./assets/changed.png', 7);
    view.dispatch({
      effects: refreshImagePreviews.of('E:/notes/assets/changed.png'),
    });
    await waitForMicrotasks();

    const refreshedImages = [
      ...parent.querySelectorAll<HTMLImageElement>('.lm-image-preview img'),
    ];
    const refreshedWidget = imageWidgets(view)[0];
    expect(resolver).toHaveBeenCalledTimes(3);
    expect(view.state.doc.toString()).toBe(doc);
    expect(refreshedImages[0]).not.toBe(initialImages[0]);
    expect(refreshedImages[1]).toBe(initialImages[1]);
    expect(refreshedWidget).not.toBe(initialWidget);
    expect(refreshedWidget.estimatedHeight).toBe(240);

    view.destroy();
    parent.remove();
  });

  it('reuses discovered image blocks for selection-only updates without resyncing sources', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = ['![Alt](./assets/local.png)', '', 'after'].join('\n');
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

    syncLocalSources.mockClear();
    view.dispatch({
      selection: EditorSelection.cursor(doc.indexOf('Alt')),
    });

    expect(syncLocalSources).not.toHaveBeenCalled();
    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    expect(parent.textContent).toContain('![Alt](./assets/local.png)');

    view.destroy();
    parent.remove();
  });

  it('maps existing image previews across tail text edits without resyncing sources', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = [
      '![Alt](./assets/local.png)',
      '',
      'after ```inline```',
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
        selection: EditorSelection.cursor(doc.length),
      }),
    });
    const preview = parent.querySelector('.lm-image-preview');

    syncLocalSources.mockClear();
    view.dispatch({
      changes: { from: doc.length, insert: '!' },
      selection: EditorSelection.cursor(doc.length + 1),
    });

    expect(syncLocalSources).not.toHaveBeenCalled();
    expect(parent.querySelector('.lm-image-preview')).toBe(preview);
    expect(view.state.doc.toString()).toBe(`${doc}!`);

    view.destroy();
    parent.remove();
  });

  it('removes a cached image preview when an equal-length edit turns its parent into an HTML block', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = ['plain', '![Alt](./assets/local.png)'].join('\n');
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

    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    syncLocalSources.mockClear();

    view.dispatch({
      changes: { from: 0, to: 'plain'.length, insert: '<div>' },
    });

    expect(parent.querySelector('.lm-image-preview')).toBeNull();
    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: [],
    });

    view.destroy();
    parent.remove();
  });

  it('discovers an image preview when an equal-length edit turns an HTML block back into a paragraph', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = ['<div>', '![Alt](./assets/local.png)'].join('\n');
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

    expect(parent.querySelector('.lm-image-preview')).toBeNull();
    syncLocalSources.mockClear();

    view.dispatch({
      changes: { from: 0, to: '<div>'.length, insert: 'plain' },
    });

    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/local.png'],
    });

    view.destroy();
    parent.remove();
  });

  it('removes a cached image preview when an equal-length tag edit expands an HTML block', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = [
      '<script>',
      'x',
      '</script>',
      '![Alt](./x.png)',
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

    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    syncLocalSources.mockClear();

    view.dispatch({
      changes: { from: 0, to: '<script>'.length, insert: '<xcript>' },
    });

    expect(parent.querySelector('.lm-image-preview')).toBeNull();
    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: [],
    });

    view.destroy();
    parent.remove();
  });

  it('discovers an image preview when an equal-length tag edit contracts an HTML block', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = [
      '<xcript>',
      'x',
      '</script>',
      '![Alt](./x.png)',
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

    expect(parent.querySelector('.lm-image-preview')).toBeNull();
    syncLocalSources.mockClear();

    view.dispatch({
      changes: { from: 0, to: '<xcript>'.length, insert: '<script>' },
    });

    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./x.png'],
    });

    view.destroy();
    parent.remove();
  });

  it('rediscovers and syncs image sources when image markdown changes', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'after',
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({
            documentPath: 'E:\\notes\\doc.md',
            imageAssetResolver: resolver,
          }),
        ],
      }),
    });
    const createdDoc = ['![Alt](./one.png)', '', 'after'].join('\n');

    syncLocalSources.mockClear();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: createdDoc },
    });
    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./one.png'],
    });
    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();

    const sourceFrom = view.state.doc.toString().indexOf('./one.png');
    syncLocalSources.mockClear();
    view.dispatch({
      changes: {
        from: sourceFrom,
        to: sourceFrom + './one.png'.length,
        insert: './two.png',
      },
    });
    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./two.png'],
    });

    syncLocalSources.mockClear();
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.toString().indexOf('after'),
      },
    });
    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: [],
    });
    expect(parent.querySelector('.lm-image-preview')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('removes a cached image preview when an adjacent closing fence is invalidated', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = [
      '```text',
      'code',
      '```',
      '![Alt](./assets/local.png)',
    ].join('\n');
    const closingFenceFrom = doc.indexOf('```\n![Alt]');
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

    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();
    syncLocalSources.mockClear();
    view.dispatch({
      changes: {
        from: closingFenceFrom,
        to: closingFenceFrom + 3,
        insert: 'xxx',
      },
    });

    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: [],
    });
    expect(parent.querySelector('.lm-image-preview')).toBeNull();

    view.destroy();
    parent.remove();
  });

  it('discovers an image preview when an adjacent closing fence is restored', () => {
    const syncLocalSources = vi.fn();
    const resolver = Object.assign(
      vi.fn().mockResolvedValue({
        kind: 'resolved',
        src: 'asset://localhost/image.png',
      }),
      { syncLocalSources },
    );
    const doc = [
      '```text',
      'code',
      'xxx',
      '![Alt](./assets/local.png)',
    ].join('\n');
    const closingFenceFrom = doc.indexOf('xxx');
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

    expect(parent.querySelector('.lm-image-preview')).toBeNull();
    syncLocalSources.mockClear();
    view.dispatch({
      changes: {
        from: closingFenceFrom,
        to: closingFenceFrom + 3,
        insert: '```',
      },
    });

    expect(syncLocalSources).toHaveBeenCalledTimes(1);
    expect(syncLocalSources).toHaveBeenLastCalledWith({
      documentPath: 'E:\\notes\\doc.md',
      sources: ['./assets/local.png'],
    });
    expect(parent.querySelector('.lm-image-preview')).not.toBeNull();

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
