import { create } from 'zustand';

import {
  browserPreferenceStorage,
  type PreferenceStorage,
} from '../../services/preferences/browserPreferenceStorage';

export const PAGE_WIDTHS = ['narrow', 'standard', 'wide', 'fluid'] as const;
export type EditorPageWidth = (typeof PAGE_WIDTHS)[number];

export const DEFAULT_PAGE_WIDTH: EditorPageWidth = 'standard';
export const DEFAULT_FONT_ZOOM_PERCENT = 100;
export const MIN_FONT_ZOOM_PERCENT = 20;
export const MAX_FONT_ZOOM_PERCENT = 300;
export const FONT_ZOOM_STEP_PERCENT = 10;

const PAGE_WIDTH_PIXELS: Record<EditorPageWidth, number | null> = {
  fluid: null,
  narrow: 680,
  standard: 810,
  wide: 1040,
};

const READING_APPEARANCE_STORAGE_KEY = 'lumamark.reading-appearance.v1';
const READING_APPEARANCE_STORAGE_VERSION = 1;

export type ReadingAppearanceState = {
  fontZoomPercent: number;
  pageWidth: EditorPageWidth;
  pageWidthPersistenceError: boolean;
  resetZoom: () => void;
  setPageWidth: (pageWidth: EditorPageWidth) => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

type LoadedPageWidth = {
  pageWidth: EditorPageWidth;
  pageWidthPersistenceError: boolean;
};

export function isEditorPageWidth(value: unknown): value is EditorPageWidth {
  return PAGE_WIDTHS.some((pageWidth) => pageWidth === value);
}

export function getPageWidthPixels(pageWidth: EditorPageWidth): number | null {
  return PAGE_WIDTH_PIXELS[pageWidth];
}

function loadPageWidth(storage: PreferenceStorage): LoadedPageWidth {
  try {
    const serialized = storage.getItem(READING_APPEARANCE_STORAGE_KEY);

    if (serialized === null) {
      return {
        pageWidth: DEFAULT_PAGE_WIDTH,
        pageWidthPersistenceError: false,
      };
    }

    const persisted = JSON.parse(serialized) as {
      state?: { pageWidth?: unknown };
      version?: unknown;
    };
    const pageWidth = persisted.state?.pageWidth;

    if (
      persisted.version !== READING_APPEARANCE_STORAGE_VERSION ||
      !isEditorPageWidth(pageWidth)
    ) {
      throw new Error('Persisted page width is invalid.');
    }

    return { pageWidth, pageWidthPersistenceError: false };
  } catch {
    return {
      pageWidth: DEFAULT_PAGE_WIDTH,
      pageWidthPersistenceError: true,
    };
  }
}

function serializePageWidth(pageWidth: EditorPageWidth): string {
  return JSON.stringify({
    state: { pageWidth },
    version: READING_APPEARANCE_STORAGE_VERSION,
  });
}

export function createReadingAppearanceStore(
  storage: PreferenceStorage = browserPreferenceStorage,
) {
  const loadedPageWidth = loadPageWidth(storage);

  return create<ReadingAppearanceState>()((set) => ({
    fontZoomPercent: DEFAULT_FONT_ZOOM_PERCENT,
    ...loadedPageWidth,
    setPageWidth: (pageWidth) => {
      let pageWidthPersistenceError = false;

      try {
        storage.setItem(
          READING_APPEARANCE_STORAGE_KEY,
          serializePageWidth(pageWidth),
        );
      } catch {
        pageWidthPersistenceError = true;
      }

      set({ pageWidth, pageWidthPersistenceError });
    },
    resetZoom: () => {
      set((state) =>
        state.fontZoomPercent === DEFAULT_FONT_ZOOM_PERCENT
          ? state
          : { fontZoomPercent: DEFAULT_FONT_ZOOM_PERCENT },
      );
    },
    zoomIn: () => {
      set((state) => {
        const fontZoomPercent = Math.min(
          MAX_FONT_ZOOM_PERCENT,
          state.fontZoomPercent + FONT_ZOOM_STEP_PERCENT,
        );

        return fontZoomPercent === state.fontZoomPercent
          ? state
          : { fontZoomPercent };
      });
    },
    zoomOut: () => {
      set((state) => {
        const fontZoomPercent = Math.max(
          MIN_FONT_ZOOM_PERCENT,
          state.fontZoomPercent - FONT_ZOOM_STEP_PERCENT,
        );

        return fontZoomPercent === state.fontZoomPercent
          ? state
          : { fontZoomPercent };
      });
    },
  }));
}

export const useReadingAppearanceStore = createReadingAppearanceStore();
