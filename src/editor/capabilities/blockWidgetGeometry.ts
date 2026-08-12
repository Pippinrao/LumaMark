import type { EditorView } from '@codemirror/view';

const HEIGHT_CHANGE_EPSILON = 0.5;
const MAX_CACHED_MEDIA_HEIGHTS = 2_048;

type ObservedBlockWidget = {
  recordHeight(height: number): boolean;
};

type EditorViewMeasurementState = {
  mustMeasureContent: boolean | 'refresh';
};

const observersByView = new WeakMap<EditorView, BlockWidgetResizeCoordinator>();
const coordinatorsByTarget = new WeakMap<
  HTMLElement,
  BlockWidgetResizeCoordinator
>();

/**
 * Produces a fixed-size cache key without retaining a full data URL or a long
 * Mermaid source snapshot for every edit revision.
 */
export function blockWidgetGeometryKey(
  namespace: string,
  parts: readonly string[],
): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  let totalLength = 0;

  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    totalLength += part.length;
    first = mixGeometryHash(first, part.length ^ partIndex);
    second = mixGeometryHash(second, part.length + partIndex);
    for (let index = 0; index < part.length; index += 1) {
      const code = part.charCodeAt(index);
      first = mixGeometryHash(first, code);
      second = mixGeometryHash(second, code ^ index);
    }
  }

  return [
    namespace,
    parts.length,
    totalLength,
    (first >>> 0).toString(16).padStart(8, '0'),
    (second >>> 0).toString(16).padStart(8, '0'),
  ].join(':');
}

function mixGeometryHash(hash: number, value: number): number {
  return Math.imul(hash ^ value, 0x01000193);
}

/**
 * Keeps the last mounted height available when a decoration rebuild creates a
 * new WidgetType instance for the same logical media block.
 */
export class BlockWidgetGeometryCache {
  private readonly heights = new Map<string, number>();
  private readonly liveKeyCounts = new Map<string, number>();

  estimate(key: string, fallback: number): number {
    return this.heights.get(key) ?? fallback;
  }

  record(key: string, height: number, fallback: number): boolean {
    const previous = this.estimate(key, fallback);
    if (
      !Number.isFinite(height) ||
      height <= 0 ||
      Math.abs(height - previous) < HEIGHT_CHANGE_EPSILON
    ) {
      return false;
    }

    this.heights.delete(key);
    this.heights.set(key, height);
    this.evictStaleEntries();
    return true;
  }

  retain(keys: Iterable<string>): void {
    const retainedCounts = new Map<string, number>();
    for (const key of keys) {
      retainedCounts.set(key, (retainedCounts.get(key) ?? 0) + 1);
    }
    this.liveKeyCounts.clear();
    for (const [key, count] of retainedCounts) {
      this.liveKeyCounts.set(key, count);
    }
    for (const key of this.heights.keys()) {
      if (!retainedCounts.has(key)) {
        this.heights.delete(key);
      }
    }
  }

  updateRetained(
    removedKeys: Iterable<string>,
    addedKeys: Iterable<string>,
  ): void {
    const deltas = new Map<string, number>();
    for (const key of removedKeys) {
      deltas.set(key, (deltas.get(key) ?? 0) - 1);
    }
    for (const key of addedKeys) {
      deltas.set(key, (deltas.get(key) ?? 0) + 1);
    }
    for (const [key, delta] of deltas) {
      const nextCount = (this.liveKeyCounts.get(key) ?? 0) + delta;
      if (nextCount <= 0) {
        this.liveKeyCounts.delete(key);
        this.heights.delete(key);
      } else {
        this.liveKeyCounts.set(key, nextCount);
      }
    }
    this.evictStaleEntries();
  }

  private evictStaleEntries(): void {
    if (this.heights.size <= MAX_CACHED_MEDIA_HEIGHTS) {
      return;
    }

    for (const key of this.heights.keys()) {
      if (this.heights.size <= MAX_CACHED_MEDIA_HEIGHTS) {
        break;
      }
      if (!this.liveKeyCounts.has(key)) {
        this.heights.delete(key);
      }
    }
  }
}

/**
 * Tracks the measured height of one async block widget.
 *
 * CodeMirror only renders widgets in its active viewports. A mounted widget is
 * therefore always covered by requestMeasure(), while the last measured height
 * remains available as its off-screen estimate after the DOM is removed.
 */
export class BlockWidgetGeometryTracker {
  private readonly cache: BlockWidgetGeometryCache;
  private coordinator: BlockWidgetResizeCoordinator | null = null;
  private readonly initialHeight: number;
  private readonly key: string;
  private target: HTMLElement | null = null;

