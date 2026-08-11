import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_ADAPTIVE_MAX_WIDTH,
  SIDEBAR_ADAPTIVE_MIN_WIDTH,
  sidebarPanelConstraints,
  sidebarWidthForContentWidth,
} from './panelConstraints';

describe('sidebar panel constraints', () => {
  it('lets dragging reach a narrow floor and leaves the ceiling to the editor panel', () => {
    expect(sidebarPanelConstraints).toEqual({
      defaultSize: '26%',
      minSize: '120px',
    });
  });

  it('does not declare a maximum width, so the editor minimum defines the ceiling', () => {
    expect('maxSize' in sidebarPanelConstraints).toBe(false);
  });
});

describe('sidebarWidthForContentWidth', () => {
  it('raises narrow content to the adaptive minimum', () => {
    expect(sidebarWidthForContentWidth(40)).toBe(SIDEBAR_ADAPTIVE_MIN_WIDTH);
    expect(SIDEBAR_ADAPTIVE_MIN_WIDTH).toBe(200);
  });

  it('caps wide content at the adaptive maximum', () => {
    expect(sidebarWidthForContentWidth(2000)).toBe(SIDEBAR_ADAPTIVE_MAX_WIDTH);
    expect(SIDEBAR_ADAPTIVE_MAX_WIDTH).toBe(480);
  });

  it('adds room for the sidebar chrome around the measured content', () => {
    const width = sidebarWidthForContentWidth(240);

    expect(width).toBeGreaterThan(240);
    expect(width).toBeLessThan(SIDEBAR_ADAPTIVE_MAX_WIDTH);
  });

  it('grows with the measured content between both bounds', () => {
    expect(sidebarWidthForContentWidth(300)).toBeGreaterThan(
      sidebarWidthForContentWidth(240),
    );
  });

  it('treats missing measurements as the adaptive minimum', () => {
    expect(sidebarWidthForContentWidth(0)).toBe(SIDEBAR_ADAPTIVE_MIN_WIDTH);
    expect(sidebarWidthForContentWidth(Number.NaN)).toBe(
      SIDEBAR_ADAPTIVE_MIN_WIDTH,
    );
  });
});
