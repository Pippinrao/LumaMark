import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  OpenRequest,
  OpenRequestAttempt,
  OpenRequestClient,
} from '../../services/open-requests/openRequestClient';
import { useDesktopOpenRequests } from './useDesktopOpenRequests';

describe('useDesktopOpenRequests', () => {
  it('subscribes before recovering acknowledgements and claiming launch requests', async () => {
    const order: string[] = [];
    const client = createClient({
      claim: async () => {
        order.push('claim');
        return success([]);
      },
      listen: async () => {
        order.push('listen');
        return () => undefined;
      },
      recover: async () => {
        order.push('recover');
        return success([]);
      },
    });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() => {
      expect(order).toEqual(['listen', 'recover', 'claim']);
      expect(result.current.bootstrapComplete).toBe(true);
    });
  });

  it('opens, records, and acknowledges a request only once across duplicate claims and notifications', async () => {
    let notify: (() => void) | undefined;
    const delivery = request('1', '1', 'E:/notes/launch.md');
    const openDeferred = createDeferred<OpenedOutcome>();
    const openPath = vi.fn(() => openDeferred.promise);
    const client = createClient({
      claim: vi.fn(async () => success([delivery, delivery])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => expect(openPath).toHaveBeenCalledOnce());

    act(() => {
      notify?.();
      notify?.();
    });
    openDeferred.resolve(opened(delivery.path));

    await waitFor(() => {
      expect(client.recordApplied).toHaveBeenCalledOnce();
      expect(client.acknowledge).toHaveBeenCalledOnce();
    });
    expect(openPath).toHaveBeenCalledOnce();
    expect(client.recordApplied).toHaveBeenCalledWith(attempt(delivery));
    expect(client.acknowledge).toHaveBeenCalledWith(attempt(delivery));
  });

  it('retains a failed record operation and retries it before acknowledgement without reopening', async () => {
    let notify: (() => void) | undefined;
    const delivery = request('1', '1', 'E:/notes/launch.md');
    const recordApplied = vi
      .fn()
      .mockResolvedValueOnce(failure('desktop.open_request_record_failed'))
      .mockResolvedValueOnce(success(undefined));
    const client = createClient({
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([delivery]))
        .mockResolvedValue(success([])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
      recordApplied,
    });
    const openPath = vi.fn(async () => opened(delivery.path));
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => {
      expect(recordApplied).toHaveBeenCalledOnce();
      expect(result.current.error?.code).toBe(
        'desktop.open_request_record_failed',
      );
    });
    expect(client.acknowledge).not.toHaveBeenCalled();

    act(() => notify?.());

    await waitFor(() => {
      expect(recordApplied).toHaveBeenCalledTimes(2);
      expect(client.acknowledge).toHaveBeenCalledOnce();
    });
    expect(openPath).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it('retains a failed acknowledgement and resumes it without reopening', async () => {
    let notify: (() => void) | undefined;
    const delivery = request('1', '7', 'E:/notes/launch.md');
    const acknowledge = vi
      .fn()
      .mockResolvedValueOnce(failure('desktop.open_request_ack_failed'))
      .mockResolvedValueOnce(success(undefined));
    const client = createClient({
      acknowledge,
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([delivery]))
        .mockResolvedValue(success([])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
      recover: vi
        .fn()
        .mockResolvedValueOnce(success([]))
        .mockResolvedValueOnce(success([attempt(delivery)])),
    });
    const openPath = vi.fn(async () => opened(delivery.path));
    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => expect(acknowledge).toHaveBeenCalledOnce());

    act(() => notify?.());

    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
    expect(client.recordApplied).toHaveBeenCalledOnce();
    expect(openPath).toHaveBeenCalledOnce();
  });

  it('recovers an applied request after remount by acknowledging it without applying again', async () => {
    const delivery = request('1', '9', 'E:/notes/reload.md');
    const firstClient = createClient({
      acknowledge: vi.fn(async () =>
        failure('desktop.open_request_ack_failed'),
      ),
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([delivery]))
        .mockResolvedValue(success([])),
    });
    const firstOpenPath = vi.fn(async () => opened(delivery.path));
    const first = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client: firstClient, openPath: firstOpenPath }),
      ),
    );
    await waitFor(() =>
      expect(firstClient.acknowledge).toHaveBeenCalledOnce(),
    );
    first.unmount();

    const secondClient = createClient({
      recover: vi.fn(async () => success([attempt(delivery)])),
    });
    const secondOpenPath = vi.fn(async () => opened(delivery.path));
    renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client: secondClient, openPath: secondOpenPath }),
      ),
    );

    await waitFor(() =>
      expect(secondClient.acknowledge).toHaveBeenCalledWith(
        attempt(delivery),
      ),
    );
    expect(secondOpenPath).not.toHaveBeenCalled();
    expect(secondClient.recordApplied).not.toHaveBeenCalled();
  });

  it('does not re-record an in-flight apply after recovery reports that attempt as already applied', async () => {
    let notify: (() => void) | undefined;
    const delivery = request('1', '9', 'E:/notes/recovered.md');
    const pendingOpen = createDeferred<OpenedOutcome>();
    const onOpened = vi.fn();
    const client = createClient({
      acknowledge: vi.fn(async () =>
        failure('desktop.open_request_ack_failed'),
      ),
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([delivery]))
        .mockResolvedValue(success([])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
      recover: vi
        .fn()
        .mockResolvedValueOnce(success([]))
        .mockResolvedValueOnce(success([attempt(delivery)])),
    });
    renderHook(() =>
      useDesktopOpenRequests(
        createOptions({
          client,
          onOpened,
          openPath: vi.fn(() => pendingOpen.promise),
        }),
      ),
    );
    await waitFor(() => expect(client.claim).toHaveBeenCalledOnce());

    act(() => notify?.());
    await waitFor(() => expect(client.acknowledge).toHaveBeenCalledOnce());
    pendingOpen.resolve(opened(delivery.path));
    await act(async () => Promise.resolve());

    expect(onOpened).not.toHaveBeenCalled();
    expect(client.recordApplied).not.toHaveBeenCalled();
    expect(client.acknowledge).toHaveBeenCalledOnce();
  });

  it('fences a late outcome from an old attempt and applies only the current attempt', async () => {
    let notify: (() => void) | undefined;
    const oldDelivery = request('1', '1', 'E:/notes/old.md');
    const freshDelivery = request('1', '2', 'E:/notes/fresh.md');
    const oldOpen = createDeferred<OpenedOutcome>();
    const openPath = vi
      .fn()
      .mockReturnValueOnce(oldOpen.promise)
      .mockResolvedValueOnce(opened(freshDelivery.path));
    const onOpened = vi.fn();
    const client = createClient({
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([oldDelivery]))
        .mockResolvedValueOnce(success([freshDelivery]))
        .mockResolvedValue(success([])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, onOpened, openPath }),
      ),
    );
    await waitFor(() => expect(openPath).toHaveBeenCalledOnce());

    act(() => notify?.());
    await waitFor(() => expect(client.claim).toHaveBeenCalledTimes(2));
    oldOpen.resolve(opened(oldDelivery.path));

    await waitFor(() => expect(openPath).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.acknowledge).toHaveBeenCalledOnce());
    expect(onOpened).toHaveBeenCalledOnce();
    expect(onOpened).toHaveBeenCalledWith(freshDelivery.path);
    expect(client.recordApplied).toHaveBeenCalledWith(
      attempt(freshDelivery),
    );
    expect(client.recordApplied).not.toHaveBeenCalledWith(
      attempt(oldDelivery),
    );
    expect(client.acknowledge).not.toHaveBeenCalledWith(
      attempt(oldDelivery),
    );
  });

  it('adopts a later distinct opaque token without interpreting its numeric magnitude', async () => {
    let notify: (() => void) | undefined;
    const first = request('1', '9', 'E:/notes/first.md');
    const later = request('1', '1', 'E:/notes/later.md');
    const client = createClient({
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([first]))
        .mockResolvedValueOnce(success([later])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    const openPath = vi.fn(async (path: string) => opened(path));
    const { rerender } = renderHook(
      ({ editorReady }) =>
        useDesktopOpenRequests(
          createOptions({ client, editorReady, openPath }),
        ),
      { initialProps: { editorReady: false } },
    );
    await waitFor(() => expect(client.claim).toHaveBeenCalledOnce());

    act(() => notify?.());
    await waitFor(() => expect(client.claim).toHaveBeenCalledTimes(2));
    rerender({ editorReady: true });

    await waitFor(() => expect(openPath).toHaveBeenCalledOnce());
    expect(openPath).toHaveBeenCalledWith(later.path);
    expect(openPath).not.toHaveBeenCalledWith(first.path);
  });

  it('abandons a claim that resolves after its hook generation unmounts', async () => {
    const delivery = request(
      '3',
      '18446744073709551615',
      'E:/notes/late.md',
    );
    const claimDeferred =
      createDeferred<Awaited<ReturnType<OpenRequestClient['claim']>>>();
    const client = createClient({
      claim: vi.fn(() => claimDeferred.promise),
    });
    const openPath = vi.fn(async () => opened(delivery.path));
    const hook = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => expect(client.claim).toHaveBeenCalledOnce());

    hook.unmount();
    await act(async () => {
      claimDeferred.resolve(success([delivery, delivery]));
      await claimDeferred.promise;
    });

    await waitFor(() =>
      expect(client.abandon).toHaveBeenCalledWith(attempt(delivery)),
    );
    expect(client.abandon).toHaveBeenCalledOnce();
    expect(openPath).not.toHaveBeenCalled();
    expect(client.recordApplied).not.toHaveBeenCalled();
    expect(client.acknowledge).not.toHaveBeenCalled();
  });

  it('abandons an explicitly failed apply without recording or acknowledging it', async () => {
    const delivery = request('1', '1', 'E:/notes/missing.md');
    const onOpened = vi.fn();
    const openPath = vi.fn(async () => ({ status: 'failed' as const }));
    const client = createClient({
      claim: vi.fn(async () => success([delivery])),
    });
    renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, onOpened, openPath }),
      ),
    );

    await waitFor(() =>
      expect(client.abandon).toHaveBeenCalledWith(attempt(delivery)),
    );
    expect(onOpened).not.toHaveBeenCalled();
    expect(client.recordApplied).not.toHaveBeenCalled();
    expect(client.acknowledge).not.toHaveBeenCalled();
  });

  it('retries a failed abandon before the next claim without reopening', async () => {
    let notify: (() => void) | undefined;
    const order: string[] = [];
    const delivery = request(
      '4',
      '3',
      'E:/notes/retry-abandon.md',
    );
    const abandon = vi
      .fn<OpenRequestClient['abandon']>(async () => {
        order.push('abandon');
        return success(undefined);
      })
      .mockImplementationOnce(async () => {
        order.push('abandon');
        return failure('desktop.open_request_abandon_failed');
      });
    const claim = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('claim');
        return success([delivery]);
      })
      .mockImplementation(async () => {
        order.push('claim');
        return success([]);
      });
    const client = createClient({
      abandon,
      claim,
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
      recover: vi.fn(async () => {
        order.push('recover');
        return success([]);
      }),
    });
    const openPath = vi.fn(async () => ({ status: 'failed' as const }));
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => {
      expect(abandon).toHaveBeenCalledOnce();
      expect(result.current.error?.code).toBe(
        'desktop.open_request_abandon_failed',
      );
    });
    order.length = 0;

    act(() => notify?.());

    await waitFor(() => expect(abandon).toHaveBeenCalledTimes(2));
    expect(order).toEqual(['recover', 'abandon', 'claim']);
    expect(openPath).toHaveBeenCalledOnce();
  });

  it('retries a failed late-claim abandon in a later hook before claiming', async () => {
    const order: string[] = [];
    const delivery = request(
      '5',
      '4',
      'E:/notes/late-abandon.md',
    );
    const claimDeferred =
      createDeferred<Awaited<ReturnType<OpenRequestClient['claim']>>>();
    const abandon = vi
      .fn()
      .mockResolvedValueOnce(
        failure('desktop.open_request_abandon_failed'),
      )
      .mockImplementation(async () => {
        order.push('abandon');
        return success(undefined);
      });
    const claim = vi
      .fn()
      .mockImplementationOnce(() => claimDeferred.promise)
      .mockImplementation(async () => {
        order.push('claim');
        return success([]);
      });
    const recover = vi
      .fn()
      .mockResolvedValueOnce(success([]))
      .mockImplementation(async () => {
        order.push('recover');
        return success([]);
      });
    const client = createClient({
      abandon,
      claim,
      recover,
    });
    const firstHook = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );
    await waitFor(() => expect(claim).toHaveBeenCalledOnce());
    firstHook.unmount();
    await act(async () => {
      claimDeferred.resolve(success([delivery]));
      await claimDeferred.promise;
    });
    await waitFor(() => expect(abandon).toHaveBeenCalledOnce());

    order.length = 0;
    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() =>
      expect(abandon).toHaveBeenCalledWith(attempt(delivery)),
    );
    expect(abandon).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['recover', 'abandon', 'claim']);
  });

  it('drops a pending abandon retry when recovery reports the attempt as applied', async () => {
    const delivery = request(
      '6',
      '5',
      'E:/notes/applied-over-abandon.md',
    );
    const abandon = vi.fn(async () =>
      failure('desktop.open_request_abandon_failed'),
    );
    const acknowledge = vi.fn(async () =>
      failure('desktop.open_request_ack_failed'),
    );
    const client = createClient({
      abandon,
      acknowledge,
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([delivery]))
        .mockResolvedValue(success([])),
      recover: vi
        .fn()
        .mockResolvedValueOnce(success([]))
        .mockResolvedValue(success([attempt(delivery)])),
    });
    const firstHook = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({
          client,
          openPath: vi.fn(async () => ({ status: 'failed' as const })),
        }),
      ),
    );
    await waitFor(() => expect(abandon).toHaveBeenCalledOnce());
    firstHook.unmount();

    const secondOpenPath = vi.fn(async () => opened(delivery.path));
    renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, openPath: secondOpenPath }),
      ),
    );

    await waitFor(() => expect(client.claim).toHaveBeenCalledTimes(2));
    expect(acknowledge).toHaveBeenCalledWith(attempt(delivery));
    expect(abandon).toHaveBeenCalledOnce();
    expect(secondOpenPath).not.toHaveBeenCalled();
  });

  it('records and acknowledges a request routed to an existing window without reporting a local open', async () => {
    const delivery = request('1', '1', 'E:/notes/already-open.md');
    const onOpened = vi.fn();
    const openPath = vi.fn(async () => ({
      status: 'focused' as const,
      windowLabel: 'document-2',
    }));
    const client = createClient({
      claim: vi.fn(async () => success([delivery])),
    });
    renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, onOpened, openPath }),
      ),
    );

    await waitFor(() =>
      expect(client.acknowledge).toHaveBeenCalledWith(attempt(delivery)),
    );
    expect(onOpened).not.toHaveBeenCalled();
    expect(client.recordApplied).toHaveBeenCalledWith(attempt(delivery));
    expect(client.abandon).not.toHaveBeenCalled();
  });

  it('protects dirty content and abandons every claimed request when discard is cancelled', async () => {
    const first = request('1', '1', 'E:/notes/first.md');
    const second = request('2', '1', 'E:/notes/second.md');
    const client = createClient({
      claim: vi.fn(async () => success([first, second, first])),
    });
    const openPath = vi.fn();
    const { result } = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({ client, dirty: true, openPath }),
      ),
    );
    await waitFor(() =>
      expect(result.current.pendingRequest?.path).toBe(first.path),
    );

    act(() => result.current.cancelDiscard());

    await waitFor(() => expect(client.abandon).toHaveBeenCalledTimes(2));
    expect(client.abandon).toHaveBeenCalledWith(attempt(first));
    expect(client.abandon).toHaveBeenCalledWith(attempt(second));
    expect(result.current.pendingRequest).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
  });

  it('confirms only the request shown by the dirty-document prompt', async () => {
    const first = request('1', '1', 'E:/notes/first.md');
    const second = request('2', '1', 'E:/notes/second.md');
    const client = createClient({
      claim: vi.fn(async () => success([first, second])),
    });
    let dirty = true;
    const openPath = vi.fn(async (path: string) =>
      dirty ? ({ status: 'cancelled' as const }) : opened(path),
    );
    const openPathAfterDiscard = vi.fn(async (path: string) => {
      dirty = false;
      return opened(path);
    });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({
          client,
          dirty: true,
          openPath,
          openPathAfterDiscard,
        }),
      ),
    );
    await waitFor(() => expect(result.current.pendingRequest).not.toBeNull());

    act(() => result.current.confirmDiscard());

    await waitFor(() =>
      expect(openPathAfterDiscard).toHaveBeenCalledWith(first.path),
    );
    await waitFor(() =>
      expect(client.acknowledge).toHaveBeenCalledWith(attempt(first)),
    );
    expect(openPath).not.toHaveBeenCalled();
    expect(client.recordApplied).toHaveBeenCalledWith(attempt(first));
  });

  it('continues initial synchronization when event subscription fails', async () => {
    const client = createClient({
      listen: async () => {
        throw new Error('event bridge unavailable');
      },
    });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() => {
      expect(client.recover).toHaveBeenCalledOnce();
      expect(client.claim).toHaveBeenCalledOnce();
      expect(result.current.bootstrapComplete).toBe(true);
      expect(result.current.error?.code).toBe(
        'desktop.open_request_listener_unavailable',
      );
    });
  });

  it('retries a failed listener installation and synchronizes from the installed notification', async () => {
    let notify: (() => void) | undefined;
    const listen = vi
      .fn()
      .mockRejectedValueOnce(new Error('event bridge unavailable'))
      .mockImplementationOnce(async (listener: () => void) => {
        notify = listener;
        return () => undefined;
      });
    const client = createClient({ listen });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() =>
      expect(result.current.error?.code).toBe(
        'desktop.open_request_listener_unavailable',
      ),
    );

    act(() => result.current.retrySynchronization());

    await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(client.recover).toHaveBeenCalledTimes(2);

    act(() => notify?.());

    await waitFor(() => expect(client.recover).toHaveBeenCalledTimes(3));
  });

  it('installs a fresh listener when Strict Mode retires an unresolved listener generation', async () => {
    let notify: (() => void) | undefined;
    const staleListener = createDeferred<() => void>();
    const listen = vi
      .fn()
      .mockImplementationOnce(() => staleListener.promise)
      .mockImplementationOnce(async (listener: () => void) => {
        notify = listener;
        return () => undefined;
      });
    const client = createClient({ listen });
    renderHook(
      () => useDesktopOpenRequests(createOptions({ client })),
      { wrapper: StrictMode },
    );

    await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));
    staleListener.resolve(() => undefined);
    const recoverCount = client.recover.mock.calls.length;

    act(() => notify?.());

    await waitFor(() =>
      expect(client.recover.mock.calls.length).toBeGreaterThan(
        recoverCount,
      ),
    );
  });

  it('preserves a new listener error when listener retry fails but synchronization succeeds', async () => {
    const listen = vi
      .fn()
      .mockRejectedValueOnce(new Error('first listener failure'))
      .mockRejectedValueOnce(new Error('second listener failure'));
    const client = createClient({ listen });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() =>
      expect(result.current.error?.code).toBe(
        'desktop.open_request_listener_unavailable',
      ),
    );

    act(() => result.current.retrySynchronization());

    await waitFor(() => expect(listen).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(client.recover).toHaveBeenCalledTimes(2);
      expect(client.claim).toHaveBeenCalledTimes(2);
      expect(result.current.error?.code).toBe(
        'desktop.open_request_listener_unavailable',
      );
    });
  });

  it.each(['recover', 'claim'] as const)(
    'clears a resolved %s error after an event-driven synchronization succeeds',
    async (failedCommand) => {
      let notify: (() => void) | undefined;
      const recover = vi.fn<OpenRequestClient['recover']>(async () =>
        success([]),
      );
      const claim = vi.fn<OpenRequestClient['claim']>(async () =>
        success([]),
      );
      if (failedCommand === 'recover') {
        recover.mockResolvedValueOnce(
          failure('desktop.open_request_recover_failed'),
        );
      } else {
        claim.mockResolvedValueOnce(
          failure('desktop.open_request_claim_failed'),
        );
      }
      const client = createClient({
        claim,
        listen: async (listener) => {
          notify = listener;
          return () => undefined;
        },
        recover,
      });
      const { result } = renderHook(() =>
        useDesktopOpenRequests(createOptions({ client })),
      );

      await waitFor(() =>
        expect(result.current.error?.code).toBe(
          `desktop.open_request_${failedCommand}_failed`,
        ),
      );

      act(() => notify?.());

      await waitFor(() => expect(result.current.bootstrapComplete).toBe(true));
      await waitFor(() => expect(result.current.error).toBeNull());
    },
  );

  it('keeps a newer acknowledgement error when an earlier record retry succeeds', async () => {
    let notify: (() => void) | undefined;
    const delivery = request('ledger', '1', 'E:/notes/ledger.md');
    const recordApplied = vi
      .fn()
      .mockResolvedValueOnce(
        failure('desktop.open_request_record_failed'),
      )
      .mockResolvedValue(success(undefined));
    const acknowledge = vi.fn(async () =>
      failure('desktop.open_request_ack_failed'),
    );
    const client = createClient({
      acknowledge,
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([delivery]))
        .mockResolvedValue(success([])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
      recordApplied,
    });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(
        createOptions({
          client,
          openPath: vi.fn(async () => opened(delivery.path)),
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.error?.code).toBe(
        'desktop.open_request_record_failed',
      ),
    );

    act(() => notify?.());

    await waitFor(() => expect(acknowledge).toHaveBeenCalledOnce());
    expect(result.current.error?.code).toBe(
      'desktop.open_request_ack_failed',
    );
  });

  it('keeps bootstrap blocked until a later notification completes recovery and claim', async () => {
    let notify: (() => void) | undefined;
    const recover = vi
      .fn()
      .mockResolvedValueOnce(
        failure('desktop.open_request_queue_unavailable'),
      )
      .mockResolvedValueOnce(success([]));
    const client = createClient({
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
      recover,
    });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );
    await waitFor(() =>
      expect(result.current.error?.code).toBe(
        'desktop.open_request_queue_unavailable',
      ),
    );
    expect(result.current.bootstrapComplete).toBe(false);
    expect(client.claim).not.toHaveBeenCalled();

    act(() => notify?.());

    await waitFor(() => expect(result.current.bootstrapComplete).toBe(true));
    expect(client.claim).toHaveBeenCalledOnce();
  });

  it('lets the user retry a failed initial synchronization without waiting for another notification', async () => {
    const recover = vi
      .fn()
      .mockResolvedValueOnce(
        failure('desktop.open_request_queue_unavailable'),
      )
      .mockResolvedValueOnce(success([]));
    const client = createClient({ recover });
    const { result } = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client })),
    );

    await waitFor(() =>
      expect(result.current.error?.code).toBe(
        'desktop.open_request_queue_unavailable',
      ),
    );
    expect(result.current.bootstrapComplete).toBe(false);

    act(() => result.current.retrySynchronization());

    await waitFor(() => {
      expect(result.current.bootstrapComplete).toBe(true);
      expect(result.current.error).toBeNull();
    });
    expect(recover).toHaveBeenCalledTimes(2);
    expect(client.claim).toHaveBeenCalledOnce();
  });

  it('shares an in-flight open across unmount and remount for the same client and attempt', async () => {
    const delivery = request('remount-open', '1', 'E:/notes/remount.md');
    const pendingOpen = createDeferred<OpenedOutcome>();
    const openPath = vi.fn(() => pendingOpen.promise);
    const client = createClient({
      claim: vi.fn(async () => success([delivery])),
    });
    const first = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => expect(openPath).toHaveBeenCalledOnce());

    first.unmount();
    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );

    await waitFor(() => expect(client.claim).toHaveBeenCalledTimes(2));
    expect(openPath).toHaveBeenCalledOnce();

    pendingOpen.resolve(opened(delivery.path));

    await waitFor(() => expect(client.acknowledge).toHaveBeenCalledOnce());
    expect(client.recordApplied).toHaveBeenCalledOnce();
    expect(openPath).toHaveBeenCalledOnce();
  });

  it('resumes a failed record after remount without reopening the applied attempt', async () => {
    const delivery = request('remount-record', '1', 'E:/notes/applied.md');
    const recordApplied = vi
      .fn()
      .mockResolvedValueOnce(
        failure('desktop.open_request_record_failed'),
      )
      .mockResolvedValueOnce(success(undefined));
    const openPath = vi.fn(async () => opened(delivery.path));
    const client = createClient({
      claim: vi.fn(async () => success([delivery])),
      recordApplied,
    });
    const first = renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => expect(recordApplied).toHaveBeenCalledOnce());
    first.unmount();

    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );

    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.acknowledge).toHaveBeenCalledOnce());
    expect(openPath).toHaveBeenCalledOnce();
  });

  it('retargets an applied completion to a new opaque token without reopening', async () => {
    let notify: (() => void) | undefined;
    const first = request('retarget-applied', '9', 'E:/notes/applied.md');
    const renewed = request('retarget-applied', '1', first.path);
    const recordApplied = vi
      .fn()
      .mockResolvedValueOnce(
        failure('desktop.open_request_record_failed'),
      )
      .mockResolvedValueOnce(
        failure('desktop.open_request_record_failed'),
      )
      .mockResolvedValue(success(undefined));
    const openPath = vi.fn(async () => opened(first.path));
    const client = createClient({
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([first]))
        .mockResolvedValueOnce(success([renewed]))
        .mockResolvedValue(success([])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
      recordApplied,
    });
    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() => expect(recordApplied).toHaveBeenCalledOnce());

    act(() => notify?.());

    await waitFor(() =>
      expect(client.acknowledge).toHaveBeenCalledWith(attempt(renewed)),
    );
    expect(recordApplied).toHaveBeenCalledWith(attempt(renewed));
    expect(openPath).toHaveBeenCalledOnce();
  });

  it('releases terminal attempt state so a reused request id can be opened again', async () => {
    let notify: (() => void) | undefined;
    const first = request('reused-id', '1', 'E:/notes/first.md');
    const second = request('reused-id', '2', 'E:/notes/second.md');
    const client = createClient({
      claim: vi
        .fn()
        .mockResolvedValueOnce(success([first]))
        .mockResolvedValueOnce(success([second]))
        .mockResolvedValue(success([])),
      listen: async (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    const openPath = vi.fn(async (path: string) => opened(path));
    renderHook(() =>
      useDesktopOpenRequests(createOptions({ client, openPath })),
    );
    await waitFor(() =>
      expect(client.acknowledge).toHaveBeenCalledWith(attempt(first)),
    );

    act(() => notify?.());

    await waitFor(() =>
      expect(client.acknowledge).toHaveBeenCalledWith(attempt(second)),
    );
    expect(openPath).toHaveBeenCalledTimes(2);
  });
});

type OpenedOutcome = {
  file: { name: string; path: string };
  status: 'opened';
};

function request(
  requestId: string,
  attemptToken: string,
  path: string,
): OpenRequest {
  return { attemptToken, path, requestId };
}

function attempt(value: OpenRequest): OpenRequestAttempt {
  return {
    attemptToken: value.attemptToken,
    requestId: value.requestId,
  };
}

function opened(path: string): OpenedOutcome {
  return {
    file: { name: path.split('/').at(-1) ?? path, path },
    status: 'opened',
  };
}

function success<T>(data: T) {
  return { data, ok: true as const };
}

function failure(code: string) {
  return {
    error: { code, message: code, recoverable: true },
    ok: false as const,
  };
}

function createClient(
  overrides: Partial<OpenRequestClient> = {},
): OpenRequestClient & {
  abandon: ReturnType<typeof vi.fn>;
  acknowledge: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  recordApplied: ReturnType<typeof vi.fn>;
  recover: ReturnType<typeof vi.fn>;
} {
  return {
    abandon: vi.fn(async () => success(undefined)),
    acknowledge: vi.fn(async () => success(undefined)),
    claim: vi.fn(async () => success([])),
    listen: vi.fn(async () => () => undefined),
    recordApplied: vi.fn(async () => success(undefined)),
    recover: vi.fn(async () => success([])),
    ...overrides,
  } as OpenRequestClient & {
    abandon: ReturnType<typeof vi.fn>;
    acknowledge: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    recordApplied: ReturnType<typeof vi.fn>;
    recover: ReturnType<typeof vi.fn>;
  };
}

function createOptions({
  client,
  dirty = false,
  editorReady = true,
  onOpened = vi.fn(),
  openPath = vi.fn(async () => ({ status: 'failed' as const })),
  openPathAfterDiscard = openPath,
}: {
  client: OpenRequestClient;
  dirty?: boolean;
  editorReady?: boolean;
  onOpened?: (path: string) => void;
  openPath?: (path: string) => Promise<
    | OpenedOutcome
    | { status: 'focused'; windowLabel: string | null }
    | { status: 'cancelled' | 'failed' | 'superseded' }
  >;
  openPathAfterDiscard?: (path: string) => Promise<
    | OpenedOutcome
    | { status: 'focused'; windowLabel: string | null }
    | { status: 'cancelled' | 'failed' | 'superseded' }
  >;
}) {
  return {
    client,
    dirty,
    editorReady,
    onOpened,
    openPath,
    openPathAfterDiscard,
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
