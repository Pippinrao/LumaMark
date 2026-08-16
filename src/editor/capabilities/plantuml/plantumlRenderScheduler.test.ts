import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlantumlCacheKey, PlantumlRenderCache } from './PlantumlRenderCache';
import { PlantumlRenderScheduler } from './plantumlRenderScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe('createPlantumlCacheKey', () => {
  it('includes source and dark theme', () => {
    const base = { dark: false, source: '@startuml\nA -> B\n@enduml' };

    expect(createPlantumlCacheKey(base)).not.toBe(
      createPlantumlCacheKey({ ...base, source: '@startuml\nA -> C\n@enduml' }),
    );
    expect(createPlantumlCacheKey(base)).not.toBe(
      createPlantumlCacheKey({ ...base, dark: true }),
    );
  });
});

describe('PlantumlRenderCache', () => {
  it('evicts the oldest entry when the cache reaches its limit', () => {
    const cache = new PlantumlRenderCache({ maxEntries: 2 });

    cache.set('first', '<svg>first</svg>');
    cache.set('second', '<svg>second</svg>');
    cache.set('third', '<svg>third</svg>');

    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBe('<svg>second</svg>');
    expect(cache.get('third')).toBe('<svg>third</svg>');
  });
});

describe('PlantumlRenderScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels stale work so an old result cannot overwrite a newer request', async () => {
    vi.useFakeTimers();
    const first = deferred<string>();
    const second = deferred<string>();
    const render = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const scheduler = new PlantumlRenderScheduler({ debounceMs: 20, render });
    const onSuccess = vi.fn();
    const jobOwner = {};

    scheduler.request({
      blockId: 'block-1',
      dark: false,
      jobOwner,
      onSuccess,
      source: 'old',
    });
    await vi.advanceTimersByTimeAsync(20);

    scheduler.request({
      blockId: 'block-1',
      dark: false,
      jobOwner,
      onSuccess,
      source: 'new',
    });
    await vi.advanceTimersByTimeAsync(20);

    first.resolve('<svg>old</svg>');
    await vi.runAllTicks();

    expect(onSuccess).not.toHaveBeenCalledWith(
      expect.objectContaining({ svg: '<svg>old</svg>' }),
    );

    second.resolve('<svg>new</svg>');
    await vi.runAllTicks();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ svg: '<svg>new</svg>' }),
    );
  });

  it('reuses a cached render result for identical inputs', async () => {
    vi.useFakeTimers();
    const render = vi.fn<() => Promise<string>>().mockResolvedValue('<svg />');
    const scheduler = new PlantumlRenderScheduler({ debounceMs: 0, render });
    const onSuccess = vi.fn();
    const request = {
      blockId: 'block-1',
      dark: false,
      jobOwner: {},
      onSuccess,
      source: '@startuml\nA -> B\n@enduml',
    };

    scheduler.request(request);
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTicks();
    scheduler.request(request);
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTicks();

    expect(render).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(2);
  });

  it('isolates in-flight jobs by owner while sharing the cache', async () => {
    vi.useFakeTimers();
    const ownerA = {};
    const ownerB = {};
    const render = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue('<svg>shared</svg>');
    const scheduler = new PlantumlRenderScheduler({ debounceMs: 0, render });
    const onSuccessA = vi.fn();
    const onSuccessB = vi.fn();
    const content = {
      dark: true,
      source: '@startuml\nA -> B\n@enduml',
    };

    scheduler.request({
      ...content,
      blockId: '0:40',
      jobOwner: ownerA,
      onSuccess: onSuccessA,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTicks();

    scheduler.request({
      ...content,
      blockId: '80:120',
      jobOwner: ownerB,
      onSuccess: onSuccessB,
    });

    expect(onSuccessA).toHaveBeenCalledTimes(1);
    expect(onSuccessB).toHaveBeenCalledTimes(1);
    expect(onSuccessA.mock.calls[0]?.[0].cacheKey).toBe(
      onSuccessB.mock.calls[0]?.[0].cacheKey,
    );
    expect(render).toHaveBeenCalledTimes(1);
  });
});
