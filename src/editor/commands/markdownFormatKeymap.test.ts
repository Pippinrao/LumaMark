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
  it('publishes every Markdown shortcut advertised by the menu', () => {
    expect(markdownFormatKeymap.map((binding) => binding.key)).toEqual([
      'Mod-b',
      'Mod-i',
      'Mod-0',
      'Mod-1',
      'Mod-2',
      'Mod-3',
      'Mod-4',
      'Mod-5',
      'Mod-6',
      'Mod-Shift-k',
    ]);
  });

  it.each([
    ['Mod-b', 'text', '**text**'],
    ['Mod-i', 'text', '*text*'],
    ['Mod-0', '# text', 'text'],
    ['Mod-1', 'text', '# text'],
    ['Mod-2', 'text', '## text'],
    ['Mod-3', 'text', '### text'],
    ['Mod-4', 'text', '#### text'],
    ['Mod-5', 'text', '##### text'],
    ['Mod-6', 'text', '###### text'],
  ] as const)('executes %s through the Markdown command', (key, doc, expected) => {
    const binding = markdownFormatKeymap.find(
      (candidate) => candidate.key === key,
    );
    const view = createView(doc);

    expect(binding?.run?.(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(expected);
    view.destroy();
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
