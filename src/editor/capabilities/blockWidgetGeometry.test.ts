import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import {
  BlockWidgetGeometryCache,
  BlockWidgetGeometryTracker,
} from './blockWidgetGeometry';

const originalResizeObserver = globalThis.ResizeObserver;

function flushLastMeasure(
  requestMeasure: ReturnType<typeof vi.fn>,
  view: EditorView,
): void {
  const request = [...requestMeasure.mock.calls]
    .reverse()
    .find((args) => args[0] != null)?.[0] as
      | {
          read(view: EditorView): unknown;
          write?(measurement: unknown, view: EditorView): void;
        }
      | undefined;
  if (!request) {
    throw new Error('Expected a queued CodeMirror measurement request.');
  }
  const measurement = request.read(view);
  request.write?.(measurement, view);
}

class ControlledResizeObserver implements ResizeObserver {
  static instances: ControlledResizeObserver[] = [];

  readonly observed = new Set<Element>();
  disconnect = vi.fn(() => {
    this.observed.clear();
  });
  unobserve = vi.fn((target: Element) => {
    this.observed.delete(target);
  });

  constructor(
    private readonly callback: ResizeObserverCallback,
  ) {
    ControlledResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  takeRecords(): ResizeObserverEntry[] {
    return [];
  }

  emit(target: HTMLElement, height: number): void {
    this.emitMany([[target, height]]);
  }

  emitMany(entries: ReadonlyArray<readonly [HTMLElement, number]>): void {
    this.callback(
      entries.map(([target, height]) => ({
        borderBoxSize: [{ blockSize: height, inlineSize: 100 }],
        target,
      })) as unknown as ResizeObserverEntry[],
      this,
    );
  }

  emitWithoutBorderBox(target: HTMLElement): void {
    this.callback(
      [{ target } as unknown as ResizeObserverEntry],
      this,
    );
  }
}

describe('BlockWidgetGeometryTracker', () => {
  beforeEach(() => {
    ControlledResizeObserver.instances = [];
    globalThis.ResizeObserver = ControlledResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it('keeps measuring distinct root height changes after the initial mount', async () => {
    const requestMeasure = vi.fn();
    const viewState = { mustMeasureContent: false };
    const view = { requestMeasure, viewState } as unknown as EditorView;
    const target = document.createElement('div');
    let height = 48;
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => ({ height }) as DOMRect,
    );
    const geometry = new BlockWidgetGeometryTracker();

    geometry.mount(view, target);
    await Promise.resolve();
    flushLastMeasure(requestMeasure, view);

    expect(geometry.estimatedHeight).toBe(48);
    expect(viewState.mustMeasureContent).toBe(true);
    expect(requestMeasure).toHaveBeenCalledTimes(1);

    const observer = ControlledResizeObserver.instances[0];
    height = 240;
    observer.emit(target, height);

    expect(geometry.estimatedHeight).toBe(240);
    expect(requestMeasure).toHaveBeenCalledTimes(2);

    observer.emit(target, 240.2);
    expect(geometry.estimatedHeight).toBe(240);
    expect(requestMeasure).toHaveBeenCalledTimes(2);
  });

  it('queues explicit sync reads in CodeMirror measurement phase', () => {
    const requestMeasure = vi.fn();
    const view = {
      requestMeasure,
      viewState: { mustMeasureContent: false },
    } as unknown as EditorView;
    const target = document.createElement('div');
    const readRect = vi
      .spyOn(target, 'getBoundingClientRect')
      .mockReturnValue({ height: 120 } as DOMRect);
    const geometry = new BlockWidgetGeometryTracker();

    geometry.mount(view, target);
    geometry.sync();
    geometry.sync();

    expect(readRect).not.toHaveBeenCalled();
    expect(requestMeasure).toHaveBeenCalledTimes(2);
    expect(requestMeasure.mock.calls[0][0]).toMatchObject({
      key: expect.anything(),
      read: expect.any(Function),
      write: expect.any(Function),
    });
    expect(requestMeasure.mock.calls[1][0]).toBe(
      requestMeasure.mock.calls[0][0],
    );
  });

  it('preserves measured estimates across widget instances and prunes removed media', async () => {
    const cache = new BlockWidgetGeometryCache();
    const requestMeasure = vi.fn();
    const view = {
      requestMeasure,
      viewState: { mustMeasureContent: false },
    } as unknown as EditorView;
    const firstTarget = elementWithHeight(240);
    const first = new BlockWidgetGeometryTracker(cache, 'image:asset', -1);

    first.mount(view, firstTarget);
    await Promise.resolve();
    flushLastMeasure(requestMeasure, view);
    first.unmount();

    const replacement = new BlockWidgetGeometryTracker(
      cache,
      'image:asset',
      -1,
    );
    const unrelated = new BlockWidgetGeometryTracker(
      cache,
      'image:other',
      -1,
    );
    expect(replacement.estimatedHeight).toBe(240);
    expect(unrelated.estimatedHeight).toBe(-1);

    cache.retain(['image:other']);
    const afterRemoval = new BlockWidgetGeometryTracker(
      cache,
      'image:asset',
      -1,
    );
    expect(afterRemoval.estimatedHeight).toBe(-1);
  });

  it('bounds stale height entries from long-running media edits', () => {
    const cache = new BlockWidgetGeometryCache();

    for (let index = 0; index < 2_049; index += 1) {
      cache.record(`mermaid:${index}`, 100 + index, -1);
    }

    expect(cache.estimate('mermaid:0', -1)).toBe(-1);
    expect(cache.estimate('mermaid:2048', -1)).toBe(2_148);
  });

  it('never evicts measured heights that still belong to the live document', () => {
    const cache = new BlockWidgetGeometryCache();
    const liveKeys = Array.from(
      { length: 2_049 },
      (_, index) => `image:live:${index}`,
    );

    cache.retain(liveKeys);
    for (let index = 0; index < liveKeys.length; index += 1) {
      cache.record(liveKeys[index], 200 + index, -1);
    }

    expect(cache.estimate(liveKeys[0], -1)).toBe(200);
    expect(cache.estimate(liveKeys.at(-1) ?? '', -1)).toBe(2_248);

    cache.retain([liveKeys.at(-1) ?? '']);
    expect(cache.estimate(liveKeys[0], -1)).toBe(-1);
    expect(cache.estimate(liveKeys.at(-1) ?? '', -1)).toBe(2_248);
  });

  it('retains a shared geometry key until its final live block is removed', () => {
    const cache = new BlockWidgetGeometryCache();
    cache.retain(['mermaid:shared', 'mermaid:shared']);
    cache.record('mermaid:shared', 360, 48);

    cache.updateRetained(['mermaid:shared'], ['mermaid:changed']);
    expect(cache.estimate('mermaid:shared', 48)).toBe(360);

    cache.updateRetained(['mermaid:shared'], []);
    expect(cache.estimate('mermaid:shared', 48)).toBe(48);
  });

  it('shares one resize observer per editor view and batches one callback', async () => {
    const requestMeasure = vi.fn();
    const view = {
      requestMeasure,
      viewState: { mustMeasureContent: false },
    } as unknown as EditorView;
    const firstTarget = elementWithHeight(40);
    const secondTarget = elementWithHeight(60);
    const firstGeometry = new BlockWidgetGeometryTracker();
    const secondGeometry = new BlockWidgetGeometryTracker(48);

    firstGeometry.mount(view, firstTarget);
    secondGeometry.mount(view, secondTarget);
    await Promise.resolve();
    flushLastMeasure(requestMeasure, view);
    requestMeasure.mockClear();

    expect(ControlledResizeObserver.instances).toHaveLength(1);
    const observer = ControlledResizeObserver.instances[0];
    expect(observer.observed).toEqual(new Set([firstTarget, secondTarget]));

    observer.emitMany([
      [firstTarget, 140],
      [secondTarget, 160],
    ]);

    expect(firstGeometry.estimatedHeight).toBe(140);
    expect(secondGeometry.estimatedHeight).toBe(160);
    expect(requestMeasure).toHaveBeenCalledTimes(1);
  });

  it('falls back to the root border box for legacy observer entries', async () => {
    const view = {
      requestMeasure: vi.fn(),
      viewState: { mustMeasureContent: false },
    } as unknown as EditorView;
    let height = 40;
    const target = document.createElement('div');
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => ({ height }) as DOMRect,
    );
    const geometry = new BlockWidgetGeometryTracker();

    geometry.mount(view, target);
    await Promise.resolve();
    flushLastMeasure(
      view.requestMeasure as ReturnType<typeof vi.fn>,
      view,
    );
    height = 180;
    ControlledResizeObserver.instances[0].emitWithoutBorderBox(target);
    flushLastMeasure(
      view.requestMeasure as ReturnType<typeof vi.fn>,
      view,
    );

    expect(geometry.estimatedHeight).toBe(180);
  });

  it('disconnects roots on unmount and ignores stale resize callbacks', async () => {
    const requestMeasure = vi.fn();
    const view = {
      requestMeasure,
      viewState: { mustMeasureContent: false },
    } as unknown as EditorView;
    const firstTarget = elementWithHeight(40);
    const secondTarget = elementWithHeight(60);
    const firstGeometry = new BlockWidgetGeometryTracker();
    const secondGeometry = new BlockWidgetGeometryTracker();

    firstGeometry.mount(view, firstTarget);
    secondGeometry.mount(view, secondTarget);
    await Promise.resolve();
    flushLastMeasure(requestMeasure, view);
    const observer = ControlledResizeObserver.instances[0];
    requestMeasure.mockClear();

    firstGeometry.unmount();
    observer.emit(firstTarget, 400);
    expect(firstGeometry.estimatedHeight).toBe(40);
    expect(requestMeasure).not.toHaveBeenCalled();
    expect(observer.disconnect).not.toHaveBeenCalled();

    secondGeometry.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('releases a reused DOM root when CodeMirror destroys a replacement widget', async () => {
    const requestMeasure = vi.fn();
    const view = {
      requestMeasure,
      viewState: { mustMeasureContent: false },
    } as unknown as EditorView;
    const cache = new BlockWidgetGeometryCache();
    const target = elementWithHeight(120);
    const mounted = new BlockWidgetGeometryTracker(cache, 'image:asset', -1);
    const replacement = new BlockWidgetGeometryTracker(
      cache,
      'image:asset',
      -1,
    );

    mounted.mount(view, target);
    await Promise.resolve();
    flushLastMeasure(requestMeasure, view);
    const observer = ControlledResizeObserver.instances[0];

    (
      replacement.unmount as unknown as (reusedTarget: HTMLElement) => void
    )(target);

    expect(observer.observed).not.toContain(target);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });
});

function elementWithHeight(height: number): HTMLElement {
  const target = document.createElement('div');
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
    height,
  } as DOMRect);
  return target;
}
