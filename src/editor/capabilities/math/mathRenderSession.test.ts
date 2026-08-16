import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MathRenderSession,
  type MathRenderSessionSnapshot,
  type MathWorkerLike,
} from './mathRenderSession';
import type {
  MathDocumentRenderRequest,
  MathDocumentRenderResult,
  MathDocumentWorkerRequest,
  MathDocumentWorkerResponse,
} from './mathWorkerProtocol';

class FakeWorker implements MathWorkerLike {
  readonly messages: MathDocumentWorkerRequest[] = [];
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessage: ((event: MessageEvent<MathDocumentWorkerResponse>) => unknown) | null = null;
  onmessageerror: ((event: MessageEvent) => unknown) | null = null;
  readonly terminate = vi.fn();

  postMessage(message: MathDocumentWorkerRequest): void {
    this.messages.push(message);
  }

  respond(result: MathDocumentRenderResult): void {
    this.onmessage?.(
      new MessageEvent('message', {
        data: { result, type: 'render-result' },
      }),
    );
  }

  fatal(
    generation: number,
    message: string,
    documentId = 'document-a',
  ): void {
    this.onmessage?.(
      new MessageEvent('message', {
        data: {
          documentId,
          error: message,
          generation,
          type: 'render-fatal',
        },
      }),
    );
  }

  fail(message: string): void {
    this.onerror?.(new ErrorEvent('error', { message }));
  }
}

function request(
  documentId = 'document-a',
  source = 'x',
): Omit<MathDocumentRenderRequest, 'generation'> {
  return {
    documentId,
    formulas: source
      ? [{ display: false, id: 'math:inline:0', source }]
      : [],
    layoutMetrics: { containerWidth: 800, em: 16, ex: 8 },
    preferences: { numbering: 'none', physics: false },
  };
}

function success(
  generation: number,
  chtml: string,
  documentId = 'document-a',
): MathDocumentRenderResult {
  return {
    documentId,
    documentLabels: {},
    formulas: [{
      chtml,
      id: 'math:inline:0',
      labels: [],
      sourceFingerprint: JSON.stringify([false, chtml.replace(/<[^>]+>/g, '')]),
    }],
    generation,
    stylesheet: '.mjx-test {}',
  };
}

