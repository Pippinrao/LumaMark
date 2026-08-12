import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { windowControls } from '../../services/window/windowControls';
import type { WindowControlsModel } from '../shell/shellTypes';

export function useWindowControlsModel(): WindowControlsModel {
  const [maximized, setMaximized] = useState(false);
  const mountedRef = useRef(false);
  const refreshGenerationRef = useRef(0);

  const refreshMaximized = useCallback(async () => {
    const generation = ++refreshGenerationRef.current;
    const nextMaximized = await windowControls.isMaximized();

    if (
      mountedRef.current &&
      generation === refreshGenerationRef.current &&
      nextMaximized !== null
    ) {
      setMaximized(nextMaximized);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    mountedRef.current = true;

    void windowControls
      .onResized(() => {
        void refreshMaximized();
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten?.();
          return;
        }

        unlisten = nextUnlisten ?? undefined;
        void refreshMaximized();
      });
    void refreshMaximized();

    return () => {
      disposed = true;
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
      if (unlisten) {
        unlisten();
      }
    };
  }, [refreshMaximized]);

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

        await refreshMaximized();
      });
    },
    [refreshMaximized],
  );

  return {
    maximized,
    onControl,
  };
}
