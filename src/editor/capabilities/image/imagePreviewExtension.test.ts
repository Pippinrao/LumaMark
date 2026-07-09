import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import {
  collectImageBlocksInRanges,
  imagePreviewExtension,
  resolveMarkdownImageSource,
} from './imagePreviewExtension';

describe('image preview extension', () => {
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

  it('resolves remote absolute and relative image sources', () => {
    expect(
      resolveMarkdownImageSource({
        documentPath: 'E:\\workspace\\notes\\doc.md',
        source: './assets/pic.png',
      }),
    ).toEqual({
      kind: 'resolved',
      src: expect.stringContaining('assets'),
    });
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

  it('keeps image-only markdown editable on the active line', () => {
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

    expect(parent.querySelector('.lm-image-preview')).toBeNull();
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
});
