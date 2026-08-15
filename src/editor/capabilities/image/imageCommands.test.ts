import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { createImageCommands, deleteImageReference } from './imageCommands';
import { refreshImagePreviews } from './imagePreviewExtension';

describe('image capability commands', () => {
  it('dispatches the public image preview refresh effect', () => {
    const dispatch = vi.fn();
    const commands = createImageCommands({ dispatch } as unknown as EditorView);

    expect(commands.refreshImages).toBeTypeOf('function');
    commands.refreshImages('E:/notes/pic.png');
    expect(dispatch).toHaveBeenCalledWith({
      effects: refreshImagePreviews.of('E:/notes/pic.png'),
    });
  });

  it('deletes only the image markdown syntax range in a single undoable transaction', () => {
    const source = [
      'before',
      '![keep](./keep.png)',
      '![remove](./remove.png "title")',
      'after',
    ].join('\n');
    const imageMarkdown = '![remove](./remove.png "title")';
    const from = source.indexOf(imageMarkdown);
    const to = from + imageMarkdown.length;
    const { parent, view } = createView(source, from + 3);

    expect(deleteImageReference(view, { from, to })).toBe(true);
    expect(view.state.doc.toString()).toBe(
      ['before', '![keep](./keep.png)', '', 'after'].join('\n'),
    );

    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
    parent.remove();
  });

  it('reports docChanged only for the deleted image range', () => {
    const source = 'prefix ![alt](./a.png) suffix';
    const from = source.indexOf('![alt]');
    const to = from + '![alt](./a.png)'.length;
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    let seen: {
      docChanged: boolean;
      fromA: number;
      toA: number;
      inserted: string;
    } | null = null;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          history(),
          markdownLanguage(),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            let fromA = -1;
            let toA = -1;
            let inserted = '';
            update.changes.iterChanges(
              (changeFromA, changeToA, _fromB, _toB, insert) => {
                fromA = changeFromA;
                toA = changeToA;
                inserted = insert.toString();
              },
            );
            seen = {
              docChanged: true,
              fromA,
              toA,
              inserted,
            };
          }),
        ],
        selection: EditorSelection.cursor(from + 2),
      }),
    });

    expect(deleteImageReference(view, { from, to })).toBe(true);
    expect(seen).toEqual({
      docChanged: true,
      fromA: from,
      toA: to,
      inserted: '',
    });
    expect(view.state.doc.toString()).toBe('prefix  suffix');

    view.destroy();
    parent.remove();
  });

  it('refuses to delete an image reference while read-only', () => {
    const source = 'before ![cover](./cover.png) after';
    const from = source.indexOf('![cover]');
    const to = from + '![cover](./cover.png)'.length;
    const { parent, view } = createView(source, from, true);

    expect(deleteImageReference(view, { from, to })).toBe(false);
    expect(view.state.doc.toString()).toBe(source);

    view.destroy();
    parent.remove();
  });
});

function createView(doc: string, selection: number, readOnly = false) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        markdownLanguage(),
        EditorState.readOnly.of(readOnly),
      ],
      selection: EditorSelection.cursor(selection),
    }),
  });

  return { parent, view };
}
