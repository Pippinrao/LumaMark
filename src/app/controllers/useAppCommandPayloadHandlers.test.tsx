import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorContextPayloadHandlers } from './useEditorContextMenu';
import type { FileTreeContextPayloadHandlers } from './useFileTreeContextMenu';
import { useAppCommandPayloadHandlers } from './useAppCommandPayloadHandlers';

const editorHandlers: EditorContextPayloadHandlers = {
  copyImagePath: vi.fn(),
  copyLinkAddress: vi.fn(),
  openLink: vi.fn(),
  revealImage: vi.fn(),
};
const fileTreeHandlers: FileTreeContextPayloadHandlers = {
  fileTreeCopyPath: vi.fn(),
  fileTreeCreateDirectory: vi.fn(),
  fileTreeCreateFile: vi.fn(),
  fileTreeDelete: vi.fn(),
  fileTreeRename: vi.fn(),
  fileTreeReveal: vi.fn(),
};

describe('useAppCommandPayloadHandlers', () => {
  it('guards recent-file execution with the same file-opening policy as its surface', () => {
    const openRecentFile = vi.fn();
    const { result, rerender } = renderHook(
      ({ fileOpening }) =>
        useAppCommandPayloadHandlers(
          editorHandlers,
          fileTreeHandlers,
          openRecentFile,
          fileOpening,
        ),
      { initialProps: { fileOpening: true } },
    );

    act(() => result.current.openRecentFile({ path: 'E:/notes/one.md' }));
    expect(openRecentFile).not.toHaveBeenCalled();

    rerender({ fileOpening: false });
    act(() => result.current.openRecentFile({ path: 'E:/notes/one.md' }));
    expect(openRecentFile).toHaveBeenCalledWith('E:/notes/one.md');
  });
});
