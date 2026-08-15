import {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';

import type { OpenDocumentOutcome } from '../../features/file-actions/useFileWorkflow';
import {
  resolveOpenRequestClient,
  type OpenRequest,
  type OpenRequestAttempt,
  type OpenRequestClient,
} from '../../services/open-requests/openRequestClient';
import type {
  CommandError,
  CommandResult,
} from '../../services/tauri/invokeCommand';

export type UseDesktopOpenRequestsOptions = {
  client?: OpenRequestClient;
  dirty: boolean;
  editorReady: boolean;
  onOpened: (path: string) => void;
  openPath: (path: string) => Promise<OpenDocumentOutcome>;
  openPathAfterDiscard: (path: string) => Promise<OpenDocumentOutcome>;
  recoveryChecked: boolean;
  recoveryPending: boolean;
};

export type DesktopOpenRequests = {
  blocksSessionRestore: boolean;
  bootstrapComplete: boolean;
  cancelDiscard: () => void;
  confirmDiscard: () => void;
  dismissError: () => void;
  error: CommandError | null;
  pendingRequest: OpenRequest | null;
  retrySynchronization: () => void;
};

type CompletionEntry = {
  attempt: OpenRequestAttempt;
  stage: 'acknowledge' | 'record';
};

type AttemptAdoption = 'accepted' | 'rejected' | 'retargeted';

type ErrorTicket = {
  revision: number;
  source: string;
};

type ErrorEntry = ErrorTicket & {
  error: CommandError;
  order: number;
};

type OpenRequestRuntimeSnapshot = {
  blocksSessionRestore: boolean;
  bootstrapComplete: boolean;
  error: CommandError | null;
  pendingRequest: OpenRequest | null;
  revision: number;
};

type ListenerRegistration = {
  generation: number;
  promise: Promise<boolean>;
};

type OpenRequestRuntime = {
  abandonmentChain: Promise<void>;
  active: OpenRequest | null;
  appliedAttempts: Set<string>;
  blocksSessionRestore: boolean;
  bootstrapComplete: boolean;
  bridgeChain: Promise<void>;
  client: OpenRequestClient;
  completions: Map<string, CompletionEntry>;
  currentAttempts: Map<string, string>;
  errorEntries: Map<string, ErrorEntry>;
  errorOrder: number;
  errorRevision: number;
  latestOptions: UseDesktopOpenRequestsOptions | null;
  pendingAbandonments: Map<string, OpenRequestAttempt>;
  pending: OpenRequest | null;
  processing: boolean;
  queue: OpenRequest[];
  seenClaims: Set<string>;
  sourceRevisions: Map<string, number>;
  stateRevision: number;
  subscribers: Set<() => void>;
  snapshot: OpenRequestRuntimeSnapshot;
  terminalAttempts: Map<string, string>;
};

const openRequestRuntimes = new WeakMap<
  OpenRequestClient,
  OpenRequestRuntime
>();

const initialRuntimeSnapshot: OpenRequestRuntimeSnapshot = {
  blocksSessionRestore: false,
  bootstrapComplete: false,
  error: null,
  pendingRequest: null,
  revision: 0,
};

export function useDesktopOpenRequests(
  options: UseDesktopOpenRequestsOptions,
): DesktopOpenRequests {
  const runtimeRef = useRef<OpenRequestRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = getOpenRequestRuntime(
      options.client ?? resolveOpenRequestClient(),
    );
  }
  const optionsRef = useRef(options);
  const mountedRef = useRef(true);
  const effectGenerationRef = useRef(0);
  const listenerRef = useRef<(() => void) | null>(null);
  const listenerRegistrationRef =
    useRef<ListenerRegistration | null>(null);

  const readRuntime = useCallback((): OpenRequestRuntime => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      throw new Error('Desktop open request runtime is unavailable.');
    }
    return runtime;
  }, []);

  useEffect(() => {
    const runtime = readRuntime();
    optionsRef.current = options;
    runtime.latestOptions = options;
  }, [options, readRuntime]);

  const subscribe = useCallback(
    (notify: () => void) => {
      const runtime = readRuntime();
      runtime.subscribers.add(notify);
      return () => {
        runtime.subscribers.delete(notify);
      };
    },
    [readRuntime],
  );

  const getSnapshot = useCallback(
    () => readRuntime().snapshot,
    [readRuntime],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  const isCurrentGeneration = useCallback((generation: number) => {
    return (
      mountedRef.current && effectGenerationRef.current === generation
    );
  }, []);

  const enqueueBridge = useCallback(<T,>(operation: () => Promise<T>) => {
    const runtime = readRuntime();
    const next = runtime.bridgeChain.then(operation, operation);
    runtime.bridgeChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, [readRuntime]);

  const isCurrentAttempt = useCallback((attempt: OpenRequestAttempt) => {
    const runtime = readRuntime();
    return (
      runtime.currentAttempts.get(attempt.requestId) ===
      attempt.attemptToken
    );
  }, [readRuntime]);

  const removeLocalRequest = useCallback((requestId: string) => {
    const runtime = readRuntime();
    runtime.queue = runtime.queue.filter(
      (request) => request.requestId !== requestId,
    );
    if (runtime.pending?.requestId === requestId) {
      runtime.pending = null;
    }
    notifyRuntime(runtime);
  }, [readRuntime]);

  const adoptAttempt = useCallback(
    (attempt: OpenRequestAttempt): AttemptAdoption => {
      const runtime = readRuntime();
      const nextKey = attemptKey(attempt);
      const terminalToken = runtime.terminalAttempts.get(
        attempt.requestId,
      );
      if (terminalToken === attempt.attemptToken) {
        return 'rejected';
      }
      if (terminalToken !== undefined) {
        runtime.terminalAttempts.delete(attempt.requestId);
      }
      if (runtime.pendingAbandonments.has(nextKey)) {
        return 'rejected';
      }
      clearSupersededAbandonments(runtime, attempt);

      const currentToken = runtime.currentAttempts.get(
        attempt.requestId,
      );
      if (
        currentToken !== undefined &&
        currentToken !== attempt.attemptToken
      ) {
        const currentAttempt = {
          attemptToken: currentToken,
          requestId: attempt.requestId,
        };
        const currentKey = attemptKey(currentAttempt);
        const wasApplied = runtime.appliedAttempts.has(currentKey);
        removeLocalRequest(attempt.requestId);
        runtime.completions.delete(currentKey);
        runtime.seenClaims.delete(currentKey);
        runtime.appliedAttempts.delete(currentKey);
        clearAttemptErrors(runtime, currentAttempt);
        runtime.currentAttempts.set(
          attempt.requestId,
          attempt.attemptToken,
        );

        if (wasApplied) {
          runtime.seenClaims.add(nextKey);
          runtime.appliedAttempts.add(nextKey);
          runtime.completions.set(nextKey, {
            attempt: toAttempt(attempt),
            stage: 'record',
          });
          notifyRuntime(runtime);
          return 'retargeted';
        }
      }
      runtime.currentAttempts.set(
        attempt.requestId,
        attempt.attemptToken,
      );
      return 'accepted';
    },
    [readRuntime, removeLocalRequest],
  );

  const advanceCompletion = useCallback(
    async (key: string): Promise<void> => {
      const runtime = readRuntime();
      let entry = runtime.completions.get(key);
      if (!entry || !isCurrentAttempt(entry.attempt)) {
        runtime.completions.delete(key);
        return;
      }

      if (entry.stage === 'record') {
        const recordResult = await runCommand(
          runtime,
          errorSource('record', entry.attempt),
          () => runtime.client.recordApplied(entry!.attempt),
          'desktop.open_request_record_failed',
        );
        entry = runtime.completions.get(key);
        if (!entry || !isCurrentAttempt(entry.attempt)) {
          runtime.completions.delete(key);
          return;
        }
        if (!recordResult.ok) {
          return;
        }
        entry.stage = 'acknowledge';
      }

      const acknowledgeResult = await runCommand(
        runtime,
        errorSource('ack', entry.attempt),
        () => runtime.client.acknowledge(entry!.attempt),
        'desktop.open_request_ack_failed',
      );
      entry = runtime.completions.get(key);
      if (!entry || !isCurrentAttempt(entry.attempt)) {
        runtime.completions.delete(key);
        return;
      }
      if (!acknowledgeResult.ok) {
        return;
      }

      cleanupTerminalAttempt(runtime, entry.attempt);
    },
    [isCurrentAttempt, readRuntime],
  );

  const retryCompletions = useCallback(async () => {
    const runtime = readRuntime();
    for (const key of [...runtime.completions.keys()]) {
      await advanceCompletion(key);
    }
  }, [advanceCompletion, readRuntime]);

  const sendAbandon = useCallback(
    async (attempt: OpenRequestAttempt): Promise<void> => {
      const runtime = readRuntime();
      const key = attemptKey(attempt);
      const trackedAttempt =
        runtime.pendingAbandonments.get(key) ?? attempt;
      runtime.pendingAbandonments.set(key, trackedAttempt);

      await enqueueAbandonment(runtime, async () => {
        if (
          runtime.pendingAbandonments.get(key) !== trackedAttempt
        ) {
          return;
        }

        const result = await runCommand(
          runtime,
          errorSource('abandon', trackedAttempt),
          () => runtime.client.abandon(trackedAttempt),
          'desktop.open_request_abandon_failed',
        );
        if (
          runtime.pendingAbandonments.get(key) !== trackedAttempt
        ) {
          return;
        }
        if (result.ok) {
          cleanupTerminalAttempt(runtime, trackedAttempt);
          return;
        }
      });
    },
    [readRuntime],
  );

  const retryAbandonments = useCallback(async () => {
    const runtime = readRuntime();
    for (const attempt of [...runtime.pendingAbandonments.values()]) {
      await sendAbandon(attempt);
    }
  }, [readRuntime, sendAbandon]);

  const abandonAttempt = useCallback(
    async (request: OpenRequest): Promise<void> => {
      if (!isCurrentAttempt(request)) {
        return;
      }
      await sendAbandon(toAttempt(request));
    },
    [isCurrentAttempt, sendAbandon],
  );

  const abandonLateClaim = useCallback(
    async (request: OpenRequest): Promise<void> => {
      await sendAbandon(toAttempt(request));
    },
    [sendAbandon],
  );

  const synchronize = useCallback((generation: number) => {
    const runtime = readRuntime();
    return enqueueBridge(async () => {
      if (!isCurrentGeneration(generation)) {
        return false;
      }
      const recovery = await runCommand(
        runtime,
        'recover',
        () => runtime.client.recover(),
        'desktop.open_request_recover_failed',
      );
      if (!isCurrentGeneration(generation)) {
        return false;
      }
      if (!recovery.ok) {
        return false;
      }

      if (recovery.data.length > 0) {
        runtime.blocksSessionRestore = true;
      }
      for (const attempt of recovery.data) {
        clearAbandonmentsForRequest(runtime, attempt.requestId);
        if (adoptAttempt(attempt) === 'rejected') {
          continue;
        }
        removeLocalRequest(attempt.requestId);
        const key = attemptKey(attempt);
        runtime.appliedAttempts.add(key);
        runtime.completions.set(key, {
          attempt,
          stage: 'acknowledge',
        });
      }
      notifyRuntime(runtime);
      await retryCompletions();
      if (!isCurrentGeneration(generation)) {
        return false;
      }
      await retryAbandonments();
      if (!isCurrentGeneration(generation)) {
        return false;
      }

      const claimed = await runCommand(
        runtime,
        'claim',
        () => runtime.client.claim(),
        'desktop.open_request_claim_failed',
      );
      if (!claimed.ok) {
        return false;
      }
      if (!isCurrentGeneration(generation)) {
        const uniqueRequests = new Map(
          claimed.data.map((request) => [attemptKey(request), request]),
        );
        for (const request of uniqueRequests.values()) {
          await abandonLateClaim(request);
        }
        return false;
      }

      let retargeted = false;
      const claimedAttempts = new Map(
        claimed.data.map((request) => [
          request.requestId,
          request.attemptToken,
        ]),
      );
      for (const [requestId, terminalToken] of [
        ...runtime.terminalAttempts,
      ]) {
        if (claimedAttempts.get(requestId) !== terminalToken) {
          runtime.terminalAttempts.delete(requestId);
        }
      }
      for (const request of claimed.data) {
        const key = attemptKey(request);
        if (
          runtime.seenClaims.has(key) ||
          runtime.completions.has(key)
        ) {
          continue;
        }
        const adoption = adoptAttempt(request);
        if (adoption === 'rejected') {
          continue;
        }
        if (adoption === 'retargeted') {
          retargeted = true;
          continue;
        }
        runtime.seenClaims.add(key);
        runtime.queue.push(request);
      }

      if (retargeted) {
        await retryCompletions();
      }
      runtime.bootstrapComplete = true;
      if (claimed.data.length > 0) {
        runtime.blocksSessionRestore = true;
      }
      notifyRuntime(runtime);
      return true;
    });
  }, [
    abandonLateClaim,
    adoptAttempt,
    enqueueBridge,
    isCurrentGeneration,
    readRuntime,
    removeLocalRequest,
    retryAbandonments,
    retryCompletions,
  ]);

  const openRequest = useCallback(
    async (
      request: OpenRequest,
      openPath: (path: string) => Promise<OpenDocumentOutcome>,
    ) => {
      const runtime = readRuntime();
      runtime.processing = true;
      runtime.active = request;
      notifyRuntime(runtime);
      const applyTicket = beginErrorOperation(
        runtime,
        errorSource('apply', request),
      );
      try {
        let outcome: OpenDocumentOutcome;
        try {
          outcome = await openPath(request.path);
        } catch {
          failErrorOperation(
            runtime,
            applyTicket,
            desktopBridgeError('desktop.open_request_apply_failed'),
          );
          if (isCurrentAttempt(request)) {
            await enqueueBridge(() => abandonAttempt(request));
          }
          return;
        }
        resolveErrorOperation(runtime, applyTicket);

        if (!isCurrentAttempt(request)) {
          return;
        }
        const key = attemptKey(request);
        if (runtime.appliedAttempts.has(key)) {
          return;
        }
        if (
          outcome.status !== 'opened' &&
          outcome.status !== 'focused'
        ) {
          await enqueueBridge(() => abandonAttempt(request));
          return;
        }

        runtime.appliedAttempts.add(key);
        if (outcome.status === 'opened') {
          runtime.latestOptions?.onOpened(outcome.file.path);
        }
        runtime.completions.set(key, {
          attempt: toAttempt(request),
          stage: 'record',
        });
        await enqueueBridge(() => advanceCompletion(key));
      } finally {
        if (runtime.active === request) {
          runtime.active = null;
        }
        runtime.processing = false;
        notifyRuntime(runtime);
      }
    },
    [
      abandonAttempt,
      advanceCompletion,
      enqueueBridge,
      isCurrentAttempt,
      readRuntime,
    ],
  );

  const pump = useCallback(() => {
    const runtime = readRuntime();
    const current = optionsRef.current;
    if (
      runtime.processing ||
      runtime.pending ||
      !current.editorReady ||
      !current.recoveryChecked ||
      current.recoveryPending
    ) {
      return;
    }

    let request = runtime.queue.shift();
    while (request && !isCurrentAttempt(request)) {
      request = runtime.queue.shift();
    }
    if (!request) {
      return;
    }

    if (current.dirty) {
      runtime.pending = request;
      notifyRuntime(runtime);
      return;
    }

    void openRequest(request, current.openPath);
  }, [isCurrentAttempt, openRequest, optionsRef, readRuntime]);

  const ensureListening = useCallback(
    (generation: number): Promise<boolean> => {
      if (listenerRef.current) {
        return Promise.resolve(true);
      }
      const currentRegistration = listenerRegistrationRef.current;
      if (currentRegistration?.generation === generation) {
        return currentRegistration.promise;
      }

      const runtime = readRuntime();
      const ticket = beginErrorOperation(runtime, 'listener');
      const promise = (async () => {
        try {
          const stopListening = await runtime.client.listen(() => {
            if (isCurrentGeneration(generation)) {
              void synchronize(generation);
            }
          });
          if (!isCurrentGeneration(generation)) {
            stopListening();
            return false;
          }
          listenerRef.current = stopListening;
          resolveErrorOperation(runtime, ticket);
          return true;
        } catch {
          if (isCurrentGeneration(generation)) {
            failErrorOperation(
              runtime,
              ticket,
              desktopBridgeError(
                'desktop.open_request_listener_unavailable',
              ),
            );
          }
          return false;
        }
      })();
      const registration = { generation, promise };
      listenerRegistrationRef.current = registration;
      void promise.finally(() => {
        if (listenerRegistrationRef.current === registration) {
          listenerRegistrationRef.current = null;
        }
      });
      return promise;
    },
    [isCurrentGeneration, readRuntime, synchronize],
  );

  useEffect(() => {
    const generation = effectGenerationRef.current + 1;
    effectGenerationRef.current = generation;
    mountedRef.current = true;

    void (async () => {
      await ensureListening(generation);

      if (isCurrentGeneration(generation)) {
        await synchronize(generation);
      }
    })();

    return () => {
      if (effectGenerationRef.current === generation) {
        effectGenerationRef.current += 1;
        mountedRef.current = false;
      }
      listenerRef.current?.();
      listenerRef.current = null;
    };
  }, [ensureListening, isCurrentGeneration, synchronize]);

  useEffect(() => {
    pump();
  }, [
    options.dirty,
    options.editorReady,
    options.recoveryChecked,
    options.recoveryPending,
    pump,
    snapshot.revision,
  ]);

  const confirmDiscard = useCallback(() => {
    const runtime = readRuntime();
    const request = runtime.pending;
    if (!request || !isCurrentAttempt(request)) {
      return;
    }
    runtime.pending = null;
    notifyRuntime(runtime);
    void openRequest(request, optionsRef.current.openPathAfterDiscard);
  }, [isCurrentAttempt, openRequest, optionsRef, readRuntime]);

  const cancelDiscard = useCallback(() => {
    const runtime = readRuntime();
    const requests = [
      ...(runtime.pending ? [runtime.pending] : []),
      ...runtime.queue,
    ];
    runtime.pending = null;
    runtime.queue = [];
    notifyRuntime(runtime);

    const unique = new Map(
      requests.map((request) => [attemptKey(request), request]),
    );
    void enqueueBridge(async () => {
      for (const request of unique.values()) {
        await abandonAttempt(request);
      }
    });
  }, [abandonAttempt, enqueueBridge, readRuntime]);

  const dismissError = useCallback(() => {
    const runtime = readRuntime();
    dismissLatestError(runtime);
  }, [readRuntime]);

  const retrySynchronization = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }
    const generation = effectGenerationRef.current;
    void (async () => {
      await ensureListening(generation);
      if (isCurrentGeneration(generation)) {
        await synchronize(generation);
      }
    })();
  }, [ensureListening, isCurrentGeneration, synchronize]);

  return {
    blocksSessionRestore: snapshot.blocksSessionRestore,
    bootstrapComplete: snapshot.bootstrapComplete,
    cancelDiscard,
    confirmDiscard,
    dismissError,
    error: snapshot.error,
    pendingRequest: snapshot.pendingRequest,
    retrySynchronization,
  };
}

