import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecoveryDraftScheduler } from './recoveryDraftScheduler';

describe('recovery draft scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists only the latest snapshot after input settles', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const scheduler = createRecoveryDraftScheduler(save, 500);

    scheduler.schedule({ filePath: null, text: 'a' });
    scheduler.schedule({ filePath: null, text: 'ab' });
    vi.advanceTimersByTime(499);
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledWith({ filePath: null, text: 'ab' });
  });

  it('does not read document text until the delayed save runs', () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const readText = vi.fn(() => 'ab');
    const scheduler = createRecoveryDraftScheduler(save, 500);

    scheduler.schedule(() => ({ filePath: null, text: readText() }));
    scheduler.schedule(() => ({ filePath: null, text: readText() }));
    expect(readText).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ filePath: null, text: 'ab' });
  });
});
