import { describe, expect, it } from 'vitest';
import { sidebarPanelConstraints } from './panelConstraints';

describe('sidebar panel constraints', () => {
  it('uses an adaptive default with practical pixel bounds', () => {
    expect(sidebarPanelConstraints).toEqual({
      defaultSize: '26%',
      maxSize: '360px',
      minSize: '240px',
    });
  });
});
