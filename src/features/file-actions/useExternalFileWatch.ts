import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { EditorDocumentPort } from '../../editor/commands/editorCommandPort';
import type { FileWatchChangeEvent, FileWatchClient } from '../../services/file-watch/fileWatchClient';
import { resolveFileCommandClient } from '../../services/files/fileCommandClient';
import { readTextFile } from '../../services/files/fileCommands';
import type { CommandError } from '../../services/tauri/invokeCommand';
import type { FileActionStateAdapter } from './fileActions';

export type ExternalFileConflict = Pick<
  FileWatchChangeEvent,
  'fingerprint' | 'path' | 'revision'
>;

type StatusAdapter = {
  setStatusKey: (statusKey: string) => void;
};

type UseExternalFileWatchOptions = {
  editorRef: RefObject<EditorDocumentPort | null>;
  fileWatch: FileWatchClient;
  onDocumentBecameSafe: () => void;
  onLocalImageChanged: (event: FileWatchChangeEvent) => void;
  state: FileActionStateAdapter;
  status: StatusAdapter;
};

export type ExternalFileWatchModel = {
  conflict: ExternalFileConflict | null;
  keepCurrentContent: () => void;
  reloadFromDisk: () => Promise<void>;
  replaceWatchedDocument: (
    path: string | null,
    knownFingerprint?: string | null,
  ) => Promise<void>;
};

function normalizeSeparators(path: string): string {
  return path.replaceAll('\\', '/');
}

function isWindowsDrivePath(path: string): boolean {
  return /^[a-zA-Z]:\//.test(path);
}

export function areWatchedPathsEqual(left: string, right: string): boolean {
  const normalizedLeft = normalizeSeparators(left);
  const normalizedRight = normalizeSeparators(right);

  if (
    isWindowsDrivePath(normalizedLeft) &&
    isWindowsDrivePath(normalizedRight)
  ) {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }

  return normalizedLeft === normalizedRight;
}

function sameExternalVersion(
  left: ExternalFileConflict,
  right: ExternalFileConflict,
): boolean {
  if (!areWatchedPathsEqual(left.path, right.path)) {
    return false;
  }

  if (left.fingerprint != null || right.fingerprint != null) {
    return left.fingerprint === right.fingerprint;
  }

  return left.revision === right.revision;
}

function fileWatchError(cause: unknown): CommandError {
  const message =
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
      ? cause.message
      : 'The file watcher could not be started.';

  return {
    code: 'file.watch_error',
    details: cause,
    message,
    recoverable: true,
  };
}

async function readLatestText(path: string) {
  const browserCommands = resolveFileCommandClient();

  return browserCommands
    ? browserCommands.readText(path)
    : readTextFile(path);
}

