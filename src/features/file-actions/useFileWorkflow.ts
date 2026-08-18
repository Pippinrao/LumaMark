import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import { resolveFileCommandClient } from '../../services/files/fileCommandClient';
import {
  showOpenFileDialog,
  showSaveFileDialog,
} from '../../services/files/fileCommands';
import {
  createFileActions,
  type FileActionStateAdapter,
} from './fileActions';
import {
  beginIrreversibleDocumentClaimTransition,
  blockDocumentClaimOwnership,
  clearDocumentClaimOwnedOperation,
  enqueueDocumentClaimMutation,
  enqueueDocumentClaimSave,
  finishIrreversibleDocumentClaimTransition,
  getDocumentClaimOwnedOperation,
  getDocumentClaimOperationId,
  getDocumentClaimOwnershipBlock,
  getDocumentClaimWorkflowMountGeneration,
  hasIrreversibleDocumentClaimTransition,
  isDocumentClaimWorkflowMountCurrent,
  nextDocumentClaimOperationId,
  registerDocumentClaimWorkflowMount,
  resolveDocumentClaimWorkflowRuntime,
  setDocumentClaimOwnedOperation,
  waitForDocumentClaimWorkflowMount,
} from './documentClaimWorkflowRuntime';
import type { RecentFileInput } from '../recent-files/recentFilesStore';
import type { FileMetadata } from '../../services/files/fileTypes';
import {
  resolveFileWatchClient,
  type FileWatchChangeEvent,
  type FileWatchClient,
} from '../../services/file-watch/fileWatchClient';
import {
  useExternalFileWatch,
  areWatchedPathsEqual,
  type ExternalFileConflict,
} from './useExternalFileWatch';
import {
  resolveDocumentClaimClient,
  type DocumentClaimReservation,
  type DocumentClaimClient,
} from '../../services/window/documentClaimClient';
import type { CommandError } from '../../services/tauri/invokeCommand';

export type { ExternalFileConflict } from './useExternalFileWatch';

export type OpenDocumentOutcome =
  | { file: FileMetadata; status: 'opened' }
  | { status: 'focused'; windowLabel: string | null }
  | { status: 'cancelled' | 'failed' | 'superseded' };

export type RetargetOpenDocumentOptions = {
  expectedCurrentPath: string;
  failClosedError: CommandError;
};

export type RetargetOpenDocumentOutcome =
  | { status: 'failClosed' | 'notCurrent' | 'retargeted' }
  | { error: CommandError; status: 'indeterminate' }
  | { error: CommandError; status: 'failed' };

export type RetargetOpenDocumentCall = (
  path: string,
  options?: RetargetOpenDocumentOptions,
) => RetargetOpenDocumentOutcome | Promise<RetargetOpenDocumentOutcome>;

export type RetargetOpenDocument = RetargetOpenDocumentCall & {
  runDocumentMutation?: (
    operation: (retarget: RetargetOpenDocumentCall) => Promise<void>,
  ) => Promise<void>;
};

type RetargetDocumentMutation = (
  operation: (retarget: RetargetOpenDocumentCall) => Promise<void>,
) => Promise<void>;

const retargetDocumentMutationRunners = new WeakMap<
  RetargetOpenDocumentCall,
  RetargetDocumentMutation
>();

export function runRetargetOpenDocumentMutation(
  retarget: RetargetOpenDocument,
  operation: (retarget: RetargetOpenDocumentCall) => Promise<void>,
): Promise<void> {
  const runner =
    retargetDocumentMutationRunners.get(retarget) ??
    retarget.runDocumentMutation;
  return runner ? runner(operation) : operation(retarget);
}

export type FileWorkflow = {
  createNewDocument: () => Promise<boolean>;
  externalConflict: ExternalFileConflict | null;
  fileOpening: boolean;
  keepCurrentContent: () => void;
  markDocumentDirty: (dirty: boolean) => void;
  markOpenDocumentRemoved: (path: string) => void;
  openFromDialog: () => Promise<OpenDocumentOutcome>;
  openFromDialogAfterDiscard: () => Promise<OpenDocumentOutcome>;
  openPath: (path: string) => Promise<OpenDocumentOutcome>;
  openPathAfterDiscard: (path: string) => Promise<OpenDocumentOutcome>;
  reloadFromDisk: () => Promise<void>;
  retargetOpenDocument: RetargetOpenDocument;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  supersedePendingOpen: () => void;
};

export type StatusAdapter = {
  setStatusKey: (statusKey: string) => void;
};

export type RecentFilesAdapter = {
  addRecentFile: (file: RecentFileInput) => void;
};

export type UseFileWorkflowOptions = {
  documentClaims?: DocumentClaimClient;
  editorReady: boolean;
  editorRef: RefObject<EditorDocumentPort | null>;
  fileWatch?: FileWatchClient;
  onLocalImageChanged?: (event: FileWatchChangeEvent) => void;
  onDocumentLoaded?: () => void;
  onDocumentBecameSafe?: () => void;
  prepareTextForSave?: (path: string, text: string) => Promise<string>;
  recentFiles: RecentFilesAdapter;
  state: FileActionStateAdapter;
  status: StatusAdapter;
};

type DocumentOpenBaseline = {
  currentDocumentPath: string | null;
  dirty: boolean;
  dirtyRevision: number;
  snapshot: ReturnType<EditorDocumentPort['captureSnapshot']>;
};

type ReservationReleaseTerminal =
  | { status: 'owned' }
  | { status: 'released' }
  | { error: CommandError; status: 'unknown' };

type ReservationCommitTerminal =
  | { status: 'owned' }
  | { error: CommandError; status: 'released' }
  | { error: CommandError; status: 'unknown' };

type OwnedReleaseTerminal =
  | { status: 'released' }
  | { error: CommandError; status: 'unknown' };

type ReservationStartTerminal =
  | { reservation: DocumentClaimReservation; status: 'known' }
  | { error: CommandError; status: 'released' }
  | { error: CommandError; status: 'unknown' };

type OwnedOperationResolution =
  | { operationId: number; status: 'owned' }
  | { status: 'failed' | 'superseded' };

const TERMINAL_RECONCILIATION_ATTEMPTS = 2;

async function reserveDocumentToTerminal(
  documentClaims: DocumentClaimClient,
  operationId: number,
  path: string,
): Promise<ReservationStartTerminal> {
  let lastError: CommandError | null = null;
  for (let attempt = 0; attempt < TERMINAL_RECONCILIATION_ATTEMPTS; attempt += 1) {
    const reserved = await documentClaims.reserveDocument({ operationId, path });
    if (reserved.ok) {
      return { reservation: reserved.data, status: 'known' };
    }
    lastError = reserved.error;
  }

  const released = await releaseReservationToTerminal(
    documentClaims,
    operationId,
    path,
  );
  if (released.status === 'released') {
    return { error: lastError!, status: 'released' };
  }
  if (released.status === 'unknown') {
    return { error: released.error, status: 'unknown' };
  }

  const ownershipRelease = await releaseOwnedDocumentToTerminal(
    documentClaims,
    path,
  );
  return ownershipRelease.status === 'released'
    ? { error: lastError!, status: 'released' }
    : { error: ownershipRelease.error, status: 'unknown' };
}

async function releaseReservationToTerminal(
  documentClaims: DocumentClaimClient,
  operationId: number,
  path: string,
): Promise<ReservationReleaseTerminal> {
  let lastError: CommandError | null = null;

  for (let attempt = 0; attempt < TERMINAL_RECONCILIATION_ATTEMPTS; attempt += 1) {
    const released = await documentClaims.releaseReservation(operationId, path);
    if (!released.ok) {
      lastError = released.error;
      continue;
    }
    return released.data.status === 'alreadyCommitted'
      ? { status: 'owned' }
      : { status: 'released' };
  }

  return { error: lastError!, status: 'unknown' };
}

async function commitReservationToTerminal(
  documentClaims: DocumentClaimClient,
  operationId: number,
  path: string,
): Promise<ReservationCommitTerminal> {
  const committed = await documentClaims.commitReservation(operationId, path);
  if (committed.ok) {
    return { status: 'owned' };
  }

  const reconciled = await releaseReservationToTerminal(
    documentClaims,
    operationId,
    path,
  );
  if (reconciled.status === 'owned') {
    return reconciled;
  }
  if (reconciled.status === 'released') {
    return { error: committed.error, status: 'released' };
  }
  return reconciled;
}

async function releaseOwnedDocumentToTerminal(
  documentClaims: DocumentClaimClient,
  path: string,
): Promise<OwnedReleaseTerminal> {
  let lastError: CommandError | null = null;

  for (let attempt = 0; attempt < TERMINAL_RECONCILIATION_ATTEMPTS; attempt += 1) {
    const released = await documentClaims.releaseOwnedDocument(path);
    if (!released.ok) {
      lastError = released.error;
      continue;
    }
    return { status: 'released' };
  }

  return { error: lastError!, status: 'unknown' };
}

function documentClaimWorkflowError(
  code: string,
  message: string,
): CommandError {
  return { code, message, recoverable: true };
}

function unexpectedDocumentClaimWorkflowError(
  code: string,
  message: string,
  cause: unknown,
): CommandError {
  return { code, details: cause, message, recoverable: false };
}

