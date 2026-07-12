import { EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import {
  imageInputTrackingExtension,
  imageMarkdown,
  invalidatePendingImageImports,
  importFiles,
} from './imageInputExtension';

function imageFile(name: string): File {
  return {
    arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
    name,
    type: 'image/png',
  } as File;
}

describe('image input extension', () => {
  it('preserves drop order and emits one standalone markdown line per imported image', () => {
    expect(
      imageMarkdown([
        { alt: 'first.png', markdownSource: 'note.assets/image-001.png' },
        { alt: 'second.jpg', markdownSource: 'note.assets/image-002.jpg' },
      ]),
    ).toBe(
      '![first.png](note.assets/image-001.png)\n![second.jpg](note.assets/image-002.jpg)',
    );
  });

  it('emits valid markdown for image names and paths with special characters', () => {
    expect(
      imageMarkdown([
        {
          alt: 'a]b.png',
          markdownSource: 'C:\\Pictures\\summer (1)\\a]b.png',
        },
      ]),
    ).toBe('![a\\]b.png](<C:\\Pictures\\summer (1)\\a]b.png>)');
  });

  it('serializes imports and inserts at the selection captured before async work', async () => {
    let resolveFirst: ((value: { markdownSource: string }) => void) | undefined;
    const handler = vi.fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ markdownSource: string }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ markdownSource: 'note.assets/image-002.png' });
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'original',
        extensions: [imageInputTrackingExtension],
        selection: EditorSelection.cursor(0),
      }),
    });

    const task = importFiles(
      view,
      [imageFile('first.png'), imageFile('second.png')],
      handler,
      'E:\\notes\\note.md',
    );
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    resolveFirst?.({ markdownSource: 'note.assets/image-001.png' });
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(2);
    await task;

    expect(view.state.doc.toString()).toBe(
      '![first.png](note.assets/image-001.png)\n' +
        '![second.png](note.assets/image-002.png)original',
    );
    view.destroy();
  });

  it('maps the pending insertion point when the same document changes', async () => {
    let resolveImport: ((value: { markdownSource: string }) => void) | undefined;
    const handler = vi.fn(
      () =>
        new Promise<{ markdownSource: string }>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'first document',
        extensions: [imageInputTrackingExtension],
      }),
    });

    const task = importFiles(
      view,
      [imageFile('late.png')],
      handler,
      'E:\\notes\\first.md',
    );
    await Promise.resolve();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'second document' },
    });
    resolveImport?.({ markdownSource: 'first.assets/image-001.png' });
    await task;

    expect(view.state.doc.toString()).toBe(
      '![late.png](first.assets/image-001.png)second document',
    );
    view.destroy();
  });

  it('discards a pending result only after the image capability is reconfigured away', async () => {
    let resolveImport: ((value: { markdownSource: string }) => void) | undefined;
    const handler = vi.fn(
      () =>
        new Promise<{ markdownSource: string }>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const parent = document.createElement('div');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'old document',
        extensions: [imageInputTrackingExtension],
      }),
    });

    const task = importFiles(
      view,
      [imageFile('late.png')],
      handler,
      'E:\\notes\\old.md',
    );
    await Promise.resolve();
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'new document' },
      effects: [
        invalidatePendingImageImports.of(null),
        StateEffect.reconfigure.of([]),
      ],
    });
    resolveImport?.({ markdownSource: 'old.assets/image-001.png' });
    await task;

    expect(view.state.doc.toString()).toBe('new document');
    view.destroy();
  });
});
