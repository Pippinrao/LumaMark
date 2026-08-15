import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';

import {
  invokeCommand,
  type CommandError,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';

export const OPEN_REQUESTS_AVAILABLE_EVENT =
  'desktop-open-requests-available';

export type OpenRequestAttempt = {
  attemptToken: string;
  requestId: string;
};

export type OpenRequest = OpenRequestAttempt & {
  path: string;
};

export type OpenRequestClient = {
  abandon: (
    attempt: OpenRequestAttempt,
  ) => Promise<CommandResult<void>>;
  acknowledge: (
    attempt: OpenRequestAttempt,
  ) => Promise<CommandResult<void>>;
  claim: () => Promise<CommandResult<OpenRequest[]>>;
  listen: (listener: () => void) => Promise<UnlistenFn>;
  recordApplied: (
    attempt: OpenRequestAttempt,
  ) => Promise<CommandResult<void>>;
  recover: () => Promise<CommandResult<OpenRequestAttempt[]>>;
};

type LegacyOpenRequestClient = {
  drain: () => Promise<CommandResult<Array<{ path: string }>>>;
  listen: (listener: () => void) => Promise<UnlistenFn>;
};

type ListenFunction = <T>(
  event: string,
  handler: (event: Event<T>) => void,
) => Promise<UnlistenFn>;

type CreateOpenRequestClientOptions = {
  invokeFn?: InvokeCommandFunction;
  listenFn?: ListenFunction;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_OPEN_REQUESTS__?:
      | LegacyOpenRequestClient
      | OpenRequestClient;
  }
}

export function createOpenRequestClient({
  invokeFn,
  listenFn = listen,
}: CreateOpenRequestClientOptions = {}): OpenRequestClient {
  return {
    abandon: (attempt) =>
      invokeUnit(
        'open_requests_abandon',
        lifecycleArguments(attempt),
        invokeFn,
      ),
    acknowledge: (attempt) =>
      invokeUnit(
        'open_requests_acknowledge',
        lifecycleArguments(attempt),
        invokeFn,
      ),
    claim: () =>
      invokeArray(
        'open_requests_claim',
        isOpenRequest,
        invokeFn,
      ),
    listen: (listener) =>
      listenFn<unknown>(OPEN_REQUESTS_AVAILABLE_EVENT, (event) => {
        if (event.payload === null || event.payload === undefined) {
          listener();
        }
      }),
    recordApplied: (attempt) =>
      invokeUnit(
        'open_requests_record_applied',
        lifecycleArguments(attempt),
        invokeFn,
      ),
    recover: () =>
      invokeArray(
        'open_requests_recover',
        isOpenRequestAttempt,
        invokeFn,
      ),
  };
}

const noopClient: OpenRequestClient = {
  abandon: async () => ({ data: undefined, ok: true }),
  acknowledge: async () => ({ data: undefined, ok: true }),
  claim: async () => ({ data: [], ok: true }),
  listen: async () => () => undefined,
  recordApplied: async () => ({ data: undefined, ok: true }),
  recover: async () => ({ data: [], ok: true }),
};

const tauriClient = createOpenRequestClient();

export function resolveOpenRequestClient(): OpenRequestClient {
  const injected =
    typeof window === 'undefined'
      ? undefined
      : window.__LUMAMARK_E2E_OPEN_REQUESTS__;

  if (import.meta.env.MODE === 'test') {
    return injected ? adaptInjectedClient(injected) : noopClient;
  }

  if (import.meta.env.DEV && injected) {
    return adaptInjectedClient(injected);
  }

  if (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  ) {
    return tauriClient;
  }

  return noopClient;
}

async function invokeArray<T>(
  command: string,
  isItem: (value: unknown) => value is T,
  invokeFn: InvokeCommandFunction | undefined,
): Promise<CommandResult<T[]>> {
  const result = await invokeCommand<unknown>(command, undefined, invokeFn);
  if (!result.ok) {
    return result;
  }
  if (!Array.isArray(result.data) || !result.data.every(isItem)) {
    return invalidResponse();
  }
  return { data: result.data, ok: true };
}

async function invokeUnit(
  command: string,
  args: Record<string, unknown>,
  invokeFn: InvokeCommandFunction | undefined,
): Promise<CommandResult<void>> {
  const result = await invokeCommand<unknown>(command, args, invokeFn);
  if (!result.ok) {
    return result;
  }
  if (result.data !== null && result.data !== undefined) {
    return invalidResponse();
  }
  return { data: undefined, ok: true };
}

function lifecycleArguments(
  attempt: OpenRequestAttempt,
): Record<string, unknown> {
  return {
    attemptToken: attempt.attemptToken,
    requestId: attempt.requestId,
  };
}

function isOpenRequestAttempt(
  value: unknown,
): value is OpenRequestAttempt {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const attempt = value as Record<string, unknown>;
  return (
    hasExactKeys(attempt, ['attemptToken', 'requestId']) &&
    hasValidAttemptFields(attempt)
  );
}

function hasValidAttemptFields(attempt: Record<string, unknown>): boolean {
  return (
    isCanonicalU64Decimal(attempt.requestId) &&
    isAttemptToken(attempt.attemptToken)
  );
}

const MAX_U64_DECIMAL = '18446744073709551615';

function isAttemptToken(value: unknown): value is string {
  return isCanonicalU64Decimal(value);
}

function isCanonicalU64Decimal(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    return false;
  }

  return (
    value.length < MAX_U64_DECIMAL.length ||
    (value.length === MAX_U64_DECIMAL.length && value <= MAX_U64_DECIMAL)
  );
}

function isOpenRequest(value: unknown): value is OpenRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (
    hasExactKeys(request, ['attemptToken', 'path', 'requestId']) &&
    hasValidAttemptFields(request) &&
    typeof request.path === 'string' &&
    request.path.trim().length > 0
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function invalidResponse(): { error: CommandError; ok: false } {
  return {
    error: {
      code: 'desktop.open_request_invalid_response',
      message: 'Desktop open requests returned an invalid response.',
      recoverable: true,
    },
    ok: false,
  };
}

function adaptInjectedClient(
  client: LegacyOpenRequestClient | OpenRequestClient,
): OpenRequestClient {
  if ('recover' in client) {
    return client;
  }

  let sequence = 0;
  return {
    abandon: async () => ({ data: undefined, ok: true }),
    acknowledge: async () => ({ data: undefined, ok: true }),
    async claim() {
      const result = await client.drain();
      if (!result.ok) {
        return result;
      }
      return {
        data: result.data.map(({ path }) => ({
          attemptToken: '0',
          path,
          requestId: String(sequence++),
        })),
        ok: true,
      };
    },
    listen: client.listen,
    recordApplied: async () => ({ data: undefined, ok: true }),
    recover: async () => ({ data: [], ok: true }),
  };
}
