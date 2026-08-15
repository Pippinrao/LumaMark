import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMermaidCacheKey } from './mermaidCache';
import { MermaidRenderCache } from './mermaidCache';
import { MermaidRenderScheduler } from './mermaidRenderScheduler';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe('createMermaidCacheKey', () => {
  it('includes source theme config and mermaid version', () => {
    const base = {
      config: { securityLevel: 'strict' },
      mermaidVersion: '11.0.0',
      source: 'flowchart TD\nA-->B',
      theme: 'default',
    };

    expect(createMermaidCacheKey(base)).not.toBe(
      createMermaidCacheKey({ ...base, source: 'flowchart TD\nA-->C' }),
    );
    expect(createMermaidCacheKey(base)).not.toBe(
      createMermaidCacheKey({ ...base, theme: 'dark' }),
    );
    expect(createMermaidCacheKey(base)).not.toBe(
      createMermaidCacheKey({
        ...base,
        config: { securityLevel: 'loose' },
      }),
    );
    expect(createMermaidCacheKey(base)).not.toBe(
      createMermaidCacheKey({ ...base, mermaidVersion: '11.1.0' }),
    );
  });

  it('sorts config keys before generating a key', () => {
    const left = createMermaidCacheKey({
      config: { a: 1, b: 2 },
      mermaidVersion: '11.0.0',
      source: 'graph TD',
      theme: 'default',
    });
    const right = createMermaidCacheKey({
      config: { b: 2, a: 1 },
      mermaidVersion: '11.0.0',
      source: 'graph TD',
      theme: 'default',
    });

    expect(left).toBe(right);
  });
});

describe('MermaidRenderCache', () => {
  it('evicts the oldest entry when the cache reaches its limit', () => {
    const cache = new MermaidRenderCache({ maxEntries: 2 });

    cache.set('first', '<svg>first</svg>');
    cache.set('second', '<svg>second</svg>');
    cache.set('third', '<svg>third</svg>');

    expect(cache.get('first')).toBeUndefined();
    expect(cache.get('second')).toBe('<svg>second</svg>');
    expect(cache.get('third')).toBe('<svg>third</svg>');
  });
});

describe('MermaidRenderScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels stale work so an old result cannot overwrite a newer request', async () => {
    vi.useFakeTimers();
    const jobOwner = {};
    const first = deferred<string>();
    const second = deferred<string>();
    const render = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 20,
      render,
    });
    const onSuccess = vi.fn();

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess,
      source: 'old',
      theme: 'default',
    });
    await vi.advanceTimersByTimeAsync(20);

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess,
      source: 'new',
      theme: 'default',
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
      expect.objectContaining({
        cacheKey: createMermaidCacheKey({
          config: {},
          mermaidVersion: '11.0.0',
          source: 'new',
          theme: 'default',
        }),
        svg: '<svg>new</svg>',
      }),
    );
  });

  it('reuses a cached render result for identical inputs', async () => {
    vi.useFakeTimers();
    const jobOwner = {};
    const render = vi.fn<() => Promise<string>>().mockResolvedValue('<svg />');
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render,
    });
    const onSuccess = vi.fn();
    const request = {
      blockId: 'block-1',
      config: { securityLevel: 'strict' },
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess,
      source: 'flowchart TD\nA-->B',
      theme: 'default',
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

  it('shares cached content across owners and block positions', async () => {
    vi.useFakeTimers();
    const ownerA = {};
    const ownerB = {};
    const render = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue('<svg>shared</svg>');
    const scheduler = new MermaidRenderScheduler({ debounceMs: 0, render });
    const onSuccessA = vi.fn();
    const onSuccessB = vi.fn();
    const content = {
      config: { securityLevel: 'strict' },
      mermaidVersion: '11.0.0',
      source: 'flowchart TD\nA-->B',
      theme: 'default' as const,
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

  it('cancels an in-flight job before returning a cached result for the same block', async () => {
    vi.useFakeTimers();
    const jobOwner = {};
    const oldRender = deferred<string>();
    const render = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('<svg>cached</svg>')
      .mockReturnValueOnce(oldRender.promise);
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render,
    });
    const cachedSuccess = vi.fn();
    const oldSuccess = vi.fn();

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess: cachedSuccess,
      source: 'cached',
      theme: 'default',
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTicks();

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess: oldSuccess,
      source: 'old',
      theme: 'default',
    });
    await vi.advanceTimersByTimeAsync(0);

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess: cachedSuccess,
      source: 'cached',
      theme: 'default',
    });

    oldRender.resolve('<svg>old</svg>');
    await vi.runAllTicks();

    expect(cachedSuccess).toHaveBeenCalledTimes(2);
    expect(oldSuccess).not.toHaveBeenCalled();
  });

  it('uses a monotonic job token after cache hits so older renders cannot match newer jobs', async () => {
    vi.useFakeTimers();
    const jobOwner = {};
    const oldRender = deferred<string>();
    const newerRender = deferred<string>();
    const render = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('<svg>cached</svg>')
      .mockReturnValueOnce(oldRender.promise)
      .mockReturnValueOnce(newerRender.promise);
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render,
    });
    const cachedSuccess = vi.fn();
    const oldSuccess = vi.fn();
    const newerSuccess = vi.fn();

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess: cachedSuccess,
      source: 'cached',
      theme: 'default',
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTicks();

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess: oldSuccess,
      source: 'old',
      theme: 'default',
    });
    await vi.advanceTimersByTimeAsync(0);

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess: cachedSuccess,
      source: 'cached',
      theme: 'default',
    });

    scheduler.request({
      blockId: 'block-1',
      config: {},
      jobOwner,
      mermaidVersion: '11.0.0',
      onSuccess: newerSuccess,
      source: 'newer',
      theme: 'default',
    });
    await vi.advanceTimersByTimeAsync(0);

    oldRender.resolve('<svg>old</svg>');
    await vi.runAllTicks();
    newerRender.resolve('<svg>newer</svg>');
    await vi.runAllTicks();

    expect(oldSuccess).not.toHaveBeenCalled();
    expect(newerSuccess).toHaveBeenCalledTimes(1);
    expect(newerSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ svg: '<svg>newer</svg>' }),
    );
  });
});
