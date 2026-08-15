import {
  invokeCommand,
  type CommandError,
  type CommandResult,
  type InvokeCommandFunction,
} from '../tauri/invokeCommand';
import type {
  ReadTextFileResult,
  WriteTextFileResult,
} from '../files/fileCommands';

export type DocumentClaimReservation =
  | { status: 'alreadyPending' }
  | { status: 'alreadyReleased' }
  | { status: 'alreadyOwned' }
  | { status: 'ownedBy'; windowLabel: string }
  | { status: 'reserved' };

export type DocumentClaimSessionStart = {
  sessionGeneration: number;
  status: 'alreadyActive' | 'began';
};

export type DocumentClaimSessionRelease = {
  releasedReservations: number;
  status: 'released';
};

export type DocumentClaimSessionTakeover =
  | { sessionGeneration: number; status: 'alreadyActive' }
  | {
      releasedReservations: number;
      sessionGeneration: number;
      status: 'takenOver';
    };

export type DocumentClaimCommit = {
  status: 'alreadyCommitted' | 'committed';
};

export type DocumentClaimRelease = {
  status: 'alreadyCommitted' | 'alreadyReleased' | 'released';
};

export type DocumentClaimOwnedRelease = {
  status: 'notOwned' | 'released';
};

export type DocumentWindowFocus = { status: 'focused' };

export type ReserveDocumentInput = {
  operationId: number;
  path: string;
};

export type DocumentClaimClient = {
  beginSession: () => Promise<CommandResult<DocumentClaimSessionStart>>;
  commitReservation: (
    operationId: number,
    path: string,
  ) => Promise<CommandResult<DocumentClaimCommit>>;
  focusWindow: (
    label: string,
  ) => Promise<CommandResult<DocumentWindowFocus>>;
  releaseOwnedDocument: (
    path: string,
  ) => Promise<CommandResult<DocumentClaimOwnedRelease>>;
  releaseReservation: (
    operationId: number,
    path: string,
  ) => Promise<CommandResult<DocumentClaimRelease>>;
  releaseSession: () => Promise<CommandResult<DocumentClaimSessionRelease>>;
  readTextClaimed: (
    operationId: number,
    path: string,
  ) => Promise<CommandResult<ReadTextFileResult>>;
  reserveDocument: (
    input: ReserveDocumentInput,
  ) => Promise<CommandResult<DocumentClaimReservation>>;
  takeoverSession: (
    expectedActiveGeneration: number,
  ) => Promise<CommandResult<DocumentClaimSessionTakeover>>;
  writeTextClaimed: (
    operationId: number,
    path: string,
    text: string,
  ) => Promise<CommandResult<WriteTextFileResult>>;
};

declare global {
  interface Window {
    __LUMAMARK_E2E_DOCUMENT_CLAIMS__?: DocumentClaimClient;
  }
}

type CreateDocumentClaimClientOptions = {
  invokeFn?: InvokeCommandFunction;
  sessionId?: string;
};

type ResolveDocumentClaimClientOptions = {
  allowBrowserClient?: boolean;
};

export function createDocumentClaimClient({
  invokeFn,
  sessionId = createSessionId(),
}: CreateDocumentClaimClientOptions = {}): DocumentClaimClient {
  const invokeParsed = async <T>(
    command: string,
    args: Record<string, unknown>,
    parse: (value: unknown) => T | null,
  ): Promise<CommandResult<T>> => {
    const result = await invokeCommand<unknown>(command, args, invokeFn);
    if (!result.ok) {
      return result;
    }

    const parsed = parse(result.data);
    return parsed
      ? { data: parsed, ok: true }
      : failure(
          'document_claim.invalid_response',
          'The document claim response was invalid.',
        );
  };

  const invokeOperation = <T>(
    command: string,
    operationId: number,
    path: string,
    parse: (value: unknown) => T | null,
  ): Promise<CommandResult<T>> => {
    if (!isOperationId(operationId)) {
      return Promise.resolve(
        failure(
          'document_claim.invalid_operation',
          'The document claim operation identifier was invalid.',
        ),
      );
    }
    return invokeParsed(
      command,
      { operationId, path, sessionId },
      parse,
    );
  };

  const invokeClaimedFileOperation = <T>(
    command: string,
    operationId: number,
    path: string,
    extraArgs?: Record<string, unknown>,
  ): Promise<CommandResult<T>> => {
    if (!isOperationId(operationId)) {
      return Promise.resolve(
        failure(
          'document_claim.invalid_operation',
          'The document claim operation identifier was invalid.',
        ),
      );
    }
    return invokeCommand<T>(
      command,
      { ...extraArgs, operationId, path, sessionId },
      invokeFn,
    );
  };

  return {
    beginSession: () =>
      invokeParsed(
        'document_claim_begin_session',
        { sessionId },
        parseSessionStart,
      ),
    commitReservation: (operationId, path) =>
      invokeOperation(
        'document_claim_commit',
        operationId,
        path,
        parseCommit,
      ),
    focusWindow: (label) =>
      invokeParsed(
        'desktop_focus_window',
        { targetWindowLabel: label },
        (value) => parseSimpleStatus(value, ['focused']),
      ),
    releaseOwnedDocument: (path) =>
      invokeParsed(
        'document_claim_release_owned',
        { path, sessionId },
        parseOwnedRelease,
      ),
    releaseReservation: (operationId, path) =>
      invokeOperation(
        'document_claim_release',
        operationId,
        path,
        parseRelease,
      ),
    releaseSession: () =>
      invokeParsed(
        'document_claim_release_session',
        { sessionId },
        parseSessionRelease,
      ),
    readTextClaimed: (operationId, path) =>
      invokeClaimedFileOperation<ReadTextFileResult>(
        'files_read_text_claimed',
        operationId,
        path,
      ),
    async reserveDocument({ operationId, path }) {
      return invokeOperation(
        'document_claim_reserve',
        operationId,
        path,
        parseReservation,
      );
    },
    takeoverSession: (expectedActiveGeneration) => {
      if (!isSessionGeneration(expectedActiveGeneration)) {
        return Promise.resolve(
          failure(
            'document_claim.invalid_session_generation',
            'The document claim session generation was invalid.',
          ),
        );
      }
      return invokeParsed(
        'document_claim_takeover_session',
        { expectedActiveGeneration, sessionId },
        parseSessionTakeover,
      );
    },
    writeTextClaimed: (operationId, path, text) =>
      invokeClaimedFileOperation<WriteTextFileResult>(
        'files_write_text_claimed',
        operationId,
        path,
        { text },
      ),
  };
}