function getOpenRequestRuntime(
  client: OpenRequestClient,
): OpenRequestRuntime {
  const existing = openRequestRuntimes.get(client);
  if (existing) {
    return existing;
  }

  const runtime: OpenRequestRuntime = {
    abandonmentChain: Promise.resolve(),
    active: null,
    appliedAttempts: new Set(),
    blocksSessionRestore: false,
    bootstrapComplete: false,
    bridgeChain: Promise.resolve(),
    client,
    completions: new Map(),
    currentAttempts: new Map(),
    errorEntries: new Map(),
    errorOrder: 0,
    errorRevision: 0,
    latestOptions: null,
    pendingAbandonments: new Map(),
    pending: null,
    processing: false,
    queue: [],
    seenClaims: new Set(),
    sourceRevisions: new Map(),
    stateRevision: 0,
    subscribers: new Set(),
    snapshot: { ...initialRuntimeSnapshot },
    terminalAttempts: new Map(),
  };
  openRequestRuntimes.set(client, runtime);
  return runtime;
}

function notifyRuntime(runtime: OpenRequestRuntime): void {
  runtime.stateRevision += 1;
  runtime.snapshot = snapshotRuntime(runtime);
  for (const subscriber of runtime.subscribers) {
    subscriber();
  }
}

function snapshotRuntime(
  runtime: OpenRequestRuntime,
): OpenRequestRuntimeSnapshot {
  return {
    blocksSessionRestore: runtime.blocksSessionRestore,
    bootstrapComplete: runtime.bootstrapComplete,
    error: latestError(runtime),
    pendingRequest: runtime.pending,
    revision: runtime.stateRevision,
  };
}

