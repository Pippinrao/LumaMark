import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaViewer } from './useMediaViewer';

afterEach(() => cleanup());

describe('useMediaViewer', () => {
  it('keeps media payload local and starts a fresh zoom session per request', () => {
    const { result } = renderHook(() => useMediaViewer(vi.fn()));

    act(() => {
      result.current.openMedia({ alt: 'one', kind: 'image', src: 'one.png' });
    });
    const firstSession = result.current.sessionId;

    act(() => {
      result.current.openMedia({ kind: 'mermaid', svg: '<svg />' });
    });

    expect(result.current.open).toBe(true);
    expect(result.current.request).toEqual({ kind: 'mermaid', svg: '<svg />' });
    expect(result.current.sessionId).toBeGreaterThan(firstSession);
  });

  it('returns focus to the connected opener and falls back when it is gone', () => {
    const fallbackFocus = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { result } = renderHook(() => useMediaViewer(fallbackFocus));

    act(() => {
      result.current.openMedia({ alt: '', kind: 'image', src: 'one.png' });
    });
    opener.blur();
    act(() => result.current.returnFocus());
    expect(document.activeElement).toBe(opener);

    opener.remove();
    act(() => result.current.returnFocus());
    expect(fallbackFocus).toHaveBeenCalledOnce();
  });
});
