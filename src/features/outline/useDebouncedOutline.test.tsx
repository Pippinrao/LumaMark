import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedOutline } from './useDebouncedOutline';

function OutlineHarness({ getDocumentText }: { getDocumentText: () => string }) {
  const [, forceRender] = useState(0);
  const { headings, isCurrent, scheduleRefresh } = useDebouncedOutline({
    delayMs: 120,
    getDocumentText,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          scheduleRefresh();
          forceRender((value) => value + 1);
        }}
      >
        refresh
      </button>
      <output data-current={String(isCurrent())}>
        {headings.map((heading) => heading.text).join(',')}
      </output>
    </>
  );
}

describe('useDebouncedOutline', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('reads the full document once after bursty refresh requests settle', async () => {
    vi.useFakeTimers();
    const getDocumentText = vi.fn(() => '# LumaMark\n\n## Outline');

    render(<OutlineHarness getDocumentText={getDocumentText} />);

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    expect(getDocumentText).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(getDocumentText).toHaveBeenCalledTimes(1);
    expect(screen.getByText('LumaMark,Outline')).toBeInTheDocument();
  });

  it('marks the visible snapshot stale synchronously until the scheduled refresh completes', async () => {
    vi.useFakeTimers();
    let source = '# Before';
    const getDocumentText = vi.fn(() => source);

    render(<OutlineHarness getDocumentText={getDocumentText} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(screen.getByText('Before')).toHaveAttribute('data-current', 'true');

    source = 'prefix\n\n# Before';
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    expect(screen.getByText('Before')).toHaveAttribute('data-current', 'false');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(screen.getByText('Before')).toHaveAttribute('data-current', 'true');
  });

  it('resolves a pending waiter with the exact refreshed snapshot instead of a stale render closure', async () => {
    vi.useFakeTimers();
    let source = '# Before';
    const getDocumentText = vi.fn(() => source);
    const { result } = renderHook(() =>
      useDebouncedOutline({
        delayMs: 120,
        getDocumentText,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    source = '# After';
    act(() => {
      result.current.scheduleRefresh();
    });
    const pendingSnapshot = result.current.awaitCurrentSnapshot();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    await expect(pendingSnapshot).resolves.toMatchObject({
      headings: [{ id: 'after', text: 'After' }],
      status: 'current',
    });
  });

  it('returns the latest snapshot immediately once its revision is current', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useDebouncedOutline({
        delayMs: 120,
        getDocumentText: () => '# Current',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    await expect(result.current.awaitCurrentSnapshot()).resolves.toMatchObject({
      headings: [{ id: 'current', text: 'Current' }],
      status: 'current',
    });
  });

  it('supersedes an older waiter when a newer outline refresh is scheduled', async () => {
    vi.useFakeTimers();
    let source = '# Initial';
    const { result } = renderHook(() =>
      useDebouncedOutline({
        delayMs: 120,
        getDocumentText: () => source,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    source = '# First';
    act(() => {
      result.current.scheduleRefresh();
    });
    const firstWaiter = result.current.awaitCurrentSnapshot();

    source = '# Second';
    act(() => {
      result.current.scheduleRefresh();
    });
    const secondWaiter = result.current.awaitCurrentSnapshot();

    await expect(firstWaiter).resolves.toEqual({ status: 'superseded' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    await expect(secondWaiter).resolves.toMatchObject({
      headings: [{ id: 'second', text: 'Second' }],
      status: 'current',
    });
  });

  it('supersedes a pending waiter when the outline owner unmounts', async () => {
    vi.useFakeTimers();
    let source = '# Initial';
    const { result, unmount } = renderHook(() =>
      useDebouncedOutline({
        delayMs: 120,
        getDocumentText: () => source,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    source = '# Pending';
    act(() => {
      result.current.scheduleRefresh();
    });
    const pendingSnapshot = result.current.awaitCurrentSnapshot();

    unmount();

    await expect(pendingSnapshot).resolves.toEqual({ status: 'superseded' });
  });

  it('never reports a completed snapshot as current after its owner unmounts', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() =>
      useDebouncedOutline({
        delayMs: 120,
        getDocumentText: () => '# Complete',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    const isCurrent = result.current.isCurrent;
    expect(isCurrent()).toBe(true);

    unmount();

    expect(isCurrent()).toBe(false);
  });

  it('rejects a heading object from the previous completed snapshot', async () => {
    vi.useFakeTimers();
    let source = '# Before';
    const { result } = renderHook(() =>
      useDebouncedOutline({
        delayMs: 120,
        getDocumentText: () => source,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    const staleHeading = result.current.headings[0];
    expect(result.current.isCurrentHeading(staleHeading)).toBe(true);

    source = '\n\n# Before';
    act(() => {
      result.current.scheduleRefresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });

    expect(result.current.isCurrentHeading(staleHeading)).toBe(false);
    expect(result.current.isCurrentHeading(result.current.headings[0])).toBe(true);
  });
});