function beginErrorOperation(
  runtime: OpenRequestRuntime,
  source: string,
): ErrorTicket {
  const revision = runtime.errorRevision + 1;
  runtime.errorRevision = revision;
  runtime.sourceRevisions.set(source, revision);

  const unresolved = runtime.errorEntries.get(source);
  if (unresolved) {
    runtime.errorEntries.set(source, { ...unresolved, revision });
  }
  return { revision, source };
}

function failErrorOperation(
  runtime: OpenRequestRuntime,
  ticket: ErrorTicket,
  error: CommandError,
): void {
  if (runtime.sourceRevisions.get(ticket.source) !== ticket.revision) {
    return;
  }
  runtime.errorOrder += 1;
  runtime.errorEntries.set(ticket.source, {
    ...ticket,
    error,
    order: runtime.errorOrder,
  });
  notifyRuntime(runtime);
}

function resolveErrorOperation(
  runtime: OpenRequestRuntime,
  ticket: ErrorTicket,
): void {
  if (runtime.sourceRevisions.get(ticket.source) !== ticket.revision) {
    return;
  }
  runtime.sourceRevisions.delete(ticket.source);
  const unresolved = runtime.errorEntries.get(ticket.source);
  if (unresolved?.revision === ticket.revision) {
    runtime.errorEntries.delete(ticket.source);
    notifyRuntime(runtime);
  }
}

