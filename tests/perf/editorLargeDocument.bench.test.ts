import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createEditorApi } from '../../src/editor/core/editorApi';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';
import {
  formatLatencySamples,
  inputHardLimitMs,
  latencySampleCount,
  measureLatencySamples,
  summarizeLatencySamples,
} from './performanceSamples';

const editorBudgetsMs: Record<
  string,
  {
    input: number;
    load: number;
  }
> = {
  'large-1mb.md': {
    input: 16,
    load: 300,
  },
  'large-5mb.md': {
    input: 50,
    load: 1_000,
  },
  'large-10mb.md': {
    input: 100,
    load: 2_000,
  },
};

describe('large Markdown editor responsiveness baseline', () => {
  it('bounds initial editor creation and input before large document samples', () => {
    const initialDoc = '# Performance cold path\n\nInitial editor content.';
    const loadValues: number[] = [];
    const inputValues: number[] = [];

    for (let sampleIndex = 0; sampleIndex < latencySampleCount; sampleIndex += 1) {
      const sampleParent = document.createElement('div');
      document.body.appendChild(sampleParent);
      let sampleEditor: ReturnType<typeof createEditorApi> | undefined;

      try {
        const loadStartedAt = performance.now();
        sampleEditor = createEditorApi({
          doc: initialDoc,
          parent: sampleParent,
        });
        loadValues.push(performance.now() - loadStartedAt);

        const insert = `\nCold tail input ${sampleIndex}.`;
        const insertPosition = sampleEditor.view.state.doc.length;
        const inputStartedAt = performance.now();

        sampleEditor.view.dispatch({
          changes: {
            from: insertPosition,
            insert,
          },
          selection: {
            anchor: insertPosition + insert.length,
          },
        });
        inputValues.push(performance.now() - inputStartedAt);

        expect(sampleEditor.getDocumentText()).toContain(
          `Cold tail input ${sampleIndex}.`,
        );
      } finally {
        sampleEditor?.destroy();
        sampleParent.remove();
      }
    }

    const loadSamples = summarizeLatencySamples(loadValues);
    const inputSamples = summarizeLatencySamples(inputValues);

    process.stdout.write(
      [
        '[perf:editor-initial] independent default documents:',
        `load first ${loadSamples.first.toFixed(2)} ms / p80 ${loadSamples.p80.toFixed(2)} ms / median ${loadSamples.median.toFixed(2)} ms / max ${loadSamples.maximum.toFixed(2)} ms`,
        `samples ${formatLatencySamples(loadSamples)};`,
        `first-input p80 ${inputSamples.p80.toFixed(2)} ms / median ${inputSamples.median.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
        `samples ${formatLatencySamples(inputSamples)}`,
        '(budgets load first <300 ms / p80 <300 ms / max <600 ms, input p80 <16 ms / max <50 ms)',
        '\n',
      ].join(' '),
    );

    expect(loadSamples.first).toBeLessThan(300);
    expect(loadSamples.p80).toBeLessThan(300);
    expect(loadSamples.maximum).toBeLessThan(600);
    expect(inputSamples.p80).toBeLessThan(16);
    expect(inputSamples.maximum).toBeLessThan(50);
  });

  it.each(largeMarkdownFixturePaths)(
    'loads and edits $name without freezing',
    async ({ name, path }) => {
      const source = await readFile(path, 'utf8');
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
          const insert = `\nV1 large document input probe ${sampleIndex}`;
          const insertPosition = editor.view.state.doc.length;

          editor.view.dispatch({
            changes: {
              from: insertPosition,
              insert,
            },
            selection: {
              anchor: insertPosition + insert.length,
            },
          });
        });
        const inputHardLimit = inputHardLimitMs(
          editorBudgetsMs[name].input,
        );

        process.stdout.write(
          [
            `[perf:editor-large-file] ${name}:`,
            `load ${loadDurationMs.toFixed(2)} ms,`,
            `input p80 ${inputSamples.p80.toFixed(2)} ms / median ${inputSamples.median.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
            `samples ${formatLatencySamples(inputSamples)}`,
            `(budgets load <${editorBudgetsMs[name].load} ms,`,
            `input p80 <${editorBudgetsMs[name].input} ms / max <${inputHardLimit} ms)`,
            '\n',
          ].join(' '),
        );

        expect(editor.getDocumentText()).toContain(
          'V1 large document input probe 4',
        );
        expect(loadDurationMs).toBeLessThan(editorBudgetsMs[name].load);
        expect(inputSamples.p80).toBeLessThan(
          editorBudgetsMs[name].input,
        );
        expect(inputSamples.maximum).toBeLessThan(inputHardLimit);
      } finally {
        editor.destroy();
        parent.remove();
      }
    },
  );
});