  constructor();
  constructor(initialHeight: number);
  constructor(
    cache: BlockWidgetGeometryCache,
    key: string,
    initialHeight?: number,
  );
  constructor(
    cacheOrInitialHeight: BlockWidgetGeometryCache | number = -1,
    key = 'widget',
    initialHeight = -1,
  ) {
    if (cacheOrInitialHeight instanceof BlockWidgetGeometryCache) {
      this.cache = cacheOrInitialHeight;
      this.key = key;
      this.initialHeight = initialHeight;
    } else {
      this.cache = new BlockWidgetGeometryCache();
      this.key = key;
      this.initialHeight = cacheOrInitialHeight;
    }
  }

  get estimatedHeight(): number {
    return this.cache.estimate(this.key, this.initialHeight);
  }

  mount(view: EditorView, target: HTMLElement): void {
    this.unmount();
    this.coordinator = coordinatorFor(view);
    this.target = target;
    this.coordinator.observe(target, this);
  }

  sync(): void {
    if (this.coordinator && this.target) {
      this.coordinator.measure(this.target);
    }
  }

  unmount(reusedTarget = this.target): void {
    if (reusedTarget) {
      const coordinator = coordinatorsByTarget.get(reusedTarget);
      coordinator?.unobserve(reusedTarget);
    }
    if (reusedTarget === this.target) {
      this.coordinator = null;
      this.target = null;
    }
  }

  recordHeight(height: number): boolean {
    return this.cache.record(this.key, height, this.initialHeight);
  }
}

class BlockWidgetResizeCoordinator {
  private readonly measureRequest = {
    key: this,
    read: () => {
      const measurements = [...this.pendingReads]
        .filter((target) => this.targets.has(target))
        .map((target) => ({
          height: target.getBoundingClientRect().height,
          target,
        }));
      this.pendingReads.clear();
      return measurements;
    },
    write: (
      measurements: ReadonlyArray<{
        height: number;
        target: HTMLElement;
      }>,
    ) => {
      for (const { height, target } of measurements) {
        this.targets.get(target)?.recordHeight(height);
      }
    },
  };
  private readonly observer: ResizeObserver | null;
  private readonly pendingReads = new Set<HTMLElement>();
  private readonly targets = new Map<HTMLElement, ObservedBlockWidget>();

  constructor(private readonly view: EditorView) {
    this.observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver((entries) => {
          let changed = false;

          for (const entry of entries) {
            if (!(entry.target instanceof HTMLElement)) {
              continue;
            }
            const widget = this.targets.get(entry.target);
            if (!widget) {
              continue;
            }
            const height = resizeObserverHeight(entry);
            if (height === null) {
              this.measure(entry.target);
            } else {
              changed = widget.recordHeight(height) || changed;
            }
          }

          if (changed) {
            requestMountedWidgetMeasure(this.view);
          }
        });
  }

  observe(target: HTMLElement, widget: ObservedBlockWidget): void {
    const previousCoordinator = coordinatorsByTarget.get(target);
    if (previousCoordinator && previousCoordinator !== this) {
      previousCoordinator.unobserve(target);
    }
    this.targets.set(target, widget);
    coordinatorsByTarget.set(target, this);
    this.observer?.observe(target);
    queueMicrotask(() => {
      if (this.targets.get(target) === widget) {
        this.measure(target);
      }
    });
  }

  measure(target: HTMLElement): void {
    if (this.targets.has(target)) {
      this.pendingReads.add(target);
      requestMountedWidgetMeasure(this.view, this.measureRequest);
    }
  }

  unobserve(target: HTMLElement): void {
    this.targets.delete(target);
    this.pendingReads.delete(target);
    if (coordinatorsByTarget.get(target) === this) {
      coordinatorsByTarget.delete(target);
    }
    this.observer?.unobserve(target);

    if (this.targets.size === 0) {
      this.observer?.disconnect();
      observersByView.delete(this.view);
    }
  }
}

function coordinatorFor(view: EditorView): BlockWidgetResizeCoordinator {
  const existing = observersByView.get(view);
  if (existing) {
    return existing;
  }

  const coordinator = new BlockWidgetResizeCoordinator(view);
  observersByView.set(view, coordinator);
  return coordinator;
}

function resizeObserverHeight(
  entry: ResizeObserverEntry,
): number | null {
  const borderBoxSize = entry.borderBoxSize as
    | readonly ResizeObserverSize[]
    | ResizeObserverSize
    | undefined;
  const borderBox = Array.isArray(borderBoxSize)
    ? borderBoxSize[0]
    : borderBoxSize;
  return borderBox?.blockSize ?? null;
}

function requestMountedWidgetMeasure<T>(
  view: EditorView,
  request?: {
    key: unknown;
    read: () => T;
    write: (measurement: T) => void;
  },
): void {
  const measurementState = (
    view as EditorView & { viewState?: EditorViewMeasurementState }
  ).viewState;
  if (!measurementState) {
    throw new Error(
      'CodeMirror viewState is unavailable for block-widget measurement.',
    );
  }

  // requestMeasure() alone only queues a cycle. CodeMirror 6.43.4 also needs
  // this flag to re-read block DOM whose overflow changed after initial layout.
  measurementState.mustMeasureContent = true;
  view.requestMeasure(request);
}
