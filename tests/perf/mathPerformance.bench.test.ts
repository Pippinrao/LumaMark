import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectMathInventory } from '../../src/editor/capabilities/math/mathInventory';
import { mathPreviewExtension } from '../../src/editor/capabilities/math/mathPreviewExtension';
import {
  MathRenderSession,
  type MathWorkerLike,
} from '../../src/editor/capabilities/math/mathRenderSession';
import { renderMathDocument } from '../../src/editor/capabilities/math/mathDocumentRenderer';
import type {
  MathDocumentRenderRequest,
  MathDocumentWorkerRequest,
  MathDocumentWorkerResponse,
} from '../../src/editor/capabilities/math/mathWorkerProtocol';
import { markdownLanguage } from '../../src/editor/markdown/markdownLanguage';
import {
  formatLatencySamples,
  summarizeLatencySamples,
} from './performanceSamples';

const originalResizeObserver = globalThis.ResizeObserver;
const oneMegabyte = 1024 * 1024;

class BenchmarkWorker implements MathWorkerLike {
  readonly messages: MathDocumentWorkerRequest[] = [];
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessage: ((event: MessageEvent<MathDocumentWorkerResponse>) => unknown) | null = null;
  onmessageerror: ((event: MessageEvent) => unknown) | null = null;
  readonly terminate = vi.fn();

  postMessage(message: MathDocumentWorkerRequest): void {
    this.messages.push(message);
  }
}

class BenchmarkResizeObserver implements ResizeObserver {
  static instances: BenchmarkResizeObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    BenchmarkResizeObserver.instances.push(this);
  }

  disconnect(): void {
    this.observed.clear();
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  takeRecords(): ResizeObserverEntry[] {
    return [];
  }

  emit(target: Element): void {
    this.callback([{ target }] as ResizeObserverEntry[], this);
  }
}

