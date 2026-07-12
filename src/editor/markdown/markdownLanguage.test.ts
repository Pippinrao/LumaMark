import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage, markdownSyntaxHighlighting } from './markdownLanguage';

describe('markdown language', () => {
  it('highlights common fenced code block languages through CodeMirror language data', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ['```ts', 'const value = 1', '```'].join('\n'),
        extensions: [markdownLanguage(), markdownSyntaxHighlighting()],
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(parent.querySelector('.lm-code-token-keyword')?.textContent).toBe(
      'const',
    );

    view.destroy();
    parent.remove();
  });
});
