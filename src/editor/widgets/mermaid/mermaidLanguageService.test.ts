import { describe, expect, it } from 'vitest';
import {
  getMermaidCompletions,
  getMermaidDiagnostics,
  mermaidSnippets,
} from './mermaidLanguageService';

describe('mermaid language service', () => {
  it('suggests diagram types keywords and reusable snippets', () => {
    const completions = getMermaidCompletions('');

    expect(completions.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'flowchart TD' }),
        expect.objectContaining({ label: 'sequenceDiagram' }),
        expect.objectContaining({ label: 'participant' }),
      ]),
    );
    expect(mermaidSnippets.map((snippet) => snippet.label)).toContain(
      'flowchart with decision',
    );
  });

  it('reports missing diagram type and obvious invalid starts', () => {
    expect(getMermaidDiagnostics('')).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ]);
    expect(getMermaidDiagnostics('hello world')).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('diagram type'),
        severity: 'error',
      }),
    ]);
  });

  it('accepts Mermaid diagram types supported by the renderer', () => {
    const supportedStarts = [
      'graph TD',
      'flowchart-elk TD',
      'swimlane-beta',
      'stateDiagram',
      'classDiagram-v2',
      'info',
      'C4Context',
      'sankey',
      'sankey-beta',
      'xychart',
      'xychart-beta',
      'block',
      'block-beta',
      'packet',
      'packet-beta',
      'radar-beta',
      'treeView-beta',
      'architecture',
      'architecture-beta',
      'eventmodeling',
      'ishikawa-beta',
      'kanban',
      'wardley-beta',
      'cynefin-beta',
      'treemap',
      'treemap-beta',
      'venn-beta',
      'railroad-beta',
      'railroad-ebnf-beta',
      'railroad-abnf-beta',
      'railroad-peg-beta',
    ];

    for (const start of supportedStarts) {
      expect(getMermaidDiagnostics(start), start).toEqual([]);
    }
  });

  it('reports unterminated block structures for common diagrams', () => {
    expect(getMermaidDiagnostics(['sequenceDiagram', 'loop retry'].join('\n'))).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('end'),
        severity: 'warning',
      }),
    ]);
  });
});
