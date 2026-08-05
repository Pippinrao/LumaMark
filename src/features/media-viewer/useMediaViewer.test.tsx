import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaViewer } from './useMediaViewer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

  it('reveals a hidden focus scope before restoring its opener', () => {
    vi.useFakeTimers();
    const fallbackFocus = vi.fn();
    const focusScope = document.createElement('section');
    const opener = document.createElement('button');
    focusScope.tabIndex = 0;
    focusScope.append(opener);
    document.body.append(focusScope);
    opener.focus();
    const { result } = renderHook(() => useMediaViewer(fallbackFocus));

    act(() => {
      result.current.openMedia({ kind: 'mermaid', svg: '<svg />' });
    });
    opener.blur();
    const nativeFocus = HTMLElement.prototype.focus;
    let focusAttempts = 0;
    vi.spyOn(opener, 'focus').mockImplementation((options) => {
      focusAttempts += 1;
      if (focusAttempts > 1) {
        nativeFocus.call(opener, options);
      }
    });

    act(() => result.current.returnFocus());
    expect(document.activeElement).toBe(focusScope);
    act(() => vi.runAllTimers());

    expect(document.activeElement).toBe(opener);
    expect(fallbackFocus).not.toHaveBeenCalled();
    focusScope.remove();
  });

  it('does not let a stale focus restore affect an immediately reopened viewer', () => {
    vi.useFakeTimers();
    const fallbackFocus = vi.fn();
    const oldFocusScope = document.createElement('section');
    const oldOpener = document.createElement('button');
    const newOpener = document.createElement('button');
    oldFocusScope.tabIndex = 0;
    oldFocusScope.append(oldOpener);
    document.body.append(oldFocusScope, newOpener);
    oldOpener.focus();
    const { result } = renderHook(() => useMediaViewer(fallbackFocus));

    act(() => {
      result.current.openMedia({ kind: 'mermaid', svg: '<svg id="old" />' });
    });
    oldOpener.blur();
    const nativeFocus = HTMLElement.prototype.focus;
    let focusAttempts = 0;
    vi.spyOn(oldOpener, 'focus').mockImplementation((options) => {
      focusAttempts += 1;
      if (focusAttempts > 1) {
        nativeFocus.call(oldOpener, options);
      }
    });

    act(() => result.current.returnFocus());
    expect(document.activeElement).toBe(oldFocusScope);
    newOpener.focus();
    act(() => {
      result.current.openMedia({ alt: 'new', kind: 'image', src: 'new.png' });
      vi.runAllTimers();
    });

    expect(document.activeElement).toBe(newOpener);
    expect(result.current.open).toBe(true);
    expect(result.current.request).toEqual({
      alt: 'new',
      kind: 'image',
      src: 'new.png',
    });
    expect(fallbackFocus).not.toHaveBeenCalled();
    oldFocusScope.remove();
    newOpener.remove();
  });

  it('cancels a scheduled focus restore when the hook unmounts', () => {
    vi.useFakeTimers();
    const fallbackFocus = vi.fn();
    const focusScope = document.createElement('section');
    const opener = document.createElement('button');
    focusScope.tabIndex = 0;
    focusScope.append(opener);
    document.body.append(focusScope);
    opener.focus();
    const { result, unmount } = renderHook(() => useMediaViewer(fallbackFocus));

    act(() => {
      result.current.openMedia({ kind: 'mermaid', svg: '<svg />' });
    });
    opener.blur();
    const openerFocus = vi.spyOn(opener, 'focus').mockImplementation(() => {});
    act(() => result.current.returnFocus());
    expect(openerFocus).toHaveBeenCalledOnce();

    unmount();
    act(() => vi.runAllTimers());

    expect(openerFocus).toHaveBeenCalledOnce();
    expect(fallbackFocus).not.toHaveBeenCalled();
    focusScope.remove();
  });

  it('releases the closed media payload after focus is safely restored', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { result } = renderHook(() => useMediaViewer(vi.fn()));

    act(() => {
      result.current.openMedia({ alt: 'one', kind: 'image', src: 'one.png' });
      result.current.setOpen(false);
      result.current.returnFocus();
    });

    expect(document.activeElement).toBe(opener);
    expect(result.current.open).toBe(false);
    expect(result.current.request).toBeNull();
    opener.remove();
  });

  it('forgets the opener after restoring focus once', () => {
    const fallbackFocus = vi.fn();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { result } = renderHook(() => useMediaViewer(fallbackFocus));

    act(() => {
      result.current.openMedia({ alt: 'one', kind: 'image', src: 'one.png' });
    });
    opener.blur();
    act(() => result.current.returnFocus());
    opener.blur();
    act(() => result.current.returnFocus());

    expect(fallbackFocus).toHaveBeenCalledOnce();
    opener.remove();
  });
});
