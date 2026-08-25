import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import {
  editorContentGutterPx,
  EDITOR_BLOCK_TRACK_WIDTH_VAR,
  EDITOR_DESKTOP_GUTTER_PX,
  EDITOR_MOBILE_GUTTER_PX,
  quantizedBlockTrackWidth,
  shouldPublishBlockTrackWidth,
  syncEditorAvailableWidth,
} from './editorAvailableWidth';

describe('editorAvailableWidth', () => {
  it('uses the desktop gutter above the mobile breakpoint and the mobile gutter at or below it', () => {
    expect(editorContentGutterPx(721)).toBe(EDITOR_DESKTOP_GUTTER_PX);
    expect(editorContentGutterPx(720)).toBe(EDITOR_MOBILE_GUTTER_PX);
    expect(editorContentGutterPx(480)).toBe(EDITOR_MOBILE_GUTTER_PX);
  });

  it('quantizes the available track to an integer pixel width', () => {
    expect(quantizedBlockTrackWidth(1000.4, 96)).toBe(904);
    expect(quantizedBlockTrackWidth(80, 96)).toBe(0);
    expect(quantizedBlockTrackWidth(Number.NaN, 96)).toBe(0);
  });

  it('does not publish a zero track width before the scroller is laid out', () => {
    const view = {
      dom: document.createElement('div'),
      requestMeasure: vi.fn(),
      scrollDOM: document.createElement('div'),
      viewState: { mustMeasureContent: false as boolean | 'refresh' },
    };
    Object.defineProperty(view.scrollDOM, 'clientWidth', { value: 0 });
    Object.defineProperty(view.dom, 'ownerDocument', {
      value: { defaultView: { innerWidth: 1920 } },
    });

    const published = syncEditorAvailableWidth(
      view as unknown as EditorView,
      null,
    );
    expect(published).toBeNull();
    expect(view.dom.style.getPropertyValue(EDITOR_BLOCK_TRACK_WIDTH_VAR)).toBe(
      '',
    );
    expect(view.requestMeasure).not.toHaveBeenCalled();
  });

  it('does not republish an unchanged quantized width', () => {
    expect(shouldPublishBlockTrackWidth(904, 904)).toBe(false);
    expect(shouldPublishBlockTrackWidth(null, 904)).toBe(true);
    expect(shouldPublishBlockTrackWidth(904, 905)).toBe(true);
  });

  it('publishes the track width and requests a content measure only when it changes', () => {
    const view = {
      dom: document.createElement('div'),
      requestMeasure: vi.fn(),
      scrollDOM: document.createElement('div'),
      viewState: { mustMeasureContent: false as boolean | 'refresh' },
    };
    Object.defineProperty(view.scrollDOM, 'clientWidth', { value: 1000 });
    Object.defineProperty(view.dom, 'ownerDocument', {
      value: { defaultView: { innerWidth: 1920 } },
    });

    const first = syncEditorAvailableWidth(
      view as unknown as EditorView,
      null,
    );
    expect(first).toBe(904);
    expect(view.dom.style.getPropertyValue(EDITOR_BLOCK_TRACK_WIDTH_VAR)).toBe(
      '904px',
    );
    expect(view.viewState.mustMeasureContent).toBe(true);
    expect(view.requestMeasure).toHaveBeenCalledOnce();

    view.requestMeasure.mockClear();
    view.viewState.mustMeasureContent = false;
    const second = syncEditorAvailableWidth(
      view as unknown as EditorView,
      904,
    );
    expect(second).toBe(904);
    expect(view.requestMeasure).not.toHaveBeenCalled();
    expect(view.viewState.mustMeasureContent).toBe(false);
  });

  it('can publish the first track width without forcing a full content remasure', () => {
    const view = {
      dom: document.createElement('div'),
      requestMeasure: vi.fn(),
      scrollDOM: document.createElement('div'),
      viewState: { mustMeasureContent: false as boolean | 'refresh' },
    };
    Object.defineProperty(view.scrollDOM, 'clientWidth', { value: 1000 });
    Object.defineProperty(view.dom, 'ownerDocument', {
      value: { defaultView: { innerWidth: 1920 } },
    });

    const first = syncEditorAvailableWidth(
      view as unknown as EditorView,
      null,
      { refreshHeightMap: false },
    );
    expect(first).toBe(904);
    expect(view.dom.style.getPropertyValue(EDITOR_BLOCK_TRACK_WIDTH_VAR)).toBe(
      '904px',
    );
    expect(view.requestMeasure).not.toHaveBeenCalled();
    expect(view.viewState.mustMeasureContent).toBe(false);
  });
});
