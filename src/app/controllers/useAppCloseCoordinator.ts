import { useEffect, useMemo } from 'react';

import {
  windowControls,
  type WindowControls,
} from '../../services/window/windowControls';
import { markSettingsAcceptanceCloseEntered } from '../../services/settings/settingsClient';
import { createAppCloseCoordinator } from './appCloseCoordinator';

type AppCloseWindowControls = Pick<
  WindowControls,
  'destroy' | 'onCloseRequested'
>;

type UseAppCloseCoordinatorOptions = {
  controls?: AppCloseWindowControls;
  flushSettings: () => Promise<void>;
  markAcceptanceCloseEntered?: () => Promise<void>;
  onCloseBlocked: (error: unknown) => void;
};

export function useAppCloseCoordinator({
  controls = windowControls,
  flushSettings,
  markAcceptanceCloseEntered = markSettingsAcceptanceCloseEntered,
  onCloseBlocked,
}: UseAppCloseCoordinatorOptions) {
  const coordinator = useMemo(
    () =>
      createAppCloseCoordinator({
        destroy: controls.destroy,
        flushSettings,
        markAcceptanceCloseEntered,
        onCloseBlocked,
      }),
    [controls.destroy, flushSettings, markAcceptanceCloseEntered, onCloseBlocked],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void controls
      .onCloseRequested(async (event) => {
        await coordinator.handleCloseRequested(event);
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten?.();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error: unknown) => {
        if (!disposed) {
          onCloseBlocked(error);
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [controls, coordinator, onCloseBlocked]);

  return { requestClose: coordinator.requestClose };
}
