import { create } from 'zustand';
import { areFilePathsEqual } from '../../services/files/filePathIdentity';
import {
  browserPreferenceStorage,
  type KeyValueStorage,
  type PreferenceStorage,
} from '../../services/preferences/browserPreferenceStorage';
import {
  BROWSER_RECENT_FILES_STORAGE_KEY,
  recentFilesClient,
  type RecentFile,
  type RecentFileInput,
  type RecentFilesClient,
  type RecentFilesSnapshot,
} from '../../services/recent-files/recentFilesClient';

export type { RecentFile, RecentFileInput };

type RecentFilesState = {
  recentFiles: RecentFile[];
  recentFilesPersistenceError: boolean;
  addRecentFile: (file: RecentFileInput) => Promise<void>;
  clearRecentFiles: () => Promise<void>;
  hydrateFromClient: () => Promise<void>;
};

type CreateRecentFilesStoreInput =
  | KeyValueStorage
  | {
      client: RecentFilesClient;
      legacyStorage?: PreferenceStorage;
    };

type OptimisticMutation =
  | {
      file: RecentFile;
      id: number;
      kind: 'add';
      status: 'failed' | 'pending';
    }
  | {
      id: number;
      kind: 'clear';
      status: 'failed' | 'pending';
    };

const MAX_RECENT_FILES = 20;
const RECENT_FILES_STORAGE_KEY = 'lumamark.recent-files.v1';

function parseRecentFiles(value: string | null): RecentFile[] {
  if (value === null) {
    return [];
  }

  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed) || !parsed.every(isRecentFile)) {
    throw new Error('Invalid persisted recent files');
  }

  return parsed.slice(0, MAX_RECENT_FILES);
}

function loadRecentFiles(
  storage: KeyValueStorage,
): Pick<RecentFilesState, 'recentFiles' | 'recentFilesPersistenceError'> {
  try {
    return {
      recentFiles: parseRecentFiles(storage.getItem(RECENT_FILES_STORAGE_KEY)),
      recentFilesPersistenceError: false,
    };
  } catch {
    return {
      recentFiles: [],
      recentFilesPersistenceError: true,
    };
  }
}

function persistRecentFiles(
  storage: KeyValueStorage,
  recentFiles: RecentFile[],
): boolean {
  try {
    storage.setItem(RECENT_FILES_STORAGE_KEY, JSON.stringify(recentFiles));
    return true;
  } catch {
    return false;
  }
}

function isRecentFile(value: unknown): value is RecentFile {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const file = value as Record<string, unknown>;

  return (
    typeof file.name === 'string' &&
    typeof file.openedAt === 'number' &&
    Number.isFinite(file.openedAt) &&
    typeof file.path === 'string'
  );
}

export function createRecentFilesStore(
  input: CreateRecentFilesStoreInput = browserPreferenceStorage,
) {
  const backend = isClientInput(input)
    ? {
        client: input.client,
        kind: 'client' as const,
        legacyStorage: input.legacyStorage,
      }
    : { kind: 'storage' as const, storage: input };
  let latestRevision = -1;
  let canonicalFiles: RecentFile[] = [];
  let nextMutationId = 0;
  let optimisticMutations: OptimisticMutation[] = [];
  let mutationChain = Promise.resolve();
  const persistenceFailures = new Set<string>();
  let hydrationPromise: Promise<void> | null = null;
  let unlisten: (() => void) | null = null;

  return create<RecentFilesState>((set) => {
    const projectedRecentFiles = () =>
      optimisticMutations.reduce<RecentFile[]>((files, mutation) => {
        if (mutation.kind === 'clear') {
          return [];
        }
        return projectOptimisticAdd(files, mutation.file);
      }, canonicalFiles);

    const publishClientState = () => {
      set({
        recentFiles: projectedRecentFiles(),
        recentFilesPersistenceError:
          persistenceFailures.size > 0 ||
          optimisticMutations.some(
            (mutation) => mutation.status === 'failed',
          ),
      });
    };

    const applySnapshot = (
      snapshot: RecentFilesSnapshot,
      clearFailure?: string,
    ) => {
      if (snapshot.revision < latestRevision) {
        if (clearFailure) {
          persistenceFailures.delete(clearFailure);
        }
        publishClientState();
        return;
      }

      latestRevision = snapshot.revision;
      canonicalFiles = snapshot.files;
      if (clearFailure) {
        persistenceFailures.delete(clearFailure);
      }
      optimisticMutations = optimisticMutations.filter(
        (mutation) =>
          mutation.status === 'pending' ||
          !snapshotConfirmsMutation(snapshot.files, mutation),
      );
      publishClientState();
    };

    const enqueueMutation = async (
      mutation: OptimisticMutation,
      operation: () => ReturnType<RecentFilesClient['add']>,
    ) => {
      optimisticMutations.push(mutation);
      publishClientState();
      const run = async () => {
        try {
          return await operation();
        } catch {
          return null;
        }
      };
      const result = mutationChain.then(run, run);
      mutationChain = result.then(() => undefined, () => undefined);
      const settled = await result;

      if (settled?.ok) {
        optimisticMutations = optimisticMutations.filter(
          (candidate) =>
            candidate.id !== mutation.id &&
            !(
              mutation.kind === 'add' &&
              candidate.id < mutation.id &&
              candidate.status === 'failed' &&
              (candidate.kind === 'clear' ||
                areFilePathsEqual(
                  candidate.file.path,
                  mutation.file.path,
                ))
            ),
        );
        applySnapshot(settled.data);
      } else {
        optimisticMutations = optimisticMutations.map((candidate) =>
          candidate.id === mutation.id
            ? { ...candidate, status: 'failed' }
            : candidate,
        );
        publishClientState();
      }
    };

    return {
      ...(backend.kind === 'storage'
        ? loadRecentFiles(backend.storage)
        : {
            recentFiles: [],
            recentFilesPersistenceError: false,
          }),
      addRecentFile: async (file) => {
        const nextFile: RecentFile = {
          name: file.name,
          openedAt: file.openedAt ?? Date.now(),
          path: file.path,
        };

        if (backend.kind === 'storage') {
          set((state) => {
            const recentFiles = addToRecentFiles(state.recentFiles, nextFile);

            return {
              recentFiles,
              recentFilesPersistenceError: !persistRecentFiles(
                backend.storage,
                recentFiles,
              ),
            };
          });
          return;
        }

        optimisticMutations = optimisticMutations.filter(
          (mutation) =>
            mutation.kind !== 'add' ||
            mutation.status !== 'failed' ||
            !areFilePathsEqual(mutation.file.path, nextFile.path),
        );
        await enqueueMutation(
          {
            file: nextFile,
            id: ++nextMutationId,
            kind: 'add',
            status: 'pending',
          },
          () => backend.client.add(nextFile),
        );
      },
      clearRecentFiles: async () => {
        const recentFiles: RecentFile[] = [];

        if (backend.kind === 'storage') {
          set({
            recentFiles,
            recentFilesPersistenceError: !persistRecentFiles(
              backend.storage,
              recentFiles,
            ),
          });
          return;
        }

        optimisticMutations = [];
        await enqueueMutation(
          {
            id: ++nextMutationId,
            kind: 'clear',
            status: 'pending',
          },
          () => backend.client.clear(),
        );
      },
      hydrateFromClient: () => {
        if (backend.kind === 'storage') {
          return Promise.resolve();
        }
        if (hydrationPromise) {
          return hydrationPromise;
        }

        hydrationPromise = (async () => {
          let subscriptionFailed = false;

          if (!unlisten) {
            try {
              unlisten = await backend.client.listen((snapshot) => {
                applySnapshot(snapshot);
              });
              persistenceFailures.delete('subscription');
            } catch {
              subscriptionFailed = true;
              persistenceFailures.add('subscription');
              publishClientState();
            }
          }

          const result = await backend.client.get();
          if (result.ok) {
            applySnapshot(
              result.data,
              subscriptionFailed ? undefined : 'hydration',
            );
            if (
              backend.legacyStorage &&
              !backend.client.ownsLegacyStorage
            ) {
              await migrateLegacyRecentFiles(
                backend.client,
                backend.legacyStorage,
                applySnapshot,
                () => {
                  persistenceFailures.add('migration');
                  publishClientState();
                },
                () => {
                  persistenceFailures.delete('migration');
                  publishClientState();
                },
              );
            }
          } else {
            persistenceFailures.add('hydration');
            publishClientState();
          }
        })().finally(() => {
          hydrationPromise = null;
        });

        return hydrationPromise;
      },
    };
  });
}

