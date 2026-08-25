import { describe, expect, it } from 'vitest';
import {
  inputHardLimitMs,
  summarizeLatencySamples,
} from '../../tests/perf/performanceSamples';

describe('performance sample summaries', () => {
  it('keeps first, median, P80, and maximum samples', () => {
    const values = [19, 8, 7, 9, 10];

    expect(summarizeLatencySamples(values)).toEqual({
      first: 19,
      maximum: 19,
      median: 9,
      p80: 10,
      values,
    });
  });

  it('rejects an empty sample set', () => {
    expect(() => summarizeLatencySamples([])).toThrow(
      'At least one latency sample is required.',
    );
  });

  it('retains a 50 ms hard ceiling for strict input budgets', () => {
    expect(inputHardLimitMs(16)).toBe(50);
    expect(inputHardLimitMs(50)).toBe(100);
    expect(inputHardLimitMs(100)).toBe(200);
  });

  it('makes two slow samples fail the P80 primary budget', () => {
    const summary = summarizeLatencySamples([49, 49, 1, 1, 1]);

    expect(summary.median).toBe(1);
    expect(summary.p80).toBe(49);
  });

  it('treats P80 of three samples as the maximum, so stats gates must use five', () => {
    const summary = summarizeLatencySamples([19.34, 12.53, 10.27]);

    expect(summary.p80).toBe(19.34);
    expect(summary.p80).toBe(summary.maximum);
  });
});
