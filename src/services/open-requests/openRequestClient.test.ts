import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OPEN_REQUESTS_AVAILABLE_EVENT,
  createOpenRequestClient,
} from './openRequestClient';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauriMocks.listen,
}));

describe('openRequestClient', () => {
  afterEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.listen.mockReset();
  });

  it('maps recover, claim, record, acknowledge, abandon, and notifications to the lifecycle commands', async () => {
    const recovery = [{ requestId: '1', attemptToken: '4' }];
    const deliveries = [
      {
        attemptToken: '5',
        path: 'E:/notes/launch.md',
        requestId: '2',
      },
    ];
    tauriMocks.invoke
      .mockResolvedValueOnce(recovery)
      .mockResolvedValueOnce(deliveries)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const unlisten = vi.fn();
    const onAvailable = vi.fn();
    tauriMocks.listen.mockImplementation(
      async (
        _eventName: string,
        listener: (event: { payload: unknown }) => void,
      ) => {
        listener({ payload: null });
        return unlisten;
      },
    );
    const client = createOpenRequestClient();

    await expect(client.recover()).resolves.toEqual({
      data: recovery,
      ok: true,
    });
    await expect(client.claim()).resolves.toEqual({
      data: deliveries,
      ok: true,
    });
    await expect(
      client.recordApplied({ requestId: '2', attemptToken: '5' }),
    ).resolves.toEqual({ data: undefined, ok: true });
    await expect(
      client.acknowledge({ requestId: '2', attemptToken: '5' }),
    ).resolves.toEqual({ data: undefined, ok: true });
    await expect(
      client.abandon({ requestId: '2', attemptToken: '5' }),
    ).resolves.toEqual({ data: undefined, ok: true });
    const stopListening = await client.listen(onAvailable);

    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      1,
      'open_requests_recover',
      undefined,
    );
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      2,
      'open_requests_claim',
      undefined,
    );
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      3,
      'open_requests_record_applied',
      { attemptToken: '5', requestId: '2' },
    );
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      4,
      'open_requests_acknowledge',
      { attemptToken: '5', requestId: '2' },
    );
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      5,
      'open_requests_abandon',
      { attemptToken: '5', requestId: '2' },
    );
    expect(tauriMocks.listen).toHaveBeenCalledWith(
      OPEN_REQUESTS_AVAILABLE_EVENT,
      expect.any(Function),
    );
    expect(onAvailable).toHaveBeenCalledOnce();
    stopListening();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('preserves attempt tokens beyond the JavaScript safe integer range as opaque decimal strings', async () => {
    const recovery = [
      { attemptToken: '9007199254740993', requestId: '18446744073709551615' },
    ];
    tauriMocks.invoke.mockResolvedValueOnce(recovery);
    const client = createOpenRequestClient();

    await expect(client.recover()).resolves.toEqual({
      data: recovery,
      ok: true,
    });
  });

  it('rejects lifecycle DTOs with fields outside the exact camelCase contract', async () => {
    tauriMocks.invoke
      .mockResolvedValueOnce([
        {
          attemptToken: '1',
          attempt_token: '1',
          requestId: '1',
        },
      ])
      .mockResolvedValueOnce([
        {
          attemptToken: '2',
          owner: 'main',
          path: 'E:/notes/claim.md',
          requestId: '2',
        },
      ]);
    const client = createOpenRequestClient();

    await expect(client.recover()).resolves.toMatchObject({
      error: { code: 'desktop.open_request_invalid_response' },
      ok: false,
    });
    await expect(client.claim()).resolves.toMatchObject({
      error: { code: 'desktop.open_request_invalid_response' },
      ok: false,
    });
  });

  it.each([
    { attemptToken: 1, label: 'numeric' },
    { attemptToken: '01', label: 'non-canonical' },
    {
      attemptToken: '18446744073709551616',
      label: 'above-u64',
    },
  ])('rejects a $label attempt token', async ({ attemptToken }) => {
    tauriMocks.invoke.mockResolvedValueOnce([
      { attemptToken, requestId: '1' },
    ]);
    const client = createOpenRequestClient();

    await expect(client.recover()).resolves.toMatchObject({
      error: { code: 'desktop.open_request_invalid_response' },
      ok: false,
    });
  });

  it.each([
    { label: 'non-numeric', requestId: 'request-1' },
    { label: 'non-canonical', requestId: '01' },
    { label: 'numeric', requestId: 1 },
    { label: 'above-u64', requestId: '18446744073709551616' },
  ])('rejects a $label request id', async ({ requestId }) => {
    tauriMocks.invoke.mockResolvedValueOnce([
      { attemptToken: '1', requestId },
    ]);
    const client = createOpenRequestClient();

    await expect(client.recover()).resolves.toMatchObject({
      error: { code: 'desktop.open_request_invalid_response' },
      ok: false,
    });
  });

  it('fails closed for malformed lifecycle responses and ignores malformed notifications', async () => {
    tauriMocks.invoke
      .mockResolvedValueOnce([{ requestId: '', attemptToken: '-1' }])
      .mockResolvedValueOnce([
        { requestId: '1', path: '', attemptToken: '1.5' },
      ])
      .mockResolvedValueOnce({ unexpected: true });
    tauriMocks.listen.mockImplementation(
      async (
        _eventName: string,
        listener: (event: { payload: unknown }) => void,
      ) => {
        listener({ payload: { unexpected: true } });
        return () => undefined;
      },
    );
    const onAvailable = vi.fn();
    const client = createOpenRequestClient();

    await expect(client.recover()).resolves.toMatchObject({
      error: { code: 'desktop.open_request_invalid_response' },
      ok: false,
    });
    await expect(client.claim()).resolves.toMatchObject({
      error: { code: 'desktop.open_request_invalid_response' },
      ok: false,
    });
    await expect(
      client.recordApplied({ requestId: '1', attemptToken: '1' }),
    ).resolves.toMatchObject({
      error: { code: 'desktop.open_request_invalid_response' },
      ok: false,
    });
    await client.listen(onAvailable);

    expect(onAvailable).not.toHaveBeenCalled();
  });
});
