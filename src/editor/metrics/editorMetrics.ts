export type EditorTransactionMetricInput = {
  docChanged: boolean;
  transactionCount: number;
  endedAt?: number;
  startedAt?: number;
};

export type EditorTransactionMetric = {
  docChanged: boolean;
  durationMs: number;
  timestamp: number;
  transactionCount: number;
};

const MAX_RECENT_EDITOR_TRANSACTION_METRICS = 64;
const recentEditorTransactionMetrics: EditorTransactionMetric[] = [];

function readEditorTimestamp(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function recordEditorTransactionMetric(
  input: EditorTransactionMetricInput,
): EditorTransactionMetric {
  const endedAt = input.endedAt ?? readEditorTimestamp();
  const startedAt = input.startedAt ?? endedAt;
  const metric: EditorTransactionMetric = {
    docChanged: input.docChanged,
    durationMs: Math.max(0, endedAt - startedAt),
    timestamp: endedAt,
    transactionCount: input.transactionCount,
  };

  if (input.startedAt !== undefined) {
    recentEditorTransactionMetrics.push(metric);
    if (
      recentEditorTransactionMetrics.length > MAX_RECENT_EDITOR_TRANSACTION_METRICS
    ) {
      recentEditorTransactionMetrics.shift();
    }
  }

  return metric;
}

export function readRecentEditorTransactionMetrics(): readonly EditorTransactionMetric[] {
  return [...recentEditorTransactionMetrics];
}

export function clearEditorTransactionMetrics(): void {
  recentEditorTransactionMetrics.length = 0;
}
