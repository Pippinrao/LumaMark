import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { ThemeProvider } from './ThemeProvider';

describe('ThemeProvider system preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tracks system color-scheme changes without changing the stored preference', () => {
    let dark = true;
    let onChange: ((event: MediaQueryListEvent) => void) | undefined;
    const mediaQuery = {
      addEventListener: vi.fn((_name, listener) => {
        onChange = listener;
      }),
      matches: dark,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
    useAppPreferencesStore.setState({ theme: 'system' as never });

    render(<ThemeProvider><span>content</span></ThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useAppPreferencesStore.getState().theme).toBe('system');

    dark = false;
    Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: dark });
    act(() => {
      onChange?.({ matches: false } as MediaQueryListEvent);
    });

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(useAppPreferencesStore.getState().theme).toBe('system');
  });
});