function latestError(runtime: OpenRequestRuntime): CommandError | null {
  let latest: ErrorEntry | null = null;
  for (const entry of runtime.errorEntries.values()) {
    if (!latest || entry.order > latest.order) {
      latest = entry;
    }
  }
  return latest?.error ?? null;
}

function dismissLatestError(runtime: OpenRequestRuntime): void {
  let latest: ErrorEntry | null = null;
  for (const entry of runtime.errorEntries.values()) {
    if (!latest || entry.order > latest.order) {
      latest = entry;
    }
  }
  if (!latest) {
    return;
  }
  runtime.errorEntries.delete(latest.source);
  if (
    runtime.sourceRevisions.get(latest.source) === latest.revision
  ) {
    runtime.sourceRevisions.delete(latest.source);
  }
  notifyRuntime(runtime);
}

async function runCommand<T>(
  runtime: OpenRequestRuntime,
  source: string,
  operation: () => Promise<CommandResult<T>>,
  failureCode: string,
): Promise<CommandResult<T>> {
  const ticket = beginErrorOperation(runtime, source);
  let result: CommandResult<T>;
  try {
    result = await operation();
  } catch {
    result = { error: desktopBridgeError(failureCode), ok: false };
  }
  if (result.ok) {
    resolveErrorOperation(runtime, ticket);
  } else {
    failErrorOperation(runtime, ticket, result.error);
  }
  return result;
}

