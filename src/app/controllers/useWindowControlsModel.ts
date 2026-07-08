import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { windowControls } from '../../services/window/windowControls';
import type { WindowControlsModel } from '../shell/shellTypes';

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

      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('[data-lm-window-interactive="true"]')
      ) {
        return;
      }

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
