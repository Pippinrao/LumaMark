import { readFile } from 'node:fs/promises';
import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  getDocumentStatisticsFromText,
  scheduleDocumentStatisticsFromText,
} from '../../src/editor/metrics/documentStatistics';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';
import {
  formatLatencySamples,
  measureLatencySamples,
} from './performanceSamples';

const syncStatisticsBudgetsMs: Record<string, number> = {
  'large-1mb.md': 16,
};

const scheduleStatisticsBudgetsMs: Record<string, number> = {
  'large-5mb.md': 2,
  'large-10mb.md': 2,
};

describe('large Markdown document statistics baseline', () => {
  it.each(largeMarkdownFixturePaths.filter(({ name }) => name in syncStatisticsBudgetsMs))(
    'counts $name on the editor document within one frame',
    async ({ name, path }) => {
      const source = await readFile(path, 'utf8');
      const doc = Text.of(source.split('\n'));
      getDocumentStatisticsFromText(Text.of(['warmup']));

      const samples = measureLatencySamples(() => {
        getDocumentStatisticsFromText(doc);
      }, 3);

      process.stdout.write(
        `[perf:document-statistics] ${name}: p80 ${samples.p80.toFixed(2)} ms, samples ${formatLatencySamples(samples)}\n`,
      );

      expect(samples.p80).toBeLessThan(syncStatisticsBudgetsMs[name]);
    },
  );

  it.each(
    largeMarkdownFixturePaths.filter(({ name }) => name in scheduleStatisticsBudgetsMs),
  )(
    'schedules $name statistics off the input path in under 2ms',
    async ({ name, path }) => {
      const source = await readFile(path, 'utf8');
      const doc = Text.of(source.split('\n'));
      const expected = getDocumentStatisticsFromText(doc);
      const running: Array<{ cancel: () => void }> = [];

      const samples = measureLatencySamples(() => {
        for (const job of running) {
          job.cancel();
        }
        running.length = 0;
        running.push(
          scheduleDocumentStatisticsFromText(doc, () => undefined),
        );
      }, 3);

      process.stdout.write(
        `[perf:document-statistics] ${name}: schedule p80 ${samples.p80.toFixed(2)} ms, samples ${formatLatencySamples(samples)}\n`,
      );

      expect(samples.p80).toBeLessThan(scheduleStatisticsBudgetsMs[name]);

      const completed = await new Promise<typeof expected>((resolve) => {
        scheduleDocumentStatisticsFromText(doc, resolve);
      });
      expect(completed).toEqual(expected);
      for (const job of running) {
        job.cancel();
      }
    },
  );
});
