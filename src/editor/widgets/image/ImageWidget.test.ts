import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import {
  collectImageBlocksInRanges,
  imagePreviewExtension,
  resolveMarkdownImageSource,
} from './ImageWidget';

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
        source: './assets/pic.png',
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
});
