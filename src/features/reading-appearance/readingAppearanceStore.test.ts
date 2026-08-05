import { describe, expect, it, vi } from 'vitest';

import type { PreferenceStorage } from '../../services/preferences/browserPreferenceStorage';

import {
  DEFAULT_FONT_ZOOM_PERCENT,
  DEFAULT_PAGE_WIDTH,
  MAX_FONT_ZOOM_PERCENT,
  MIN_FONT_ZOOM_PERCENT,
  PAGE_WIDTHS,
  createReadingAppearanceStore,
  getPageWidthPixels,
} from './readingAppearanceStore';

function createMemoryStorage(initialValue: string | null = null): PreferenceStorage {
  let value = initialValue;

  return {
    getItem: () => value,
    removeItem: () => {
      value = null;
    },
    setItem: (_name, nextValue) => {
      value = nextValue;
    },
  };
}

describe('readingAppearanceStore', () => {
  it('maps every user-facing width preset to an editor boundary', () => {
    expect(PAGE_WIDTHS.map(getPageWidthPixels)).toEqual([680, 810, 1040, null]);
  });

  it('restores the page width but resets font zoom for a new app session', () => {
    const storage = createMemoryStorage();
    const firstSession = createReadingAppearanceStore(storage);

    firstSession.getState().setPageWidth('wide');
    firstSession.getState().zoomIn();
    firstSession.getState().zoomIn();

    expect(firstSession.getState()).toMatchObject({
      fontZoomPercent: 120,
      pageWidth: 'wide',
    });

    const nextSession = createReadingAppearanceStore(storage);

    expect(nextSession.getState()).toMatchObject({
      fontZoomPercent: DEFAULT_FONT_ZOOM_PERCENT,
      pageWidth: 'wide',
    });
  });

  it('writes only page-width changes and never writes session zoom', () => {
    const storage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    const store = createReadingAppearanceStore(storage);

    store.getState().zoomIn();
    store.getState().zoomOut();

    expect(storage.setItem).not.toHaveBeenCalled();

    store.getState().setPageWidth('wide');

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.setItem.mock.calls[0]![1])).toEqual({
      state: { pageWidth: 'wide' },
      version: 1,
    });
  });

  it('uses safe defaults when persisted page-width data is invalid', () => {
    const storage = createMemoryStorage(
      JSON.stringify({
        state: { fontZoomPercent: 180, pageWidth: 'poster' },
        version: 1,
      }),
    );

    const store = createReadingAppearanceStore(storage);

    expect(store.getState()).toMatchObject({
      fontZoomPercent: DEFAULT_FONT_ZOOM_PERCENT,
      pageWidth: DEFAULT_PAGE_WIDTH,
      pageWidthPersistenceError: true,
    });
  });

  it('reports malformed or inaccessible persisted settings', () => {
    const malformedStore = createReadingAppearanceStore(
      createMemoryStorage('{not valid json'),
    );
    const blockedStore = createReadingAppearanceStore({
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      removeItem: vi.fn(),
      setItem: vi.fn(),
    });

    expect(malformedStore.getState()).toMatchObject({
      pageWidth: DEFAULT_PAGE_WIDTH,
      pageWidthPersistenceError: true,
    });
    expect(blockedStore.getState()).toMatchObject({
      pageWidth: DEFAULT_PAGE_WIDTH,
      pageWidthPersistenceError: true,
    });
  });

  it('keeps the selected width visible and reports a failed write', () => {
    const store = createReadingAppearanceStore({
      getItem: () => null,
      removeItem: vi.fn(),
      setItem: () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      },
    });

    store.getState().setPageWidth('wide');

    expect(store.getState()).toMatchObject({
      pageWidth: 'wide',
      pageWidthPersistenceError: true,
    });
  });

  it('clamps session zoom to the supported range', () => {
    const store = createReadingAppearanceStore(createMemoryStorage());

    for (let index = 0; index < 20; index += 1) {
      store.getState().zoomOut();
    }
    expect(store.getState().fontZoomPercent).toBe(MIN_FONT_ZOOM_PERCENT);

    for (let index = 0; index < 30; index += 1) {
      store.getState().zoomIn();
    }
    expect(store.getState().fontZoomPercent).toBe(MAX_FONT_ZOOM_PERCENT);
  });
});