export function useExternalFileWatch({
  editorRef,
  fileWatch,
  onDocumentBecameSafe,
  onLocalImageChanged,
  state,
  status,
}: UseExternalFileWatchOptions): ExternalFileWatchModel {
  const [conflict, setConflict] = useState<ExternalFileConflict | null>(null);
  const generationRef = useRef(0);
  const diskReadRequestRef = useRef(0);
  const latestWatchRevisionRef = useRef(0);
  const watchedPathRef = useRef<string | null>(null);
  const acknowledgedChangeRef = useRef<ExternalFileConflict | null>(null);
  const eventHandlerRef = useRef<(event: FileWatchChangeEvent) => void>(
    () => undefined,
  );

  const replaceWatchedDocument = useCallback(
    async (path: string | null, knownFingerprint?: string | null) => {
      diskReadRequestRef.current += 1;
      if (
        watchedPathRef.current &&
        path &&
        areWatchedPathsEqual(watchedPathRef.current, path)
      ) {
        return;
      }

      if (!watchedPathRef.current && !path) {
        return;
      }

      const generation = ++generationRef.current;
      watchedPathRef.current = null;
      acknowledgedChangeRef.current = null;
      setConflict(null);

      try {
        const unwatchResult = await fileWatch.unwatchDocument();

        if (generation !== generationRef.current) {
          return;
        }

        if (!unwatchResult.ok) {
          state.setLastFileError(fileWatchError(unwatchResult.error));
          return;
        }

        if (!path) {
          return;
        }

        watchedPathRef.current = path;
        const watchResult = await fileWatch.watchDocument(path);

        if (generation !== generationRef.current) {
          return;
        }

        if (!watchResult.ok) {
          diskReadRequestRef.current += 1;
          watchedPathRef.current = null;
          state.setLastFileError(fileWatchError(watchResult.error));
          return;
        }

        const watchFingerprint = watchResult.data?.fingerprint;
        if (
          knownFingerprint === undefined ||
          watchResult.data === undefined ||
          watchFingerprint === knownFingerprint
        ) {
          return;
        }

        const diskReadRequest = ++diskReadRequestRef.current;
        const latest = await readLatestText(path);

        if (
          diskReadRequest !== diskReadRequestRef.current ||
          generation !== generationRef.current ||
          !watchedPathRef.current ||
          !areWatchedPathsEqual(watchedPathRef.current, path)
        ) {
          return;
        }

        if (!latest.ok) {
          state.setLastFileError(latest.error);
          return;
        }

        const editor = editorRef.current;
        if (!editor || editor.serializeText() === latest.data.text) {
          return;
        }

        if (state.getState().dirty) {
          setConflict({ fingerprint: watchFingerprint, path, revision: 0 });
          return;
        }

        editor.loadText(latest.data.text, { preserveView: true });
        state.setDirty(false);
        state.setLastFileError(null);
        onDocumentBecameSafe();
        status.setStatusKey('status.externalReloaded');
      } catch (error) {
        if (generation === generationRef.current) {
          diskReadRequestRef.current += 1;
          watchedPathRef.current = null;
          state.setLastFileError(fileWatchError(error));
        }
      }
    },
    [editorRef, fileWatch, onDocumentBecameSafe, state, status],
  );

  const handleChange = useCallback(
    (event: FileWatchChangeEvent) => {
      if (event.revision <= latestWatchRevisionRef.current) {
        return;
      }
      latestWatchRevisionRef.current = event.revision;

      if (event.kind === 'error') {
        if (
          !event.path ||
          (watchedPathRef.current &&
            areWatchedPathsEqual(watchedPathRef.current, event.path))
        ) {
          diskReadRequestRef.current += 1;
        }
        state.setLastFileError({
          code: 'file.watch_error',
          message: 'A watched file could not be refreshed from disk.',
          recoverable: true,
        });
        return;
      }

      if (event.kind === 'image') {
        onLocalImageChanged(event);
        return;
      }

      const watchedPath = watchedPathRef.current;

      if (!watchedPath || !areWatchedPathsEqual(watchedPath, event.path)) {
        if (event.kind === 'removed') {
          onLocalImageChanged(event);
        }
        return;
      }

      if (event.kind === 'removed') {
        diskReadRequestRef.current += 1;
        setConflict(null);
        editorRef.current?.markUnsaved();
        if (!state.getState().dirty) {
          state.setDirty(true);
        }
        state.setLastFileError({
          code: 'file.not_found',
          message: 'The watched document is no longer available on disk.',
          recoverable: true,
        });
        return;
      }

      if (event.kind !== 'document') {
        return;
      }

      const eventVersion: ExternalFileConflict = {
        fingerprint: event.fingerprint,
        path: event.path,
        revision: event.revision,
      };

      if (
        acknowledgedChangeRef.current &&
        sameExternalVersion(acknowledgedChangeRef.current, eventVersion)
      ) {
        return;
      }

      acknowledgedChangeRef.current = null;
      const generation = generationRef.current;
      const diskReadRequest = ++diskReadRequestRef.current;

      void (async () => {
        const result = await readLatestText(watchedPath);

        if (
          diskReadRequest !== diskReadRequestRef.current ||
          generation !== generationRef.current ||
          !watchedPathRef.current ||
          !areWatchedPathsEqual(watchedPathRef.current, watchedPath)
        ) {
          return;
        }

        if (!result.ok) {
          state.setLastFileError(result.error);
          return;
        }

        const editor = editorRef.current;

        if (!editor || result.data.text === editor.serializeText()) {
          return;
        }

        if (state.getState().dirty) {
          setConflict(eventVersion);
          return;
        }

        editor.loadText(result.data.text, { preserveView: true });
        state.setDirty(false);
        state.setLastFileError(null);
        acknowledgedChangeRef.current = eventVersion;
        onDocumentBecameSafe();
        status.setStatusKey('status.externalReloaded');
      })();
    },
    [
      editorRef,
      onDocumentBecameSafe,
      onLocalImageChanged,
      state,
      status,
    ],
  );

  useEffect(() => {
    eventHandlerRef.current = handleChange;
  }, [handleChange]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    void fileWatch
      .listen((event) => {
        eventHandlerRef.current(event);
      })
      .then((stopListening) => {
        if (active) {
          unlisten = stopListening;
          return;
        }

        stopListening();
      })
      .catch((error: unknown) => {
        if (active) {
          state.setLastFileError(fileWatchError(error));
        }
      });

    return () => {
      active = false;
      generationRef.current += 1;
      diskReadRequestRef.current += 1;
      watchedPathRef.current = null;
      unlisten?.();
      void fileWatch.unwatchDocument().catch(() => undefined);
    };
  }, [fileWatch, state]);

  const reloadFromDisk = useCallback(async () => {
    const activeConflict = conflict;
    const watchedPath = watchedPathRef.current;

    if (
      !activeConflict ||
      !watchedPath ||
      !areWatchedPathsEqual(activeConflict.path, watchedPath)
    ) {
      return;
    }

    const generation = generationRef.current;
    const diskReadRequest = ++diskReadRequestRef.current;
    const result = await readLatestText(watchedPath);

    if (
      diskReadRequest !== diskReadRequestRef.current ||
      generation !== generationRef.current ||
      !watchedPathRef.current ||
      !areWatchedPathsEqual(watchedPathRef.current, watchedPath)
    ) {
      return;
    }

    if (!result.ok) {
      state.setLastFileError(result.error);
      return;
    }

    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    if (editor.serializeText() !== result.data.text) {
      editor.loadText(result.data.text, { preserveView: true });
    }
    state.setDirty(false);
    state.setLastFileError(null);
    acknowledgedChangeRef.current = activeConflict;
    setConflict(null);
    onDocumentBecameSafe();
    status.setStatusKey('status.externalReloaded');
  }, [editorRef, conflict, onDocumentBecameSafe, state, status]);

  const keepCurrentContent = useCallback(() => {
    if (!conflict) {
      return;
    }

    acknowledgedChangeRef.current = conflict;
    setConflict(null);
  }, [conflict]);

  return {
    conflict,
    keepCurrentContent,
    reloadFromDisk,
    replaceWatchedDocument,
  };
}
