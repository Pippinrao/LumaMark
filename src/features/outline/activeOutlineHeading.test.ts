import { describe, expect, it } from 'vitest';
import { getActiveOutlineHeadingFrom } from './activeOutlineHeading';

describe('getActiveOutlineHeadingFrom', () => {
  const headings = [
    { from: 0, id: 'start', level: 1, line: 1, text: 'Start', to: 7 },
    { from: 20, id: 'middle', level: 2, line: 4, text: 'Middle', to: 30 },
    { from: 45, id: 'end', level: 1, line: 8, text: 'End', to: 50 },
  ] as const;

  it('uses the nearest preceding heading for the current editor position', () => {
    expect(getActiveOutlineHeadingFrom(headings, 34)).toBe(20);
  });

  it('does not highlight a heading before the selection reaches the first heading', () => {
    expect(getActiveOutlineHeadingFrom(headings, -1)).toBeNull();
  });
});
