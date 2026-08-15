import type { CommandError } from '../../services/tauri/invokeCommand';
import type { DocumentClaimClient } from '../../services/window/documentClaimClient';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { FileActionStateAdapter } from './fileActions';

export type DocumentClaimWorkflowRuntime = {
  activeSave: Promise<void> | null;
  irreversibleOperationId: number | null;
  mountGeneration: number;
  mountedWorkflow: DocumentClaimWorkflowMount | null;
  mountWaiters: Set<DocumentClaimWorkflowMountWaiter>;
  mutationTail: Promise<void> | null;
  ownedOperationId: number | null;
  ownedPath: string | null;
  operationId: number;
  ownershipBlockedError: CommandError | null;
};

export type DocumentClaimWorkflowMount = {
  generation: number;
  getEditor: () => EditorDocumentPort | null;
  getStateAdapter: () => FileActionStateAdapter;
  id: symbol;
  onDocumentBecameSafe: () => void;
  onDocumentLoaded: () => void;
  replaceWatchedDocument: (
    path: string | null,
    knownFingerprint?: string | null,
  ) => Promise<{ status: 'failed' | 'ready' | 'superseded' }>;
  setLastFileError: (error: CommandError | null) => void;
  setStatusKey: (statusKey: string) => void;
};

type DocumentClaimWorkflowMountInput = Omit<
  DocumentClaimWorkflowMount,
  'generation'
>;

type DocumentClaimWorkflowMountWaiter = {
  afterGeneration: number;
  resolve: (mount: DocumentClaimWorkflowMount) => void;
};

type OperationIdResult =
  | { ok: true; operationId: number }
  | { error: CommandError; ok: false };

const runtimes = new WeakMap<DocumentClaimClient, DocumentClaimWorkflowRuntime>();

export function resolveDocumentClaimWorkflowRuntime(
  client: DocumentClaimClient,
): DocumentClaimWorkflowRuntime {
  const existing = runtimes.get(client);
  if (existing) {
    return existing;
  }

  const runtime: DocumentClaimWorkflowRuntime = {
    activeSave: null,
    irreversibleOperationId: null,
    mountGeneration: 0,
    mountedWorkflow: null,
    mountWaiters: new Set(),
    mutationTail: null,
    ownedOperationId: null,
    ownedPath: null,
    operationId: 0,
    ownershipBlockedError: null,
  };
  runtimes.set(client, runtime);
  return runtime;
}

export function enqueueDocumentClaimMutation<T>(
  runtime: DocumentClaimWorkflowRuntime,
  operation: () => Promise<T>,
): Promise<T> {
  const mutationGate = runtime.mutationTail ?? Promise.resolve();
  const nextMutation = mutationGate.then(operation, operation);

  const settledMutation = nextMutation.then(
    () => undefined,
    () => undefined,
  );
  runtime.mutationTail = settledMutation;
  void settledMutation.then(() => {
    if (runtime.mutationTail === settledMutation) {
      runtime.mutationTail = null;
    }
  });
  return nextMutation;
}

export function enqueueDocumentClaimSave(
  runtime: DocumentClaimWorkflowRuntime,
  operation: () => Promise<void>,
): Promise<void> {
  const nextSave = enqueueDocumentClaimMutation(runtime, operation);
  runtime.activeSave = nextSave;
  void nextSave.then(
    () => {
      if (runtime.activeSave === nextSave) {
        runtime.activeSave = null;
      }
    },
    () => {
      if (runtime.activeSave === nextSave) {
        runtime.activeSave = null;
      }
    },
  );
  return nextSave;
}

export function registerDocumentClaimWorkflowMount(
  runtime: DocumentClaimWorkflowRuntime,
  mount: DocumentClaimWorkflowMountInput,
): () => void {
  const registeredMount: DocumentClaimWorkflowMount = {
    ...mount,
    generation: runtime.mountGeneration + 1,
  };
  runtime.mountGeneration = registeredMount.generation;
  runtime.mountedWorkflow = registeredMount;
  for (const waiter of runtime.mountWaiters) {
    if (registeredMount.generation <= waiter.afterGeneration) {
      continue;
    }
    runtime.mountWaiters.delete(waiter);
    waiter.resolve(registeredMount);
  }

  return () => {
    if (runtime.mountedWorkflow?.generation === registeredMount.generation) {
      runtime.mountedWorkflow = null;
    }
  };
}

