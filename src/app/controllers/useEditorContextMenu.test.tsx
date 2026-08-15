import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorContextTarget } from '../../editor/interaction';
import { createCommandShortcutLabels } from '../../features/commands/commandShortcuts';
import type { CommandMenuNode } from '../../features/commands/commandTypes';
import { useAppStore } from '../stores/appStore';
import {
  useEditorContextMenu,
  type EditorContextPayloadHandlers,
} from './useEditorContextMenu';

const openerMocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  revealPathInOs: vi.fn(),
}));

vi.mock('../../services/opener/openerCommands', () => openerMocks);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const shortcuts = createCommandShortcutLabels(
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
);
const editableState = {
  canFormat: true,
  canInsert: true,
  canRedo: false,
  canUndo: false,
  composing: false,
  eligibleFindSelection: false,
  readOnly: false,
  selectionCount: 1,
  selectionEmpty: true,
  selectionLength: 0,
} as const;

describe('useEditorContextMenu clipboard actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentFile: { name: 'note.md', path: 'E:\\notes\\note.md' },
      lastFileError: null,
    });
    installClipboard(undefined);
  });

  it.each([
    {
      errorCode: 'link.copy_failed',
      errorMessage: 'linkError.copyFailed',
      id: 'copy-link-address',
      target: {
        from: 0,
        href: 'https://example.com',
        kind: 'link',
        rawHref: 'https://example.com',
        to: 8,
      } satisfies EditorContextTarget,
    },
    {
      errorCode: 'image.copy_path_failed',
      errorMessage: 'imageError.copyPathFailed',
      id: 'copy-image-path',
      target: {
        from: 0,
        kind: 'image',
        src: './assets/cover.png',
        to: 27,
      } satisfies EditorContextTarget,
    },
  ])(
    'does not throw and reports $errorCode when the Clipboard API is absent',
    async ({ errorCode, errorMessage, id, target }) => {
      const { result } = renderHook(() =>
        useEditorContextMenu({
          editorAvailable: true,
          getEditState: () => ({
            ...editableState,
            clipboardReadAvailable: false,
            clipboardWriteAvailable: false,
          }),
          navigateLinkHref: vi.fn(),
          shortcuts,
        }),
      );
      const node = findItem(result.current.getContextMenuNodes(target), id);

      expect(node).toMatchObject({ disabled: true });
      expect(() => {
        act(() => {
          invokeClipboardPayload(result.current.payloadHandlers, node);
        });
      }).not.toThrow();
      await waitFor(() => {
        expect(useAppStore.getState().lastFileError).toMatchObject({
          code: errorCode,
          message: errorMessage,
          recoverable: true,
        });
      });
    },
  );

  it.each([
    {
      errorCode: 'link.copy_failed',
      errorMessage: 'linkError.copyFailed',
      id: 'copy-link-address',
      target: {
        from: 0,
        href: 'https://example.com',
        kind: 'link',
        rawHref: 'https://example.com',
        to: 8,
      } satisfies EditorContextTarget,
    },
    {
      errorCode: 'image.copy_path_failed',
      errorMessage: 'imageError.copyPathFailed',
      id: 'copy-image-path',
      target: {
        from: 0,
        kind: 'image',
        src: './assets/cover.png',
        to: 27,
      } satisfies EditorContextTarget,
    },
  ])(
    'reports the localized $errorCode failure when clipboard write is rejected',
    async ({ errorCode, errorMessage, id, target }) => {
      const writeText = vi.fn().mockRejectedValue(new Error('denied'));
      installClipboard({ writeText });
      const { result } = renderHook(() =>
        useEditorContextMenu({
          editorAvailable: true,
          getEditState: () => ({
            ...editableState,
            clipboardReadAvailable: false,
            clipboardWriteAvailable: true,
          }),
          navigateLinkHref: vi.fn(),
          shortcuts,
        }),
      );
      const node = findItem(result.current.getContextMenuNodes(target), id);

      act(() => {
        invokeClipboardPayload(result.current.payloadHandlers, node);
      });
      await waitFor(() => {
        expect(useAppStore.getState().lastFileError).toMatchObject({
          code: errorCode,
          message: errorMessage,
          recoverable: true,
        });
      });
      expect(writeText).toHaveBeenCalledOnce();
    },
  );

  it('keeps a newer successful link copy authoritative over an older late failure', async () => {
    const olderWrite = createDeferred<void>();
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => olderWrite.promise)
      .mockResolvedValueOnce(undefined);
    installClipboard({ writeText });
    useAppStore.getState().setLastFileError({
      code: 'link.copy_failed',
      message: 'linkError.copyFailed',
      recoverable: true,
    });
    const { result } = renderHook(() =>
      useEditorContextMenu({
        editorAvailable: true,
        getEditState: () => ({
          ...editableState,
          clipboardReadAvailable: false,
          clipboardWriteAvailable: true,
        }),
        navigateLinkHref: vi.fn(),
        shortcuts,
      }),
    );
    const target = {
      from: 0,
      href: 'https://example.com',
      kind: 'link',
      rawHref: 'https://example.com',
      to: 8,
    } satisfies EditorContextTarget;
    const node = findItem(
      result.current.getContextMenuNodes(target),
      'copy-link-address',
    );

    act(() => {
      invokeClipboardPayload(result.current.payloadHandlers, node);
      invokeClipboardPayload(result.current.payloadHandlers, node);
    });

    await waitFor(() => {
      expect(useAppStore.getState().lastFileError).toBeNull();
    });

    await act(async () => {
      olderWrite.reject(new Error('older denied'));
      await olderWrite.promise.catch(() => undefined);
    });

    expect(useAppStore.getState().lastFileError).toBeNull();
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});

