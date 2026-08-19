import { describe, expect, it } from 'vitest';
import {
  FILE_TREE_CONTENT_CHROME_WIDTH,
  OUTLINE_CONTENT_CHROME_WIDTH,
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

  it('adds file-tree chrome around the measured content by default', () => {
    expect(FILE_TREE_CONTENT_CHROME_WIDTH).toBe(72);
    expect(sidebarWidthForContentWidth(240)).toBe(240 + FILE_TREE_CONTENT_CHROME_WIDTH);
  });

  it('uses a smaller outline chrome than the file-tree chevron and icon row', () => {
    expect(OUTLINE_CONTENT_CHROME_WIDTH).toBeLessThan(FILE_TREE_CONTENT_CHROME_WIDTH);
    expect(sidebarWidthForContentWidth(240, OUTLINE_CONTENT_CHROME_WIDTH)).toBe(
      240 + OUTLINE_CONTENT_CHROME_WIDTH,
    );
    expect(
      sidebarWidthForContentWidth(240, OUTLINE_CONTENT_CHROME_WIDTH),
    ).toBeLessThan(sidebarWidthForContentWidth(240));
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
