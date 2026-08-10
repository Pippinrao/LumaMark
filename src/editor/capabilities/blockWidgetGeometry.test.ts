import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { syncBlockWidgetHeight } from './blockWidgetGeometry';

describe('syncBlockWidgetHeight', () => {
  it('forces a full height-map refresh when the widget size changes', () => {
    const requestMeasure = vi.fn();
    const viewState = { mustMeasureContent: true as boolean | 'refresh' };
    const view = {
      requestMeasure,
      viewState,
    } as unknown as EditorView;
    const dom = {
      getBoundingClientRect: () => ({ height: 240 }),
    } as HTMLElement;

    expect(syncBlockWidgetHeight(view, dom, 48)).toBe(240);
    expect(viewState.mustMeasureContent).toBe('refresh');
    expect(requestMeasure).toHaveBeenCalledTimes(1);
  });

  it('still requests measure when the height is unchanged', () => {
    const requestMeasure = vi.fn();
    const viewState = { mustMeasureContent: true as boolean | 'refresh' };
    const view = {
      requestMeasure,
      viewState,
    } as unknown as EditorView;
    const dom = {
      getBoundingClientRect: () => ({ height: 240 }),
    } as HTMLElement;

    expect(syncBlockWidgetHeight(view, dom, 240)).toBe(240);
    expect(viewState.mustMeasureContent).toBe(true);
    expect(requestMeasure).toHaveBeenCalledTimes(1);
  });
});
