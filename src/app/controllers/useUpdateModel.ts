import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import packageMetadata from '../../../package.json';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';
import { createUpdateStore } from '../../features/updates/updateStore';
import { patchSettings } from './applySettings';
import {
  type SettingsLoadState,
  useSettingsStore,
} from '../../features/settings/settingsStore';

const AUTO_CHECK_DELAY_MS = 5_000;

function isSettingsLoadSettled(
  status: SettingsLoadState['status'],
): boolean {
  return (
    status === 'ready' ||
    status === 'readFailed' ||
    status === 'unsupportedVersion'
  );
}

export function useUpdateModel() {
  const store = useMemo(
    () =>
      createUpdateStore({
        currentVersion: packageMetadata.version,
      }),
    [],
  );
  const autoCheckOnStartup = useSettingsStore(
    (state) => state.settings.updates.autoCheckOnStartup,
  );
  const settingsLoadStatus = useSettingsStore(
    (state) => state.loadState.status,
  );
  const settingsLoadSettled = isSettingsLoadSettled(settingsLoadStatus);
  const setAutoCheckOnStartup = useCallback((next: boolean) => {
    patchSettings((current) => ({
      ...current,
      updates: { ...current.updates, autoCheckOnStartup: next },
    }));
  }, []);
  const state = store();
  const autoCheckStartedRef = useRef(false);

  useEffect(() => {
    if (
      autoCheckStartedRef.current ||
      !settingsLoadSettled ||
      !autoCheckOnStartup ||
      !isTauri()
    ) {
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
  }, [autoCheckOnStartup, settingsLoadSettled, store]);

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
