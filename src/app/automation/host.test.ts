import { describe, expect, it, vi } from 'vitest';
import { runHost } from './host';
import type { HostPort } from './host';
import type { RenderJob, Report, RendererLimits, RendererMessages } from './types';

const messages: RendererMessages = {
  tooLarge: 'too large',
  tooMany: 'too many',
  empty: 'empty',
  timeout: 'timeout',
  noSvg: 'no svg',
  loadFailed: 'load failed',
};

const limits: RendererLimits = {
  sourceBytes: 1024,
  diagrams: 10,
  timeoutMs: 1_000,
};

function job(jobId: number, overrides: Partial<RenderJob> = {}): RenderJob {
  return {
    jobId,
    mode: 'render',
    source: 'graph TD',
    format: 'mermaid',
    limits,
    messages,
    ...overrides,
  };
}

function createPort(jobs: Array<RenderJob | null>) {
  const calls: {
    ready: number;
    nextJob: number;
    progress: Array<[number, number]>;
    results: Array<[number, Report]>;
  } = { ready: 0, nextJob: 0, progress: [], results: [] };
  const queue = [...jobs];
  const port: HostPort = {
    ready: vi.fn(async () => {
      calls.ready++;
    }),
    nextJob: vi.fn(async () => {
      calls.nextJob++;
      return queue.shift() ?? null;
    }),
    progress: vi.fn(async (jobId: number, completed: number) => {
      calls.progress.push([jobId, completed]);
    }),
    result: vi.fn(async (jobId: number, report: Report) => {
      calls.results.push([jobId, report]);
    }),
  };
  return { port, calls };
}

describe('automation renderer host loop', () => {
  it('announces readiness and stops when the host runs out of jobs', async () => {
    const { port, calls } = createPort([]);

    await runHost(port, async () => ({ ok: true, svg: '<svg/>' }));

    expect(calls.ready).toBe(1);
    expect(calls.nextJob).toBe(1);
    expect(calls.results).toEqual([]);
  });

  it('renders each queued job and delivers one report per job', async () => {
    const { port, calls } = createPort([job(7), job(8, { source: 'bad ^^^' })]);

    await runHost(port, async (_job, { source }) =>
      source === 'graph TD'
        ? { ok: true, svg: '<svg/>' }
        : { ok: false, code: 'diagram.invalid', message: 'bad' },
    );

    expect(calls.results.map(([id]) => id)).toEqual([7, 8]);
    expect(calls.results[0][1]).toMatchObject({ ok: true, checked: 1 });
    expect(calls.results[1][1]).toMatchObject({ ok: false, checked: 1 });
  });

  it('reports per-diagram progress for markdown jobs', async () => {
    const markdown = '```mermaid\ngraph TD\n```\n\n```mermaid\ngraph LR\n```\n';
    const { port, calls } = createPort([job(3, { source: markdown, format: 'markdown' })]);

    await runHost(port, async () => ({ ok: true, svg: '<svg/>' }));

    expect(calls.progress).toEqual([
      [3, 1],
      [3, 2],
    ]);
  });

  it('keeps serving later jobs after a renderer throws', async () => {
    const { port, calls } = createPort([job(1), job(2)]);

    await runHost(port, async () => {
      throw new Error('engine exploded');
    });

    expect(calls.results).toHaveLength(2);
    expect(calls.results[0][1].diagnostics[0].code).toBe('automation.failed');
  });

  it('stops pulling when the host closes the window instead of spinning', async () => {
    const port: HostPort = {
      ready: vi.fn(async () => undefined),
      nextJob: vi.fn(async () => {
        throw new Error('window closed');
      }),
      progress: vi.fn(async () => undefined),
      result: vi.fn(async () => undefined),
    };

    await expect(runHost(port, async () => ({ ok: true, svg: '<svg/>' }))).resolves.toBeUndefined();
    expect(port.nextJob).toHaveBeenCalledTimes(1);
  });
});
