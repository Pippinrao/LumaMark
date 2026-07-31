import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { EditorSelection } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  createEditorApi,
  type EditorApi,
} from '../../src/editor/core/editorApi';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';

const selectionProbeCount = 12;
const denseCodeBlockCount = 2_048;
const denseCodeBlockBudgetsMs = {
  input: 16,
  load: 300,
};
const interactionBudgetsMs: Record<
  string,
  {
    modeRoundTrip: number;
    selectionBatch: number;
  }
> = {
  'large-1mb.md': {
    modeRoundTrip: 150,
    selectionBatch: 100,
  },
  'large-5mb.md': {
    modeRoundTrip: 300,
    selectionBatch: 120,
  },
  'large-10mb.md': {
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

        process.stdout.write(
          [
            `[perf:editor-interaction] ${name}:`,
            `${selectionProbeCount} selection-only dispatches`,
            `${selectionDurationMs.toFixed(2)} ms`,
            `(avg ${(selectionDurationMs / selectionProbeCount).toFixed(2)} ms),`,
            `mode round-trip ${modeRoundTripDurationMs.toFixed(2)} ms`,
            `(budgets selection <${interactionBudgetsMs[name].selectionBatch} ms,`,
            `mode <${interactionBudgetsMs[name].modeRoundTrip} ms)`,
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
        expect(selectionDurationMs).toBeLessThan(
          interactionBudgetsMs[name].selectionBatch,
        );
        expect(modeRoundTripDurationMs).toBeLessThan(
          interactionBudgetsMs[name].modeRoundTrip,
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
      const insert = '\nDense code-block input probe.';
      const inputStartedAt = performance.now();

      editor.view.dispatch({
        changes: {
          from: editor.view.state.doc.length,
          insert,
        },
        selection: {
          anchor: editor.view.state.doc.length + insert.length,
        },
        userEvent: 'input.type',
      });

      const inputDurationMs = performance.now() - inputStartedAt;

      process.stdout.write(
        [
          '[perf:code-block-dense]',
          `${denseCodeBlockCount} blocks / ${sourceSizeMiB.toFixed(2)} MiB:`,
          `load ${loadDurationMs.toFixed(2)} ms,`,
          `input ${inputDurationMs.toFixed(2)} ms`,
          `(budgets load <${denseCodeBlockBudgetsMs.load} ms,`,
          `input <${denseCodeBlockBudgetsMs.input} ms)`,
          '\n',
        ].join(' '),
      );

      expect(source.match(/^```ts$/gm)).toHaveLength(
        denseCodeBlockCount,
      );
      expect(editor.getDocumentText()).toBe(source + insert);
      expect(Number.isFinite(loadDurationMs)).toBe(true);
      expect(Number.isFinite(inputDurationMs)).toBe(true);
      expect(loadDurationMs).toBeLessThan(
        denseCodeBlockBudgetsMs.load,
      );
      expect(inputDurationMs).toBeLessThan(
        denseCodeBlockBudgetsMs.input,
      );
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
