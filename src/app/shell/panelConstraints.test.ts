import { describe, expect, it } from 'vitest';
import {
  sidebarPanelConstraints,
  sidebarWidthForMeasuredFileName,
} from './panelConstraints';

describe('sidebar panel constraints', () => {
  it('uses an adaptive default with practical pixel bounds', () => {
    expect(sidebarPanelConstraints).toEqual({
      defaultSize: '26%',
      maxSize: '360px',
      minSize: '240px',
    });
  });

  it('keeps short file names at the 240 pixel minimum', () => {
    expect(sidebarWidthForMeasuredFileName(64)).toBe(240);
  });

  it('gives medium file names enough room without using the maximum', () => {
    const width = sidebarWidthForMeasuredFileName(180);

    expect(width).toBeGreaterThan(240);
    expect(width).toBeLessThan(360);
  });

  it('caps long file names at 360 pixels', () => {
    expect(sidebarWidthForMeasuredFileName(480)).toBe(360);
  });
});
