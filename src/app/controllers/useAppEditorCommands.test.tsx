import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorApi } from '../../editor/core/editorApi';
import type { LocalImageDrop } from '../../services/assets/localImageDrop';
import { useAppStore } from '../stores/appStore';
import { useSettingsStore } from '../../features/settings/settingsStore';
import { createDefaultLumaMarkSettings } from '../../services/settings/settingsTypes';
import { useAppEditorCommands } from './useAppEditorCommands';

const nativeDropMocks = vi.hoisted(() => ({
  listener: undefined as ((drop: LocalImageDrop) => void) | undefined,
  subscribe: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock('../../services/assets/localImageDrop', () => ({
  subscribeToLocalImageDrops: nativeDropMocks.subscribe,
}));

describe('useAppEditorCommands', () => {
  beforeEach(() => {
    nativeDropMocks.listener = undefined;
    nativeDropMocks.subscribe.mockReset().mockImplementation(async (listener) => {
      nativeDropMocks.listener = listener;
      return nativeDropMocks.unlisten;
    });
    nativeDropMocks.unlisten.mockReset();
    useAppStore.setState({
      copyImagesToAssets: false,
      currentFile: { name: 'note.md', path: 'E:\\workspace\\notes\\note.md' },
      dirty: false,
      lastFileError: null,
    });
    useSettingsStore.setState({ settings: createDefaultLumaMarkSettings() });
  });

  afterEach(() => {
    delete window.__LUMAMARK_E2E_ASSET_COMMANDS__;
    delete window.__LUMAMARK_E2E_FILE_WATCH__;
    delete window.__LUMAMARK_E2E_FILE_COMMANDS__;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    document.body.textContent = '';
  });

  it('inserts every image selected by the file-menu picker through the local-image pipeline', async () => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(),
      showOpenDialog: vi.fn(),
      showOpenImageDialog: vi.fn().mockResolvedValue({
        ok: true,
        data: ['C:\\Pictures\\cover.png', 'C:\\Pictures\\世界地图.webp'],
      }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '', parent });
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => {
      result.current.onEditorReady(editor);
    });
    await act(async () => {
      await result.current.insertLocalImages();
    });

    expect(editor.getDocumentText()).toBe(
      '![cover.png](C:\\Pictures\\cover.png)\n![世界地图.webp](C:\\Pictures\\世界地图.webp)',
    );

    unmount();
    editor.destroy();
  });

  it('treats cancelling the local-image picker as a no-op', async () => {
    window.__LUMAMARK_E2E_FILE_COMMANDS__ = {
      readText: vi.fn(),
      showOpenDialog: vi.fn(),
      showOpenImageDialog: vi.fn().mockResolvedValue({ ok: true, data: null }),
      showSaveDialog: vi.fn(),
      writeText: vi.fn(),
    };
    const parent = document.createElement('div');
    const outside = document.createElement('button');
    document.body.appendChild(parent);
    document.body.appendChild(outside);
    const editor = createEditorApi({ doc: 'unchanged', parent });
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => result.current.onEditorReady(editor));
    outside.focus();
    await act(async () => {
      await result.current.insertLocalImages();
    });

    expect(editor.getDocumentText()).toBe('unchanged');
    expect(editor.view.hasFocus).toBe(true);
    expect(useAppStore.getState().lastFileError).toBeNull();
    unmount();
    editor.destroy();
    outside.remove();
  });

  it('keeps a stable display-mode toggle synchronized with the ready editor', () => {
    const settings = createDefaultLumaMarkSettings();
    settings.editor.defaultDisplayMode = 'source';
    useSettingsStore.setState({ settings });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      displayMode: 'source',
      doc: '# Display mode',
      parent,
    });
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => {
      result.current.onEditorReady(editor);
    });
    const toggleDisplayMode = result.current.toggleDisplayMode;

    expect(result.current.editorDisplayMode).toBe('source');
    expect(editor.getDisplayMode()).toBe('source');

    act(() => {
      result.current.toggleDisplayMode();
    });

    expect(result.current.toggleDisplayMode).toBe(toggleDisplayMode);
    expect(result.current.editorDisplayMode).toBe('reading');
    expect(editor.getDisplayMode()).toBe('reading');

    act(() => {
      result.current.setDisplayMode('source');
    });

    expect(result.current.editorDisplayMode).toBe('source');
    expect(editor.getDisplayMode()).toBe('source');

    act(() => {
      toggleDisplayMode();
    });

    expect(result.current.editorDisplayMode).toBe('reading');
    expect(editor.getDisplayMode()).toBe('reading');

    act(() => {
      toggleDisplayMode();
    });

    expect(result.current.editorDisplayMode).toBe('livePreview');
    expect(editor.getDisplayMode()).toBe('livePreview');

    unmount();
    editor.destroy();
  });

  it('queries edit command state on demand without mirroring selection in React state', () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'select me', parent });
    const { result, unmount } = renderHook(() => useAppEditorCommands());
    act(() => result.current.onEditorReady(editor));

    expect(result.current.getEditState()).toMatchObject({
      selectionEmpty: true,
    });

    act(() => {
      editor.view.dispatch({ selection: { anchor: 0, head: 6 } });
    });

    expect(result.current.getEditState()).toEqual({
      canFormat: true,
      canInsert: true,
      canRedo: false,
      canUndo: false,
      clipboardReadAvailable: true,
      clipboardWriteAvailable: true,
      composing: false,
      eligibleFindSelection: true,
      readOnly: false,
      selectionCount: 1,
      selectionEmpty: false,
      selectionLength: 6,
    });

    unmount();
    editor.destroy();
  });

  it('forwards deletion of the live editor selection without touching the clipboard', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn(), writeText },
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'delete me', parent });
    editor.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const { result, unmount } = renderHook(() => useAppEditorCommands());
    act(() => result.current.onEditorReady(editor));

    act(() => {
      expect(result.current.deleteSelection()).toBe(true);
    });

    expect(editor.getDocumentText()).toBe(' me');
    expect(writeText).not.toHaveBeenCalled();

    unmount();
    editor.destroy();
  });

  it('surfaces a localized clipboard error when cut cannot write the selection', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(),
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: 'select me', parent });
    editor.view.dispatch({ selection: { anchor: 0, head: 6 } });
    const { result, unmount } = renderHook(() => useAppEditorCommands());
    act(() => result.current.onEditorReady(editor));

    await act(async () => {
      await result.current.cut();
    });

    expect(editor.getDocumentText()).toBe('select me');
    expect(useAppStore.getState().lastFileError).toMatchObject({
      code: 'clipboard.cut_failed',
      message: '无法剪切所选内容。',
      recoverable: true,
    });

    unmount();
    editor.destroy();
  });

  it('surfaces a localized clipboard error when contextual table copy is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const tableText = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({
      doc: tableText,
      displayMode: 'source',
      parent,
    });
    const { result, unmount } = renderHook(() => useAppEditorCommands());
    act(() => result.current.onEditorReady(editor));

    await act(async () => {
      await result.current.copyTable({ from: 0, to: tableText.length });
    });

    expect(useAppStore.getState().lastFileError).toMatchObject({
      code: 'clipboard.copy_failed',
      message: '无法复制所选内容。',
      recoverable: true,
    });

    unmount();
    editor.destroy();
  });

  it('applies the configured default display mode to each ready editor instance without rebuilding it', () => {
    const settings = createDefaultLumaMarkSettings();
    settings.editor.defaultDisplayMode = 'source';
    useSettingsStore.setState({ settings });
    const parent = document.createElement('div');
    const strictModeParent = document.createElement('div');
    document.body.appendChild(parent);
    document.body.appendChild(strictModeParent);
    const editor = createEditorApi({ doc: '# Initial mode', parent });
    const strictModeReplacement = createEditorApi({
      doc: '# StrictMode replacement',
      parent: strictModeParent,
    });
    const viewBefore = editor.view;
    const replacementViewBefore = strictModeReplacement.view;
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => {
      result.current.onEditorReady(editor);
      result.current.onEditorReady(strictModeReplacement);
    });

    expect(editor.getDisplayMode()).toBe('source');
    expect(strictModeReplacement.getDisplayMode()).toBe('source');
    expect(result.current.editorDisplayMode).toBe('source');
    expect(editor.view).toBe(viewBefore);
    expect(strictModeReplacement.view).toBe(replacementViewBefore);

    unmount();
    editor.destroy();
    strictModeReplacement.destroy();
  });

  it('inserts native local image drops with their original paths by default', async () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '', parent });
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => {
      result.current.onEditorReady(editor);
    });
    await waitFor(() => {
      expect(nativeDropMocks.subscribe).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      nativeDropMocks.listener?.({
        paths: ['C:\\Users\\pippin\\Pictures\\魔法森林动漫.png'],
        position: { x: 0, y: 0 },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(editor.getDocumentText()).toBe(
        '![魔法森林动漫.png](C:\\Users\\pippin\\Pictures\\魔法森林动漫.png)',
      );
    });

    unmount();
    expect(nativeDropMocks.unlisten).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it('copies native local image drops after the user opts in', async () => {
    const copyLocalImage = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        markdownSource: 'note.assets/image-001.png',
        path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
      },
    });
    window.__LUMAMARK_E2E_ASSET_COMMANDS__ = { copyLocalImage };
    useAppStore.setState({ copyImagesToAssets: true });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '', parent });
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => {
      result.current.onEditorReady(editor);
    });
    await waitFor(() => {
      expect(nativeDropMocks.subscribe).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      nativeDropMocks.listener?.({
        paths: ['C:\\Pictures\\source.png'],
        position: { x: 0, y: 0 },
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(copyLocalImage).toHaveBeenCalledWith({
        documentPath: 'E:\\workspace\\notes\\note.md',
        sourcePath: 'C:\\Pictures\\source.png',
      });
      expect(editor.getDocumentText()).toBe(
        '![source.png](note.assets/image-001.png)',
      );
    });

    unmount();
    editor.destroy();
  });

  it('does not insert a copied image after the user switches documents', async () => {
    let resolveCopy:
      | ((value: {
          ok: true;
          data: { markdownSource: string; path: string };
        }) => void)
      | undefined;
    const copyLocalImage = vi.fn(
      () =>
        new Promise<{
          ok: true;
          data: { markdownSource: string; path: string };
        }>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    window.__LUMAMARK_E2E_ASSET_COMMANDS__ = { copyLocalImage };
    useAppStore.setState({ copyImagesToAssets: true });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '', parent });
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => {
      result.current.onEditorReady(editor);
    });
    await waitFor(() => {
      expect(nativeDropMocks.subscribe).toHaveBeenCalledTimes(1);
    });
    act(() => {
      nativeDropMocks.listener?.({
        paths: ['C:\\Pictures\\slow.png'],
        position: { x: 0, y: 0 },
      });
    });
    await waitFor(() => {
      expect(copyLocalImage).toHaveBeenCalledTimes(1);
    });

    useAppStore.setState({
      currentFile: { name: 'other.md', path: 'E:\\workspace\\notes\\other.md' },
    });
    await act(async () => {
      resolveCopy?.({
        ok: true,
        data: {
          markdownSource: 'note.assets/image-001.png',
          path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
        },
      });
      await Promise.resolve();
    });

    expect(editor.getDocumentText()).toBe('');

    unmount();
    editor.destroy();
  });

  it('does not apply a pending image copy after the controller unmounts', async () => {
    let resolveCopy:
      | ((value: {
          ok: true;
          data: { markdownSource: string; path: string };
        }) => void)
      | undefined;
    window.__LUMAMARK_E2E_ASSET_COMMANDS__ = {
      copyLocalImage: () =>
        new Promise((resolve) => {
          resolveCopy = resolve;
        }),
    };
    useAppStore.setState({ copyImagesToAssets: true });
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const editor = createEditorApi({ doc: '', parent });
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    act(() => {
      result.current.onEditorReady(editor);
    });
    await waitFor(() => {
      expect(nativeDropMocks.subscribe).toHaveBeenCalledTimes(1);
    });
    act(() => {
      nativeDropMocks.listener?.({
        paths: ['C:\\Pictures\\pending.png'],
        position: { x: 0, y: 0 },
      });
    });
    await waitFor(() => {
      expect(resolveCopy).toBeTypeOf('function');
    });

    unmount();
    await act(async () => {
      resolveCopy?.({
        ok: true,
        data: {
          markdownSource: 'note.assets/image-001.png',
          path: 'E:\\workspace\\notes\\note.assets\\image-001.png',
        },
      });
      await Promise.resolve();
    });

    expect(editor.getDocumentText()).toBe('');
    editor.destroy();
  });

  it('forwards local image source synchronization through the app resolver', () => {
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    expect(result.current.imageAssetResolver.syncLocalSources).toBeTypeOf(
      'function',
    );

    unmount();
  });

  it('surfaces local image watcher synchronization failures', async () => {
    window.__LUMAMARK_E2E_FILE_WATCH__ = {
      listen: async () => () => undefined,
      replaceLocalImageTargets: async () => ({
        ok: false,
        error: {
          code: 'file.watch_error',
          message: 'watcher unavailable',
          recoverable: true,
        },
      }),
      unwatchDocument: async () => ({ ok: true, data: undefined }),
      watchDocument: async () => ({ ok: true, data: undefined }),
    };
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    await result.current.imageAssetResolver.syncLocalSources?.({
      documentPath: 'E:\\workspace\\notes\\note.md',
      sources: ['./assets/pic.png'],
    });

    expect(useAppStore.getState().lastFileError?.code).toBe('file.watch_error');
    unmount();
  });

  it('adds the watcher revision to a refreshed local image without changing its source', async () => {
    const documentPath = 'E:\\workspace\\notes\\note.md';
    const source = './assets/pic.png';
    const imagePath = 'E:\\workspace\\notes\\assets\\pic.png';
    const authorizeLocalImage = vi.fn().mockResolvedValue({
      ok: true,
      data: imagePath,
    });
    window.__LUMAMARK_E2E_ASSET_COMMANDS__ = {
      authorizeLocalImage,
    };
    (window as Window & {
      __TAURI_INTERNALS__?: {
        convertFileSrc: (path: string) => string;
      };
    }).__TAURI_INTERNALS__ = {
      convertFileSrc: (path) => `asset://localhost/${path}?size=full#preview`,
    };
    const { result, unmount } = renderHook(() => useAppEditorCommands());

    await result.current.imageAssetResolver.syncLocalSources?.({
      documentPath,
      sources: [source],
    });
    const initial = await result.current.imageAssetResolver({
      documentPath,
      source,
    });

    act(() => {
      result.current.refreshLocalImage({ path: imagePath, revision: 7 });
    });
    const refreshed = await result.current.imageAssetResolver({
      documentPath,
      source,
    });

    expect(initial).toEqual({
      kind: 'resolved',
      src: `asset://localhost/${imagePath}?size=full#preview`,
    });
    expect(refreshed).toEqual({
      kind: 'resolved',
      src: `asset://localhost/${imagePath}?size=full&lmv=7#preview`,
    });
    expect(authorizeLocalImage).toHaveBeenCalledTimes(2);
    expect(source).toBe('./assets/pic.png');

    unmount();
  });
});
