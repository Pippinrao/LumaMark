import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { refreshImagePreviews } from './imagePreviewExtension';
import { createImageCommands } from './imageCommands';

describe('image capability commands', () => {
  it('dispatches the public image preview refresh effect', () => {
    const dispatch = vi.fn();
    const commands = createImageCommands({ dispatch } as unknown as EditorView);
    const refreshImages = (
      commands as typeof commands & { refreshImages?: (path: string) => void }
    ).refreshImages;

    expect(refreshImages).toBeTypeOf('function');
    refreshImages?.('E:/notes/pic.png');
    expect(dispatch).toHaveBeenCalledWith({
      effects: refreshImagePreviews.of('E:/notes/pic.png'),
    });
  });
});
