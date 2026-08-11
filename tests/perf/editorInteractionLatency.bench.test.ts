import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { forceParsing } from '@codemirror/language';
import { EditorSelection, Transaction } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
  createEditorApi,
  type EditorApi,
} from '../../src/editor/core/editorApi';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';
import {
  formatLatencySamples,
  inputHardLimitMs,
  measureLatencySamples,
  summarizeLatencySamples,
} from './performanceSamples';

const selectionProbeCount = 12;
const denseCodeBlockCount = 2_048;
const denseCodeBlockBudgetsMs = {
  activation: 16,
  completion: 16,
  input: 16,
  load: 300,
};
const interactionBudgetsMs: Record<
  string,
  {
    appearanceDispatchRoundTrip: number;
    modeRoundTrip: number;
    selectionBatch: number;
  }
> = {
  'large-1mb.md': {
    appearanceDispatchRoundTrip: 50,
    modeRoundTrip: 150,
    selectionBatch: 100,
  },
  'large-5mb.md': {
    appearanceDispatchRoundTrip: 75,
    modeRoundTrip: 300,
    selectionBatch: 120,
  },
  'large-10mb.md': {
    appearanceDispatchRoundTrip: 100,
    modeRoundTrip: 600,
    selectionBatch: 160,
  },
};

