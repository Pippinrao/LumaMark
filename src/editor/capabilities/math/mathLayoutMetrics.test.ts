import { describe, expect, it } from 'vitest';
import {
  quantizeLayoutMetrics,
  sameLayoutMetrics,
} from './mathLayoutMetrics';

describe('math layout metrics', () => {
  it('treats a scrollbar-sized width change as the same layout', () => {
    const withOverflow = {
      containerWidth: 800,
      em: 16,
      ex: 8,
    };
    const afterScrollbar = {
      containerWidth: 783,
      em: 16,
      ex: 8,
    };

    expect(sameLayoutMetrics(withOverflow, afterScrollbar)).toBe(true);
    expect(
      quantizeLayoutMetrics(afterScrollbar, withOverflow).containerWidth,
    ).toBe(800);
  });

  it('still treats a real window-resize width change as a new layout', () => {
    const compact = {
      containerWidth: 800,
      em: 16,
      ex: 8,
    };
    const wide = {
      containerWidth: 960,
      em: 16,
      ex: 8,
    };

    expect(sameLayoutMetrics(compact, wide)).toBe(false);
    expect(quantizeLayoutMetrics(wide, compact).containerWidth).toBe(960);
  });
});
