import { useEffect, useMemo, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import packageMetadata from '../../../package.json';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';
import { createUpdateStore } from '../../features/updates/updateStore';
import { useUpdatePreferencesStore } from '../../features/updates/updatePreferencesStore';

const AUTO_CHECK_DELAY_MS = 5_000;

export function useUpdateModel() {
  const store = useMemo(
    () =>
      createUpdateStore({
        currentVersion: packageMetadata.version,
      }),
    [],
  );
  const autoCheckOnStartup = useUpdatePreferencesStore(
    (state) => state.autoCheckOnStartup,
  );
  const setAutoCheckOnStartup = useUpdatePreferencesStore(
    (state) => state.setAutoCheckOnStartup,
  );
  const updatePersistenceError = useUpdatePreferencesStore(
    (state) => state.updatePersistenceError,
  );
  const state = store();
  const autoCheckStartedRef = useRef(false);

  useEffect(() => {
    if (autoCheckStartedRef.current || !autoCheckOnStartup || !isTauri()) {
      return;
    }

    autoCheckStartedRef.current = true;
    const timer = window.setTimeout(() => {
      void store
        .getState()
        .checkForUpdates()
        .then(() => {
          const next = store.getState();
          if (next.errorCode) {
            logMenuInteraction(
              `auto update check failed: ${next.errorCode} ${next.errorMessage ?? ''}`,
            );
          }
        });
    }, AUTO_CHECK_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [autoCheckOnStartup, store]);

  return {
    autoCheckOnStartup,
    currentVersion: state.currentVersion,
    dialogOpen: state.dialogOpen,
    errorCode: state.errorCode,
    errorMessage: state.errorMessage,
    notes: state.notes,
    progress: state.progress,
    setAutoCheckOnStartup,
    status: state.status,
    updatePersistenceError,
    version: state.version,
    checkForUpdatesManually: () => {
      logMenuInteraction('handler checkForUpdates()');
      void store.getState().checkForUpdates({ openDialog: true });
    },
    closeDialog: () => {
      store.getState().closeDialog();
    },
    installAvailableUpdate: () => {
      void store.getState().installAvailableUpdate();
    },
    setDialogOpen: (open: boolean) => {
      if (open) {
        store.getState().openDialog();
        return;
      }
      store.getState().closeDialog();
    },
  };
}
