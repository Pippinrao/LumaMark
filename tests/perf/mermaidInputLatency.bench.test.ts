import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markdownLanguage } from '../../src/editor/markdown/markdownLanguage';
import { MermaidRenderScheduler } from '../../src/editor/capabilities/mermaid/mermaidRenderScheduler';
import { mermaidPreviewExtension } from '../../src/editor/capabilities/mermaid/mermaidPreviewExtension';

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
});
