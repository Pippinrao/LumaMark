import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownFormatKeymap } from './markdownFormatKeymap';

const parents: HTMLElement[] = [];

afterEach(() => {
  for (const parent of parents.splice(0)) {
    parent.remove();
  }
});

describe('markdownFormatKeymap', () => {
  it('publishes paragraph and code-block bindings beside heading bindings', () => {
    expect(markdownFormatKeymap.map((binding) => binding.key)).toEqual(
      expect.arrayContaining([
        'Mod-0',
        'Mod-1',
        'Mod-6',
        'Mod-Shift-k',
      ]),
    );
  });

  it('executes the code-block binding through the Markdown command', () => {
    const binding = markdownFormatKeymap.find(
      (candidate) => candidate.key === 'Mod-Shift-k',
    );
    const view = createView('code');

    expect(binding?.run?.(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('```\ncode\n```');
    view.destroy();
  });
});

function createView(doc: string): EditorView {
  const parent = document.createElement('div');
  parents.push(parent);
  document.body.append(parent);

  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
    }),
  });
}
