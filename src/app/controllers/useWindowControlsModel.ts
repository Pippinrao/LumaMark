import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { logMenuInteraction } from '../../shared/debug/menuInteractionLog';
import { windowControls } from '../../services/window/windowControls';
import type { WindowControlsModel } from '../shell/shellTypes';
import { shouldStartChromeDragging } from './chromeDragging';

export function useWindowControlsModel(): WindowControlsModel {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let canceled = false;

    void windowControls.isMaximized().then((nextMaximized) => {
      if (!canceled && nextMaximized !== null) {
        setMaximized(nextMaximized);
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  const onChromeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }

      if (!shouldStartChromeDragging(event.currentTarget, event.target)) {
        logMenuInteraction(
          'chrome mousedown ignored (interactive or portaled menu)',
        );
        return;
      }

      logMenuInteraction('chrome mousedown → startDragging');
      void windowControls.startDragging();
    },
    [],
  );

  const onControl = useCallback(
    (action: 'close' | 'minimize' | 'toggleMaximize') => {
      if (action !== 'toggleMaximize') {
        void windowControls[action]();
        return;
      }

      void windowControls.toggleMaximize().then(async (toggled) => {
        if (!toggled) {
          return;
        }

        const nextMaximized = await windowControls.isMaximized();
        setMaximized((current) => nextMaximized ?? !current);
      });
    },
    [],
  );

  return {
    maximized,
    onChromeMouseDown,
    onControl,
  };
}
