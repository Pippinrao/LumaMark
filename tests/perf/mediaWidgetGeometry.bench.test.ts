import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectImageBlocksInRanges,
  imagePreviewExtension,
} from '../../src/editor/capabilities/image/imagePreviewExtension';
import { markdownLanguage } from '../../src/editor/markdown/markdownLanguage';
import {
  formatLatencySamples,
  inputHardLimitMs,
  latencySampleCount,
  summarizeLatencySamples,
} from './performanceSamples';

const originalResizeObserver = globalThis.ResizeObserver;
const imageCounts = [100, 500, 1_000] as const;
const inputBudgetsMs: Record<(typeof imageCounts)[number], number> = {
  100: 16,
  500: 50,
  1_000: 100,
};
const imageDataUrl = 'data:image/png;base64,AA==';

class BenchmarkResizeObserver implements ResizeObserver {
  static instances: BenchmarkResizeObserver[] = [];

  readonly observed = new Set<Element>();
  readonly disconnect = vi.fn(() => {
    this.observed.clear();
  });

  constructor(private readonly callback: ResizeObserverCallback) {
    BenchmarkResizeObserver.instances.push(this);
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

  emitMediaBurst(): void {
    const roots = [...this.observed].filter(
      (target): target is HTMLElement =>
        target instanceof HTMLElement &&
        target.classList.contains('lm-image-preview'),
    );
    this.callback(
      roots.map((target, index) => ({
        borderBoxSize: [
          {
            blockSize: 240 + (index % 3) * 40,
            inlineSize: 800,
          },
        ],
        target,
      })) as unknown as ResizeObserverEntry[],
      this,
    );
  }
}

describe('media widget geometry performance baseline', () => {
  beforeEach(() => {
    BenchmarkResizeObserver.instances = [];
    globalThis.ResizeObserver = BenchmarkResizeObserver;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it.each(imageCounts)(
    'keeps $0 image blocks responsive and releases mounted geometry roots',
    async (imageCount) => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const doc = createImageDocument(imageCount);
      const heapBefore = process.memoryUsage().heapUsed;
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [
            markdownLanguage(),
            imagePreviewExtension({ documentPath: null }),
          ],
          selection: EditorSelection.cursor(0),
        }),
      });
      const requestMeasure = vi.spyOn(view, 'requestMeasure');

      await Promise.resolve();
      const discoveredImages = collectImageBlocksInRanges(view.state, [
        { from: 0, to: view.state.doc.length },
      ]).length;
      process.stdout.write(
        `[perf:media-widget-geometry:mount] ${imageCount} images; discovered ${discoveredImages}; observers ${BenchmarkResizeObserver.instances.length}; roots ${parent.querySelectorAll('.lm-image-preview').length}; lines ${parent.querySelectorAll('.cm-line').length}\n`,
      );
      expect(discoveredImages).toBeGreaterThan(0);
      expect(doc.match(/^!\[/gm)).toHaveLength(imageCount);
      const mediaObserver = BenchmarkResizeObserver.instances.find((observer) =>
        [...observer.observed].some(
          (target) =>
            target instanceof HTMLElement &&
            target.classList.contains('lm-image-preview'),
        ),
      );
      expect(mediaObserver).toBeDefined();
      expect(mediaObserver?.observed.size).toBeGreaterThan(0);

      requestMeasure.mockClear();
      mediaObserver?.emitMediaBurst();
      expect(requestMeasure).toHaveBeenCalledTimes(1);

      const inputValues: number[] = [];
      for (
        let sampleIndex = 0;
        sampleIndex < latencySampleCount;
        sampleIndex += 1
      ) {
        const insert = `\nmedia geometry input ${sampleIndex}`;
        const position = view.state.doc.length;
        const startedAt = performance.now();
        view.dispatch({
          changes: { from: position, insert },
          selection: EditorSelection.cursor(position + insert.length),
          userEvent: 'input.type',
        });
        inputValues.push(performance.now() - startedAt);
      }

      const heapAtPeak = process.memoryUsage().heapUsed;
      const samples = summarizeLatencySamples(inputValues);
      const finalDocument = view.state.doc.toString();
      view.destroy();
      parent.remove();
      await Promise.resolve();
      const heapAfterDestroy = process.memoryUsage().heapUsed;
      const retainedRoots = mediaObserver?.observed.size ?? 0;
      const hardLimit = inputHardLimitMs(inputBudgetsMs[imageCount]);

      process.stdout.write(
        [
          `[perf:media-widget-geometry] ${imageCount} images:`,
          `input p80 ${samples.p80.toFixed(2)} ms / median ${samples.median.toFixed(2)} ms / max ${samples.maximum.toFixed(2)} ms`,
          `samples ${formatLatencySamples(samples)};`,
          `heap ${heapBefore} -> ${heapAtPeak} -> ${heapAfterDestroy} bytes;`,
          `retained mounted roots ${retainedRoots}`,
          `(budgets p80 <${inputBudgetsMs[imageCount]} ms / max <${hardLimit} ms, retained roots = 0)`,
          '\n',
        ].join(' '),
      );

      expect(finalDocument).toContain('media geometry input 4');
      expect(samples.p80).toBeLessThan(inputBudgetsMs[imageCount]);
      expect(samples.maximum).toBeLessThan(hardLimit);
      expect(retainedRoots).toBe(0);
      expect(mediaObserver?.disconnect).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps selection rebuilds responsive with long inline image sources', async () => {
    const imageCount = 64;
    const payloadBytesPerImage = 32 * 1_024;
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const doc = createLongImageDocument(imageCount, payloadBytesPerImage);
    const heapBefore = process.memoryUsage().heapUsed;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          markdownLanguage(),
          imagePreviewExtension({ documentPath: null }),
        ],
        selection: EditorSelection.cursor(doc.length),
      }),
    });
    await Promise.resolve();

    const firstImagePosition = doc.indexOf('![long image 0]') + 3;
    const samplesMs: number[] = [];
    for (let sampleIndex = 0; sampleIndex < latencySampleCount; sampleIndex += 1) {
      const startedAt = performance.now();
      view.dispatch({
        selection: EditorSelection.cursor(firstImagePosition),
        userEvent: 'select.pointer',
      });
      view.dispatch({
        selection: EditorSelection.cursor(view.state.doc.length),
        userEvent: 'select.pointer',
      });
      samplesMs.push(performance.now() - startedAt);
    }

    const heapAtPeak = process.memoryUsage().heapUsed;
    const samples = summarizeLatencySamples(samplesMs);
    const sourceAfterSelection = view.state.doc.toString();
    view.destroy();
    parent.remove();
    await Promise.resolve();
    const heapAfterDestroy = process.memoryUsage().heapUsed;
    const p80BudgetMs = 100;
    const hardLimit = inputHardLimitMs(p80BudgetMs);

    process.stdout.write(
      [
        '[perf:media-widget-geometry:long-source-selection]',
        `${imageCount} images x ${payloadBytesPerImage} source bytes;`,
        `toggle p80 ${samples.p80.toFixed(2)} ms / median ${samples.median.toFixed(2)} ms / max ${samples.maximum.toFixed(2)} ms;`,
        `samples ${formatLatencySamples(samples)};`,
        `heap ${heapBefore} -> ${heapAtPeak} -> ${heapAfterDestroy} bytes`,
        `(budgets p80 <${p80BudgetMs} ms / max <${hardLimit} ms)`,
        '\n',
      ].join(' '),
    );

    expect(sourceAfterSelection).toBe(doc);
    expect(samples.p80).toBeLessThan(p80BudgetMs);
    expect(samples.maximum).toBeLessThan(hardLimit);
    expect(
      BenchmarkResizeObserver.instances.reduce(
        (total, observer) => total + observer.observed.size,
        0,
      ),
    ).toBe(0);
  });
});

function createImageDocument(imageCount: number): string {
  return [
    'head',
    '',
    ...Array.from({ length: imageCount }, (_, index) => [
      `![image ${index}](${imageDataUrl})`,
      '',
    ]).flat(),
    'tail',
  ].join('\n');
}

function createLongImageDocument(
  imageCount: number,
  payloadBytesPerImage: number,
): string {
  const payload = 'A'.repeat(payloadBytesPerImage);
  return [
    'head',
    '',
    ...Array.from({ length: imageCount }, (_, index) => [
      `![long image ${index}](data:image/png;base64,${payload}${index})`,
      '',
    ]).flat(),
    'tail',
  ].join('\n');
}
