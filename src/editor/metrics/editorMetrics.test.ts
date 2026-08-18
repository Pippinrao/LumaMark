import { describe, expect, it } from 'vitest';
import {
  clearEditorTransactionMetrics,
  readRecentEditorTransactionMetrics,
  recordEditorTransactionMetric,
} from './editorMetrics';

describe('editor transaction metrics', () => {
  it('records timed dispatches and ignores untimed listener payloads', () => {
    clearEditorTransactionMetrics();

    recordEditorTransactionMetric({
      docChanged: true,
      transactionCount: 1,
    });
    expect(readRecentEditorTransactionMetrics()).toEqual([]);

    recordEditorTransactionMetric({
      docChanged: false,
      startedAt: 10,
      endedAt: 18,
      transactionCount: 1,
    });

    expect(readRecentEditorTransactionMetrics()).toEqual([
      {
        docChanged: false,
        durationMs: 8,
        timestamp: 18,
        transactionCount: 1,
      },
    ]);
  });
});
