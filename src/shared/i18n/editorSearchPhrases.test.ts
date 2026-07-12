import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { getEditorSearchPhrases } from './editorSearchPhrases';

describe('editor search phrases', () => {
  it('localizes the replace-all accessibility announcement', () => {
    const state = EditorState.create({
      extensions: [
        EditorState.phrases.of(getEditorSearchPhrases('zh-CN')),
      ],
    });

    expect(state.phrase('replaced $ matches', 3)).toBe(
      '已替换 3 处匹配',
    );
  });
});
