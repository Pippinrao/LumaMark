import { create } from 'zustand';
import {
  checkForUpdate,
  type UpdateCheckOutcome,
  type UpdateDownloadProgress,
  type UpdaterServiceDependencies,
} from '../../services/updater/updaterService';

export type UpdateUiStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'upToDate'
  | 'error';

export type UpdateStoreState = {
  currentVersion: string;
  dialogOpen: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  notes: string | null;
  progress: UpdateDownloadProgress | null;
  status: UpdateUiStatus;
  version: string | null;
  checkForUpdates: (options?: {
    openDialog?: boolean;
    dependencies?: UpdaterServiceDependencies;
  }) => Promise<void>;
  closeDialog: () => void;
  installAvailableUpdate: (dependencies?: UpdaterServiceDependencies) => Promise<void>;
  openDialog: () => void;
  resetTransientState: () => void;
};

type CreateUpdateStoreOptions = {
  check?: typeof checkForUpdate;
  currentVersion: string;
};

export function createUpdateStore({
  check = checkForUpdate,
  currentVersion,
}: CreateUpdateStoreOptions) {
  let pendingInstall:
    | ((
        onProgress: (progress: UpdateDownloadProgress) => void,
      ) => Promise<{ kind: 'installed' } | { kind: 'failed'; code: string; message: string }>)
    | null = null;

  return create<UpdateStoreState>((set, get) => ({
    currentVersion,
    dialogOpen: false,
    errorCode: null,
    errorMessage: null,
    notes: null,
    progress: null,
    status: 'idle',
    version: null,
    openDialog: () => {
      set({ dialogOpen: true });
    },
    closeDialog: () => {
      set({ dialogOpen: false });
    },
    resetTransientState: () => {
      pendingInstall = null;
      set({
        errorCode: null,
        errorMessage: null,
        notes: null,
        progress: null,
        status: 'idle',
        version: null,
      });
    },
    checkForUpdates: async ({ openDialog = false, dependencies } = {}) => {
      if (get().status === 'checking' || get().status === 'downloading') {
        return;
      }

      set({
        dialogOpen: openDialog ? true : get().dialogOpen,
        errorCode: null,
        errorMessage: null,
        notes: null,
        progress: null,
        status: 'checking',
        version: null,
      });
      pendingInstall = null;

      const outcome = await check(dependencies);
      applyCheckOutcome(outcome, openDialog, set, (install) => {
        pendingInstall = install;
      });
    },
    installAvailableUpdate: async () => {
      const install = pendingInstall;
      if (!install) {
        set({
          dialogOpen: true,
          errorCode: 'update.downloadFailed',
          errorMessage: 'No available update is ready to install.',
          status: 'error',
        });
        return;
      }

      set({
        dialogOpen: true,
        errorCode: null,
        errorMessage: null,
        progress: { contentLength: null, downloaded: 0 },
        status: 'downloading',
      });

      const outcome = await install((progress) => {
        set({
          progress,
          status: 'downloading',
        });
      });

      if (outcome.kind === 'installed') {
        set({
          progress: get().progress,
          status: 'installing',
        });
        return;
      }

      set({
        dialogOpen: true,
        errorCode: outcome.code,
        errorMessage: outcome.message,
        status: 'error',
      });
    },
  }));
}

function applyCheckOutcome(
  outcome: UpdateCheckOutcome,
  openDialog: boolean,
  set: (
    partial:
      | Partial<UpdateStoreState>
      | ((state: UpdateStoreState) => Partial<UpdateStoreState>),
  ) => void,
  rememberInstall: (
    install: NonNullable<
      Extract<UpdateCheckOutcome, { kind: 'available' }>['install']
    >,
  ) => void,
) {
  switch (outcome.kind) {
    case 'unsupported':
      set({
        dialogOpen: openDialog,
        errorCode: 'update.unsupported',
        errorMessage: null,
        status: openDialog ? 'error' : 'idle',
      });
      return;
    case 'upToDate':
      set({
        dialogOpen: openDialog,
        status: 'upToDate',
      });
      return;
    case 'available':
      rememberInstall(outcome.install);
      set({
        dialogOpen: true,
        notes: outcome.notes ?? null,
        status: 'available',
        version: outcome.version,
      });
      return;
    case 'failed':
      set({
        dialogOpen: openDialog,
        errorCode: outcome.code,
        errorMessage: outcome.message,
        status: openDialog ? 'error' : 'idle',
      });
      return;
  }
}
