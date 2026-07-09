export type MarkdownFixtureManifest = {
  fileName: string;
  notes?: string;
  tags: string[];
};

export const markdownFixtureManifest = [
  {
    fileName: 'basic.md',
    tags: ['commonmark:paragraph', 'typora-like:live-preview'],
  },
  {
    fileName: 'headings.md',
    tags: ['commonmark:heading'],
  },
  {
    fileName: 'emphasis.md',
    tags: ['commonmark:emphasis', 'gfm:strikethrough'],
  },
  {
    fileName: 'lists.md',
    tags: ['commonmark:list'],
  },
  {
    fileName: 'task-list.md',
    tags: ['gfm:task-list'],
  },
  {
    fileName: 'blockquote.md',
    tags: ['commonmark:blockquote'],
  },
  {
    fileName: 'table.md',
    tags: ['gfm:table'],
  },
  {
    fileName: 'code-blocks.md',
    tags: ['commonmark:code'],
  },
  {
    fileName: 'links-images.md',
    tags: ['commonmark:link', 'commonmark:image', 'gfm:autolink'],
  },
  {
    fileName: 'mermaid.md',
    tags: ['mermaid:flowchart', 'mermaid:sequenceDiagram'],
  },
  {
    fileName: 'mixed-chinese-english.md',
    tags: ['i18n:mixed-chinese-english'],
  },
  {
    fileName: 'comprehensive.md',
    notes: 'Combined CommonMark, GFM, and Typora-like editing fixture.',
    tags: [
      'commonmark:heading',
      'commonmark:paragraph',
      'commonmark:emphasis',
      'commonmark:link',
      'commonmark:image',
      'commonmark:blockquote',
      'commonmark:list',
      'commonmark:code',
      'commonmark:html',
      'commonmark:thematic-break',
      'gfm:table',
      'gfm:task-list',
      'gfm:strikethrough',
      'gfm:autolink',
      'i18n:mixed-chinese-english',
      'typora-like:live-preview',
    ],
  },
  {
    fileName: 'gfm-edge-cases.md',
    notes: 'GFM table, task list, and code fence edge cases.',
    tags: [
      'commonmark:list',
      'commonmark:code',
      'gfm:table',
      'gfm:task-list',
      'gfm:escaped-pipe-table',
      'gfm:strikethrough',
    ],
  },
  {
    fileName: 'mermaid-gallery.md',
    notes: 'Required Mermaid render-gate samples.',
    tags: [
      'mermaid:flowchart',
      'mermaid:graph',
      'mermaid:flowchartElk',
      'mermaid:sequenceDiagram',
      'mermaid:classDiagram',
      'mermaid:classDiagram-v2',
      'mermaid:stateDiagram',
      'mermaid:stateDiagram-v2',
      'mermaid:erDiagram',
      'mermaid:journey',
      'mermaid:gantt',
      'mermaid:pie',
      'mermaid:gitGraph',
      'mermaid:mindmap',
      'mermaid:timeline',
      'mermaid:quadrantChart',
      'mermaid:requirementDiagram',
      'mermaid:c4Context',
      'mermaid:sankey',
      'mermaid:xyChart',
      'mermaid:block',
      'mermaid:packet',
      'mermaid:radar',
      'mermaid:architecture',
      'mermaid:kanban',
      'mermaid:treemap',
      'mermaid:venn',
    ],
  },
  {
    fileName: 'mermaid-edge-cases.md',
    notes: 'Mermaid source-fidelity, error, metadata, and additional modern syntax samples.',
    tags: [
      'mermaid:error',
      'mermaid:source-fidelity-only',
      'mermaid:sankey',
      'mermaid:xyChart',
      'mermaid:block',
      'mermaid:info',
      'mermaid:treeView',
    ],
  },
  {
    fileName: 'large-1mb.md',
    tags: ['large:1mb'],
  },
  {
    fileName: 'large-5mb.md',
    tags: ['large:5mb'],
  },
  {
    fileName: 'large-10mb.md',
    tags: ['large:10mb'],
  },
] satisfies MarkdownFixtureManifest[];
