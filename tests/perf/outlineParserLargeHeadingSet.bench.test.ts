import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../src/editor/markdown/markdownLanguage';
import { parseMarkdownOutlineFromState } from '../../src/features/outline/outlineParser';
import {
  formatLatencySamples,
  measureLatencySamples,
} from './performanceSamples';

const headingCount = 10_000;
const parseBudgetMs = 500;

describe('large Markdown outline parser baseline', () => {
  it('assigns unique duplicate anchors in linear-time practice', () => {
    const source = Array.from(
      { length: headingCount },
      () => '# Repeated heading',
    ).join('\n');
    const warmupState = EditorState.create({
      doc: '# Warmup',
      extensions: [markdownLanguage()],
    });
    const state = EditorState.create({
      doc: source,
      extensions: [markdownLanguage()],
    });
    let headings = parseMarkdownOutlineFromState(warmupState);

    const samples = measureLatencySamples(() => {
      headings = parseMarkdownOutlineFromState(state);
    }, 3);

    process.stdout.write(
      `[perf:outline-parser] ${headingCount} duplicate headings: p80 ${samples.p80.toFixed(2)} ms, samples ${formatLatencySamples(samples)}\n`,
    );

    expect(headings).toHaveLength(headingCount);
    expect(headings[0]?.id).toBe('repeated-heading-1');
    expect(headings[1]?.id).toBe('repeated-heading-2');
    expect(headings.at(-1)?.id).toBe(`repeated-heading-${headingCount}`);
    expect(new Set(headings.map((heading) => heading.id))).toHaveLength(
      headingCount,
    );
    expect(samples.p80).toBeLessThan(parseBudgetMs);
  });
});