describe('useEditorContextMenu link actions', () => {
  beforeEach(() => {
    openerMocks.openExternalUrl.mockReset();
    openerMocks.revealPathInOs.mockReset();
    useAppStore.setState({
      currentFile: { name: 'note.md', path: 'E:\\notes\\note.md' },
      lastFileError: null,
    });
  });

  it('routes open-link payloads through the shared navigation handler exactly once', async () => {
    const navigateLinkHref = vi.fn().mockResolvedValue({
      status: 'navigated',
      target: 'external',
    });
    const { result } = renderHook(() =>
      useEditorContextMenu({
        editorAvailable: true,
        getEditState: () => ({
          ...editableState,
          clipboardReadAvailable: false,
          clipboardWriteAvailable: false,
        }),
        navigateLinkHref,
        shortcuts,
      }),
    );

    act(() => {
      result.current.payloadHandlers.openLink({
        href: 'https://example.com',
      });
    });

    await waitFor(() => expect(navigateLinkHref).toHaveBeenCalledOnce());
    expect(navigateLinkHref).toHaveBeenCalledWith('https://example.com');
    expect(openerMocks.openExternalUrl).not.toHaveBeenCalled();
  });
});

function findItem(
  nodes: readonly CommandMenuNode[],
  id: string,
): Extract<CommandMenuNode, { type: 'item' }> | undefined {
  const node = nodes.find((candidate) => candidate.id === id);
  return node?.type === 'item' ? node : undefined;
}

function installClipboard(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: clipboard,
  });
}

function createDeferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function invokeClipboardPayload(
  handlers: EditorContextPayloadHandlers,
  node: Extract<CommandMenuNode, { type: 'item' }> | undefined,
): void {
  const invocation = node?.invocation;
  if (invocation?.kind !== 'payloadAction') {
    throw new Error('clipboard payload action missing');
  }

  switch (invocation.action) {
    case 'copyImagePath':
      handlers.copyImagePath(invocation.payload);
      return;
    case 'copyLinkAddress':
      handlers.copyLinkAddress(invocation.payload);
      return;
    default:
      throw new Error(`unexpected clipboard action: ${invocation.action}`);
  }
}
