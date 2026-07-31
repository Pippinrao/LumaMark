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
    const renderStart = waitForRenderStart();
    const scheduler = new MermaidRenderScheduler({
      debounceMs: 0,
      render: vi.fn(() => {
        renderStart.resolveStarted();
        return new Promise<string>(() => {});
      }),
    });
    const doc = [
      '```mermaid',
      'flowchart TD',
      '  A --> B',
      '```',
      '',
      'after',
    ].join('\n');
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdownLanguage(), mermaidPreviewExtension({ scheduler })],
        selection: EditorSelection.cursor(doc.length),
      }),
    });

    await renderStart.started;

    const insert = '\nplain text typed during pending render';
    const startedAt = performance.now();
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert,
      },
      selection: {
        anchor: view.state.doc.length + insert.length,
      },
    });
    const durationMs = performance.now() - startedAt;

    process.stdout.write(
      `[perf:mermaid-input] dispatch while render pending: ${durationMs.toFixed(2)} ms\n`,
    );

    expect(view.state.doc.toString()).toContain(
      'plain text typed during pending render',
    );
    expect(durationMs).toBeLessThan(50);

    view.destroy();
    parent.remove();
  });

  it('records main-document input while a complex Mermaid render is pending', async () => {
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
    const doc = createComplexMermaidDocument(
      complexMermaidNodeCount,
    );
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

      const insert = '\nMain document input during complex render.';
      const startedAt = performance.now();

      editor.view.dispatch({
        changes: {
          from: editor.view.state.doc.length,
          insert,
        },
        selection: {
          anchor: editor.view.state.doc.length + insert.length,
        },
        userEvent: 'input.type',
      });

      const durationMs = performance.now() - startedAt;

      process.stdout.write(
        [
          '[perf:mermaid-input-complex]',
          `${complexMermaidNodeCount} nodes /`,
          `${Buffer.byteLength(doc, 'utf8')} bytes:`,
          `${durationMs.toFixed(2)} ms (budget <50 ms)`,
          '\n',
        ].join(' '),
      );

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      });

      expect(editor.getDocumentText()).toBe(doc + insert);
      expect(renderedSource).toContain('flowchart LR');
      expect(renderedSource.length).toBeGreaterThan(10_000);
      expect(render).toHaveBeenCalledTimes(1);
      expect(Number.isFinite(durationMs)).toBe(true);
      expect(durationMs).toBeLessThan(50);
    } finally {
      editor.destroy();
      parent.remove();
    }
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

      const insert = '\n  B --> C';
      const insertPosition = editor.view.state.selection.main.to;
      const startedAt = performance.now();

      editor.view.dispatch({
        changes: { from: insertPosition, insert },
        selection: { anchor: insertPosition + insert.length },
        userEvent: 'input.mermaid',
      });

      const durationMs = performance.now() - startedAt;

      process.stdout.write(
        `[perf:mermaid-active-input-cold] small document: ${durationMs.toFixed(2)} ms (budget <16 ms)\n`,
      );

      expect(editor.getDocumentText()).toContain('B --> C');
      expect(durationMs).toBeLessThan(16);
    } finally {
      editor.destroy();
      parent.remove();
    }
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

        const insert = '\n  B --> C';
        const insertPosition = editor.view.state.selection.main.to;
        const startedAt = performance.now();

        editor.view.dispatch({
          changes: { from: insertPosition, insert },
          selection: { anchor: insertPosition + insert.length },
          userEvent: 'input.mermaid',
        });

        const durationMs = performance.now() - startedAt;

        process.stdout.write(
          [
            `[perf:mermaid-active-input] ${name}:`,
            `${durationMs.toFixed(2)} ms`,
            `(budget <${activeMermaidInputBudgetsMs[name]} ms)`,
            '\n',
          ].join(' '),
        );

        expect(editor.getDocumentText()).toContain('B --> C');
        expect(durationMs).toBeLessThan(activeMermaidInputBudgetsMs[name]);
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
