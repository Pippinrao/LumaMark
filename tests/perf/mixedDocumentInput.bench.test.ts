import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../src/editor/markdown/markdownLanguage';
import { markdownWysiwygExtension } from '../../src/editor/wysiwyg/markdownDecorations';
import { mathPreviewExtension } from '../../src/editor/capabilities/math/mathPreviewExtension';
import { mermaidPreviewExtension } from '../../src/editor/capabilities/mermaid/mermaidPreviewExtension';
import { MermaidRenderScheduler } from '../../src/editor/capabilities/mermaid/mermaidRenderScheduler';
import { plantumlPreviewExtension } from '../../src/editor/capabilities/plantuml/plantumlPreviewExtension';
import { PlantumlRenderScheduler } from '../../src/editor/capabilities/plantuml/plantumlRenderScheduler';
import { tablePreviewExtension } from '../../src/editor/capabilities/table/tablePreviewExtension';
import { createCodeBlockCapability } from '../../src/editor/capabilities/code-block/createCodeBlockCapability';
import type { MathWorkerLike } from '../../src/editor/capabilities/math/mathRenderSession';
import type { MathDocumentWorkerResponse } from '../../src/editor/capabilities/math/mathWorkerProtocol';
import {
  formatLatencySamples,
  summarizeLatencySamples,
} from './performanceSamples';

const mixedInputBudgetMs = 8;
const mixedSelectionBudgetMs = 8;
const mixedProcessingBudgetMs = 32;

class SilentMathWorker implements MathWorkerLike {
  onerror: ((event: ErrorEvent) => unknown) | null = null;
  onmessage: ((event: MessageEvent<MathDocumentWorkerResponse>) => unknown) | null =
    null;
  onmessageerror: ((event: MessageEvent) => unknown) | null = null;
  readonly terminate = vi.fn();

  postMessage(): void {}
}

function createMixedDocument(): string {
  const body = Array.from({ length: 24 }, (_, index) =>
    `Paragraph ${index}: mixed math $a_${index}$, prose, and lists keep the caret in ordinary text.`,
  ).join('\n\n');

  return [
    '# Mixed writing sample',
    '',
    'Lead-in with inline math $E=mc^2$ before the heavy blocks.',
    '',
    '$$',
    '\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}',
    '$$',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[Start] --> B{Branch}',
    '  B --> C[Done]',
    '```',
    '',
    '```plantuml',
    '@startuml',
    'Alice -> Bob: hello',
    '@enduml',
    '```',
    '',
    '| Col | Value |',
    '| --- | ----- |',
    '| a   | 1     |',
    '| b   | 2     |',
    '',
    body,
    '',
    'Tail paragraph for typing.',
  ].join('\n');
}

function createMixedEditor(doc: string): {
  parent: HTMLElement;
  view: EditorView;
} {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdownLanguage(),
        markdownWysiwygExtension(),
        createCodeBlockCapability().extensions,
        mathPreviewExtension({
          createWorker: () => new SilentMathWorker(),
          debounceMs: 0,
          documentId: 'mixed-doc-bench',
          mode: 'livePreview',
        }),
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

  return { parent, view };
}

describe('mixed document input latency', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('keeps mixed-doc tail input and selection inside one frame', () => {
    const doc = createMixedDocument();
    expect(doc.length).toBeGreaterThan(2_000);
    expect(doc.length).toBeLessThan(8_000);

    const inputValues: number[] = [];
    const selectionValues: number[] = [];

    for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
      const { parent, view } = createMixedEditor(doc);
      try {
        const insert = ` typed ${sampleIndex}`;
        const startedAt = performance.now();
        view.dispatch({
          changes: { from: doc.length, insert },
          selection: EditorSelection.cursor(doc.length + insert.length),
        });
        inputValues.push(performance.now() - startedAt);
      } finally {
        view.destroy();
        parent.remove();
      }
    }

    const consecutive = createMixedEditor(doc);
    try {
      for (let sampleIndex = 0; sampleIndex < 5; sampleIndex += 1) {
        const startedAt = performance.now();
        consecutive.view.dispatch({
          selection: EditorSelection.cursor(
            Math.max(0, doc.length - 12 - sampleIndex),
          ),
        });
        selectionValues.push(performance.now() - startedAt);
      }
    } finally {
      consecutive.view.destroy();
      consecutive.parent.remove();
    }

    const inputSamples = summarizeLatencySamples(inputValues);
    const selectionSamples = summarizeLatencySamples(selectionValues);

    const orderedInput = [...inputSamples.values].sort((left, right) => left - right);
    const processingP95 =
      orderedInput[Math.ceil(orderedInput.length * 0.95) - 1];

    process.stdout.write(
      [
        `[perf:mixed-doc] ${doc.length} bytes:`,
        `input p80 ${inputSamples.p80.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
        `samples ${formatLatencySamples(inputSamples)};`,
        `selection p80 ${selectionSamples.p80.toFixed(2)} ms / max ${selectionSamples.maximum.toFixed(2)} ms`,
        `samples ${formatLatencySamples(selectionSamples)};`,
        `processing p95 ${processingP95.toFixed(2)} ms`,
        `(budgets input p80 <${mixedInputBudgetMs} ms, selection p80 <${mixedSelectionBudgetMs} ms, processing p95 <${mixedProcessingBudgetMs} ms)`,
        '\n',
      ].join(' '),
    );

    expect(inputSamples.p80).toBeLessThan(mixedInputBudgetMs);
    expect(inputSamples.maximum).toBeLessThan(mixedProcessingBudgetMs);
    expect(selectionSamples.p80).toBeLessThan(mixedSelectionBudgetMs);
    expect(selectionSamples.maximum).toBeLessThan(mixedProcessingBudgetMs);
    expect(processingP95).toBeLessThan(mixedProcessingBudgetMs);
  });
});
