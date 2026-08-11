import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  codeLanguageDisplayName,
  markdownLanguage,
  markdownSyntaxHighlighting,
} from './markdownLanguage';

describe('markdown language', () => {
  it.each([
    ['ts', 'TypeScript'],
    ['TypeScript linenos=true', 'TypeScript'],
    ['bash', 'Shell'],
    ['JS', 'JavaScript'],
    ['MyDSL option=value', 'MyDSL'],
    ['typescript-custom option=1', 'typescript-custom'],
    ['myjavascriptdsl', 'myjavascriptdsl'],
    ['shellscript', 'shellscript'],
    ['jsx-extra', 'jsx-extra'],
    ['   ', null],
  ])('derives a stable display name from info %j', (info, expected) => {
    expect(codeLanguageDisplayName(info)).toBe(expected);
  });

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

  it('does not highlight unknown info strings that merely contain a known language name', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ['```myjavascriptdsl', 'const value = 1', '```'].join('\n'),
        extensions: [markdownLanguage(), markdownSyntaxHighlighting()],
      }),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(parent.querySelector('.lm-code-token-keyword')).toBeNull();

    view.destroy();
    parent.remove();
  });
});
