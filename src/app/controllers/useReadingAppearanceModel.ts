import { useCallback, useMemo } from 'react';

import type { EditorZoomDirection } from '../../editor/core/editorAppearance';
import {
  getPageWidthPixels,
  useReadingAppearanceStore,
} from '../../features/reading-appearance/readingAppearanceStore';
import { syncFontZoomToSettings } from './applySettings';

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
  const appearance = useMemo(
    () => ({
      fontZoomPercent,
      pageWidthPx: getPageWidthPixels(pageWidth),
    }),
    [fontZoomPercent, pageWidth],
  );
  const onZoomRequested = useCallback((direction: EditorZoomDirection) => {
    if (direction === 'in') {
      useReadingAppearanceStore.getState().zoomIn();
    } else {
      useReadingAppearanceStore.getState().zoomOut();
    }

    syncFontZoomToSettings(
      useReadingAppearanceStore.getState().fontZoomPercent,
    );
  }, []);
  const resetZoomAndFocus = useCallback(() => {
    resetZoom();
    syncFontZoomToSettings(
      useReadingAppearanceStore.getState().fontZoomPercent,
    );
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
