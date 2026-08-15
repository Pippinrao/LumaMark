import { describe, expect, it, vi } from 'vitest';
import { createOutlineNavigationHandler } from './outlineNavigationHandler';

describe('outline navigation handler', () => {
  it('reveals only a heading object from the current rendered snapshot', () => {
    const staleHeading = {
      from: 0,
      id: 'target',
      level: 1 as const,
      line: 1,
      text: 'Target',
      to: 8,
    };
    const currentHeading = { ...staleHeading, from: 42, line: 3, to: 50 };
    const revealPosition = vi.fn();
    const selectHeading = createOutlineNavigationHandler({
      isCurrentHeading: (heading) => heading === currentHeading,
      revealPosition,
    });

    selectHeading(staleHeading);
    expect(revealPosition).not.toHaveBeenCalled();

    selectHeading(currentHeading);
    expect(revealPosition).toHaveBeenCalledOnce();
    expect(revealPosition).toHaveBeenCalledWith(42);
  });
});
