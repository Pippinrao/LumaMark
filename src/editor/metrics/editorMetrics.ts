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

function readEditorTimestamp(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function recordEditorTransactionMetric(
  input: EditorTransactionMetricInput,
): EditorTransactionMetric {
  const endedAt = input.endedAt ?? readEditorTimestamp();
  const startedAt = input.startedAt ?? endedAt;

  return {
    docChanged: input.docChanged,
    durationMs: Math.max(0, endedAt - startedAt),
    timestamp: endedAt,
    transactionCount: input.transactionCount,
  };
}
