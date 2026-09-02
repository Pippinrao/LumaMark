import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditorApi } from '../../src/editor/core/editorApi';
import { DEFAULT_EDITOR_APPEARANCE } from '../../src/editor/core/editorAppearance';
import {
  createManyTablesDocument,
  MANY_TABLES_OPEN_COUNT,
} from '../fixtures/manyTablesDocument';
import {
  formatLatencySamples,
  inputHardLimitMs,
  latencySampleCount,
  summarizeLatencySamples,
} from './performanceSamples';

const manyTablesOpenBudgetMs = 300;
const manyTablesOpenHardLimitMs = inputHardLimitMs(manyTablesOpenBudgetMs);

describe('many-table file open baseline', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each(['adaptive', 'standard', 'fluid'] as const)(
    'opens %s-width documents with 32 everyday tables without freezing',
    (pageWidth) => {
      const doc = createManyTablesDocument();
      const appearance =
        pageWidth === 'fluid'
          ? DEFAULT_EDITOR_APPEARANCE
          : {
              ...DEFAULT_EDITOR_APPEARANCE,
              pageWidthCss:
                pageWidth === 'adaptive'
                  ? 'clamp(720px, 70%, 1100px)'
                  : '810px',
            };
      const values: number[] = [];

      for (
        let sampleIndex = 0;
        sampleIndex < latencySampleCount;
        sampleIndex += 1
      ) {
        const parent = document.createElement('div');
        document.body.appendChild(parent);
        let editor: ReturnType<typeof createEditorApi> | undefined;

        try {
          const startedAt = performance.now();
          editor = createEditorApi({
            appearance,
            doc,
            parent,
          });
          values.push(performance.now() - startedAt);
          expect(editor.getDocumentText()).toBe(doc);
          expect(
            parent.querySelectorAll('.tbl-table-widget').length,
          ).toBeGreaterThan(0);
        } finally {
          editor?.destroy();
          parent.remove();
        }
      }

      const samples = summarizeLatencySamples(values);
      process.stdout.write(
        `[perf:open-many-tables] ${pageWidth} ${MANY_TABLES_OPEN_COUNT} tables: first ${samples.first.toFixed(2)} ms / p80 ${samples.p80.toFixed(2)} ms / max ${samples.maximum.toFixed(2)} ms samples ${formatLatencySamples(samples)}\n`,
      );
      expect(samples.p80).toBeLessThan(manyTablesOpenBudgetMs);
      expect(samples.maximum).toBeLessThan(manyTablesOpenHardLimitMs);
    },
  );
});
