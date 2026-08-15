import { useCallback, useState } from 'react';

import {
  windowControls,
  type WindowControlErrorCode,
  type WindowControls,
} from '../../services/window/windowControls';
import { useAppCloseCoordinator } from './useAppCloseCoordinator';
import { useWindowControlsModel } from './useWindowControlsModel';

type AppCloseWindowControls = Pick<
  WindowControls,
  'destroy' | 'onCloseRequested'
>;

export function useAppWindowControls(
  flushSettings: () => Promise<void>,
  setSettingsOpen: (open: boolean) => void,
  controls: AppCloseWindowControls = windowControls,
) {
  const [closeErrorCode, setCloseErrorCode] =
    useState<WindowControlErrorCode | null>(null);
  const onCloseBlocked = useCallback(
    (error: unknown) => {
      const code = getWindowControlErrorCode(error);
      if (code) {
        setCloseErrorCode(code);
      }
      setSettingsOpen(true);
    },
    [setSettingsOpen],
  );
  const { requestClose } = useAppCloseCoordinator({
    controls,
    flushSettings,
    onCloseBlocked,
  });
  const windowControlsModel = useWindowControlsModel({ requestClose });

  return {
    ...windowControlsModel,
    closeErrorCode,
  };
}

function getWindowControlErrorCode(
  error: unknown,
): WindowControlErrorCode | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'window.close_listener_failed' ||
      error.code === 'window.destroy_failed')
  ) {
    return error.code;
  }

  return null;
}