describe('MathRenderSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates the worker lazily after the document request debounce', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const session = new MathRenderSession({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
      debounceMs: 20,
    });

    session.request(request());
    expect(session.snapshot.status).toBe('pending');
    expect(workers).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(19);
    expect(workers).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.messages[0]).toEqual({
      request: expect.objectContaining({ documentId: 'document-a', generation: 1 }),
      type: 'render',
    });
  });

  it('surfaces a synchronous worker creation failure and retries the same request', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    let createAttempts = 0;
    const createWorker = vi.fn(() => {
      createAttempts += 1;
      if (createAttempts === 1) {
        throw new Error('worker construction failed');
      }
      return worker;
    });
    const session = new MathRenderSession({ createWorker, debounceMs: 0 });
    const renderRequest = request('document-a', 'retry-worker-creation');

    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);

    expect(session.snapshot).toEqual(expect.objectContaining({
      error: 'worker construction failed',
      status: 'error',
    }));

    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);

    expect(worker.messages).toEqual([
      {
        request: expect.objectContaining({ generation: 2 }),
        type: 'render',
      },
    ]);
  });

  it('terminates after a synchronous postMessage failure and retries the same request', async () => {
    vi.useFakeTimers();
    const throwingWorker = new FakeWorker();
    vi.spyOn(throwingWorker, 'postMessage').mockImplementation(() => {
      throw new Error('worker postMessage failed');
    });
    const retryWorker = new FakeWorker();
    const workers = [throwingWorker, retryWorker];
    const createWorker = vi.fn(
      () => workers[createWorker.mock.calls.length - 1] as FakeWorker,
    );
    const session = new MathRenderSession({ createWorker, debounceMs: 0 });
    const renderRequest = request('document-a', 'retry-worker-message');

    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);

    expect(session.snapshot).toEqual(expect.objectContaining({
      error: 'worker postMessage failed',
      status: 'error',
    }));
    expect(throwingWorker.terminate).toHaveBeenCalledTimes(1);

    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);

    expect(retryWorker.messages).toEqual([
      {
        request: expect.objectContaining({ generation: 2 }),
        type: 'render',
      },
    ]);
  });

  it('drops stale generations and publishes only the current document result', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(() => workers[createWorker.mock.calls.length - 1] as FakeWorker);
    const snapshots: MathRenderSessionSnapshot[] = [];
    const session = new MathRenderSession({
      createWorker,
      debounceMs: 0,
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    session.request(request('document-a', 'old'));
    await vi.advanceTimersByTimeAsync(0);
    session.request(request('document-a', 'new'));
    await vi.advanceTimersByTimeAsync(0);

    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(workers[1]?.messages).toHaveLength(1);
    workers[0]?.respond(success(1, '<mjx-container>old</mjx-container>'));
    expect(session.snapshot.status).toBe('pending');

    workers[1]?.respond(success(2, '<mjx-container>new</mjx-container>'));
    expect(session.snapshot.status).toBe('success');
    expect(session.snapshot.result?.formulas[0]?.chtml).toContain('new');
    expect(snapshots.some((snapshot) => snapshot.result?.formulas[0]?.chtml?.includes('old'))).toBe(false);
  });

  it('does not create a worker for an empty inventory and clears render state', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker);
    const session = new MathRenderSession({ createWorker, debounceMs: 0 });

    session.request(request('document-a', 'x'));
    await vi.advanceTimersByTimeAsync(0);
    worker.respond(success(1, '<mjx-container>x</mjx-container>'));
    session.request(request('document-a', ''));

    expect(session.snapshot).toEqual(
      expect.objectContaining({ error: null, result: null, status: 'idle' }),
    );
    expect(session.snapshot.lastSuccessfulFormulas.size).toBe(0);

    const emptySession = new MathRenderSession({
      createWorker,
      debounceMs: 0,
    });
    emptySession.request(request('empty-document', ''));
    await vi.runAllTimersAsync();
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('terminates document state when switching documents and on destroy', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(() => workers[createWorker.mock.calls.length - 1] as FakeWorker);
    const session = new MathRenderSession({ createWorker, debounceMs: 0 });

    session.request(request('document-a'));
    await vi.advanceTimersByTimeAsync(0);
    session.request(request('document-b'));
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(session.snapshot.documentId).toBe('document-b');
    expect(session.snapshot.lastSuccessfulFormulas.size).toBe(0);
    await vi.advanceTimersByTimeAsync(0);

    session.destroy();
    expect(workers[1]?.terminate).toHaveBeenCalledTimes(1);
    expect(session.snapshot.status).toBe('idle');
  });

  it('surfaces a worker failure, preserves the last success, and recovers next generation', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(() => workers[createWorker.mock.calls.length - 1] as FakeWorker);
    const session = new MathRenderSession({ createWorker, debounceMs: 0 });

    session.request(request('document-a', 'x'));
    await vi.advanceTimersByTimeAsync(0);
    workers[0]?.respond(success(1, '<mjx-container>x</mjx-container>'));

    session.request(request('document-a', 'broken'));
    await vi.advanceTimersByTimeAsync(0);
    workers[0]?.fail('worker crashed');
    expect(session.snapshot.status).toBe('error');
    expect(session.snapshot.error).toBe('worker crashed');
    expect(session.snapshot.lastSuccessfulFormulas.get('math:inline:0')?.chtml).toContain('x');

    session.request(request('document-a', 'recovered'));
    await vi.advanceTimersByTimeAsync(0);
    workers[1]?.respond(success(3, '<mjx-container>recovered</mjx-container>'));
    expect(session.snapshot.status).toBe('success');
    expect(session.snapshot.error).toBeNull();
    expect(session.snapshot.result?.formulas[0]?.chtml).toContain('recovered');
  });

  it('treats a typed fatal response as a recoverable worker failure', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(() => workers[createWorker.mock.calls.length - 1] as FakeWorker);
    const session = new MathRenderSession({ createWorker, debounceMs: 0 });

    session.request(request('document-a', 'x'));
    await vi.advanceTimersByTimeAsync(0);
    workers[0]?.respond(success(1, '<mjx-container>x</mjx-container>'));
    session.request(request('document-a', 'oversized'));
    await vi.advanceTimersByTimeAsync(0);
    workers[0]?.fatal(2, 'Math formula exceeds safety limit.');

    expect(session.snapshot).toEqual(expect.objectContaining({
      error: 'Math formula exceeds safety limit.',
      status: 'error',
    }));
    expect(session.snapshot.lastSuccessfulFormulas.get('math:inline:0')?.chtml).toContain('x');
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);

    session.request(request('document-a', 'recovered'));
    await vi.advanceTimersByTimeAsync(0);
    workers[1]?.respond(success(3, '<mjx-container>recovered</mjx-container>'));
    expect(session.snapshot.status).toBe('success');
  });

  it('allows the same ordered request to retry after a fatal response', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(
      () => workers[createWorker.mock.calls.length - 1] as FakeWorker,
    );
    const session = new MathRenderSession({ createWorker, debounceMs: 0 });
    const renderRequest = request('document-a', 'retry-me');

    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);
    workers[0]?.fatal(1, 'transient fatal');
    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);

    expect(workers[1]?.messages).toEqual([
      {
        request: expect.objectContaining({ generation: 2, formulas: renderRequest.formulas }),
        type: 'render',
      },
    ]);
  });

  it('does not assign an ordinal preview to a newly inserted formula', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const session = new MathRenderSession({ createWorker: () => worker, debounceMs: 0 });

    session.request(request('document-a', 'x'));
    await vi.advanceTimersByTimeAsync(0);
    worker.respond(success(1, '<mjx-container>x</mjx-container>'));
    session.request({
      ...request('document-a', 'inserted'),
      formulas: [
        { display: false, id: 'math:inline:0', source: 'inserted' },
        { display: false, id: 'math:inline:1', source: 'x' },
      ],
    });

    expect(session.snapshot.lastSuccessfulFormulas.get('math:inline:0')).toBeUndefined();
    expect(session.snapshot.lastSuccessfulFormulas.get('math:inline:1')).toEqual(
      expect.objectContaining({
        chtml: '<mjx-container>x</mjx-container>',
        id: 'math:inline:1',
      }),
    );

    session.request(request('document-a', ''));
    expect(session.snapshot.lastSuccessfulFormulas.size).toBe(0);
  });

  it('retains duplicate-source previews in ordered subsequence positions', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const session = new MathRenderSession({ createWorker: () => worker, debounceMs: 0 });
    const duplicateFormulas = [
      { display: true, id: 'math:block:0', source: 'x' },
      { display: true, id: 'math:block:1', source: 'x' },
    ];

    session.request({ ...request(), formulas: duplicateFormulas });
    await vi.advanceTimersByTimeAsync(0);
    worker.respond({
      documentId: 'document-a',
      documentLabels: {},
      formulas: duplicateFormulas.map((formula, index) => ({
        chtml: `<mjx-container>equation-${index + 1}</mjx-container>`,
        id: formula.id,
        labels: [],
        sourceFingerprint: JSON.stringify([formula.display, formula.source]),
      })),
      generation: 1,
      stylesheet: '',
    });

    session.request({
      ...request(),
      formulas: [
        { display: true, id: 'math:block:0', source: 'inserted' },
        { display: true, id: 'math:block:1', source: 'x' },
        { display: true, id: 'math:block:2', source: 'x' },
      ],
    });

    expect(session.snapshot.lastSuccessfulFormulas.get('math:block:0')).toBeUndefined();
    expect(session.snapshot.lastSuccessfulFormulas.get('math:block:1')?.chtml).toContain(
      'equation-1',
    );
    expect(session.snapshot.lastSuccessfulFormulas.get('math:block:2')?.chtml).toContain(
      'equation-2',
    );
  });

  it('terminates a timed-out worker and recovers on the next generation', async () => {
    vi.useFakeTimers();
    const workers = [new FakeWorker(), new FakeWorker()];
    const createWorker = vi.fn(() => workers[createWorker.mock.calls.length - 1] as FakeWorker);
    const session = new MathRenderSession({
      createWorker,
      debounceMs: 0,
      watchdogMs: 50,
    });

    session.request(request('document-a', 'slow'));
    await vi.advanceTimersByTimeAsync(49);
    expect(session.snapshot.status).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    expect(session.snapshot).toEqual(
      expect.objectContaining({
        error: 'Math rendering timed out.',
        status: 'error',
      }),
    );
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);

    session.request(request('document-a', 'recovered'));
    await vi.advanceTimersByTimeAsync(0);
    workers[1]?.respond(success(2, '<mjx-container>recovered</mjx-container>'));
    expect(session.snapshot.status).toBe('success');
  });

  it('debounces duplicate ordered document requests without starting a new generation', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const session = new MathRenderSession({
      createWorker: () => worker,
      debounceMs: 0,
    });
    const renderRequest = request('document-a', 'x');

    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);
    worker.respond(success(1, '<mjx-container>x</mjx-container>'));
    session.request(renderRequest);
    await vi.advanceTimersByTimeAsync(0);

    expect(worker.messages).toHaveLength(1);
    expect(session.snapshot.generation).toBe(1);
    expect(session.snapshot.status).toBe('success');
  });
});