export function waitForDocumentClaimWorkflowMount(
  runtime: DocumentClaimWorkflowRuntime,
  afterGeneration = 0,
): Promise<DocumentClaimWorkflowMount> {
  if (
    runtime.mountedWorkflow &&
    runtime.mountedWorkflow.generation > afterGeneration
  ) {
    return Promise.resolve(runtime.mountedWorkflow);
  }

  return new Promise((resolve) => {
    runtime.mountWaiters.add({ afterGeneration, resolve });
  });
}

export function getDocumentClaimWorkflowMountGeneration(
  runtime: DocumentClaimWorkflowRuntime,
  mountId: symbol,
): number | null {
  return runtime.mountedWorkflow?.id === mountId
    ? runtime.mountedWorkflow.generation
    : null;
}

export function isDocumentClaimWorkflowMountCurrent(
  runtime: DocumentClaimWorkflowRuntime,
  generation: number,
): boolean {
  return runtime.mountedWorkflow?.generation === generation;
}

export function getDocumentClaimOperationId(
  runtime: DocumentClaimWorkflowRuntime,
): number {
  return runtime.operationId;
}

export function getDocumentClaimOwnershipBlock(
  runtime: DocumentClaimWorkflowRuntime,
): CommandError | null {
  return runtime.ownershipBlockedError;
}

export function getDocumentClaimOwnedOperation(
  runtime: DocumentClaimWorkflowRuntime,
): { operationId: number; path: string } | null {
  return runtime.ownedOperationId === null || runtime.ownedPath === null
    ? null
    : { operationId: runtime.ownedOperationId, path: runtime.ownedPath };
}

export function setDocumentClaimOwnedOperation(
  runtime: DocumentClaimWorkflowRuntime,
  operationId: number,
  path: string,
): void {
  runtime.ownedOperationId = operationId;
  runtime.ownedPath = path;
}

export function clearDocumentClaimOwnedOperation(
  runtime: DocumentClaimWorkflowRuntime,
  operationId?: number,
): void {
  if (
    operationId !== undefined &&
    runtime.ownedOperationId !== operationId
  ) {
    return;
  }
  runtime.ownedOperationId = null;
  runtime.ownedPath = null;
}

export function blockDocumentClaimOwnership(
  runtime: DocumentClaimWorkflowRuntime,
  error: CommandError,
): void {
  runtime.ownershipBlockedError = error;
}

export function hasIrreversibleDocumentClaimTransition(
  runtime: DocumentClaimWorkflowRuntime,
): boolean {
  return runtime.irreversibleOperationId !== null;
}

export function beginIrreversibleDocumentClaimTransition(
  runtime: DocumentClaimWorkflowRuntime,
  operationId: number,
): boolean {
  if (
    runtime.operationId !== operationId ||
    (runtime.irreversibleOperationId !== null &&
      runtime.irreversibleOperationId !== operationId)
  ) {
    return false;
  }

  runtime.irreversibleOperationId = operationId;
  return true;
}

export function finishIrreversibleDocumentClaimTransition(
  runtime: DocumentClaimWorkflowRuntime,
  operationId: number,
): void {
  if (runtime.irreversibleOperationId === operationId) {
    runtime.irreversibleOperationId = null;
  }
}

export function nextDocumentClaimOperationId(
  runtime: DocumentClaimWorkflowRuntime,
): OperationIdResult {
  const nextOperationId = runtime.operationId + 1;
  if (!Number.isSafeInteger(nextOperationId)) {
    const error: CommandError = {
      code: 'document_claim.operation_id_exhausted',
      message: 'No safe document claim operation id remains in this session.',
      recoverable: false,
    };
    runtime.ownershipBlockedError = error;
    return {
      error,
      ok: false,
    };
  }

  runtime.operationId = nextOperationId;
  return { ok: true, operationId: nextOperationId };
}
