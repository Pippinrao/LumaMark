import { useCallback, useMemo } from 'react';

import type { EditorZoomDirection } from '../../editor/core/editorAppearance';
import {
  getPageWidthPixels,
  useReadingAppearanceStore,
} from '../../features/reading-appearance/readingAppearanceStore';

export function useReadingAppearanceModel(focusEditor: () => void) {
  const fontZoomPercent = useReadingAppearanceStore(
    (state) => state.fontZoomPercent,
  );
  const pageWidth = useReadingAppearanceStore((state) => state.pageWidth);
  const pageWidthPersistenceError = useReadingAppearanceStore(
    (state) => state.pageWidthPersistenceError,
  );
  const setPageWidth = useReadingAppearanceStore((state) => state.setPageWidth);
  const resetZoom = useReadingAppearanceStore((state) => state.resetZoom);
  const zoomIn = useReadingAppearanceStore((state) => state.zoomIn);
  const zoomOut = useReadingAppearanceStore((state) => state.zoomOut);
  const appearance = useMemo(
    () => ({
      fontZoomPercent,
      pageWidthPx: getPageWidthPixels(pageWidth),
    }),
    [fontZoomPercent, pageWidth],
  );
  const onZoomRequested = useCallback(
    (direction: EditorZoomDirection) => {
      if (direction === 'in') {
        zoomIn();
        return;
      }

      zoomOut();
    },
    [zoomIn, zoomOut],
  );
  const resetZoomAndFocus = useCallback(() => {
    resetZoom();
    focusEditor();
  }, [focusEditor, resetZoom]);

  return {
    appearance,
    onZoomRequested,
    pageWidth,
    pageWidthPersistenceError,
    resetZoom: resetZoomAndFocus,
    setPageWidth,
  };
}
