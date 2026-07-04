import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createEditorApi } from '../../src/editor/core/editorApi';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';

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

      const insert = '\nV1 large document input probe';
      const inputStartedAt = performance.now();
      editor.view.dispatch({
        changes: {
          from: editor.view.state.doc.length,
          insert,
        },
        selection: {
          anchor: editor.view.state.doc.length + insert.length,
        },
      });
      const inputDurationMs = performance.now() - inputStartedAt;

      process.stdout.write(
        `[perf:editor-large-file] ${name}: load ${loadDurationMs.toFixed(2)} ms, input ${inputDurationMs.toFixed(2)} ms\n`,
      );

      expect(editor.getDocumentText()).toContain('V1 large document input probe');
      expect(loadDurationMs).toBeLessThan(editorBudgetsMs[name].load);
      expect(inputDurationMs).toBeLessThan(editorBudgetsMs[name].input);

      editor.destroy();
      parent.remove();
    },
  );
});
