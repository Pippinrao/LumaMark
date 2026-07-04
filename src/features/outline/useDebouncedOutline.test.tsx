import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedOutline } from './useDebouncedOutline';

function OutlineHarness({ getDocumentText }: { getDocumentText: () => string }) {
  const { headings, scheduleRefresh } = useDebouncedOutline({
    delayMs: 120,
    getDocumentText,
  });

  return (
    <>
      <button type="button" onClick={scheduleRefresh}>
        refresh
      </button>
      <output>{headings.map((heading) => heading.text).join(',')}</output>
    </>
  );
}

describe('useDebouncedOutline', () => {
  afterEach(() => {
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
});
