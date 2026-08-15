import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppCommandHandlers } from './useAppCommandHandlers';

describe('useAppCommandHandlers availability guard', () => {
  it('enforces the same read-only contract when an action bypasses menu disabled state', () => {
    let readOnly = true;
    const runFormat = vi.fn();
    const insertImage = vi.fn();
    const undo = vi.fn();
    const cut = vi.fn().mockResolvedValue(true);
    const paste = vi.fn().mockResolvedValue(true);
    const deleteImageReference = vi.fn();
    const deleteSelection = vi.fn(() => true);
    const deleteTable = vi.fn(() => true);
    const copy = vi.fn().mockResolvedValue(true);
    const copyTable = vi.fn().mockResolvedValue(true);
    const openSearch = vi.fn();
    const selectAll = vi.fn(() => true);
    const options = {
      checkForUpdates: vi.fn(),
      copy,
      copyTable,
      cut,
      deleteImageReference,
      deleteSelection,
      deleteTable,
      editorAvailable: true,
      exitFocusMode: vi.fn(),
      fileOpening: false,
      focusEditor: vi.fn(),
      getEditState: () => ({
        canFormat: true,
        canInsert: true,
        canRedo: true,
        canUndo: true,
        clipboardReadAvailable: true,
        clipboardWriteAvailable: true,
        composing: false,
        eligibleFindSelection: true,
        readOnly,
        selectionCount: 1,
        selectionEmpty: false,
        selectionLength: 4,
      }),
      insertImage,
      newDocument: vi.fn(),
      openAbout: vi.fn(),
      openCommandPalette: vi.fn(),
      openFile: vi.fn(),
      openSearch,
      openSettings: vi.fn(),
      openWorkspace: vi.fn(),
      paste,
      redo: vi.fn(),
      resetZoom: vi.fn(),
      runFormat,
      save: vi.fn(),
      saveAs: vi.fn(),
      selectAll,
      setLanguage: vi.fn(),
      setLivePreviewMode: vi.fn(),
      setReadingMode: vi.fn(),
      setSourceMode: vi.fn(),
      setTheme: vi.fn(),
      toggleDisplayMode: vi.fn(),
      toggleFocusMode: vi.fn(),
      toggleLanguage: vi.fn(),
      toggleSidebar: vi.fn(),
      toggleTheme: vi.fn(),
      undo,
    };
    const { result } = renderHook(() => useAppCommandHandlers(options));

    act(() => {
      result.current.bold();
      result.current.image();
      result.current.undo();
      result.current.cut();
      result.current.paste();
      result.current.deleteImageReference({ from: 0, to: 4 });
      result.current.deleteSelection();
      result.current.deleteTable({ from: 0, to: 4 });
    });

    expect(runFormat).not.toHaveBeenCalled();
    expect(insertImage).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(cut).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    expect(deleteImageReference).not.toHaveBeenCalled();
    expect(deleteSelection).not.toHaveBeenCalled();
    expect(deleteTable).not.toHaveBeenCalled();

    act(() => {
      result.current.copy();
      result.current.copyTable({ from: 0, to: 4 });
      result.current.openSearch();
      result.current.selectAll();
    });

    expect(copy).toHaveBeenCalledOnce();
    expect(copyTable).toHaveBeenCalledOnce();
    expect(openSearch).toHaveBeenCalledOnce();
    expect(selectAll).toHaveBeenCalledOnce();

    readOnly = false;
    act(() => {
      result.current.bold();
      result.current.image();
      result.current.deleteImageReference({ from: 0, to: 4 });
    });

    expect(runFormat).toHaveBeenCalledWith('bold');
    expect(insertImage).toHaveBeenCalledOnce();
    expect(deleteImageReference).toHaveBeenCalledWith({ from: 0, to: 4 });

    const composingHandlers = renderHook(() =>
      useAppCommandHandlers({
        ...options,
        getEditState: () => ({
          ...options.getEditState(),
          composing: true,
        }),
      }),
    );
    act(() => {
      composingHandlers.result.current.cut();
      composingHandlers.result.current.paste();
      composingHandlers.result.current.deleteSelection();
      composingHandlers.result.current.bold();
      composingHandlers.result.current.image();
      composingHandlers.result.current.copy();
      composingHandlers.result.current.selectAll();
      composingHandlers.result.current.openSearch();
    });
    expect(cut).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    expect(deleteSelection).not.toHaveBeenCalled();
    expect(runFormat).toHaveBeenCalledTimes(1);
    expect(insertImage).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledTimes(2);
    expect(selectAll).toHaveBeenCalledTimes(2);
    expect(openSearch).toHaveBeenCalledTimes(2);

    const fileOpeningHandlers = renderHook(() =>
      useAppCommandHandlers({ ...options, fileOpening: true }),
    );
    act(() => {
      fileOpeningHandlers.result.current.openFile();
      fileOpeningHandlers.result.current.openWorkspace();
      fileOpeningHandlers.result.current.save();
      fileOpeningHandlers.result.current.saveAs();
    });
    expect(options.openFile).not.toHaveBeenCalled();
    expect(options.openWorkspace).not.toHaveBeenCalled();
    expect(options.save).not.toHaveBeenCalled();
    expect(options.saveAs).not.toHaveBeenCalled();
  });
});
