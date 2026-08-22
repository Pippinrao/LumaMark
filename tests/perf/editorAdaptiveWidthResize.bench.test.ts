import { performance } from 'node:perf_hooks';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownLanguage } from '../../src/editor/markdown/markdownLanguage';
import { markdownWysiwygExtension } from '../../src/editor/wysiwyg/markdownDecorations';
import { tablePreviewExtension } from '../../src/editor/capabilities/table/tablePreviewExtension';
import { mermaidPreviewExtension } from '../../src/editor/capabilities/mermaid/mermaidPreviewExtension';
import { MermaidRenderScheduler } from '../../src/editor/capabilities/mermaid/mermaidRenderScheduler';
import { plantumlPreviewExtension } from '../../src/editor/capabilities/plantuml/plantumlPreviewExtension';
import { PlantumlRenderScheduler } from '../../src/editor/capabilities/plantuml/plantumlRenderScheduler';
import { syncEditorAvailableWidth } from '../../src/editor/core/editorAvailableWidth';
import {
  formatLatencySamples,
  inputHardLimitMs,
  summarizeLatencySamples,
} from './performanceSamples';

const adaptiveResizeBudgetMs = 16;

function createMixedDocument(): string {
  return [
    '# Adaptive width sample',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[Start] --> B[Done]',
    '```',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: hello',
    '@enduml',
    '```',
    '',
    '| Col | Value | Extra |',
    '| --- | ----- | ----- |',
    '| a   | 1     | x     |',
    '| b   | 2     | y     |',
    '',
    '![wide](https://example.test/wide.png)',
    '',
    'Tail paragraph for layout.',
  ].join('\n');
}

describe('adaptive width resize settle', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('republishes block-track width within one frame on mixed breakout documents', () => {
    const doc = createMixedDocument();
    const values: number[] = [];

    for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [
            markdownLanguage(),
            markdownWysiwygExtension(),
            mermaidPreviewExtension({
              scheduler: new MermaidRenderScheduler({
                debounceMs: 0,
                render: () => new Promise<string>(() => {}),
              }),
            }),
            plantumlPreviewExtension({
              scheduler: new PlantumlRenderScheduler({
                debounceMs: 0,
                render: () => new Promise<string>(() => {}),
              }),
            }),
            tablePreviewExtension(false),
          ],
          selection: EditorSelection.cursor(doc.length),
        }),
      });

      try {
        Object.defineProperty(view.scrollDOM, 'clientWidth', {
          configurable: true,
          value: 980 + sampleIndex * 40,
        });
        const startedAt = performance.now();
        syncEditorAvailableWidth(view, sampleIndex === 0 ? null : 800);
        values.push(performance.now() - startedAt);
      } finally {
        view.destroy();
        parent.remove();
      }
    }

    const samples = summarizeLatencySamples(values);
    process.stdout.write(
      `[perf:adaptive-width-resize] P80 ${samples.p80.toFixed(2)} ms; max ${samples.maximum.toFixed(2)} ms; samples ${formatLatencySamples(samples)}\n`,
    );
    expect(samples.p80).toBeLessThan(adaptiveResizeBudgetMs);
    expect(samples.maximum).toBeLessThan(inputHardLimitMs(adaptiveResizeBudgetMs));
  });
});
