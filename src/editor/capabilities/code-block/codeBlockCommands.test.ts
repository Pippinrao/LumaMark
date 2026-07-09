import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../markdown/markdownLanguage';
import { wrapCodeBlockSelection } from './codeBlockCommands';
import {
  codeBlockSyntaxDecorationRange,
  collectCodeDecorations,
  collectInlineCodeDecorations,
} from './codeBlockDecorations';

describe('code block capability', () => {
  it('collects fenced and inline code decoration ranges', () => {
    const markdown = ['Intro `inline`', '', '```ts', 'const value = 1', '```'].join(
      '\n',
    );

    expect(collectInlineCodeDecorations(markdown)).toContainEqual({
      className: 'lm-md-inline-code',
      from: 6,
      kind: 'inlineCode',
      to: 14,
    });
    expect(collectCodeDecorations(markdown)).toContainEqual({
      className: 'lm-md-code-block',
      from: 16,
      kind: 'codeBlock',
      to: markdown.length,
    });
  });

  it('maps CodeMirror syntax nodes to code decoration ranges', () => {
    const state = EditorState.create({
      doc: ['```', 'x', '```'].join('\n'),
      extensions: [markdownLanguage()],
    });

    const range = codeBlockSyntaxDecorationRange({
      from: 0,
      name: 'FencedCode',
      to: state.doc.length,
    });

    expect(range).toEqual({
      className: 'lm-md-code-block',
      from: 0,
      kind: 'codeBlock',
      to: state.doc.length,
    });
  });

  it('wraps the selected text in a fenced code block', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      doc: 'console.log(1)',
      extensions: [markdownLanguage()],
      parent,
      selection: { anchor: 0, head: 14 },
    });

    wrapCodeBlockSelection(view);

    expect(view.state.doc.toString()).toBe('```\nconsole.log(1)\n```');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      'console.log(1)',
    );
    view.destroy();
    parent.remove();
  });
});

