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
  | 'readyToInstall'
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
  installAvailableUpdate: () => Promise<void>;
  openDialog: () => void;
  resetTransientState: () => void;
};

type CreateUpdateStoreOptions = {
  check?: typeof checkForUpdate;
  currentVersion: string;
};

type PendingUpdate = {
  download: Extract<UpdateCheckOutcome, { kind: 'available' }>['download'];
  install: Extract<UpdateCheckOutcome, { kind: 'available' }>['install'];
};

const ACTIVE_UPDATE_STATUSES = new Set<UpdateUiStatus>([
  'checking',
  'downloading',
  'readyToInstall',
  'installing',
]);

export function createUpdateStore({
  check = checkForUpdate,
  currentVersion,
}: CreateUpdateStoreOptions) {
  let pendingUpdate: PendingUpdate | null = null;

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
      pendingUpdate = null;
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
      const current = get();
      if (ACTIVE_UPDATE_STATUSES.has(current.status)) {
        if (openDialog || current.dialogOpen) {
          set({ dialogOpen: true });
        }
        return;
      }

      set({
        dialogOpen: openDialog ? true : current.dialogOpen,
        errorCode: null,
        errorMessage: null,
        notes: null,
        progress: null,
        status: 'checking',
        version: null,
      });
      pendingUpdate = null;

      const outcome = await check(dependencies);
      applyCheckOutcome(outcome, openDialog, set, (next) => {
        pendingUpdate = next;
      });
    },
    installAvailableUpdate: async () => {
      const pending = pendingUpdate;
      const status = get().status;
      if (!pending) {
        set({
          dialogOpen: true,
          errorCode: 'update.downloadFailed',
          errorMessage: 'No available update is ready to install.',
          status: 'error',
        });
        return;
      }

      if (status === 'downloading' || status === 'installing') {
        set({ dialogOpen: true });
        return;
      }

      if (status === 'readyToInstall') {
        await installDownloadedUpdate(pending, set);
        return;
      }

      await downloadAvailableUpdate(pending, set, get);
    },
  }));
}

async function downloadAvailableUpdate(
  pending: PendingUpdate,
  set: (
    partial:
      | Partial<UpdateStoreState>
      | ((state: UpdateStoreState) => Partial<UpdateStoreState>),
  ) => void,
  get: () => UpdateStoreState,
): Promise<void> {
  set({
    dialogOpen: true,
    errorCode: null,
    errorMessage: null,
    progress: { contentLength: null, downloaded: 0 },
    status: 'downloading',
  });

  const outcome = await pending.download((progress) => {
    set({
      progress,
      status: 'downloading',
    });
  });

  if (get().status !== 'downloading') {
    return;
  }

  if (outcome.kind === 'downloaded') {
    set({
      dialogOpen: true,
      progress: get().progress,
      status: 'readyToInstall',
    });
    return;
  }

  set({
    dialogOpen: true,
    errorCode: outcome.code,
    errorMessage: outcome.message,
    status: 'error',
  });
}

async function installDownloadedUpdate(
  pending: PendingUpdate,
  set: (
    partial:
      | Partial<UpdateStoreState>
      | ((state: UpdateStoreState) => Partial<UpdateStoreState>),
  ) => void,
): Promise<void> {
  set({
    dialogOpen: true,
    errorCode: null,
    errorMessage: null,
    status: 'installing',
  });

  const outcome = await pending.install();
  if (outcome.kind === 'installed') {
    set({
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
}

function applyCheckOutcome(
  outcome: UpdateCheckOutcome,
  openDialog: boolean,
  set: (
    partial:
      | Partial<UpdateStoreState>
      | ((state: UpdateStoreState) => Partial<UpdateStoreState>),
  ) => void,
  rememberUpdate: (pending: PendingUpdate) => void,
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
      rememberUpdate({
        download: outcome.download,
        install: outcome.install,
      });
      set({
        dialogOpen: true,
        notes: outcome.notes ?? null,
        status: 'available',
        version: outcome.version,
      });
      return;
    case 'failed':
      set({
        dialogOpen: true,
        errorCode: outcome.code,
        errorMessage: outcome.message,
        status: 'error',
      });
      return;
  }
}
