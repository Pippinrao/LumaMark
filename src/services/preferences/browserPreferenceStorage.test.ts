import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserPreferenceStorage,
  createStrictBrowserPreferenceStorage,
  strictBrowserPreferenceStorage,
} from './browserPreferenceStorage';

describe('createBrowserPreferenceStorage', () => {
  it('delegates preference reads and writes to browser storage', () => {
    const storage = {
      getItem: vi.fn(() => 'stored-value'),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    };
    const preferences = createBrowserPreferenceStorage(() => storage);

    expect(preferences.getItem('appearance')).toBe('stored-value');
    preferences.setItem('appearance', 'next-value');
    preferences.removeItem('appearance');

    expect(storage.getItem).toHaveBeenCalledWith('appearance');
    expect(storage.setItem).toHaveBeenCalledWith('appearance', 'next-value');
    expect(storage.removeItem).toHaveBeenCalledWith('appearance');
  });

  it('exposes browser storage access failures to the feature boundary', () => {
    const preferences = createBrowserPreferenceStorage(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(() => preferences.getItem('appearance')).toThrow('blocked');
    expect(() => preferences.setItem('appearance', 'next-value')).toThrow(
      'blocked',
    );
    expect(() => preferences.removeItem('appearance')).toThrow('blocked');
  });

  it('uses the resolved browser storage without an in-memory fallback', () => {
    const storage = {
      getItem: vi.fn(() => 'stored-value'),
      setItem: vi.fn(),
    };
    const preferences = createStrictBrowserPreferenceStorage(() => storage);

    expect(preferences.getItem('startup')).toBe('stored-value');
    preferences.setItem('startup', 'next-value');

    expect(storage.getItem).toHaveBeenCalledWith('startup');
    expect(storage.setItem).toHaveBeenCalledWith('startup', 'next-value');
  });

  it('reports unavailable storage in jsdom instead of touching its browser shim', () => {
    expect(() => strictBrowserPreferenceStorage.getItem('startup')).toThrow(
      'Browser preference storage is unavailable.',
    );
  });
});
