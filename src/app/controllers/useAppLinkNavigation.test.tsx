import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/appStore';
import { useAppLinkNavigation } from './useAppLinkNavigation';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('useAppLinkNavigation', () => {
  beforeEach(() => {
    useAppStore.setState({
      currentFile: { name: 'note.md', path: 'C:\\notes\\note.md' },
      dirty: false,
      lastFileError: null,
    });
  });

  it('keeps one generation fence across rerenders while reading the latest ports', async () => {
    const firstReveal = vi.fn();
    const latestReveal = vi.fn();
    const openDocumentPath = vi.fn(async () => ({ status: 'failed' as const }));
    const { result, rerender } = renderHook(
      ({ revealPosition }: { revealPosition: (position: number) => void }) =>
        useAppLinkNavigation({
          awaitCurrentOutlineSnapshot: async () => ({
            headings: [
              {
                from: 42,
                id: 'target',
                level: 1 as const,
                line: 1,
                text: 'Target',
                to: 50,
              },
            ],
            revision: 1,
            status: 'current' as const,
          }),
          isOutlineCurrent: () => true,
          openDocumentPath,
          revealPosition,
          supersedePendingDocumentOpen: vi.fn(),
        }),
      { initialProps: { revealPosition: firstReveal } },
    );
    const stableHandler = result.current;

    rerender({ revealPosition: latestReveal });

    expect(result.current).toBe(stableHandler);
    await act(async () => {
      await result.current('#target');
    });
    expect(firstReveal).not.toHaveBeenCalled();
    expect(latestReveal).toHaveBeenCalledWith(42);
  });

  it('stores a localized recoverable error for a blocked link', async () => {
    const { result } = renderHook(() =>
      useAppLinkNavigation({
        awaitCurrentOutlineSnapshot: async () => ({ status: 'superseded' }),
        isOutlineCurrent: () => false,
        openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
        revealPosition: vi.fn(),
        supersedePendingDocumentOpen: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current('javascript:alert(1)');
    });

    expect(useAppStore.getState().lastFileError).toEqual({
      code: 'link.protocol_javascript',
      message: 'linkError.protocolJavascript',
      recoverable: true,
    });
  });

  it('reads the live dirty state and blocks a cross-document link before opening', async () => {
    const openDocumentPath = vi.fn(async () => ({ status: 'failed' as const }));
    const { result } = renderHook(() =>
      useAppLinkNavigation({
        awaitCurrentOutlineSnapshot: async () => ({ status: 'superseded' }),
        isOutlineCurrent: () => false,
        openDocumentPath,
        revealPosition: vi.fn(),
        supersedePendingDocumentOpen: vi.fn(),
      }),
    );
    useAppStore.setState({ dirty: true });

    await act(async () => {
      await result.current('./other.md');
    });

    expect(openDocumentPath).not.toHaveBeenCalled();
    expect(useAppStore.getState().lastFileError).toEqual({
      code: 'link.unsavedChanges',
      message: 'linkError.unsavedChanges',
      recoverable: true,
    });
  });

  it('clears its previous link error after a successful navigation', async () => {
    const { result } = renderHook(() =>
      useAppLinkNavigation({
        awaitCurrentOutlineSnapshot: async () => ({
          headings: [
            {
              from: 42,
              id: 'target',
              level: 1 as const,
              line: 1,
              text: 'Target',
              to: 50,
            },
          ],
          revision: 1,
          status: 'current' as const,
        }),
        isOutlineCurrent: () => true,
        openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
        revealPosition: vi.fn(),
        supersedePendingDocumentOpen: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current('javascript:alert(1)');
    });
    expect(useAppStore.getState().lastFileError?.code).toBe(
      'link.protocol_javascript',
    );

    await act(async () => {
      await result.current('#target');
    });

    expect(useAppStore.getState().lastFileError).toBeNull();
  });

  it('replaces an older link error with the new localized failure', async () => {
    useAppStore.getState().setLastFileError({
      code: 'link.fragmentUnavailable',
      message: 'old fragment error',
      recoverable: true,
    });
    const { result } = renderHook(() =>
      useAppLinkNavigation({
        awaitCurrentOutlineSnapshot: async () => ({ status: 'superseded' }),
        isOutlineCurrent: () => false,
        openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
        revealPosition: vi.fn(),
        supersedePendingDocumentOpen: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current('data:text/html,unsafe');
    });

    expect(useAppStore.getState().lastFileError).toEqual({
      code: 'link.protocol_data',
      message: 'linkError.protocolData',
      recoverable: true,
    });
  });

  it('invalidates a pending navigation when the hook unmounts', async () => {
    let release: (() => void) | undefined;
    const revealPosition = vi.fn();
    const supersedePendingDocumentOpen = vi.fn();
    const { result, unmount } = renderHook(() =>
      useAppLinkNavigation({
        awaitCurrentOutlineSnapshot: () =>
          new Promise((resolve) => {
            release = () => {
              resolve({
                headings: [
                  {
                    from: 42,
                    id: 'target',
                    level: 1 as const,
                    line: 1,
                    text: 'Target',
                    to: 50,
                  },
                ],
                revision: 1,
                status: 'current' as const,
              });
            };
          }),
        isOutlineCurrent: () => true,
        openDocumentPath: vi.fn(async () => ({ status: 'failed' as const })),
        revealPosition,
        supersedePendingDocumentOpen,
      }),
    );
    let pending: ReturnType<typeof result.current> | undefined;

    act(() => {
      pending = result.current('#target');
    });
    unmount();
    release?.();

    await expect(pending).resolves.toEqual({
      reason: 'superseded',
      status: 'notNavigated',
      target: 'fragment',
    });
    expect(revealPosition).not.toHaveBeenCalled();
    expect(supersedePendingDocumentOpen).toHaveBeenCalledTimes(2);
  });
});
