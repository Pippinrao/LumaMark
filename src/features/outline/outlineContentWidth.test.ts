import { describe, expect, it } from 'vitest';
import {
  OUTLINE_INDENT_WIDTH,
  measureOutlineContentWidth,
} from './outlineContentWidth';
import type { OutlineHeading } from './outlineParser';

const measureText = (text: string) => text.length * 10;

function heading(
  text: string,
  level: OutlineHeading['level'],
): OutlineHeading {
  return {
    from: 0,
    id: text,
    level,
    line: 1,
    text,
    to: text.length,
  };
}

describe('measureOutlineContentWidth', () => {
  it('reports nothing for an empty outline', () => {
    expect(measureOutlineContentWidth([], measureText)).toBe(0);
  });

  it('uses the widest heading rather than the last one', () => {
    expect(
      measureOutlineContentWidth(
        [
          heading('Short', 1),
          heading('A much longer heading title', 1),
          heading('Mid', 1),
        ],
        measureText,
      ),
    ).toBe(measureText('A much longer heading title'));
  });

  it('counts outline indent so a deep heading can outrun a shallow one', () => {
    expect(
      measureOutlineContentWidth(
        [heading('Notes', 1), heading('Notes', 4)],
        measureText,
      ),
    ).toBe(measureText('Notes') + 3 * OUTLINE_INDENT_WIDTH);
  });

  it('matches the indent used by outline item padding', () => {
    expect(OUTLINE_INDENT_WIDTH).toBe(12);
  });
});
