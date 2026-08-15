import {
  createWindowControlError,
  type WindowCloseRequestedEvent,
} from '../../services/window/windowControls';

export type AppCloseResult = 'blocked' | 'closed';

type AppCloseCoordinatorOptions = {
  destroy: () => Promise<boolean>;
  flushSettings: () => Promise<void>;
  markAcceptanceCloseEntered?: () => Promise<void>;
  onCloseBlocked: (error: unknown) => void;
};

export type AppCloseCoordinator = {
  handleCloseRequested: (
    event: WindowCloseRequestedEvent,
  ) => Promise<AppCloseResult>;
  requestClose: () => Promise<AppCloseResult>;
};

export function createAppCloseCoordinator({
  destroy,
  flushSettings,
  markAcceptanceCloseEntered = async () => undefined,
  onCloseBlocked,
}: AppCloseCoordinatorOptions): AppCloseCoordinator {
  let closeInFlight: Promise<AppCloseResult> | null = null;

  const requestClose = (): Promise<AppCloseResult> => {
    if (closeInFlight) {
      return closeInFlight;
    }

    const closeAttempt = (async (): Promise<AppCloseResult> => {
      try {
        await Promise.all([
          flushSettings(),
          markAcceptanceCloseEntered(),
        ]);
      } catch (error) {
        onCloseBlocked(error);
        return 'blocked';
      }

      try {
        const destroyed = await destroy();
        if (!destroyed) {
          throw createWindowControlError(
            'window.destroy_failed',
            'Unable to destroy the app window.',
          );
        }
        return 'closed';
      } catch (error) {
        onCloseBlocked(
          hasErrorCode(error, 'window.destroy_failed')
            ? error
            : createWindowControlError(
                'window.destroy_failed',
                'Unable to destroy the app window.',
                error,
              ),
        );
        return 'blocked';
      }
    })();

    closeInFlight = closeAttempt.finally(() => {
      closeInFlight = null;
    });
    return closeInFlight;
  };

  return {
    handleCloseRequested: (event) => {
      event.preventDefault();
      return requestClose();
    },
    requestClose,
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}