function toAttempt(request: OpenRequestAttempt): OpenRequestAttempt {
  return {
    attemptToken: request.attemptToken,
    requestId: request.requestId,
  };
}

function attemptKey(attempt: OpenRequestAttempt): string {
  return `${attempt.requestId}\u0000${attempt.attemptToken}`;
}

function errorSource(
  operation: 'abandon' | 'ack' | 'apply' | 'record',
  attempt: OpenRequestAttempt,
): string {
  return `${operation}:${attemptKey(attempt)}`;
}

function enqueueAbandonment(
  runtime: OpenRequestRuntime,
  operation: () => Promise<void>,
): Promise<void> {
  const next = runtime.abandonmentChain.then(
    operation,
    operation,
  );
  runtime.abandonmentChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function clearAbandonmentsForRequest(
  runtime: OpenRequestRuntime,
  requestId: string,
): void {
  for (const [key, attempt] of runtime.pendingAbandonments) {
    if (attempt.requestId === requestId) {
      runtime.pendingAbandonments.delete(key);
    }
  }
}

function clearSupersededAbandonments(
  runtime: OpenRequestRuntime,
  attempt: OpenRequestAttempt,
): void {
  for (const [key, pendingAttempt] of runtime.pendingAbandonments) {
    if (
      pendingAttempt.requestId === attempt.requestId &&
      pendingAttempt.attemptToken !== attempt.attemptToken
    ) {
      runtime.pendingAbandonments.delete(key);
    }
  }
}

function cleanupTerminalAttempt(
  runtime: OpenRequestRuntime,
  attempt: OpenRequestAttempt,
): void {
  const key = attemptKey(attempt);
  runtime.terminalAttempts.set(
    attempt.requestId,
    attempt.attemptToken,
  );
  runtime.pendingAbandonments.delete(key);
  runtime.completions.delete(key);
  runtime.appliedAttempts.delete(key);
  runtime.seenClaims.delete(key);

  if (
    runtime.currentAttempts.get(attempt.requestId) ===
    attempt.attemptToken
  ) {
    runtime.currentAttempts.delete(attempt.requestId);
    runtime.queue = runtime.queue.filter(
      (request) => request.requestId !== attempt.requestId,
    );
    if (runtime.pending?.requestId === attempt.requestId) {
      runtime.pending = null;
    }
  }
  notifyRuntime(runtime);
}

function clearAttemptErrors(
  runtime: OpenRequestRuntime,
  attempt: OpenRequestAttempt,
): void {
  let changed = false;
  for (const operation of [
    'abandon',
    'ack',
    'apply',
    'record',
  ] as const) {
    const source = errorSource(operation, attempt);
    changed = runtime.errorEntries.delete(source) || changed;
    runtime.sourceRevisions.delete(source);
  }
  if (changed) {
    notifyRuntime(runtime);
  }
}

function desktopBridgeError(code: string): CommandError {
  return {
    code,
    message: 'Desktop open request bridge is unavailable.',
    recoverable: true,
  };
}