describe('math capability performance baseline', () => {
  beforeEach(() => {
    BenchmarkResizeObserver.instances = [];
    globalThis.ResizeObserver = BenchmarkResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    document.body.replaceChildren();
    document.head
      .querySelectorAll('[data-lm-math-style]')
      .forEach((node) => node.remove());
    vi.restoreAllMocks();
  });

  it('keeps a 1 MB no-math document off the worker and bounds ordinary input', () => {
    const doc = createNoMathDocument(oneMegabyte);
    const workers: BenchmarkWorker[] = [];
    const createWorker = () => {
      const worker = new BenchmarkWorker();
      workers.push(worker);
      return worker;
    };

    // Warm both variants before alternating samples so parser/JIT startup does
    // not get attributed to whichever variant happens to run first.
    measureNoMathMount(doc, false, createWorker);
    measureNoMathMount(doc, true, createWorker);
    const baselineValues: number[] = [];
    const mathValues: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const order = index % 2 === 0 ? [false, true] : [true, false];
      for (const withMath of order) {
        const durationMs = measureNoMathMount(doc, withMath, createWorker);
        (withMath ? mathValues : baselineValues).push(durationMs);
      }
    }
    const baselineLoad = summarizeLatencySamples(baselineValues);
    const mathLoad = summarizeLatencySamples(mathValues);
    const loadDurationMs = mathLoad.median;
    const mathOverheadMs = mathLoad.median - baselineLoad.median;

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          mathPreviewExtension({
            createWorker,
            debounceMs: 0,
            documentId: 'math-perf-no-formulas',
            mode: 'livePreview',
          }),
        ],
        selection: EditorSelection.cursor(doc.length),
      }),
    });

    try {
      const inputValues: number[] = [];
      for (let index = 0; index < 20; index += 1) {
        const insert = `\nordinary input ${index}`;
        const position = view.state.doc.length;
        const startedAt = performance.now();
        view.dispatch({
          changes: { from: position, insert },
          selection: EditorSelection.cursor(position + insert.length),
          userEvent: 'input.type',
        });
        inputValues.push(performance.now() - startedAt);
      }
      const input = summarizePercentileSamples(inputValues);

      process.stdout.write(
        [
          '[perf:math-no-formulas]',
          `${Buffer.byteLength(doc, 'utf8')} bytes:`,
          `baseline median ${baselineLoad.median.toFixed(2)} ms / math median ${mathLoad.median.toFixed(2)} ms / overhead ${mathOverheadMs.toFixed(2)} ms;`,
          `input p95 ${input.p95.toFixed(2)} ms / p80 ${input.samples.p80.toFixed(2)} ms / max ${input.samples.maximum.toFixed(2)} ms;`,
          `samples ${formatLatencySamples(input.samples)};`,
          `workers ${workers.length}`,
          '(budgets load <300 ms, math overhead <50 ms, p95 <16 ms / max <50 ms, workers = 0)',
          '\n',
        ].join(' '),
      );

      expect(loadDurationMs).toBeLessThan(300);
      expect(mathOverheadMs).toBeLessThan(50);
      expect(input.p95).toBeLessThan(16);
      expect(input.samples.maximum).toBeLessThan(50);
      expect(workers).toHaveLength(0);
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it.each([100, 1_000] as const)(
    'bounds inventory, preview scheduling, normal input and selection with %i formulas',
    async (formulaCount) => {
      const doc = createFormulaDocument(formulaCount);
      const inventoryState = EditorState.create({
        doc,
        extensions: [markdownLanguage()],
      });
      const inventoryStartedAt = performance.now();
      const inventory = collectMathInventory(inventoryState);
      const inventoryDurationMs = performance.now() - inventoryStartedAt;
      const workers: BenchmarkWorker[] = [];
      const requestRender = vi.spyOn(MathRenderSession.prototype, 'request');
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const mountStartedAt = performance.now();
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [
            markdownLanguage(),
            mathPreviewExtension({
              createWorker: () => {
                const worker = new BenchmarkWorker();
                workers.push(worker);
                return worker;
              },
              debounceMs: 0,
              documentId: `math-perf-${formulaCount}`,
              mode: 'livePreview',
            }),
          ],
          selection: EditorSelection.cursor(doc.length),
        }),
      });
      const mountDurationMs = performance.now() - mountStartedAt;

      try {
        await waitForMacrotask();
        expect(workers).toHaveLength(1);
        expect(workers[0]?.messages.at(-1)?.request.formulas).toHaveLength(
          formulaCount,
        );

        const inputValues: number[] = [];
        for (let index = 0; index < 20; index += 1) {
          const insert = ` plain-input-${index}`;
          const position = view.state.doc.length;
          const startedAt = performance.now();
          view.dispatch({
            changes: { from: position, insert },
            selection: EditorSelection.cursor(position + insert.length),
            userEvent: 'input.type',
          });
          inputValues.push(performance.now() - startedAt);
        }

        const tail = view.state.doc.length;
        const selectionValues: number[] = [];
        for (let index = 0; index < 20; index += 1) {
          const startedAt = performance.now();
          view.dispatch({
            selection: EditorSelection.cursor(tail - (index % 2)),
            userEvent: 'select.pointer',
          });
          selectionValues.push(performance.now() - startedAt);
        }

        const input = summarizePercentileSamples(inputValues);
        const selection = summarizePercentileSamples(selectionValues);
        const inventoryBudgetMs = formulaCount === 100 ? 50 : 100;
        const mountBudgetMs = formulaCount === 100 ? 150 : 500;
        const inputBudgetMs = formulaCount === 100 ? 16 : 50;

        process.stdout.write(
          [
            `[perf:math-main-thread] ${formulaCount} formulas:`,
            `inventory ${inventoryDurationMs.toFixed(2)} ms;`,
            `mount/request ${mountDurationMs.toFixed(2)} ms;`,
            `input p95 ${input.p95.toFixed(2)} ms / max ${input.samples.maximum.toFixed(2)} ms;`,
            `selection p95 ${selection.p95.toFixed(2)} ms / max ${selection.samples.maximum.toFixed(2)} ms;`,
            `heap ${process.memoryUsage().heapUsed} bytes`,
            `(budgets inventory <${inventoryBudgetMs} ms, mount <${mountBudgetMs} ms, input p95 <${inputBudgetMs} ms / max <100 ms, selection p95 <16 ms / max <50 ms)`,
            '\n',
          ].join(' '),
        );

        expect(inventory).toHaveLength(formulaCount);
        expect(inventoryDurationMs).toBeLessThan(inventoryBudgetMs);
        expect(mountDurationMs).toBeLessThan(mountBudgetMs);
        expect(input.p95).toBeLessThan(inputBudgetMs);
        expect(input.samples.maximum).toBeLessThan(100);
        expect(selection.p95).toBeLessThan(16);
        expect(selection.samples.maximum).toBeLessThan(50);
        expect(workers[0]?.messages).toHaveLength(1);
        expect(requestRender).toHaveBeenCalledTimes(1);
        expect(workers[0]?.terminate).not.toHaveBeenCalled();
      } finally {
        view.destroy();
        parent.remove();
      }
    },
  );

  it('coalesces resize bursts before rescanning a 1000-formula document', async () => {
    const workers: BenchmarkWorker[] = [];
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    let width = 800;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: createFormulaDocument(1_000),
        extensions: [
          markdownLanguage(),
          mathPreviewExtension({
            createWorker: () => {
              const worker = new BenchmarkWorker();
              workers.push(worker);
              return worker;
            },
            debounceMs: 5,
            documentId: 'math-resize',
            mode: 'livePreview',
          }),
        ],
      }),
    });
    Object.defineProperty(view.contentDOM, 'clientWidth', {
      configurable: true,
      get: () => width,
    });

    try {
      await waitForMacrotask(10);
      expect(workers).toHaveLength(1);
      const contentObserver = BenchmarkResizeObserver.instances.find(
        (observer) => observer.observed.has(view.contentDOM),
      );
      expect(contentObserver).toBeDefined();

      const burstStartedAt = performance.now();
      for (let index = 0; index < 100; index += 1) {
        width = 900 + index;
        contentObserver?.emit(view.contentDOM);
      }
      const burstDispatchMs = performance.now() - burstStartedAt;
      await waitForMacrotask(50);

      process.stdout.write(
        `[perf:math-resize] 100 resize events over 1000 formulas ${burstDispatchMs.toFixed(2)} ms; workers ${workers.length}; messages ${workers.map(({ messages }) => messages.length).join(',')} (budget dispatch <16 ms, one latest replacement worker/message)\n`,
      );

      expect(burstDispatchMs).toBeLessThan(16);
      expect(workers).toHaveLength(2);
      expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
      expect(workers[1]?.messages).toHaveLength(1);
      expect(
        workers[1]?.messages[0]?.request.layoutMetrics.containerWidth,
      ).toBe(999);
    } finally {
      view.destroy();
      parent.remove();
    }
  });

  it('deduplicates 1000-formula requests and releases workers on document switch', async () => {
    const workers: BenchmarkWorker[] = [];
    const session = new MathRenderSession({
      createWorker: () => {
        const worker = new BenchmarkWorker();
        workers.push(worker);
        return worker;
      },
      debounceMs: 0,
    });
    const formulas = Array.from({ length: 1_000 }, (_, index) => ({
      display: index % 5 === 0,
      id: `math:${index}`,
      source: `x_{${index}} + y_{${index}}`,
    }));
    const request = {
      documentId: 'document-a',
      formulas,
      layoutMetrics: { containerWidth: 800, em: 16, ex: 8 },
      preferences: { numbering: 'none' as const, physics: false },
    };

    const requestStartedAt = performance.now();
    for (let index = 0; index < 20; index += 1) {
      session.request(request);
    }
    const duplicateRequestMs = performance.now() - requestStartedAt;
    await waitForMacrotask();
    session.request({ ...request, documentId: 'document-b' });
    await waitForMacrotask();
    session.destroy();

    process.stdout.write(
      `[perf:math-session] 20 x 1000-formula duplicate requests ${duplicateRequestMs.toFixed(2)} ms; workers ${workers.length}; heap ${process.memoryUsage().heapUsed} bytes (budget <50 ms, two document workers both released)\n`,
    );

    expect(duplicateRequestMs).toBeLessThan(50);
    expect(workers).toHaveLength(2);
    expect(workers[0]?.messages).toHaveLength(1);
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(workers[1]?.messages).toHaveLength(1);
    expect(workers[1]?.terminate).toHaveBeenCalledTimes(1);
  });

  it('records a real 100-formula MathJax document render separately', async () => {
    const formulaCount = 100;
    const request: MathDocumentRenderRequest = {
      documentId: 'math-render-performance',
      formulas: Array.from({ length: formulaCount }, (_, index) => ({
        display: index % 5 === 0,
        id: `math:${index}`,
        source: `x_{${index}}^2 + y_{${index}}^2 = z_{${index}}^2`,
      })),
      generation: 1,
      layoutMetrics: { containerWidth: 800, em: 16, ex: 8 },
      preferences: { numbering: 'ams', physics: false },
    };
    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = performance.now();
    const result = await renderMathDocument(request);
    const durationMs = performance.now() - startedAt;
    const heapAfter = process.memoryUsage().heapUsed;
    const heapGrowthBytes = Math.max(0, heapAfter - heapBefore);

    process.stdout.write(
      `[perf:math-renderer] ${formulaCount} formulas ${durationMs.toFixed(2)} ms; heap ${heapBefore} -> ${heapAfter} bytes; growth ${heapGrowthBytes} bytes (safety budgets <15000 ms / growth <268435456 bytes)\n`,
    );

    expect(result.formulas).toHaveLength(formulaCount);
    expect(result.formulas.every(({ chtml, error }) => Boolean(chtml) && !error)).toBe(true);
    expect(durationMs).toBeLessThan(15_000);
    expect(heapGrowthBytes).toBeLessThan(256 * 1024 * 1024);
  });
});