const unavailableClient: DocumentClaimClient = {
  beginSession: unavailable,
  commitReservation: unavailable,
  focusWindow: unavailable,
  releaseOwnedDocument: unavailable,
  releaseReservation: unavailable,
  releaseSession: unavailable,
  readTextClaimed: unavailable,
  reserveDocument: unavailable,
  takeoverSession: unavailable,
  writeTextClaimed: unavailable,
};

let cachedNativeClient: DocumentClaimClient | null = null;

export function resolveDocumentClaimClient({
  allowBrowserClient = import.meta.env.DEV || import.meta.env.MODE === 'test',
}: ResolveDocumentClaimClientOptions = {}): DocumentClaimClient {
  if (
    allowBrowserClient &&
    typeof window !== 'undefined' &&
    window.__LUMAMARK_E2E_DOCUMENT_CLAIMS__
  ) {
    return window.__LUMAMARK_E2E_DOCUMENT_CLAIMS__;
  }

  if (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  ) {
    cachedNativeClient ??= createDocumentClaimClient();
    return cachedNativeClient;
  }

  return unavailableClient;
}

function isOperationId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function isSessionGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure document claim session identities are unavailable.');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

function parseSessionStart(value: unknown): DocumentClaimSessionStart | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['sessionGeneration', 'status']) ||
    (value.status !== 'began' && value.status !== 'alreadyActive') ||
    !isSessionGeneration(value.sessionGeneration as number)
  ) {
    return null;
  }
  return {
    sessionGeneration: value.sessionGeneration as number,
    status: value.status,
  };
}

function parseSessionRelease(value: unknown): DocumentClaimSessionRelease | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['releasedReservations', 'status'])) {
    return null;
  }
  if (
    value.status !== 'released' ||
    !Number.isSafeInteger(value.releasedReservations) ||
    (value.releasedReservations as number) < 0
  ) {
    return null;
  }
  return {
    releasedReservations: value.releasedReservations as number,
    status: 'released',
  };
}

function parseSessionTakeover(
  value: unknown,
): DocumentClaimSessionTakeover | null {
  if (!isRecord(value) || !isSessionGeneration(value.sessionGeneration as number)) {
    return null;
  }
  if (
    value.status === 'alreadyActive' &&
    hasOnlyKeys(value, ['sessionGeneration', 'status'])
  ) {
    return {
      sessionGeneration: value.sessionGeneration as number,
      status: 'alreadyActive',
    };
  }
  if (
    value.status !== 'takenOver' ||
    !hasOnlyKeys(value, [
      'releasedReservations',
      'sessionGeneration',
      'status',
    ]) ||
    !Number.isSafeInteger(value.releasedReservations) ||
    (value.releasedReservations as number) < 0
  ) {
    return null;
  }
  return {
    releasedReservations: value.releasedReservations as number,
    sessionGeneration: value.sessionGeneration as number,
    status: 'takenOver',
  };
}

function parseCommit(value: unknown): DocumentClaimCommit | null {
  return parseSimpleStatus(value, ['committed', 'alreadyCommitted'] as const);
}

function parseRelease(value: unknown): DocumentClaimRelease | null {
  return parseSimpleStatus(
    value,
    ['released', 'alreadyReleased', 'alreadyCommitted'] as const,
  );
}

function parseOwnedRelease(value: unknown): DocumentClaimOwnedRelease | null {
  return parseSimpleStatus(value, ['released', 'notOwned'] as const);
}

function parseReservation(value: unknown): DocumentClaimReservation | null {
  if (!isRecord(value)) {
    return null;
  }

  const simple = parseSimpleStatus(
    value,
    [
      'reserved',
      'alreadyPending',
      'alreadyReleased',
      'alreadyOwned',
    ] as const,
  );
  if (simple) {
    return simple;
  }
  if (
    hasOnlyKeys(value, ['status', 'windowLabel']) &&
    value.status === 'ownedBy' &&
    typeof value.windowLabel === 'string' &&
    value.windowLabel.trim().length > 0
  ) {
    return { status: 'ownedBy', windowLabel: value.windowLabel };
  }

  return null;
}

function parseSimpleStatus<TStatus extends string>(
  value: unknown,
  statuses: readonly TStatus[],
): { status: TStatus } | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['status']) ||
    typeof value.status !== 'string' ||
    !statuses.includes(value.status as TStatus)
  ) {
    return null;
  }
  return { status: value.status as TStatus };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function unavailable<T>(): Promise<CommandResult<T>> {
  return Promise.resolve(
    failure(
      'document_claim.unavailable',
      'Native document claim commands are unavailable.',
    ),
  );
}

function failure(
  code: string,
  message: string,
): { error: CommandError; ok: false } {
  return {
    error: { code, message, recoverable: false },
    ok: false,
  };
}
