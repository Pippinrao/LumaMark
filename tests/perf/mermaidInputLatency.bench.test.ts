import { readFile } from 'node:fs/promises';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../src/editor/markdown/markdownLanguage';
import {
  MermaidRenderScheduler,
  type MermaidRenderContext,
} from '../../src/editor/capabilities/mermaid/mermaidRenderScheduler';
import { mermaidPreviewExtension } from '../../src/editor/capabilities/mermaid/mermaidPreviewExtension';
import { createEditorApi } from '../../src/editor/core/editorApi';
import { largeMarkdownFixturePaths } from '../fixtures/fixturePaths';
import {
  formatLatencySamples,
  inputHardLimitMs,
  latencySampleCount,
  measureLatencySamples,
  summarizeLatencySamples,
} from './performanceSamples';

const complexMermaidNodeCount = 180;
const activeMermaidInputBudgetsMs: Record<string, number> = {
  'large-1mb.md': 16,
  'large-5mb.md': 50,
  'large-10mb.md': 100,
};

function waitForRenderStart() {
  let resolveStarted: () => void;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });

  return {
    resolveStarted: resolveStarted!,
    started,
  };
}

describe('Mermaid input latency baseline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records dispatch latency while Mermaid rendering is still pending', async () => {
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'after',
    ].join('\n');
    const inputValues: number[] = [];

    for (let sampleIndex = 0; sampleIndex < latencySampleCount; sampleIndex += 1) {
      const renderStart = waitForRenderStart();
      const scheduler = new MermaidRenderScheduler({
        debounceMs: 0,
        render: vi.fn(() => {
          renderStart.resolveStarted();
          return new Promise<string>(() => {});
        }),
      });
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc,
          extensions: [
            markdownLanguage(),
            mermaidPreviewExtension({ scheduler }),
          ],
          selection: EditorSelection.cursor(doc.length),
        }),
      });

      try {
        await renderStart.started;

        const insert = `\nplain text typed during pending render ${sampleIndex}`;
        const insertPosition = view.state.doc.length;
        const startedAt = performance.now();

        view.dispatch({
          changes: {
            from: insertPosition,
            insert,
          },
          selection: {
            anchor: insertPosition + insert.length,
          },
        });
        inputValues.push(performance.now() - startedAt);

        expect(view.state.doc.toString()).toContain(
          `plain text typed during pending render ${sampleIndex}`,
        );
      } finally {
        view.destroy();
        parent.remove();
      }
    }

    const inputSamples = summarizeLatencySamples(inputValues);

    process.stdout.write(
      [
        '[perf:mermaid-input] independent pending renders:',
        `p80 ${inputSamples.p80.toFixed(2)} ms / median ${inputSamples.median.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
        `samples ${formatLatencySamples(inputSamples)}`,
        '(budgets p80 <50 ms / max <50 ms)',
        '\n',
      ].join(' '),
    );

    expect(inputSamples.p80).toBeLessThan(50);
    expect(inputSamples.maximum).toBeLessThan(50);
  });

  it('records main-document input while a complex Mermaid render is pending', async () => {
    const doc = createComplexMermaidDocument(
      complexMermaidNodeCount,
    );
    const inputValues: number[] = [];

    for (let sampleIndex = 0; sampleIndex < latencySampleCount; sampleIndex += 1) {
      const renderStart = waitForRenderStart();
      let renderedSource = '';
      const render = vi.fn((context: MermaidRenderContext) => {
        renderedSource = context.source;
        renderStart.resolveStarted();
        return new Promise<string>(() => {});
      });
      const scheduler = new MermaidRenderScheduler({
        debounceMs: 0,
        render,
      });
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const editor = createEditorApi({
        displayMode: 'source',
        doc,
        extensions: [mermaidPreviewExtension({ scheduler })],
        parent,
      });

      try {
        await renderStart.started;

        const insert = `\nMain document input during complex render ${sampleIndex}.`;
        const insertPosition = editor.view.state.doc.length;
        const startedAt = performance.now();

        editor.view.dispatch({
          changes: {
            from: insertPosition,
            insert,
          },
          selection: {
            anchor: insertPosition + insert.length,
          },
          userEvent: 'input.type',
        });
        inputValues.push(performance.now() - startedAt);

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });

        expect(editor.getDocumentText()).toBe(doc + insert);
        expect(renderedSource).toContain('flowchart LR');
        expect(renderedSource.length).toBeGreaterThan(10_000);
        expect(render).toHaveBeenCalledTimes(1);
      } finally {
        editor.destroy();
        parent.remove();
      }
    }

    const inputSamples = summarizeLatencySamples(inputValues);

    process.stdout.write(
      [
        '[perf:mermaid-input-complex]',
        `${complexMermaidNodeCount} nodes /`,
        `${Buffer.byteLength(doc, 'utf8')} bytes:`,
        `p80 ${inputSamples.p80.toFixed(2)} ms / median ${inputSamples.median.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
        `samples ${formatLatencySamples(inputSamples)}`,
        '(budgets p80 <50 ms / max <50 ms)',
        '\n',
      ].join(' '),
    );

    expect(inputSamples.p80).toBeLessThan(50);
    expect(inputSamples.maximum).toBeLessThan(50);
  });

  it('bounds the cold active Mermaid input path before steady-state samples', () => {
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'after',
    ].join('\n');
    const inputValues: number[] = [];

    for (let sampleIndex = 0; sampleIndex < latencySampleCount; sampleIndex += 1) {
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const scheduler = new MermaidRenderScheduler({
        debounceMs: 0,
        render: vi.fn().mockResolvedValue('<svg></svg>'),
      });
      const editor = createEditorApi({
        doc,
        extensions: [mermaidPreviewExtension({ scheduler })],
        parent,
      });

      try {
        const editButton = parent.querySelector<HTMLButtonElement>(
          '.lm-mermaid-edit-source',
        );
        expect(editButton).not.toBeNull();
        editButton?.click();

        const insert = `\n  B --> C${sampleIndex}`;
        const insertPosition = editor.view.state.selection.main.to;
        const startedAt = performance.now();

        editor.view.dispatch({
          changes: { from: insertPosition, insert },
          selection: { anchor: insertPosition + insert.length },
          userEvent: 'input.mermaid',
        });
        inputValues.push(performance.now() - startedAt);

        expect(editor.getDocumentText()).toContain(`B --> C${sampleIndex}`);
      } finally {
        editor.destroy();
        parent.remove();
      }
    }

    const inputSamples = summarizeLatencySamples(inputValues);

    process.stdout.write(
      [
        '[perf:mermaid-active-input-cold] independent small-document activations:',
        `p80 ${inputSamples.p80.toFixed(2)} ms / median ${inputSamples.median.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
        `samples ${formatLatencySamples(inputSamples)}`,
        '(budgets p80 <16 ms / max <50 ms)',
        '\n',
      ].join(' '),
    );

    expect(inputSamples.p80).toBeLessThan(16);
    expect(inputSamples.maximum).toBeLessThan(50);
  });

  it.each(largeMarkdownFixturePaths)(
    'keeps active Mermaid input local inside $name',
    async ({ name, path }) => {
      const surroundingDocument = await readFile(path, 'utf8');
      const mermaidSource = [
        '```mermaid',
        'flowchart TD',
        '  A --> B',
        '```',
      ].join('\n');
      const doc = `${mermaidSource}\n\n${surroundingDocument}`;
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const scheduler = new MermaidRenderScheduler({
        debounceMs: 0,
        render: vi.fn().mockResolvedValue('<svg></svg>'),
      });
      const editor = createEditorApi({
        doc,
        extensions: [mermaidPreviewExtension({ scheduler })],
        parent,
      });

      try {
        const editButton = parent.querySelector<HTMLButtonElement>(
          '.lm-mermaid-edit-source',
        );
        expect(editButton).not.toBeNull();
        editButton?.click();

        const inputSamples = measureLatencySamples((sampleIndex) => {
          const insert = `\n  B --> C${sampleIndex}`;
          const insertPosition = editor.view.state.selection.main.to;

          editor.view.dispatch({
            changes: { from: insertPosition, insert },
            selection: { anchor: insertPosition + insert.length },
            userEvent: 'input.mermaid',
          });
        });
        const inputHardLimit = inputHardLimitMs(
          activeMermaidInputBudgetsMs[name],
        );

        process.stdout.write(
          [
            `[perf:mermaid-active-input] ${name}:`,
            `p80 ${inputSamples.p80.toFixed(2)} ms / median ${inputSamples.median.toFixed(2)} ms / max ${inputSamples.maximum.toFixed(2)} ms`,
            `samples ${formatLatencySamples(inputSamples)}`,
            `(budgets p80 <${activeMermaidInputBudgetsMs[name]} ms / max <${inputHardLimit} ms)`,
            '\n',
          ].join(' '),
        );

        expect(editor.getDocumentText()).toContain('B --> C4');
        expect(inputSamples.p80).toBeLessThan(
          activeMermaidInputBudgetsMs[name],
        );
        expect(inputSamples.maximum).toBeLessThan(inputHardLimit);
      } finally {
        editor.destroy();
        parent.remove();
      }
    },
  );
});

function createComplexMermaidDocument(nodeCount: number): string {
  const nodes = Array.from(
    { length: nodeCount },
    (_, index) =>
      `  N${index}["Stage ${index}: preserve Markdown source and metadata"]`,
  );
  const edges = Array.from(
    { length: nodeCount - 1 },
    (_, index) =>
      `  N${index} -->|"transaction ${index}"| N${index + 1}`,
  );
  const recoveryEdges = Array.from(
    { length: Math.floor(nodeCount / 6) },
    (_, index) => {
      const from = index * 6;
      return `  N${from} -. "recover ${index}" .-> N${Math.min(from + 3, nodeCount - 1)}`;
    },
  );

  return [
    '# Complex Mermaid workload',
    '',
    '```mermaid',
    'flowchart LR',
    ...nodes,
    ...edges,
    ...recoveryEdges,
    '```',
    '',
    'Main document paragraph after the diagram.',
  ].join('\n');
}