describe('editor interaction latency baseline', () => {
  it.each(largeMarkdownFixturePaths)(
    'records selection-only and display-mode latency for $name',
    async ({ name, path }) => {
      const source = await readFile(path, 'utf8');
      const { editor, parent } = createTestEditor(source);

      try {
        const documentBefore = editor.view.state.doc;
        const selectionPositions = Array.from(
          { length: selectionProbeCount },
          (_, index) =>
            Math.floor(
              (documentBefore.length * (index + 1)) /
                (selectionProbeCount + 1),
            ),
        );
        const selectionStartedAt = performance.now();

        for (const position of selectionPositions) {
          editor.view.dispatch({
            selection: EditorSelection.cursor(position),
          });
        }

        const selectionDurationMs =
          performance.now() - selectionStartedAt;
        const selectionBeforeMode = editor.view.state.selection;
        const modeStartedAt = performance.now();

        editor.setDisplayMode('source');
        editor.setDisplayMode('livePreview');

        const modeRoundTripDurationMs =
          performance.now() - modeStartedAt;
        const appearanceStartedAt = performance.now();

        editor.setAppearance({ fontZoomPercent: 110, pageWidthPx: 1040 });
        editor.setAppearance({ fontZoomPercent: 100, pageWidthPx: 810 });

        const appearanceDispatchRoundTripDurationMs =
          performance.now() - appearanceStartedAt;

        process.stdout.write(
          [
            `[perf:editor-interaction] ${name}:`,
            `${selectionProbeCount} selection-only dispatches`,
            `${selectionDurationMs.toFixed(2)} ms`,
            `(avg ${(selectionDurationMs / selectionProbeCount).toFixed(2)} ms),`,
            `mode round-trip ${modeRoundTripDurationMs.toFixed(2)} ms`,
            `appearance compartment dispatch round-trip ${appearanceDispatchRoundTripDurationMs.toFixed(2)} ms`,
            `(budgets selection <${interactionBudgetsMs[name].selectionBatch} ms,`,
            `mode <${interactionBudgetsMs[name].modeRoundTrip} ms,`,
            `appearance dispatch <${interactionBudgetsMs[name].appearanceDispatchRoundTrip} ms)`,
            '\n',
          ].join(' '),
        );

        expect(editor.view.state.doc).toBe(documentBefore);
        expect(editor.view.state.selection.eq(selectionBeforeMode)).toBe(true);
        expect(editor.getDisplayMode()).toBe('livePreview');
        expect(
          parent.querySelector('.lm-editor-live-preview-mode'),
        ).not.toBeNull();
        expect(Number.isFinite(selectionDurationMs)).toBe(true);
        expect(Number.isFinite(modeRoundTripDurationMs)).toBe(true);
        expect(Number.isFinite(appearanceDispatchRoundTripDurationMs)).toBe(true);
        expect(selectionDurationMs).toBeLessThan(
          interactionBudgetsMs[name].selectionBatch,
        );
        expect(modeRoundTripDurationMs).toBeLessThan(
          interactionBudgetsMs[name].modeRoundTrip,
        );
        expect(appearanceDispatchRoundTripDurationMs).toBeLessThan(
          interactionBudgetsMs[name].appearanceDispatchRoundTrip,
        );
      } finally {
        editor.destroy();
        parent.remove();
      }
    },
  );

  it('records load and input latency for a code-block-dense document', () => {
    const source = createCodeBlockDenseDocument(denseCodeBlockCount);
    const sourceSizeMiB =
      Buffer.byteLength(source, 'utf8') / 1024 / 1024;
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const loadStartedAt = performance.now();
    const editor = createEditorApi({
      doc: source,
      parent,
    });
    const loadDurationMs = performance.now() - loadStartedAt;

    try {
      const inputSamples = measureLatencySamples((sampleIndex) => {
        const insert = `\nDense code-block input probe ${sampleIndex}.`;
        const insertPosition = editor.view.state.doc.length;

        editor.view.dispatch({
          changes: {
            from: insertPosition,
            insert,
          },
          selection: {
            anchor: insertPosition + insert.length,
          },
          userEvent: 'input.type',
        });
      });
      const inputHardLimit = inputHardLimitMs(
        denseCodeBlockBudgetsMs.input,
      );
      const firstCodeBody = source.indexOf('type Document0');
      const firstParagraph = source.indexOf('Paragraph after code block 0.');
      const activationSamples = measureLatencySamples((sampleIndex) => {
        editor.view.dispatch({
          selection: EditorSelection.cursor(
            sampleIndex % 2 === 0 ? firstCodeBody : firstParagraph,
          ),
        });
      });
      const activationHardLimit = inputHardLimitMs(
        denseCodeBlockBudgetsMs.activation,
      );
      const completionDurations: number[] = [];

      for (
        let sampleIndex = 0;
        sampleIndex < inputSamples.values.length;
        sampleIndex += 1
      ) {
        const baselineLength = editor.view.state.doc.length;
        const opening = sampleIndex % 2 === 0 ? '\n```ts' : '\n~~~shell';

        editor.view.dispatch({
          annotations: Transaction.addToHistory.of(false),
          changes: { from: baselineLength, insert: opening },
          selection: { anchor: baselineLength + opening.length },
        });
        expect(forceParsing(editor.view, editor.view.state.doc.length, 1_000)).toBe(
          true,
        );

        const completionStartedAt = performance.now();
        const handled = runScopeHandlers(
          editor.view,
          new KeyboardEvent('keydown', {
            bubbles: true,
            code: 'Enter',
            key: 'Enter',
          }),
          'editor',
        );
        completionDurations.push(performance.now() - completionStartedAt);

        expect(handled).toBe(true);
        expect(
          editor.view.state.doc.sliceString(baselineLength),
        ).toBe(`${opening}\n\n${opening.includes('~') ? '~~~' : '```'}`);

        editor.view.dispatch({
          annotations: Transaction.addToHistory.of(false),
          changes: {
            from: baselineLength,
            to: editor.view.state.doc.length,
          },
          selection: { anchor: baselineLength },
        });
      }

      const completionSamples = summarizeLatencySamples(completionDurations);
      const completionHardLimit = inputHardLimitMs(
        denseCodeBlockBudgetsMs.completion,
      );

      process.stdout.write(
        [
          '[perf:code-block-dense]',
          `${denseCodeBlockCount} blocks / ${sourceSizeMiB.toFixed(2)} MiB:`,
          `load ${loadDurationMs.toFixed(2)} ms,`,
          `input p80 ${inputSamples.p80.toFixed(2)} ms / median ${inputSamples.median.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
          `samples ${formatLatencySamples(inputSamples)}`,
          `activation p80 ${activationSamples.p80.toFixed(2)} ms / max ${activationSamples.maximum.toFixed(2)} ms`,
          `samples ${formatLatencySamples(activationSamples)}`,
          `fence completion p80 ${completionSamples.p80.toFixed(2)} ms / max ${completionSamples.maximum.toFixed(2)} ms`,
          `samples ${formatLatencySamples(completionSamples)}`,
          `(budgets load <${denseCodeBlockBudgetsMs.load} ms,`,
          `input p80 <${denseCodeBlockBudgetsMs.input} ms / max <${inputHardLimit} ms,`,
          `activation p80 <${denseCodeBlockBudgetsMs.activation} ms / max <${activationHardLimit} ms,`,
          `completion p80 <${denseCodeBlockBudgetsMs.completion} ms / max <${completionHardLimit} ms)`,
          '\n',
        ].join(' '),
      );

      expect(source.match(/^```ts$/gm)).toHaveLength(
        denseCodeBlockCount,
      );
      expect(editor.getDocumentText()).toContain(
        'Dense code-block input probe 4.',
      );
      expect(Number.isFinite(loadDurationMs)).toBe(true);
      expect(loadDurationMs).toBeLessThan(
        denseCodeBlockBudgetsMs.load,
      );
      expect(inputSamples.p80).toBeLessThan(
        denseCodeBlockBudgetsMs.input,
      );
      expect(inputSamples.maximum).toBeLessThan(inputHardLimit);
      expect(activationSamples.p80).toBeLessThan(
        denseCodeBlockBudgetsMs.activation,
      );
      expect(activationSamples.maximum).toBeLessThan(activationHardLimit);
      expect(completionSamples.p80).toBeLessThan(
        denseCodeBlockBudgetsMs.completion,
      );
      expect(completionSamples.maximum).toBeLessThan(completionHardLimit);
    } finally {
      editor.destroy();
      parent.remove();
    }
  });
});

function createTestEditor(doc: string): {
  editor: EditorApi;
  parent: HTMLElement;
} {
  const parent = document.createElement('div');
  document.body.appendChild(parent);

  return {
    editor: createEditorApi({
      doc,
      parent,
    }),
    parent,
  };
}

function createCodeBlockDenseDocument(blockCount: number): string {
  const blocks = Array.from({ length: blockCount }, (_, index) =>
    [
      `## Module ${index}`,
      '',
      '```ts',
      `type Document${index} = {`,
      '  readonly source: string;',
      '  readonly title: string;',
      '};',
      '',
      `export const document${index}: Document${index} = {`,
      `  source: 'markdown-${index}',`,
      `  title: 'Section ${index}',`,
      '};',
      '```',
      '',
      `Paragraph after code block ${index}.`,
    ].join('\n'),
  );

  return `${blocks.join('\n\n')}\n`;
}