function describeWorkflowFailure(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function areEditorDocumentPortsEquivalent(
  left: EditorDocumentPort,
  right: EditorDocumentPort,
): boolean {
  return (
    left === right ||
    (left.getText === right.getText &&
      left.loadText === right.loadText &&
      left.markSaved === right.markSaved &&
      left.markUnsaved === right.markUnsaved &&
      left.setContext === right.setContext)
  );
}

function captureDocumentOpenBaseline(
  editor: EditorDocumentPort,
  state: FileActionStateAdapter,
  allowDirty = false,
): DocumentOpenBaseline | null {
  const current = state.getState();
  if (current.dirty && !allowDirty) {
    return null;
  }

  return {
    currentDocumentPath: current.currentFile?.path ?? null,
    dirty: current.dirty,
    dirtyRevision: current.dirtyRevision,
    snapshot: editor.captureSnapshot(),
  };
}

function isDocumentOpenBaselineCurrent(
  baseline: DocumentOpenBaseline,
  editor: EditorDocumentPort,
  state: FileActionStateAdapter,
): boolean {
  const current = state.getState();
  const currentPath = current.currentFile?.path ?? null;
  const samePath =
    baseline.currentDocumentPath === null || currentPath === null
      ? baseline.currentDocumentPath === currentPath
      : areWatchedPathsEqual(baseline.currentDocumentPath, currentPath);

  return (
    current.dirty === baseline.dirty &&
    current.dirtyRevision === baseline.dirtyRevision &&
    samePath &&
    editor.isSnapshotCurrent(baseline.snapshot)
  );
}

async function beginDocumentClaimSession(documentClaims: DocumentClaimClient) {
  const started = await documentClaims.beginSession();
  if (
    started.ok ||
    started.error.code !== 'document_claim.session_already_active'
  ) {
    return started;
  }

  const details = started.error.details;
  const activeGeneration =
    details &&
    typeof details === 'object' &&
    'activeGeneration' in details
      ? (details as { activeGeneration?: unknown }).activeGeneration
      : null;
  if (!Number.isSafeInteger(activeGeneration) || (activeGeneration as number) <= 0) {
    return started;
  }

  return documentClaims.takeoverSession(activeGeneration as number);
}

export function useFileWorkflow({
  documentClaims,
  editorReady,
  editorRef,
  fileWatch = resolveFileWatchClient(),
  onLocalImageChanged = () => undefined,
  onDocumentLoaded = () => undefined,
  onDocumentBecameSafe = () => undefined,
  prepareTextForSave,
  recentFiles,
  state,
  status,
}: UseFileWorkflowOptions): FileWorkflow {
  const [fileOpening, setFileOpening] = useState(false);
  const documentClaimClient = useMemo(
    () => documentClaims ?? resolveDocumentClaimClient(),
    [documentClaims],
  );
  const claimWorkflowRuntime = useMemo(
    () => resolveDocumentClaimWorkflowRuntime(documentClaimClient),
    [documentClaimClient],
  );
  const claimSessionRef = useRef<
    ReturnType<typeof beginDocumentClaimSession> | null
  >(null);
  const fileOpeningRef = useRef(false);
  const transitionLockIdRef = useRef(0);
  const transitionLockedEditorRef = useRef<EditorDocumentPort | null>(null);
  const editorReadyWaitersRef = useRef(new Set<() => void>());
  const workflowMountId = useMemo(() => Symbol('document-claim-workflow'), []);

  useEffect(() => {
    const session = beginDocumentClaimSession(documentClaimClient);
    claimSessionRef.current = session;

    return () => {
      if (claimSessionRef.current === session) {
        claimSessionRef.current = null;
      }
    };
  }, [documentClaimClient]);

  useEffect(() => {
    if (!editorReady || !editorRef.current) {
      return;
    }

    for (const resolve of editorReadyWaitersRef.current) {
      resolve();
    }
    editorReadyWaitersRef.current.clear();
  }, [editorReady, editorRef]);

  useEffect(() => {
    const waiters = editorReadyWaitersRef.current;

    return () => {
      const irreversibleTransitionActive =
        hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime);
      if (!irreversibleTransitionActive) {
        nextDocumentClaimOperationId(claimWorkflowRuntime);
      }
      fileOpeningRef.current = false;
      if (!irreversibleTransitionActive) {
        const lockedEditor = transitionLockedEditorRef.current;
        if (lockedEditor) {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              lockedEditor.setTransitionLocked(false);
              break;
            } catch {
              // A terminal operation owns the authoritative retry/report path.
            }
          }
        }
        transitionLockIdRef.current += 1;
        transitionLockedEditorRef.current = null;
      }

      for (const resolve of waiters) {
        resolve();
      }
      waiters.clear();
    };
  }, [claimWorkflowRuntime]);

  const blockOnUnknownOwnership = useCallback(
    (error: CommandError, statusKey: 'status.openFailed' | 'status.saveFailed') => {
      blockDocumentClaimOwnership(claimWorkflowRuntime, error);
      const reportToLatestMount = (
        mount: Awaited<ReturnType<typeof waitForDocumentClaimWorkflowMount>>,
      ) => {
        if (
          !isDocumentClaimWorkflowMountCurrent(
            claimWorkflowRuntime,
            mount.generation,
          )
        ) {
          void waitForDocumentClaimWorkflowMount(
            claimWorkflowRuntime,
            mount.generation,
          ).then(reportToLatestMount);
          return;
        }
        mount.setLastFileError(error);
        mount.setStatusKey(statusKey);
      };
      const mountedWorkflow = claimWorkflowRuntime.mountedWorkflow;
      if (mountedWorkflow) {
        reportToLatestMount(mountedWorkflow);
      } else {
        void waitForDocumentClaimWorkflowMount(claimWorkflowRuntime).then(
          reportToLatestMount,
        );
      }
    },
    [claimWorkflowRuntime],
  );

  const lockDocumentTransition = useCallback(
    (
      editor: EditorDocumentPort,
      statusKey: 'status.openFailed' | 'status.saveFailed',
    ) => {
      const lockId = ++transitionLockIdRef.current;
      transitionLockedEditorRef.current = editor;
      try {
        editor.setTransitionLocked(true);
      } catch (cause) {
        if (transitionLockIdRef.current === lockId) {
          transitionLockedEditorRef.current = null;
        }
        throw cause;
      }
      let released = false;

      return (): boolean => {
        if (released) {
          return true;
        }
        if (transitionLockIdRef.current !== lockId) {
          released = true;
          return true;
        }

        let lastFailure: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            editor.setTransitionLocked(false);
            released = true;
            transitionLockedEditorRef.current = null;
            return true;
          } catch (cause) {
            lastFailure = cause;
          }
        }

        blockOnUnknownOwnership(
          unexpectedDocumentClaimWorkflowError(
            'document_claim.transition_unlock_failed',
            'The editor could not be unlocked after a document ownership transition.',
            lastFailure,
          ),
          statusKey,
        );
        return false;
      };
    },
    [blockOnUnknownOwnership],
  );

  const handoffDocumentTransitionLock = useCallback(
    (
      releaseCurrent: () => boolean,
      nextEditor: EditorDocumentPort,
      statusKey: 'status.openFailed' | 'status.saveFailed',
    ) => {
      const previousUnlocked = releaseCurrent();
      let releaseNext: (() => boolean) | null = null;
      let handoffError = previousUnlocked
        ? null
        : getDocumentClaimOwnershipBlock(claimWorkflowRuntime);

      try {
        releaseNext = lockDocumentTransition(nextEditor, statusKey);
      } catch (cause) {
        handoffError = unexpectedDocumentClaimWorkflowError(
          'document_claim.transition_lock_failed',
          'The latest editor could not be locked during a document ownership transition.',
          cause,
        );
        blockOnUnknownOwnership(handoffError, statusKey);
      }

      return { error: handoffError, release: releaseNext };
    },
    [
      blockOnUnknownOwnership,
      claimWorkflowRuntime,
      lockDocumentTransition,
    ],
  );

  const nextOperationId = useCallback(
    (statusKey: 'status.openFailed' | 'status.saveFailed'): number | null => {
      const next = nextDocumentClaimOperationId(claimWorkflowRuntime);
      if (!next.ok) {
        blockOnUnknownOwnership(next.error, statusKey);
        return null;
      }
      return next.operationId;
    },
    [blockOnUnknownOwnership, claimWorkflowRuntime],
  );

  const beginIrreversibleTransition = useCallback(
    (operationId: number): boolean => {
      return beginIrreversibleDocumentClaimTransition(
        claimWorkflowRuntime,
        operationId,
      );
    },
    [claimWorkflowRuntime],
  );

  const finishIrreversibleTransition = useCallback(
    (operationId: number) => {
      finishIrreversibleDocumentClaimTransition(
        claimWorkflowRuntime,
        operationId,
      );
    },
    [claimWorkflowRuntime],
  );

  const waitForEditor = useCallback(() => {
    if (editorRef.current) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      editorReadyWaitersRef.current.add(resolve);
    });
  }, [editorRef]);

  const waitForClaimSession = useCallback(() => {
    const activeSession = claimSessionRef.current;
    if (activeSession) {
      return activeSession;
    }

    const session = beginDocumentClaimSession(documentClaimClient);
    claimSessionRef.current = session;
    return session;
  }, [documentClaimClient]);

  const enqueueSave = useCallback(
    (operation: () => Promise<void>) => {
      const sourceGeneration = getDocumentClaimWorkflowMountGeneration(
        claimWorkflowRuntime,
        workflowMountId,
      );
      return enqueueDocumentClaimSave(claimWorkflowRuntime, async () => {
        if (
          sourceGeneration === null ||
          !isDocumentClaimWorkflowMountCurrent(
            claimWorkflowRuntime,
            sourceGeneration,
          )
        ) {
          return;
        }
        await operation();
      });
    },
    [claimWorkflowRuntime, workflowMountId],
  );

  const readLatestOwnedText = useCallback(
    async (path: string) => {
      const ownedOperation = getDocumentClaimOwnedOperation(
        claimWorkflowRuntime,
      );
      if (
        !ownedOperation ||
        !areWatchedPathsEqual(ownedOperation.path, path)
      ) {
        return {
          error: documentClaimWorkflowError(
            'document_claim.owned_operation_required',
            'The watched document has no current claimed operation.',
          ),
          ok: false as const,
        };
      }
      return documentClaimClient.readTextClaimed(
        ownedOperation.operationId,
        path,
      );
    },
    [claimWorkflowRuntime, documentClaimClient],
  );

  const runExternalDocumentMutation = useCallback(
    (operation: () => Promise<void>) => {
      const sourceGeneration = getDocumentClaimWorkflowMountGeneration(
        claimWorkflowRuntime,
        workflowMountId,
      );
      if (sourceGeneration === null) {
        return Promise.resolve();
      }
      return enqueueDocumentClaimMutation(claimWorkflowRuntime, async () => {
        if (
          !isDocumentClaimWorkflowMountCurrent(
            claimWorkflowRuntime,
            sourceGeneration,
          )
        ) {
          return;
        }
        await operation();
      });
    },
    [claimWorkflowRuntime, workflowMountId],
  );

  const markDocumentDirty = useCallback((dirty: boolean) => {
    state.setDirty(dirty);
  }, [state]);

  const externalFileWatch = useExternalFileWatch({
    editorRef,
    fileWatch,
    onDocumentBecameSafe,
    onLocalImageChanged,
    readLatestText: readLatestOwnedText,
    runDocumentMutation: runExternalDocumentMutation,
    state,
    status,
  });
  const {
    conflict: externalConflict,
    keepCurrentContent,
    reloadFromDisk,
    replaceWatchedDocument,
  } = externalFileWatch;

  useLayoutEffect(
    () =>
      registerDocumentClaimWorkflowMount(claimWorkflowRuntime, {
        getEditor: () => editorRef.current,
        getStateAdapter: () => state,
        id: workflowMountId,
        onDocumentBecameSafe,
        onDocumentLoaded,
        replaceWatchedDocument,
        setLastFileError: state.setLastFileError,
        setStatusKey: status.setStatusKey,
      }),
    [
      claimWorkflowRuntime,
      editorRef,
      onDocumentBecameSafe,
      onDocumentLoaded,
      replaceWatchedDocument,
      state,
      state.setLastFileError,
      status.setStatusKey,
      workflowMountId,
    ],
  );

  const waitForCurrentWorkflow = useCallback(
    () => waitForDocumentClaimWorkflowMount(claimWorkflowRuntime),
    [claimWorkflowRuntime],
  );

  const replaceWatchedDocumentOnLatest = useCallback(
    async (
      path: string | null,
      knownFingerprint?: string | null,
      beforeReplace?: (
        mount: Awaited<ReturnType<typeof waitForCurrentWorkflow>>,
      ) => void,
    ) => {
      let afterGeneration = 0;
      while (true) {
        const currentWorkflow = await waitForDocumentClaimWorkflowMount(
          claimWorkflowRuntime,
          afterGeneration,
        );
        const outcome = await currentWorkflow.replaceWatchedDocument(
          path,
          knownFingerprint,
        );
        if (
          outcome.status === 'superseded' ||
          !isDocumentClaimWorkflowMountCurrent(
            claimWorkflowRuntime,
            currentWorkflow.generation,
          )
        ) {
          afterGeneration = currentWorkflow.generation;
          continue;
        }
        beforeReplace?.(currentWorkflow);
        return { currentWorkflow, outcome };
      }
    },
    [claimWorkflowRuntime],
  );

  const reportErrorToCurrentWorkflow = useCallback(
    async (
      error: CommandError,
      statusKey: 'status.openFailed' | 'status.saveFailed',
    ) => {
      const currentWorkflow = await waitForCurrentWorkflow();
      currentWorkflow.setLastFileError(error);
      currentWorkflow.setStatusKey(statusKey);
    },
    [waitForCurrentWorkflow],
  );

  const blockCurrentWorkflowOnUnknownOwnership = useCallback(
    async (
      error: CommandError,
      statusKey: 'status.openFailed' | 'status.saveFailed',
    ) => {
      blockDocumentClaimOwnership(claimWorkflowRuntime, error);
      await reportErrorToCurrentWorkflow(error, statusKey);
    },
    [claimWorkflowRuntime, reportErrorToCurrentWorkflow],
  );

  const adoptCommittedPathFailClosed = useCallback(
    async (
      path: string,
      error: CommandError,
      statusKey: 'status.openFailed' | 'status.saveFailed',
    ) => {
      await blockCurrentWorkflowOnUnknownOwnership(error, statusKey);
      const currentWorkflow = await waitForCurrentWorkflow();
      const currentState = currentWorkflow.getStateAdapter();
      currentWorkflow.setStatusKey(statusKey);
      const adoptionFailures: Array<{ message: string; step: string }> = [];
      const attempt = (step: string, operation: () => void) => {
        try {
          operation();
        } catch (cause) {
          adoptionFailures.push({
            message: describeWorkflowFailure(cause),
            step,
          });
        }
      };
      const editor = currentWorkflow.getEditor();
      const nextFile = {
        name: path.split(/[\\/]/).at(-1)?.trim() || path,
        path,
      };

      attempt('editor.setContext', () => editor?.setContext({ path }));
      attempt('editor.markUnsaved', () => editor?.markUnsaved());
      attempt('state.setCurrentFile', () =>
        currentState.setCurrentFile(nextFile),
      );
      attempt('state.setDirty', () => {
        if (!currentState.getState().dirty) {
          currentState.setDirty(true);
        }
      });

      try {
        await replaceWatchedDocumentOnLatest(null);
      } catch (cause) {
        adoptionFailures.push({
          message: describeWorkflowFailure(cause),
          step: 'watcher.stop',
        });
      }

      if (adoptionFailures.length > 0) {
        await blockCurrentWorkflowOnUnknownOwnership(
          {
            ...error,
            details: {
              adoptionFailures,
              cause: error.details,
            },
          },
          statusKey,
        );
      }
    },
    [
      blockCurrentWorkflowOnUnknownOwnership,
      replaceWatchedDocumentOnLatest,
      waitForCurrentWorkflow,
    ],
  );

  const recoverReleasedDocumentAsUntitled = useCallback(
    async (
      snapshot: ReturnType<EditorDocumentPort['captureSnapshot']>,
      error: CommandError,
      restoreSnapshot = true,
    ) => {
      const currentWorkflow = await waitForCurrentWorkflow();
      const currentState = currentWorkflow.getStateAdapter();
      const editor = currentWorkflow.getEditor();
      const recoveryFailures: Array<{ message: string; step: string }> = [];
      const attempt = (step: string, operation: () => void) => {
        try {
          operation();
        } catch (cause) {
          recoveryFailures.push({
            message: describeWorkflowFailure(cause),
            step,
          });
        }
      };

      attempt('editor.loadText', () => {
        if (editor && restoreSnapshot) {
          editor.loadText(snapshot.serializedText);
        }
      });
      attempt('editor.setContext', () => editor?.setContext({ path: null }));
      attempt('editor.markUnsaved', () => editor?.markUnsaved());
      attempt('state.setCurrentFile', () => currentState.setCurrentFile(null));
      attempt('state.setDirty', () => {
        if (!currentState.getState().dirty) {
          currentState.setDirty(true);
        }
      });
      attempt('state.setLastFileError', () =>
        currentState.setLastFileError(error),
      );
      attempt('status.setStatusKey', () =>
        currentWorkflow.setStatusKey('status.openFailed'),
      );

      try {
        await replaceWatchedDocumentOnLatest(null);
      } catch (cause) {
        recoveryFailures.push({
          message: describeWorkflowFailure(cause),
          step: 'watcher.stop',
        });
      }

      if (recoveryFailures.length > 0) {
        await blockCurrentWorkflowOnUnknownOwnership(
          {
            ...error,
            details: {
              cause: error.details,
              recoveryFailures,
            },
          },
          'status.openFailed',
        );
      }
    },
    [
      blockCurrentWorkflowOnUnknownOwnership,
      replaceWatchedDocumentOnLatest,
      waitForCurrentWorkflow,
    ],
  );

  const createActions = useCallback(
    (
      claimOperationId: number,
      shouldApplyOpenResult?: () => boolean,
      shouldApplySaveResult?: () => boolean,
      editorOverride?: EditorDocumentPort,
      stateOverride?: FileActionStateAdapter,
    ) => {
      const editor = editorOverride ?? editorRef.current;
      const actionState = stateOverride ?? state;

      if (!editor) {
        return null;
      }

      const browserCommands = resolveFileCommandClient();
      return createFileActions({
        commands: {
          readText: (path) =>
            documentClaimClient.readTextClaimed(claimOperationId, path),
          showOpenDialog:
            browserCommands?.showOpenDialog ?? showOpenFileDialog,
          showSaveDialog:
            browserCommands?.showSaveDialog ?? showSaveFileDialog,
          writeText: (path, text) =>
            documentClaimClient.writeTextClaimed(
              claimOperationId,
              path,
              text,
            ),
        },
        editor: {
          captureDocumentSnapshot: editor.captureSnapshot,
          focus: editor.focus,
          isDocumentSnapshotCurrent: editor.isSnapshotCurrent,
          loadDocument: editor.loadText,
          markDocumentSaved: editor.markSaved,
          markDocumentUnsaved: editor.markUnsaved,
          setDocumentContext: editor.setContext,
        },
        recentFiles,
        prepareTextForSave,
        shouldApplyOpenResult,
        shouldApplySaveResult,
        state: actionState,
      });
    },
    [
      documentClaimClient,
      editorRef,
      prepareTextForSave,
      recentFiles,
      state,
    ],
  );

  const openPath = useCallback(
    async (path: string, allowDirty = false) => {
      const ownershipBlock = getDocumentClaimOwnershipBlock(
        claimWorkflowRuntime,
      );
      if (ownershipBlock) {
        state.setLastFileError(ownershipBlock);
        status.setStatusKey('status.openFailed');
        return { status: 'failed' } as const;
      }
      if (hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime)) {
        return { status: 'superseded' } as const;
      }
      if (state.getState().dirty && !allowDirty) {
        return { status: 'superseded' } as const;
      }

      const requestId = nextOperationId('status.openFailed');
      if (requestId === null) {
        return { status: 'failed' } as const;
      }
      const ownsRequest = () =>
        requestId === getDocumentClaimOperationId(claimWorkflowRuntime);
      let baseline = editorRef.current
        ? captureDocumentOpenBaseline(editorRef.current, state, allowDirty)
        : null;
      let openResultWasCurrent = false;
      const isCurrentRequest = () => {
        const editor = editorRef.current;
        return Boolean(
          ownsRequest() &&
          baseline &&
          editor &&
          isDocumentOpenBaselineCurrent(baseline, editor, state),
        );
      };
      const shouldApplyOpenResult = () => {
        const current = isCurrentRequest();
        openResultWasCurrent = current;
        return current;
      };
      fileOpeningRef.current = true;
      setFileOpening(true);
      status.setStatusKey('status.opening');
      let reservationHeld = false;
      let irreversibleTransitionStarted = false;
      let releaseTransitionLock: (() => boolean) | null = null;
      let speculativeRead: ReturnType<
        NonNullable<ReturnType<typeof createActions>>['readFile']
      > | null = null;
      try {
        await waitForEditor();

        if (!ownsRequest()) {
          return { status: 'superseded' } as const;
        }

        const editor = editorRef.current;
        baseline ??= editor
          ? captureDocumentOpenBaseline(editor, state, allowDirty)
          : null;
        if (!baseline) {
          return { status: 'superseded' } as const;
        }

        const actions = createActions(requestId, shouldApplyOpenResult);

        if (!actions) {
          return { status: 'superseded' } as const;
        }

        const session = await waitForClaimSession();
        if (!isCurrentRequest()) {
          return { status: 'superseded' } as const;
        }
        if (!session.ok) {
          state.setLastFileError(session.error);
          status.setStatusKey('status.openFailed');
          return { status: 'failed' } as const;
        }

        speculativeRead = actions.readFile(path);

        const reservationTerminal = await reserveDocumentToTerminal(
          documentClaimClient,
          requestId,
          path,
        );
        if (reservationTerminal.status === 'unknown') {
          await blockCurrentWorkflowOnUnknownOwnership(
            reservationTerminal.error,
            'status.openFailed',
          );
          return { status: 'failed' } as const;
        }
        if (reservationTerminal.status === 'released') {
          if (isCurrentRequest()) {
            state.setLastFileError(reservationTerminal.error);
            status.setStatusKey('status.openFailed');
            return { status: 'failed' } as const;
          }
          return { status: 'superseded' } as const;
        }
        const reservation = reservationTerminal.reservation;
        if (!isCurrentRequest()) {
          reservationHeld = reservation.status === 'reserved';
          return { status: 'superseded' } as const;
        }
        if (reservation.status === 'ownedBy') {
          const focused = await documentClaimClient.focusWindow(
            reservation.windowLabel,
          );
          if (!isCurrentRequest()) {
            return { status: 'superseded' } as const;
          }
          if (!focused.ok) {
            await reportErrorToCurrentWorkflow(
              focused.error,
              'status.openFailed',
            );
            return { status: 'failed' } as const;
          }
          const currentWorkflow = await waitForCurrentWorkflow();
          if (!isCurrentRequest()) {
            return { status: 'superseded' } as const;
          }
          currentWorkflow.setStatusKey('status.ready');
          return {
            status: 'focused',
            windowLabel: reservation.windowLabel,
          } as const;
        }
        const alreadyOwned = reservation.status === 'alreadyOwned';
        if (alreadyOwned) {
          setDocumentClaimOwnedOperation(
            claimWorkflowRuntime,
            requestId,
            path,
          );
        }
        const currentFile = state.getState().currentFile;
        if (
          alreadyOwned &&
          currentFile &&
          areWatchedPathsEqual(currentFile.path, path)
        ) {
          status.setStatusKey('status.ready');
          return { status: 'focused', windowLabel: null } as const;
        }
        if (reservation.status === 'alreadyPending') {
          status.setStatusKey('status.ready');
          return { status: 'superseded' } as const;
        }
        if (reservation.status === 'alreadyReleased') {
          status.setStatusKey('status.ready');
          return { status: 'superseded' } as const;
        }
        reservationHeld = !alreadyOwned;

        const result = await speculativeRead;

        if (!isCurrentRequest()) {
          return { status: 'superseded' } as const;
        }

        if (!result.ok) {
          actions.applyOpenResult(result);
          status.setStatusKey('status.openFailed');
          return { status: 'failed' } as const;
        }

        const currentEditor = editorRef.current;
        if (!currentEditor) {
          return { status: 'superseded' } as const;
        }
        releaseTransitionLock = lockDocumentTransition(
          currentEditor,
          'status.openFailed',
        );
        if (!isCurrentRequest()) {
          return { status: 'superseded' } as const;
        }

        if (!beginIrreversibleTransition(requestId)) {
          return { status: 'superseded' } as const;
        }
        irreversibleTransitionStarted = true;
        if (!alreadyOwned) {
          const terminal = await commitReservationToTerminal(
            documentClaimClient,
            requestId,
            result.data.path,
          );
          reservationHeld = false;
          if (terminal.status === 'unknown') {
            setDocumentClaimOwnedOperation(
              claimWorkflowRuntime,
              requestId,
              result.data.path,
            );
            await adoptCommittedPathFailClosed(
              result.data.path,
              terminal.error,
              'status.openFailed',
            );
            return { status: 'failed' } as const;
          }
          if (terminal.status === 'released') {
            finishIrreversibleTransition(requestId);
            irreversibleTransitionStarted = false;
            await reportErrorToCurrentWorkflow(
              terminal.error,
              'status.openFailed',
            );
            return { status: 'failed' } as const;
          }
          setDocumentClaimOwnedOperation(
            claimWorkflowRuntime,
            requestId,
            result.data.path,
          );
        }

        const terminalWorkflow = await waitForCurrentWorkflow();
        const terminalEditor = terminalWorkflow.getEditor();
        const terminalState = terminalWorkflow.getStateAdapter();
        if (!terminalEditor) {
          const error = documentClaimWorkflowError(
            'document_claim.editor_unavailable',
            'The editor was unavailable while applying the opened document.',
          );
          await adoptCommittedPathFailClosed(
            result.data.path,
            error,
            'status.openFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return { status: 'failed' } as const;
        }
        if (
          !baseline ||
          !isDocumentOpenBaselineCurrent(
            baseline,
            terminalEditor,
            terminalState,
          )
        ) {
          const error = documentClaimWorkflowError(
            'document_claim.open_apply_incomplete',
            'The latest editor changed before the committed document could be applied.',
          );
          await adoptCommittedPathFailClosed(
            result.data.path,
            error,
            'status.openFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return { status: 'failed' } as const;
        }
        if (terminalWorkflow.id !== workflowMountId) {
          const handoff = handoffDocumentTransitionLock(
            releaseTransitionLock,
            terminalEditor,
            'status.openFailed',
          );
          releaseTransitionLock = handoff.release;
          if (handoff.error) {
            await adoptCommittedPathFailClosed(
              result.data.path,
              handoff.error,
              'status.openFailed',
            );
            finishIrreversibleTransition(requestId);
            irreversibleTransitionStarted = false;
            return { status: 'failed' } as const;
          }
        }
        const terminalActions = createActions(
          requestId,
          shouldApplyOpenResult,
          undefined,
          terminalEditor,
          terminalState,
        );
        if (!terminalActions) {
          return { status: 'failed' } as const;
        }

        try {
          terminalActions.applyOpenResult(result);
        } catch (cause) {
          const error = unexpectedDocumentClaimWorkflowError(
            'document_claim.open_apply_failed',
            'The committed document could not be applied to the editor.',
            cause,
          );
          await adoptCommittedPathFailClosed(
            result.data.path,
            error,
            'status.openFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return { status: 'failed' } as const;
        }

        if (!ownsRequest() || !openResultWasCurrent) {
          const error = documentClaimWorkflowError(
            'document_claim.open_apply_incomplete',
            'The committed document could not be applied safely.',
          );
          await adoptCommittedPathFailClosed(
            result.data.path,
            error,
            'status.openFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return { status: 'failed' } as const;
        }

        const appliedFile = terminalWorkflow.getStateAdapter().getState()
          .currentFile!;
        finishIrreversibleTransition(requestId);
        irreversibleTransitionStarted = false;

        if (!releaseTransitionLock || !releaseTransitionLock()) {
          const currentWorkflow = await waitForCurrentWorkflow();
          currentWorkflow.setStatusKey('status.openFailed');
          return { status: 'failed' } as const;
        }
        releaseTransitionLock = null;

        const watcher = await replaceWatchedDocumentOnLatest(
          result.data.path,
          result.data.fingerprint,
          (mount) => mount.onDocumentLoaded(),
        );
        const currentWorkflow = watcher.currentWorkflow;
        const currentState = currentWorkflow.getStateAdapter().getState();
        const openedFile = currentState.currentFile;
        if (
          !openedFile ||
          !areWatchedPathsEqual(openedFile.path, result.data.path)
        ) {
          return { file: appliedFile, status: 'opened' } as const;
        }
        if (
          !currentState.dirty &&
          currentWorkflow.getEditor()?.serializeText() === result.data.text
        ) {
          currentWorkflow.onDocumentBecameSafe();
        }
        currentWorkflow.setStatusKey('status.opened');
        return { file: openedFile, status: 'opened' } as const;
      } finally {
        if (speculativeRead) {
          try {
            await speculativeRead;
          } catch {
            // Reservation outcome decides whether the document may load.
          }
        }
        releaseTransitionLock?.();
        if (
          irreversibleTransitionStarted &&
          !getDocumentClaimOwnershipBlock(claimWorkflowRuntime)
        ) {
          await blockCurrentWorkflowOnUnknownOwnership(
            documentClaimWorkflowError(
              'document_claim.irreversible_transition_incomplete',
              'The document ownership transition did not finish safely.',
            ),
            'status.openFailed',
          );
        }
        if (reservationHeld) {
          const released = await releaseReservationToTerminal(
            documentClaimClient,
            requestId,
            path,
          );
          if (released.status === 'owned') {
            const ownershipRelease = await releaseOwnedDocumentToTerminal(
              documentClaimClient,
              path,
            );
            if (ownershipRelease.status === 'unknown') {
              blockOnUnknownOwnership(
                ownershipRelease.error,
                'status.openFailed',
              );
            } else {
              clearDocumentClaimOwnedOperation(
                claimWorkflowRuntime,
                requestId,
              );
            }
          } else if (released.status === 'unknown') {
            blockOnUnknownOwnership(released.error, 'status.openFailed');
          }
        }
        if (ownsRequest()) {
          fileOpeningRef.current = false;
          setFileOpening(false);
        }
      }
    },
    [
      adoptCommittedPathFailClosed,
      beginIrreversibleTransition,
      blockOnUnknownOwnership,
      blockCurrentWorkflowOnUnknownOwnership,
      claimWorkflowRuntime,
      createActions,
      documentClaimClient,
      editorRef,
      finishIrreversibleTransition,
      handoffDocumentTransitionLock,
      lockDocumentTransition,
      nextOperationId,
      replaceWatchedDocumentOnLatest,
      reportErrorToCurrentWorkflow,
      state,
      status,
      waitForClaimSession,
      waitForCurrentWorkflow,
      waitForEditor,
      workflowMountId,
    ],
  );

  const openPathAfterDiscard = useCallback(
    (path: string) => openPath(path, true),
    [openPath],
  );

  const openFromDialog = useCallback(
    async (allowDirty = false) => {
    if (
      hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime) ||
      fileOpeningRef.current ||
      (state.getState().dirty && !allowDirty)
    ) {
      return { status: 'superseded' } as const;
    }

    const requestId = nextOperationId('status.openFailed');
    if (requestId === null) {
      return { status: 'failed' } as const;
    }
    const ownsRequest = () =>
      requestId === getDocumentClaimOperationId(claimWorkflowRuntime);
    fileOpeningRef.current = true;
    setFileOpening(true);
    status.setStatusKey('status.opening');
    try {
      await waitForEditor();
      if (!ownsRequest()) {
        return { status: 'superseded' } as const;
      }

      const actions = createActions(requestId, ownsRequest);
      if (!actions) {
        return { status: 'superseded' } as const;
      }

      const selection = await actions.selectOpenFilePath();
      if (!ownsRequest()) {
        return { status: 'superseded' } as const;
      }
      if (!selection.ok) {
        status.setStatusKey('status.openFailed');
        return { status: 'failed' } as const;
      }
      if (!selection.data) {
        status.setStatusKey('status.ready');
        return { status: 'cancelled' } as const;
      }

      return openPath(selection.data, allowDirty);
    } finally {
      if (ownsRequest()) {
        fileOpeningRef.current = false;
        setFileOpening(false);
      }
    }
  }, [
    claimWorkflowRuntime,
    createActions,
    nextOperationId,
    openPath,
    state,
    status,
    waitForEditor,
  ]);

  const openFromDialogAfterDiscard = useCallback(
    () => openFromDialog(true),
    [openFromDialog],
  );

  const createNewDocument = useCallback(async () => {
    const ownershipBlock = getDocumentClaimOwnershipBlock(
      claimWorkflowRuntime,
    );
    if (ownershipBlock) {
      state.setLastFileError(ownershipBlock);
      status.setStatusKey('status.openFailed');
      return false;
    }
    if (hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime)) {
      return false;
    }
    const requestId = nextOperationId('status.openFailed');
    if (requestId === null) {
      return false;
    }
    const ownsRequest = () =>
      requestId === getDocumentClaimOperationId(claimWorkflowRuntime);
    fileOpeningRef.current = true;
    setFileOpening(true);
    let irreversibleTransitionStarted = false;
    let releaseTransitionLock: (() => boolean) | null = null;

    try {
      const editor = editorRef.current;
      if (!editor) {
        status.setStatusKey('status.ready');
        return false;
      }
      const initialBaseline = captureDocumentOpenBaseline(editor, state, true);
      releaseTransitionLock = lockDocumentTransition(
        editor,
        'status.openFailed',
      );

      const currentPath = state.getState().currentFile?.path ?? null;
      if (currentPath) {
        const session = await waitForClaimSession();
        if (!ownsRequest()) {
          return false;
        }
        if (!session.ok) {
          state.setLastFileError(session.error);
          status.setStatusKey('status.openFailed');
          return false;
        }

        if (!beginIrreversibleTransition(requestId)) {
          return false;
        }
        irreversibleTransitionStarted = true;
        const released = await releaseOwnedDocumentToTerminal(
          documentClaimClient,
          currentPath,
        );
        if (released.status === 'unknown') {
          await blockCurrentWorkflowOnUnknownOwnership(
            released.error,
            'status.openFailed',
          );
          return false;
        }
        clearDocumentClaimOwnedOperation(claimWorkflowRuntime);
      }

      const terminalWorkflow = await waitForCurrentWorkflow();
      const terminalEditor = terminalWorkflow.getEditor();
      const terminalState = terminalWorkflow.getStateAdapter();
      if (!terminalEditor) {
        await reportErrorToCurrentWorkflow(
          documentClaimWorkflowError(
            'document_claim.editor_unavailable',
            'The editor was unavailable while creating the untitled document.',
          ),
          'status.openFailed',
        );
        return false;
      }
      if (terminalWorkflow.id !== workflowMountId) {
        const handoff = handoffDocumentTransitionLock(
          releaseTransitionLock,
          terminalEditor,
          'status.openFailed',
        );
        releaseTransitionLock = handoff.release;
        if (handoff.error) {
          await recoverReleasedDocumentAsUntitled(
            terminalEditor.captureSnapshot(),
            handoff.error,
          );
          if (irreversibleTransitionStarted) {
            finishIrreversibleTransition(requestId);
            irreversibleTransitionStarted = false;
          }
          return false;
        }
      }
      if (
        !initialBaseline ||
        !isDocumentOpenBaselineCurrent(
          initialBaseline,
          terminalEditor,
          terminalState,
        )
      ) {
        await recoverReleasedDocumentAsUntitled(
          terminalEditor.captureSnapshot(),
          documentClaimWorkflowError(
            'document_claim.new_apply_incomplete',
            'The latest editor changed before the untitled document could be applied.',
          ),
          false,
        );
        if (irreversibleTransitionStarted) {
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
        }
        return false;
      }
      const terminalActions = createActions(
        requestId,
        undefined,
        undefined,
        terminalEditor,
        terminalState,
      );
      if (!terminalActions) {
        return false;
      }
      const previousSnapshot = terminalEditor.captureSnapshot();

      try {
        terminalActions.createNewDocument();
      } catch (cause) {
        await recoverReleasedDocumentAsUntitled(
          previousSnapshot,
          unexpectedDocumentClaimWorkflowError(
            'document_claim.new_apply_failed',
            'The released document could not be replaced with an untitled document.',
            cause,
          ),
        );
        if (irreversibleTransitionStarted) {
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
        }
        return false;
      }
      if (irreversibleTransitionStarted) {
        finishIrreversibleTransition(requestId);
        irreversibleTransitionStarted = false;
      }
      if (!releaseTransitionLock || !releaseTransitionLock()) {
        const currentWorkflow = await waitForCurrentWorkflow();
        currentWorkflow.setStatusKey('status.openFailed');
        return false;
      }
      releaseTransitionLock = null;
      const watcher = await replaceWatchedDocumentOnLatest(
        null,
        undefined,
        (mount) => mount.onDocumentLoaded(),
      );
      const currentWorkflow = watcher.currentWorkflow;
      if (!ownsRequest()) {
        return false;
      }
      currentWorkflow.onDocumentBecameSafe();
      currentWorkflow.setStatusKey('status.ready');
      return true;
    } finally {
      releaseTransitionLock?.();
      if (
        irreversibleTransitionStarted &&
        !getDocumentClaimOwnershipBlock(claimWorkflowRuntime)
      ) {
        await blockCurrentWorkflowOnUnknownOwnership(
          documentClaimWorkflowError(
            'document_claim.irreversible_transition_incomplete',
            'The document ownership transition did not finish safely.',
          ),
          'status.openFailed',
        );
      }
      if (ownsRequest()) {
        fileOpeningRef.current = false;
        setFileOpening(false);
      }
    }
  }, [
    beginIrreversibleTransition,
    blockCurrentWorkflowOnUnknownOwnership,
    claimWorkflowRuntime,
    createActions,
    documentClaimClient,
    editorRef,
    finishIrreversibleTransition,
    handoffDocumentTransitionLock,
    lockDocumentTransition,
    nextOperationId,
    recoverReleasedDocumentAsUntitled,
    reportErrorToCurrentWorkflow,
    replaceWatchedDocumentOnLatest,
    state,
    status,
    waitForClaimSession,
    waitForCurrentWorkflow,
    workflowMountId,
  ]);

  const supersedePendingOpen = useCallback(() => {
    if (
      !fileOpeningRef.current ||
      hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime)
    ) {
      return;
    }

    const supersedingOperation = nextDocumentClaimOperationId(claimWorkflowRuntime);
    if (!supersedingOperation.ok) {
      blockOnUnknownOwnership(
        supersedingOperation.error,
        'status.openFailed',
      );
      return;
    }
    fileOpeningRef.current = false;
    setFileOpening(false);
    status.setStatusKey('status.ready');
  }, [blockOnUnknownOwnership, claimWorkflowRuntime, status]);

  const resolveOwnedOperationForSave = useCallback(
    async (
      path: string,
      requestId: number,
    ): Promise<OwnedOperationResolution> => {
      const ownsRequest = () =>
        requestId === getDocumentClaimOperationId(claimWorkflowRuntime);
      let irreversibleTransitionStarted = false;
      let reservationHeld = false;

      try {
        if (!ownsRequest()) {
          return { status: 'superseded' };
        }
        const session = await waitForClaimSession();
        if (!ownsRequest()) {
          return { status: 'superseded' };
        }
        if (!session.ok) {
          await reportErrorToCurrentWorkflow(
            session.error,
            'status.saveFailed',
          );
          return { status: 'failed' };
        }

        const reservationTerminal = await reserveDocumentToTerminal(
          documentClaimClient,
          requestId,
          path,
        );
        if (reservationTerminal.status === 'unknown') {
          await blockCurrentWorkflowOnUnknownOwnership(
            reservationTerminal.error,
            'status.saveFailed',
          );
          return { status: 'failed' };
        }
        if (reservationTerminal.status === 'released') {
          await reportErrorToCurrentWorkflow(
            reservationTerminal.error,
            'status.saveFailed',
          );
          return { status: 'failed' };
        }

        const reservation = reservationTerminal.reservation;
        if (!ownsRequest()) {
          reservationHeld = reservation.status === 'reserved';
          return { status: 'superseded' };
        }
        if (reservation.status === 'ownedBy') {
          const focused = await documentClaimClient.focusWindow(
            reservation.windowLabel,
          );
          if (!ownsRequest()) {
            return { status: 'superseded' };
          }
          const error = focused.ok
            ? documentClaimWorkflowError(
                'document_claim.owned_by_other_window',
                'Another window owns the document being saved.',
              )
            : focused.error;
          await reportErrorToCurrentWorkflow(error, 'status.saveFailed');
          return { status: 'failed' };
        }
        if (reservation.status === 'alreadyPending') {
          await reportErrorToCurrentWorkflow(
            documentClaimWorkflowError(
              'document_claim.operation_already_pending',
              'The document save claim is already pending.',
            ),
            'status.saveFailed',
          );
          return { status: 'failed' };
        }
        if (reservation.status === 'alreadyReleased') {
          await reportErrorToCurrentWorkflow(
            documentClaimWorkflowError(
              'document_claim.operation_already_released',
              'The document save claim was already released.',
            ),
            'status.saveFailed',
          );
          return { status: 'failed' };
        }
        if (reservation.status === 'alreadyOwned') {
          setDocumentClaimOwnedOperation(
            claimWorkflowRuntime,
            requestId,
            path,
          );
          return { operationId: requestId, status: 'owned' };
        }

        reservationHeld = true;
        if (!beginIrreversibleTransition(requestId)) {
          return { status: 'superseded' };
        }
        irreversibleTransitionStarted = true;
        const terminal = await commitReservationToTerminal(
          documentClaimClient,
          requestId,
          path,
        );
        reservationHeld = false;
        if (terminal.status === 'unknown') {
          await blockCurrentWorkflowOnUnknownOwnership(
            terminal.error,
            'status.saveFailed',
          );
          return { status: 'failed' };
        }
        if (terminal.status === 'released') {
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          await reportErrorToCurrentWorkflow(
            terminal.error,
            'status.saveFailed',
          );
          return { status: 'failed' };
        }

        setDocumentClaimOwnedOperation(
          claimWorkflowRuntime,
          requestId,
          path,
        );
        finishIrreversibleTransition(requestId);
        irreversibleTransitionStarted = false;
        return { operationId: requestId, status: 'owned' };
      } finally {
        if (
          irreversibleTransitionStarted &&
          !getDocumentClaimOwnershipBlock(claimWorkflowRuntime)
        ) {
          await blockCurrentWorkflowOnUnknownOwnership(
            documentClaimWorkflowError(
              'document_claim.irreversible_transition_incomplete',
              'The document ownership transition did not finish safely.',
            ),
            'status.saveFailed',
          );
        }
        if (reservationHeld) {
          const released = await releaseReservationToTerminal(
            documentClaimClient,
            requestId,
            path,
          );
          if (released.status === 'owned') {
            const ownershipRelease = await releaseOwnedDocumentToTerminal(
              documentClaimClient,
              path,
            );
            if (ownershipRelease.status === 'unknown') {
              await blockCurrentWorkflowOnUnknownOwnership(
                ownershipRelease.error,
                'status.saveFailed',
              );
            } else {
              clearDocumentClaimOwnedOperation(
                claimWorkflowRuntime,
                requestId,
              );
            }
          } else if (released.status === 'unknown') {
            await blockCurrentWorkflowOnUnknownOwnership(
              released.error,
              'status.saveFailed',
            );
          }
        }
      }
    },
    [
      beginIrreversibleTransition,
      blockCurrentWorkflowOnUnknownOwnership,
      claimWorkflowRuntime,
      documentClaimClient,
      finishIrreversibleTransition,
      reportErrorToCurrentWorkflow,
      waitForClaimSession,
    ],
  );

  const saveCurrentFile = useCallback(() => {
    const requestedEditor = editorRef.current;
    const requestedSnapshot = requestedEditor?.captureSnapshot() ?? null;
    return enqueueSave(async () => {
      const ownershipBlock = getDocumentClaimOwnershipBlock(
        claimWorkflowRuntime,
      );
      if (ownershipBlock) {
        state.setLastFileError(ownershipBlock);
        status.setStatusKey('status.saveFailed');
        return;
      }
      if (
        hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime) ||
        fileOpeningRef.current
      ) {
        return;
      }

      const currentFile = state.getState().currentFile;
      if (!currentFile) {
        return;
      }
      const sourceGeneration = getDocumentClaimWorkflowMountGeneration(
        claimWorkflowRuntime,
        workflowMountId,
      );
      if (sourceGeneration === null) {
        return;
      }
      const retainedOperation = getDocumentClaimOwnedOperation(
        claimWorkflowRuntime,
      );
      const retainedCurrentOperation =
        retainedOperation &&
        areWatchedPathsEqual(retainedOperation.path, currentFile.path)
          ? retainedOperation
          : null;
      const claimOperationId =
        retainedCurrentOperation?.operationId ??
        nextOperationId('status.saveFailed');
      if (claimOperationId === null) {
        return;
      }
      const requestEpoch = getDocumentClaimOperationId(claimWorkflowRuntime);
      let resolvedOwnedOperationId =
        retainedCurrentOperation?.operationId ?? null;
      const isCurrentRequest = () => {
        const latestFile = state.getState().currentFile;
        if (
          requestEpoch !== getDocumentClaimOperationId(claimWorkflowRuntime) ||
          !latestFile ||
          !areWatchedPathsEqual(latestFile.path, currentFile.path)
        ) {
          return false;
        }
        if (resolvedOwnedOperationId === null) {
          return true;
        }
        const latestOwnedOperation = getDocumentClaimOwnedOperation(
          claimWorkflowRuntime,
        );
        return Boolean(
          latestOwnedOperation?.operationId === resolvedOwnedOperationId &&
          areWatchedPathsEqual(latestOwnedOperation.path, currentFile.path)
        );
      };
      const actions = createActions(
        claimOperationId,
        undefined,
        isCurrentRequest,
        requestedEditor && requestedSnapshot
          ? {
              ...requestedEditor,
              captureSnapshot: () => requestedSnapshot,
            }
          : undefined,
      );
      if (!actions) {
        return;
      }
      const prepared = await actions.prepareCurrentFileSave();
      if (!prepared.ok) {
        status.setStatusKey('status.saveFailed');
        return;
      }

      const ownedOperation: OwnedOperationResolution = retainedCurrentOperation
        ? {
            operationId: retainedCurrentOperation.operationId,
            status: 'owned',
          }
        : await resolveOwnedOperationForSave(
            currentFile.path,
            claimOperationId,
          );
      if (ownedOperation.status !== 'owned' || fileOpeningRef.current) {
        return;
      }
      resolvedOwnedOperationId = ownedOperation.operationId;
      if (!isCurrentRequest()) {
        return;
      }

      if (!beginIrreversibleTransition(requestEpoch)) {
        return;
      }
      let irreversibleTransitionStarted = true;
      try {
        const result = await prepared.data.write();

        if (!isCurrentRequest()) {
          return;
        }

        const terminalWorkflow = await waitForCurrentWorkflow();
        const terminalEditor = terminalWorkflow.getEditor();
        const terminalState = terminalWorkflow.getStateAdapter();
        if (!result.ok) {
          if (terminalWorkflow.generation === sourceGeneration) {
            prepared.data.apply(result);
            terminalWorkflow.setStatusKey('status.saveFailed');
          } else {
            await reportErrorToCurrentWorkflow(
              result.error,
              'status.saveFailed',
            );
          }
          finishIrreversibleTransition(requestEpoch);
          irreversibleTransitionStarted = false;
          return;
        }

        if (!terminalEditor) {
          await blockCurrentWorkflowOnUnknownOwnership(
            documentClaimWorkflowError(
              'document_claim.editor_unavailable',
              'The editor was unavailable while applying the saved document.',
            ),
            'status.saveFailed',
          );
          finishIrreversibleTransition(requestEpoch);
          irreversibleTransitionStarted = false;
          return;
        }

        if (terminalWorkflow.generation === sourceGeneration) {
          prepared.data.apply(result);
        } else {
          try {
            terminalEditor.setContext({ path: result.data.path });
            terminalEditor.markUnsaved();
            if (!terminalState.getState().dirty) {
              terminalState.setDirty(true);
            }
            terminalState.setLastFileError(null);
            recentFiles.addRecentFile(currentFile);
          } catch (cause) {
            await blockCurrentWorkflowOnUnknownOwnership(
              unexpectedDocumentClaimWorkflowError(
                'document_claim.save_apply_failed',
                'The completed save could not be reconciled with the latest editor.',
                cause,
              ),
              'status.saveFailed',
            );
            finishIrreversibleTransition(requestEpoch);
            irreversibleTransitionStarted = false;
            return;
          }
        }

        finishIrreversibleTransition(requestEpoch);
        irreversibleTransitionStarted = false;

        const savedState = terminalState.getState();
        if (result.data) {
          const savedRevision = savedState.dirtyRevision;
          const watcher = await replaceWatchedDocumentOnLatest(
            result.data.path,
            result.data.fingerprint,
          );
          const currentWorkflow = watcher.currentWorkflow;
          if (!isCurrentRequest() || savedState.dirty) {
            return;
          }
          const watchedState = currentWorkflow.getStateAdapter().getState();
          if (
            watchedState.dirty ||
            watchedState.dirtyRevision !== savedRevision
          ) {
            return;
          }
          currentWorkflow.onDocumentBecameSafe();
          currentWorkflow.setStatusKey('status.saved');
        }
      } finally {
        if (irreversibleTransitionStarted) {
          await blockCurrentWorkflowOnUnknownOwnership(
            documentClaimWorkflowError(
              'document_claim.irreversible_transition_incomplete',
              'The document save did not finish safely.',
            ),
            'status.saveFailed',
          );
          finishIrreversibleTransition(requestEpoch);
        }
      }
    });
  }, [
    beginIrreversibleTransition,
    blockCurrentWorkflowOnUnknownOwnership,
    claimWorkflowRuntime,
    createActions,
    editorRef,
    enqueueSave,
    finishIrreversibleTransition,
    nextOperationId,
    recentFiles,
    replaceWatchedDocumentOnLatest,
    reportErrorToCurrentWorkflow,
    resolveOwnedOperationForSave,
    state,
    status,
    waitForCurrentWorkflow,
    workflowMountId,
  ]);

  const saveAs = useCallback(() => {
    return enqueueSave(async () => {
      const ownershipBlock = getDocumentClaimOwnershipBlock(
        claimWorkflowRuntime,
      );
      if (ownershipBlock) {
        state.setLastFileError(ownershipBlock);
        status.setStatusKey('status.saveFailed');
        return;
      }
      if (
        hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime) ||
        fileOpeningRef.current
      ) {
        return;
      }

      const requestId = nextOperationId('status.saveFailed');
      if (requestId === null) {
        return;
      }
      const isCurrentRequest = () =>
        requestId === getDocumentClaimOperationId(claimWorkflowRuntime);
      if (!isCurrentRequest() || fileOpeningRef.current) {
        return;
      }

      const actions = createActions(requestId, undefined, isCurrentRequest);
      if (!actions) {
        return;
      }

      let reservationHeld = false;
      let irreversibleTransitionStarted = false;
      let releaseTransitionLock: (() => boolean) | null = null;
      let targetPath: string | null = null;
      try {
        const selection = await actions.selectSaveFilePath();
        if (!isCurrentRequest()) {
          return;
        }
        if (!selection.ok) {
          status.setStatusKey('status.saveFailed');
          return;
        }
        if (!selection.data) {
          return;
        }
        targetPath = selection.data;

        const session = await waitForClaimSession();
        if (!isCurrentRequest()) {
          return;
        }
        if (!session.ok) {
          state.setLastFileError(session.error);
          status.setStatusKey('status.saveFailed');
          return;
        }

        const reservationTerminal = await reserveDocumentToTerminal(
          documentClaimClient,
          requestId,
          targetPath,
        );
        if (reservationTerminal.status === 'unknown') {
          await blockCurrentWorkflowOnUnknownOwnership(
            reservationTerminal.error,
            'status.saveFailed',
          );
          return;
        }
        if (reservationTerminal.status === 'released') {
          if (isCurrentRequest()) {
            state.setLastFileError(reservationTerminal.error);
            status.setStatusKey('status.saveFailed');
          }
          return;
        }
        const reservation = reservationTerminal.reservation;
        if (!isCurrentRequest()) {
          reservationHeld = reservation.status === 'reserved';
          return;
        }
        if (reservation.status === 'ownedBy') {
          const focused = await documentClaimClient.focusWindow(
            reservation.windowLabel,
          );
          if (!isCurrentRequest()) {
            return;
          }
          if (!focused.ok) {
            await reportErrorToCurrentWorkflow(
              focused.error,
              'status.saveFailed',
            );
          }
          return;
        }
        if (reservation.status === 'alreadyReleased') {
          return;
        }
        if (reservation.status === 'alreadyPending') {
          return;
        }
        const needsCommit = reservation.status !== 'alreadyOwned';
        if (!needsCommit) {
          setDocumentClaimOwnedOperation(
            claimWorkflowRuntime,
            requestId,
            targetPath,
          );
        }
        reservationHeld = needsCommit;

        const prepared = await actions.prepareCurrentFileSave(targetPath);
        if (!isCurrentRequest()) {
          return;
        }
        if (!prepared.ok) {
          status.setStatusKey('status.saveFailed');
          return;
        }

        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        releaseTransitionLock = lockDocumentTransition(
          editor,
          'status.saveFailed',
        );
        if (!isCurrentRequest()) {
          return;
        }
        if (!beginIrreversibleTransition(requestId)) {
          return;
        }
        irreversibleTransitionStarted = true;

        const result = await prepared.data.write();
        if (!isCurrentRequest()) {
          return;
        }
        if (!result.ok) {
          const terminalWorkflow = await waitForCurrentWorkflow();
          if (terminalWorkflow.getEditor() === editor) {
            prepared.data.apply(result);
          } else {
            await reportErrorToCurrentWorkflow(
              result.error,
              'status.saveFailed',
            );
          }
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return;
        }
        if (needsCommit) {
          const terminal = await commitReservationToTerminal(
            documentClaimClient,
            requestId,
            result.data.path,
          );
          reservationHeld = false;
          if (terminal.status === 'unknown') {
            setDocumentClaimOwnedOperation(
              claimWorkflowRuntime,
              requestId,
              result.data.path,
            );
            await adoptCommittedPathFailClosed(
              result.data.path,
              terminal.error,
              'status.saveFailed',
            );
            return;
          }
          if (terminal.status === 'released') {
            finishIrreversibleTransition(requestId);
            irreversibleTransitionStarted = false;
            await reportErrorToCurrentWorkflow(
              terminal.error,
              'status.saveFailed',
            );
            return;
          }
          setDocumentClaimOwnedOperation(
            claimWorkflowRuntime,
            requestId,
            result.data.path,
          );
        }

        const terminalWorkflow = await waitForCurrentWorkflow();
        const terminalEditor = terminalWorkflow.getEditor();
        const terminalState = terminalWorkflow.getStateAdapter();
        if (!terminalEditor) {
          const error = documentClaimWorkflowError(
            'document_claim.editor_unavailable',
            'The editor was unavailable while applying the Save As result.',
          );
          await adoptCommittedPathFailClosed(
            result.data.path,
            error,
            'status.saveFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return;
        }
        const terminalUsesSourceEditor =
          terminalState === state &&
          areEditorDocumentPortsEquivalent(terminalEditor, editor);
        if (!terminalUsesSourceEditor) {
          const handoff = handoffDocumentTransitionLock(
            releaseTransitionLock,
            terminalEditor,
            'status.saveFailed',
          );
          releaseTransitionLock = handoff.release;
          if (handoff.error) {
            await adoptCommittedPathFailClosed(
              result.data.path,
              handoff.error,
              'status.saveFailed',
            );
            finishIrreversibleTransition(requestId);
            irreversibleTransitionStarted = false;
            return;
          }
        }

        try {
          if (terminalUsesSourceEditor) {
            prepared.data.apply(result);
          } else {
            const nextFile = {
              name:
                result.data.path.split(/[\\/]/).at(-1)?.trim() ||
                result.data.path,
              path: result.data.path,
            };
            terminalEditor.setContext({ path: result.data.path });
            terminalEditor.markUnsaved();
            terminalState.setCurrentFile(nextFile);
            if (!terminalState.getState().dirty) {
              terminalState.setDirty(true);
            }
            terminalState.setLastFileError(null);
            recentFiles.addRecentFile(nextFile);
          }
        } catch (cause) {
          const error = unexpectedDocumentClaimWorkflowError(
            'document_claim.save_apply_failed',
            'The committed Save As result could not be applied to the editor.',
            cause,
          );
          await adoptCommittedPathFailClosed(
            result.data.path,
            error,
            'status.saveFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return;
        }
        if (!isCurrentRequest()) {
          await adoptCommittedPathFailClosed(
            result.data.path,
            documentClaimWorkflowError(
              'document_claim.save_apply_incomplete',
              'The committed Save As result could not be applied safely.',
            ),
            'status.saveFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return;
        }
        finishIrreversibleTransition(requestId);
        irreversibleTransitionStarted = false;
        if (!releaseTransitionLock || !releaseTransitionLock()) {
          const currentWorkflow = await waitForCurrentWorkflow();
          currentWorkflow.setStatusKey('status.saveFailed');
          return;
        }
        releaseTransitionLock = null;
        const savedState = terminalState.getState();
        const savedRevision = savedState.dirtyRevision;
        const savedCleanly = !savedState.dirty;
        const watcher = await replaceWatchedDocumentOnLatest(
          result.data.path,
          result.data.fingerprint,
        );
        const currentWorkflow = watcher.currentWorkflow;
        if (!isCurrentRequest() || !savedCleanly) {
          return;
        }
        const watchedState = currentWorkflow.getStateAdapter().getState();
        if (
          watchedState.dirty ||
          watchedState.dirtyRevision !== savedRevision
        ) {
          return;
        }
        currentWorkflow.onDocumentBecameSafe();
        currentWorkflow.setStatusKey('status.saved');
      } finally {
        releaseTransitionLock?.();
        if (
          irreversibleTransitionStarted &&
          !getDocumentClaimOwnershipBlock(claimWorkflowRuntime)
        ) {
          await blockCurrentWorkflowOnUnknownOwnership(
            documentClaimWorkflowError(
              'document_claim.irreversible_transition_incomplete',
              'The document ownership transition did not finish safely.',
            ),
            'status.saveFailed',
          );
        }
        if (reservationHeld && targetPath) {
          const released = await releaseReservationToTerminal(
            documentClaimClient,
            requestId,
            targetPath,
          );
          if (released.status === 'owned') {
            const ownershipRelease = await releaseOwnedDocumentToTerminal(
              documentClaimClient,
              targetPath,
            );
            if (ownershipRelease.status === 'unknown') {
              blockOnUnknownOwnership(
                ownershipRelease.error,
                'status.saveFailed',
              );
            } else {
              clearDocumentClaimOwnedOperation(
                claimWorkflowRuntime,
                requestId,
              );
            }
          } else if (released.status === 'unknown') {
            blockOnUnknownOwnership(released.error, 'status.saveFailed');
          }
        }
      }
    });
  }, [
    adoptCommittedPathFailClosed,
    beginIrreversibleTransition,
    blockOnUnknownOwnership,
    blockCurrentWorkflowOnUnknownOwnership,
    claimWorkflowRuntime,
    createActions,
    documentClaimClient,
    editorRef,
    enqueueSave,
    finishIrreversibleTransition,
    handoffDocumentTransitionLock,
    lockDocumentTransition,
    nextOperationId,
    recentFiles,
    reportErrorToCurrentWorkflow,
    replaceWatchedDocumentOnLatest,
    state,
    status,
    waitForClaimSession,
    waitForCurrentWorkflow,
  ]);

  const save = useCallback(() => {
    if (state.getState().currentFile) {
      return saveCurrentFile();
    }
    return saveAs();
  }, [saveAs, saveCurrentFile, state]);

  const performRetargetOpenDocument = useCallback(
    async (
      path: string,
      options?: RetargetOpenDocumentOptions,
    ): Promise<RetargetOpenDocumentOutcome> => {
      const current = state.getState().currentFile;
      if (!current) {
        return { status: 'notCurrent' };
      }
      if (hasIrreversibleDocumentClaimTransition(claimWorkflowRuntime)) {
        return {
          error: documentClaimWorkflowError(
            'document_claim.irreversible_transition_in_progress',
            'Another document ownership transition is still being applied.',
          ),
          status: 'failed',
        };
      }
      if (options) {
        if (!areWatchedPathsEqual(current.path, options.expectedCurrentPath)) {
          return { status: 'notCurrent' };
        }
        const editor = editorRef.current;

        fileOpeningRef.current = true;
        setFileOpening(true);
        blockDocumentClaimOwnership(
          claimWorkflowRuntime,
          options.failClosedError,
        );
        state.setLastFileError(options.failClosedError);
        status.setStatusKey('status.openFailed');
        let blockedError = options.failClosedError;
        let releaseTransitionLock: () => boolean = () => true;
        if (editor) {
          try {
            releaseTransitionLock = lockDocumentTransition(
              editor,
              'status.openFailed',
            );
          } catch (cause) {
            blockedError = unexpectedDocumentClaimWorkflowError(
              'document_claim.fail_closed_transition_lock_failed',
              'The editor could not be locked during fail-closed ownership cleanup.',
              cause,
            );
            blockOnUnknownOwnership(blockedError, 'status.openFailed');
          }
        }
        try {
          await replaceWatchedDocumentOnLatest(null);
          const pathsToRelease = areWatchedPathsEqual(current.path, path)
            ? [current.path]
            : [current.path, path];
          let ownershipReleaseUnknown = false;
          for (const ownedPath of pathsToRelease) {
            const released = await releaseOwnedDocumentToTerminal(
              documentClaimClient,
              ownedPath,
            );
            if (released.status === 'unknown') {
              ownershipReleaseUnknown = true;
              blockedError = released.error;
            }
          }
          if (!ownershipReleaseUnknown) {
            clearDocumentClaimOwnedOperation(claimWorkflowRuntime);
          }
          await adoptCommittedPathFailClosed(
            path,
            blockedError,
            'status.openFailed',
          );
          return { status: 'failClosed' };
        } finally {
          if (!releaseTransitionLock()) {
            const currentWorkflow = await waitForCurrentWorkflow();
            currentWorkflow.setStatusKey('status.openFailed');
          }
          fileOpeningRef.current = false;
          setFileOpening(false);
        }
      }

      const ownershipBlock = getDocumentClaimOwnershipBlock(
        claimWorkflowRuntime,
      );
      if (ownershipBlock) {
        state.setLastFileError(ownershipBlock);
        status.setStatusKey('status.openFailed');
        return { error: ownershipBlock, status: 'failed' };
      }

      const requestId = nextOperationId('status.openFailed');
      if (requestId === null) {
        return {
          error: getDocumentClaimOwnershipBlock(claimWorkflowRuntime)!,
          status: 'failed',
        };
      }
      const ownsRequest = () =>
        requestId === getDocumentClaimOperationId(claimWorkflowRuntime);
      const noLongerTargetsCurrentDocument = (): RetargetOpenDocumentOutcome => {
        const latest = state.getState().currentFile;
        if (!latest || !areWatchedPathsEqual(latest.path, current.path)) {
          return { status: 'notCurrent' };
        }
        return {
          error: documentClaimWorkflowError(
            'document_claim.operation_superseded',
            'The document retarget operation was superseded.',
          ),
          status: 'failed',
        };
      };
      const stillTargetsCurrentDocument = () => {
        const latest = state.getState().currentFile;
        return Boolean(
          ownsRequest() &&
          latest &&
          areWatchedPathsEqual(latest.path, current.path),
        );
      };
      fileOpeningRef.current = false;
      setFileOpening(false);
      let reservationHeld = false;
      let irreversibleTransitionStarted = false;
      let releaseTransitionLock: (() => boolean) | null = null;

      try {
        const session = await waitForClaimSession();
        if (!stillTargetsCurrentDocument()) {
          return noLongerTargetsCurrentDocument();
        }
        if (!session.ok) {
          state.setLastFileError(session.error);
          status.setStatusKey('status.openFailed');
          return { error: session.error, status: 'failed' };
        }

        const reservationTerminal = await reserveDocumentToTerminal(
          documentClaimClient,
          requestId,
          path,
        );
        if (reservationTerminal.status === 'unknown') {
          blockOnUnknownOwnership(
            reservationTerminal.error,
            'status.openFailed',
          );
          return { error: reservationTerminal.error, status: 'failed' };
        }
        if (reservationTerminal.status === 'released') {
          if (stillTargetsCurrentDocument()) {
            state.setLastFileError(reservationTerminal.error);
            status.setStatusKey('status.openFailed');
          }
          return {
            error: reservationTerminal.error,
            status: 'failed',
          };
        }
        const reservation = reservationTerminal.reservation;
        if (!stillTargetsCurrentDocument()) {
          reservationHeld = reservation.status === 'reserved';
          return noLongerTargetsCurrentDocument();
        }
        if (reservation.status === 'ownedBy') {
          const focused = await documentClaimClient.focusWindow(
            reservation.windowLabel,
          );
          if (!stillTargetsCurrentDocument()) {
            return noLongerTargetsCurrentDocument();
          }
          const error = focused.ok
            ? documentClaimWorkflowError(
                'document_claim.owned_by_other_window',
                'Another window owns the renamed document.',
              )
            : focused.error;
          await reportErrorToCurrentWorkflow(error, 'status.openFailed');
          return { error, status: 'failed' };
        }
        if (reservation.status === 'alreadyPending') {
          const error = documentClaimWorkflowError(
            'document_claim.operation_already_pending',
            'The document retarget operation is already pending.',
          );
          state.setLastFileError(error);
          status.setStatusKey('status.openFailed');
          return { error, status: 'failed' };
        }
        if (reservation.status === 'alreadyReleased') {
          const error = documentClaimWorkflowError(
            'document_claim.operation_already_released',
            'The document retarget operation was already released.',
          );
          state.setLastFileError(error);
          status.setStatusKey('status.openFailed');
          return { error, status: 'failed' };
        }

        const needsCommit = reservation.status !== 'alreadyOwned';
        if (!needsCommit) {
          setDocumentClaimOwnedOperation(
            claimWorkflowRuntime,
            requestId,
            path,
          );
        }
        reservationHeld = needsCommit;
        const editor = editorRef.current;
        if (!editor) {
          const error = documentClaimWorkflowError(
            'document_claim.editor_unavailable',
            'The editor was unavailable while retargeting the document.',
          );
          state.setLastFileError(error);
          status.setStatusKey('status.openFailed');
          return { error, status: 'failed' };
        }
        releaseTransitionLock = lockDocumentTransition(
          editor,
          'status.openFailed',
        );
        if (!stillTargetsCurrentDocument()) {
          return noLongerTargetsCurrentDocument();
        }

        if (!beginIrreversibleTransition(requestId)) {
          return noLongerTargetsCurrentDocument();
        }
        irreversibleTransitionStarted = true;
        if (needsCommit) {
          const terminal = await commitReservationToTerminal(
            documentClaimClient,
            requestId,
            path,
          );
          reservationHeld = false;
          if (terminal.status === 'unknown') {
            setDocumentClaimOwnedOperation(
              claimWorkflowRuntime,
              requestId,
              path,
            );
            await adoptCommittedPathFailClosed(
              path,
              terminal.error,
              'status.openFailed',
            );
            return { error: terminal.error, status: 'indeterminate' };
          }
          if (terminal.status === 'released') {
            finishIrreversibleTransition(requestId);
            irreversibleTransitionStarted = false;
            await reportErrorToCurrentWorkflow(
              terminal.error,
              'status.openFailed',
            );
            return { error: terminal.error, status: 'failed' };
          }
          setDocumentClaimOwnedOperation(
            claimWorkflowRuntime,
            requestId,
            path,
          );
        }

        const terminalWorkflow = await waitForCurrentWorkflow();
        const terminalEditor = terminalWorkflow.getEditor();
        const terminalState = terminalWorkflow.getStateAdapter();
        if (!terminalEditor) {
          const error = documentClaimWorkflowError(
            'document_claim.editor_unavailable',
            'The editor was unavailable while applying the renamed path.',
          );
          await adoptCommittedPathFailClosed(
            path,
            error,
            'status.openFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return { status: 'failClosed' };
        }
        if (terminalWorkflow.id !== workflowMountId) {
          const handoff = handoffDocumentTransitionLock(
            releaseTransitionLock,
            terminalEditor,
            'status.openFailed',
          );
          releaseTransitionLock = handoff.release;
          if (handoff.error) {
            await adoptCommittedPathFailClosed(
              path,
              handoff.error,
              'status.openFailed',
            );
            finishIrreversibleTransition(requestId);
            irreversibleTransitionStarted = false;
            return { status: 'failClosed' };
          }
        }

        const nextFile = {
          name: path.split(/[\\/]/).at(-1)?.trim() || path,
          path,
        };
        try {
          terminalEditor.setContext({ path: nextFile.path });
          terminalState.setCurrentFile(nextFile);
          terminalState.setLastFileError(null);
        } catch (cause) {
          const error = unexpectedDocumentClaimWorkflowError(
            'document_claim.retarget_apply_failed',
            'The committed renamed path could not be applied to the editor.',
            cause,
          );
          await adoptCommittedPathFailClosed(
            path,
            error,
            'status.openFailed',
          );
          finishIrreversibleTransition(requestId);
          irreversibleTransitionStarted = false;
          return { status: 'failClosed' };
        }
        finishIrreversibleTransition(requestId);
        irreversibleTransitionStarted = false;
        if (!releaseTransitionLock || !releaseTransitionLock()) {
          const error = getDocumentClaimOwnershipBlock(claimWorkflowRuntime)!;
          const currentWorkflow = await waitForCurrentWorkflow();
          currentWorkflow.setStatusKey('status.openFailed');
          return { error, status: 'failed' };
        }
        releaseTransitionLock = null;
        const watcher = await replaceWatchedDocumentOnLatest(nextFile.path);
        const currentWorkflow = watcher.currentWorkflow;
        currentWorkflow.setStatusKey('status.ready');
        return { status: 'retargeted' };
      } finally {
        releaseTransitionLock?.();
        if (
          irreversibleTransitionStarted &&
          !getDocumentClaimOwnershipBlock(claimWorkflowRuntime)
        ) {
          await blockCurrentWorkflowOnUnknownOwnership(
            documentClaimWorkflowError(
              'document_claim.irreversible_transition_incomplete',
              'The document ownership transition did not finish safely.',
            ),
            'status.openFailed',
          );
        }
        if (reservationHeld) {
          const released = await releaseReservationToTerminal(
            documentClaimClient,
            requestId,
            path,
          );
          if (released.status === 'owned') {
            const ownershipRelease = await releaseOwnedDocumentToTerminal(
              documentClaimClient,
              path,
            );
            if (ownershipRelease.status === 'unknown') {
              blockOnUnknownOwnership(
                ownershipRelease.error,
                'status.openFailed',
              );
            } else {
              clearDocumentClaimOwnedOperation(
                claimWorkflowRuntime,
                requestId,
              );
            }
          } else if (released.status === 'unknown') {
            blockOnUnknownOwnership(released.error, 'status.openFailed');
          }
        }
      }
    },
    [
      adoptCommittedPathFailClosed,
      beginIrreversibleTransition,
      blockOnUnknownOwnership,
      blockCurrentWorkflowOnUnknownOwnership,
      claimWorkflowRuntime,
      documentClaimClient,
      editorRef,
      finishIrreversibleTransition,
      handoffDocumentTransitionLock,
      lockDocumentTransition,
      nextOperationId,
      replaceWatchedDocumentOnLatest,
      reportErrorToCurrentWorkflow,
      state,
      status,
      waitForClaimSession,
      waitForCurrentWorkflow,
      workflowMountId,
    ],
  );

  const retargetOpenDocument = useCallback(
    (path: string, options?: RetargetOpenDocumentOptions) => {
      const sourceGeneration = getDocumentClaimWorkflowMountGeneration(
        claimWorkflowRuntime,
        workflowMountId,
      );
      return enqueueDocumentClaimMutation(claimWorkflowRuntime, () => {
        if (
          sourceGeneration === null ||
          !isDocumentClaimWorkflowMountCurrent(
            claimWorkflowRuntime,
            sourceGeneration,
          )
        ) {
          return Promise.resolve({ status: 'notCurrent' as const });
        }
        return performRetargetOpenDocument(path, options);
      });
    },
    [claimWorkflowRuntime, performRetargetOpenDocument, workflowMountId],
  ) as RetargetOpenDocument;

  const runRetargetDocumentMutation = useCallback<RetargetDocumentMutation>(
    (operation) => {
      const sourceGeneration = getDocumentClaimWorkflowMountGeneration(
        claimWorkflowRuntime,
        workflowMountId,
      );
      return enqueueDocumentClaimMutation(claimWorkflowRuntime, async () => {
        if (
          sourceGeneration === null ||
          !isDocumentClaimWorkflowMountCurrent(
            claimWorkflowRuntime,
            sourceGeneration,
          )
        ) {
          return;
        }
        await operation(performRetargetOpenDocument);
      });
    },
    [claimWorkflowRuntime, performRetargetOpenDocument, workflowMountId],
  );

  useLayoutEffect(() => {
    retargetDocumentMutationRunners.set(
      retargetOpenDocument,
      runRetargetDocumentMutation,
    );
    return () => {
      if (
        retargetDocumentMutationRunners.get(retargetOpenDocument) ===
        runRetargetDocumentMutation
      ) {
        retargetDocumentMutationRunners.delete(retargetOpenDocument);
      }
    };
  }, [retargetOpenDocument, runRetargetDocumentMutation]);

  const markOpenDocumentRemoved = useCallback(
    (path: string) => {
      const current = state.getState().currentFile;
      if (!current || !areWatchedPathsEqual(current.path, path)) {
        return;
      }

      editorRef.current?.markUnsaved();
      if (!state.getState().dirty) {
        state.setDirty(true);
      }
      state.setLastFileError({
        code: 'file.not_found',
        message: 'The watched document is no longer available on disk.',
        recoverable: true,
      });
    },
    [editorRef, state],
  );

  return {
    createNewDocument,
    externalConflict,
    fileOpening,
    keepCurrentContent,
    markDocumentDirty,
    markOpenDocumentRemoved,
    openFromDialog,
    openFromDialogAfterDiscard,
    openPath,
    openPathAfterDiscard,
    reloadFromDisk,
    retargetOpenDocument,
    save,
    saveAs,
    supersedePendingOpen,
  };
}
