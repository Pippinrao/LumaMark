import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpenDocumentOutcome } from '../../features/file-actions/useFileWorkflow';
import type { CommandError } from '../../services/tauri/invokeCommand';
import {
  resolveOpenRequestClient,
  type OpenRequest,
  type OpenRequestClient,
} from '../../services/open-requests/openRequestClient';

export type UseDesktopOpenRequestsOptions = {
  client?: OpenRequestClient;
  dirty: boolean;
  editorReady: boolean;
  onOpened: (path: string) => void;
  openPath: (path: string) => Promise<OpenDocumentOutcome>;
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
};

export function useDesktopOpenRequests(
  options: UseDesktopOpenRequestsOptions,
): DesktopOpenRequests {
  const clientRef = useRef(options.client ?? resolveOpenRequestClient());
  const optionsRef = useRef(options);
  const mountedRef = useRef(true);
  const processingRef = useRef(false);
  const queueRef = useRef<OpenRequest[]>([]);
  const pendingRef = useRef<OpenRequest | null>(null);
  const drainChainRef = useRef(Promise.resolve());
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [blocksSessionRestore, setBlocksSessionRestore] = useState(false);
  const [pendingRequest, setPendingRequest] =
    useState<OpenRequest | null>(null);
  const [error, setError] = useState<CommandError | null>(null);
  const [pumpRevision, setPumpRevision] = useState(0);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const openRequest = useCallback(async (request: OpenRequest) => {
    processingRef.current = true;
    try {
      const outcome = await optionsRef.current.openPath(request.path);
      if (outcome.status === 'opened') {
        optionsRef.current.onOpened(outcome.file.path);
      }
    } finally {
      processingRef.current = false;
      setPumpRevision((revision) => revision + 1);
    }
  }, []);

  const pump = useCallback(() => {
    const current = optionsRef.current;
    if (
      processingRef.current ||
      pendingRef.current ||
      !current.editorReady ||
      !current.recoveryChecked ||
      current.recoveryPending
    ) {
      return;
    }

    const request = queueRef.current.shift();
    if (!request) {
      return;
    }

    if (current.dirty) {
      pendingRef.current = request;
      setPendingRequest(request);
      return;
    }

    void openRequest(request);
  }, [openRequest]);

  const drain = useCallback(() => {
    const runDrain = async (): Promise<boolean> => {
      let result;
      try {
        result = await clientRef.current.drain();
      } catch {
        if (mountedRef.current) {
          setError(desktopBridgeError('desktop.open_request_drain_failed'));
        }
        return false;
      }

      if (!result.ok) {
        if (mountedRef.current) {
          setError(result.error);
        }
        return false;
      }
      if (!mountedRef.current) {
        return false;
      }
      setBootstrapComplete(true);
      if (result.data.length > 0) {
        queueRef.current.push(...result.data);
        setBlocksSessionRestore(true);
        setPumpRevision((revision) => revision + 1);
      }
      return true;
    };
    const nextDrain = drainChainRef.current.then(runDrain, runDrain);
    drainChainRef.current = nextDrain.then(() => undefined);
    return nextDrain;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const stopListening = await clientRef.current.listen(() => {
          void drain();
        });
        if (cancelled) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      } catch {
        if (!cancelled) {
          setError(
            desktopBridgeError(
              'desktop.open_request_listener_unavailable',
            ),
          );
        }
      }

      await drain();
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      unlisten?.();
    };
  }, [drain]);

  useEffect(() => {
    pump();
  }, [
    options.dirty,
    options.editorReady,
    options.recoveryChecked,
    options.recoveryPending,
    pump,
    pumpRevision,
  ]);

  const confirmDiscard = useCallback(() => {
    const request = pendingRef.current;
    if (!request) {
      return;
    }
    pendingRef.current = null;
    setPendingRequest(null);
    void openRequest(request);
  }, [openRequest]);

  const cancelDiscard = useCallback(() => {
    pendingRef.current = null;
    queueRef.current = [];
    setPendingRequest(null);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
  }, []);

  return {
    blocksSessionRestore,
    bootstrapComplete,
    cancelDiscard,
    confirmDiscard,
    dismissError,
    error,
    pendingRequest,
  };
}

function desktopBridgeError(code: string): CommandError {
  return {
    code,
    message: 'Desktop open request bridge is unavailable.',
    recoverable: true,
  };
}
