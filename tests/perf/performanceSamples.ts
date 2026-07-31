import { performance } from 'node:perf_hooks';

export const latencySampleCount = 5;

export interface LatencySamples {
  readonly first: number;
  readonly maximum: number;
  readonly median: number;
  readonly p80: number;
  readonly values: readonly number[];
}

export function measureLatencySamples(
  operation: (sampleIndex: number) => void,
  sampleCount = latencySampleCount,
): LatencySamples {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new Error('Latency sample count must be a positive integer.');
  }

  const values = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const startedAt = performance.now();
    operation(sampleIndex);
    return performance.now() - startedAt;
  });

  return summarizeLatencySamples(values);
}

export function summarizeLatencySamples(
  values: readonly number[],
): LatencySamples {
  if (values.length === 0) {
    throw new Error('At least one latency sample is required.');
  }

  const sorted = [...values].sort((left, right) => left - right);

  return {
    first: values[0],
    maximum: sorted[sorted.length - 1],
    median: sorted[Math.floor(sorted.length / 2)],
    p80: sorted[Math.ceil(sorted.length * 0.8) - 1],
    values: [...values],
  };
}

export function inputHardLimitMs(primaryBudgetMs: number): number {
  return Math.max(50, primaryBudgetMs * 2);
}

export function formatLatencySamples(samples: LatencySamples): string {
  return `[${samples.values.map((value) => value.toFixed(2)).join(', ')}]`;
}