function createNoMathDocument(targetBytes: number): string {
  const paragraph = 'Plain Markdown paragraph without formula delimiters.\n\n';
  return paragraph.repeat(Math.ceil(targetBytes / paragraph.length)).slice(0, targetBytes);
}

function createFormulaDocument(formulaCount: number): string {
  return [
    ...Array.from(
      { length: formulaCount },
      (_, index) => `Formula ${index}: $x_{${index}} + y_{${index}}$.`,
    ),
    '',
    'ordinary tail text',
  ].join('\n');
}

function measureNoMathMount(
  doc: string,
  withMath: boolean,
  createWorker: () => MathWorkerLike,
): number {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const startedAt = performance.now();
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        ...(withMath
          ? [
              mathPreviewExtension({
                createWorker,
                debounceMs: 0,
                documentId: 'math-perf-no-formulas-mount',
                mode: 'livePreview',
              }),
            ]
          : []),
      ],
      selection: EditorSelection.cursor(doc.length),
    }),
  });
  const durationMs = performance.now() - startedAt;
  view.destroy();
  parent.remove();
  return durationMs;
}

function summarizePercentileSamples(values: readonly number[]): {
  readonly p95: number;
  readonly samples: ReturnType<typeof summarizeLatencySamples>;
} {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0,
    samples: summarizeLatencySamples(values),
  };
}

function waitForMacrotask(delayMs = 0): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
