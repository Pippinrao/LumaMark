import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OpenRequestClient } from '../../services/open-requests/openRequestClient';
import { useDesktopOpenRequests } from './useDesktopOpenRequests';

describe('useDesktopOpenRequests', () => {
  it('subscribes before draining queued launch requests', async () => {
    const order: string[] = [];
    const client: OpenRequestClient = {
      drain: vi.fn(async () => {
        order.push('drain');
        return { ok: true as const, data: [] };
      }),
      listen: vi.fn(async () => {
        order.push('listen');
        return () => undefined;
      }),
    };

    renderHook(() => useDesktopOpenRequests(createOptions({ client })));

    await waitFor(() => {
      expect(order).toEqual(['listen', 'drain']);
    });
  });

  it('drains an event notification through the existing file workflow', async () => {
    let notify: (() => void) | undefined;
    const openPath = vi.fn(async () => ({
      file: { name: 'launch.md', path: 'E:/notes/launch.md' },
      status: 'opened' as const,
    }));
    const drain = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({
        ok: true as const,
        data: [{ path: 'E:/notes/launch.md' }],
      });
    const client: OpenRequestClient = {
      drain,
      listen: vi.fn(async (handler) => {
        notify = handler;
        return () => undefined;
      }),
    };

    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => {
      expect(drain).toHaveBeenCalledOnce();
    });

    act(() => {
      notify?.();
    });

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith('E:/notes/launch.md');
    });
  });

  it('protects a dirty document until the user confirms discard', async () => {
    const openPath = vi.fn(async () => ({
      file: { name: 'incoming.md', path: 'E:/notes/incoming.md' },
      status: 'opened' as const,
    }));
    const client: OpenRequestClient = {
      drain: vi.fn(async () => ({
        ok: true as const,
        data: [{ path: 'E:/notes/incoming.md' }],
      })),
      listen: vi.fn(async () => () => undefined),
    };
    const { result } = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, dirty: true, openPath }),
      ),
    );

    await waitFor(() => {
      expect(result.current.pendingRequest?.path).toBe(
        'E:/notes/incoming.md',
      );
    });
    expect(openPath).not.toHaveBeenCalled();

    act(() => {
      result.current.confirmDiscard();
    });

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith('E:/notes/incoming.md');
    });
  });

  it('still performs the initial drain when event subscription fails', async () => {
    const drain = vi.fn(async () => ({ ok: true as const, data: [] }));
    const client: OpenRequestClient = {
      drain,
      listen: vi.fn(async () => {
        throw new Error('event bridge unavailable');
      }),
    };
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() => {
      expect(drain).toHaveBeenCalledOnce();
      expect(result.current.bootstrapComplete).toBe(true);
      expect(result.current.error?.code).toBe(
        'desktop.open_request_listener_unavailable',
      );
    });
  });

  it.each([
    {
      drain: async () => ({
        error: {
          code: 'desktop.open_request_queue_unavailable',
          message: 'queue unavailable',
          recoverable: true,
        },
        ok: false as const,
      }),
      expectedCode: 'desktop.open_request_queue_unavailable',
      label: 'command failure',
    },
    {
      drain: async () => {
        throw new Error('IPC rejected');
      },
      expectedCode: 'desktop.open_request_drain_failed',
      label: 'rejected IPC promise',
    },
  ])('keeps bootstrap blocked and exposes a $label', async ({ drain, expectedCode }) => {
    const client: OpenRequestClient = {
      drain,
      listen: vi.fn(async () => () => undefined),
    };
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() => {
      expect(result.current.error?.code).toBe(expectedCode);
    });
    expect(result.current.bootstrapComplete).toBe(false);
  });

  it('serializes an event drain that races the initial drain', async () => {
    let notify: (() => void) | undefined;
    const initialDrain = createDeferred<{
      data: { path: string }[];
      ok: true;
    }>();
    const openPath = vi.fn(async (path: string) => ({
      file: { name: 'race.md', path },
      status: 'opened' as const,
    }));
    const drain = vi
      .fn()
      .mockReturnValueOnce(initialDrain.promise)
      .mockResolvedValueOnce({
        data: [{ path: 'E:/notes/race.md' }],
        ok: true as const,
      });
    const client: OpenRequestClient = {
      drain,
      listen: vi.fn(async (handler) => {
        notify = handler;
        return () => undefined;
      }),
    };
    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => expect(drain).toHaveBeenCalledOnce());

    act(() => notify?.());
    expect(drain).toHaveBeenCalledOnce();
    initialDrain.resolve({ data: [], ok: true });

    await waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(2);
      expect(openPath).toHaveBeenCalledWith('E:/notes/race.md');
    });
  });

  it('completes bootstrap after a later successful drain recovers the bridge', async () => {
    let notify: (() => void) | undefined;
    const drain = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'desktop.open_request_queue_unavailable',
          message: 'temporary failure',
          recoverable: true,
        },
        ok: false as const,
      })
      .mockResolvedValueOnce({ data: [], ok: true as const });
    const client: OpenRequestClient = {
      drain,
      listen: vi.fn(async (handler) => {
        notify = handler;
        return () => undefined;
      }),
    };
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => notify?.());

    await waitFor(() => {
      expect(result.current.bootstrapComplete).toBe(true);
    });
  });

  it('clears the pending item and all remaining local requests when discard is cancelled', async () => {
    const openPath = vi.fn();
    const client: OpenRequestClient = {
      drain: vi.fn(async () => ({
        data: [
          { path: 'E:/notes/first.md' },
          { path: 'E:/notes/second.md' },
        ],
        ok: true as const,
      })),
      listen: vi.fn(async () => () => undefined),
    };
    const { result } = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, dirty: true, openPath }),
      ),
    );
    await waitFor(() => {
      expect(result.current.pendingRequest?.path).toBe(
        'E:/notes/first.md',
      );
    });

    act(() => result.current.cancelDiscard());
    await act(async () => Promise.resolve());

    expect(result.current.pendingRequest).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
  });

  it('confirms only the request shown in the dirty-document prompt', async () => {
    const openPath = vi.fn(async (path: string) => ({
      file: { name: 'opened.md', path },
      status: 'opened' as const,
    }));
    const client: OpenRequestClient = {
      drain: vi.fn(async () => ({
        data: [
          { path: 'E:/notes/first.md' },
          { path: 'E:/notes/second.md' },
        ],
        ok: true as const,
      })),
      listen: vi.fn(async () => () => undefined),
    };
    const { result } = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, dirty: true, openPath }),
      ),
    );
    await waitFor(() => expect(result.current.pendingRequest).not.toBeNull());

    act(() => result.current.confirmDiscard());

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledTimes(1);
      expect(openPath).toHaveBeenCalledWith('E:/notes/first.md');
    });
  });

  it('does not report a failed open request as opened', async () => {
    const onOpened = vi.fn();
    const openPath = vi.fn(async () => ({ status: 'failed' as const }));
    const client: OpenRequestClient = {
      drain: vi.fn(async () => ({
        data: [{ path: 'E:/notes/missing.md' }],
        ok: true as const,
      })),
      listen: vi.fn(async () => () => undefined),
    };
    renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, onOpened, openPath }),
      ),
    );

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith('E:/notes/missing.md');
    });
    expect(onOpened).not.toHaveBeenCalled();
  });
});

function createOptions({
  client,
  dirty = false,
  onOpened = vi.fn(),
  openPath = vi.fn(async () => ({ status: 'failed' as const })),
}: {
  client: OpenRequestClient;
  dirty?: boolean;
  onOpened?: (path: string) => void;
  openPath?: (path: string) => Promise<
    | { file: { name: string; path: string }; status: 'opened' }
    | { status: 'cancelled' | 'failed' | 'superseded' }
  >;
}) {
  return {
    client,
    dirty,
    editorReady: true,
    onOpened,
    openPath,
    recoveryChecked: true,
    recoveryPending: false,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