function addToRecentFiles(
  recentFiles: RecentFile[],
  nextFile: RecentFile,
): RecentFile[] {
  return [
    nextFile,
    ...recentFiles.filter(
      (recentFile) => !areFilePathsEqual(recentFile.path, nextFile.path),
    ),
  ].slice(0, MAX_RECENT_FILES);
}

function projectOptimisticAdd(
  recentFiles: RecentFile[],
  nextFile: RecentFile,
): RecentFile[] {
  const remaining = recentFiles.filter(
    (recentFile) => !areFilePathsEqual(recentFile.path, nextFile.path),
  );
  const insertAt = remaining.findIndex(
    (recentFile) => recentFile.openedAt <= nextFile.openedAt,
  );
  if (insertAt < 0) {
    return [...remaining, nextFile].slice(0, MAX_RECENT_FILES);
  }
  return [
    ...remaining.slice(0, insertAt),
    nextFile,
    ...remaining.slice(insertAt),
  ].slice(0, MAX_RECENT_FILES);
}

function isClientInput(
  input: CreateRecentFilesStoreInput,
): input is {
  client: RecentFilesClient;
  legacyStorage?: PreferenceStorage;
} {
  return 'client' in input;
}

async function migrateLegacyRecentFiles(
  client: RecentFilesClient,
  legacyStorage: PreferenceStorage,
  applySnapshot: (snapshot: RecentFilesSnapshot) => void,
  markFailed: () => void,
  markSucceeded: () => void,
): Promise<void> {
  let rawLegacyFiles: string | null;
  let legacyFiles: RecentFile[];
  try {
    rawLegacyFiles = legacyStorage.getItem(
      BROWSER_RECENT_FILES_STORAGE_KEY,
    );
    legacyFiles = parseRecentFiles(rawLegacyFiles);
  } catch {
    markFailed();
    return;
  }
  if (rawLegacyFiles === null) {
    markSucceeded();
    return;
  }

  if (legacyFiles.length > 0) {
    let result;
    try {
      result = await client.importLegacy(legacyFiles);
    } catch {
      markFailed();
      return;
    }
    if (!result.ok) {
      markFailed();
      return;
    }
    applySnapshot(result.data);
  }

  try {
    legacyStorage.removeItem(BROWSER_RECENT_FILES_STORAGE_KEY);
    markSucceeded();
  } catch {
    markFailed();
  }
}

function snapshotConfirmsMutation(
  files: RecentFile[],
  mutation: OptimisticMutation,
): boolean {
  if (mutation.kind === 'clear') {
    return files.length === 0;
  }

  return files.some(
    (file) =>
      areFilePathsEqual(file.path, mutation.file.path) &&
      file.name === mutation.file.name &&
      file.openedAt === mutation.file.openedAt,
  );
}

export const useRecentFilesStore = createRecentFilesStore({
  client: recentFilesClient,
  legacyStorage: browserPreferenceStorage,
});
