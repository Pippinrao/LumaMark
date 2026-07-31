import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorApi } from '../../editor/core/editorApi';
import type { LocalImageDrop } from '../../services/assets/localImageDrop';
import { useAppStore } from '../stores/appStore';
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
  });

  afterEach(() => {
    delete window.__LUMAMARK_E2E_ASSET_COMMANDS__;
    delete window.__LUMAMARK_E2E_FILE_WATCH__;
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    document.body.textContent = '';
  });

  it('keeps a stable display-mode toggle synchronized with the ready editor', () => {
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
    expect(result.current.editorDisplayMode).toBe('livePreview');
    expect(editor.getDisplayMode()).toBe('livePreview');

    act(() => {
      result.current.setDisplayMode('source');
    });

    expect(result.current.editorDisplayMode).toBe('source');
    expect(editor.getDisplayMode()).toBe('source');

    act(() => {
      toggleDisplayMode();
    });

    expect(result.current.editorDisplayMode).toBe('livePreview');
    expect(editor.getDisplayMode()).toBe('livePreview');

    unmount();
    editor.destroy();
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
