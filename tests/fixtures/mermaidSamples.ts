export type MermaidRenderGate = 'fixture-only' | 'required';

export type MermaidTestSample = {
  id: string;
  renderGate: MermaidRenderGate;
  source: string;
  title: string;
};

export const mermaidTestSamples = [
  {
    id: 'flowchart',
    renderGate: 'required',
    title: 'flowchart',
    source: ['flowchart TD', '  A[Open Markdown] --> B{Valid?}', '  B --> C[Preview]'].join('\n'),
  },
  {
    id: 'sequenceDiagram',
    renderGate: 'required',
    title: 'sequence diagram',
    source: [
      'sequenceDiagram',
      '  participant User',
      '  participant LumaMark',
      '  User->>LumaMark: Open document',
      '  LumaMark-->>User: Render preview',
    ].join('\n'),
  },
  {
    id: 'classDiagram',
    renderGate: 'required',
    title: 'class diagram',
    source: [
      'classDiagram',
      '  class Document {',
      '    +string title',
      '    +save()',
      '  }',
      '  Document <|-- MarkdownDocument',
    ].join('\n'),
  },
  {
    id: 'stateDiagram-v2',
    renderGate: 'required',
    title: 'state diagram',
    source: ['stateDiagram-v2', '  [*] --> Editing', '  Editing --> Preview', '  Preview --> Editing'].join('\n'),
  },
  {
    id: 'erDiagram',
    renderGate: 'required',
    title: 'entity relationship diagram',
    source: [
      'erDiagram',
      '  DOCUMENT ||--o{ BLOCK : contains',
      '  BLOCK {',
      '    string type',
      '    string source',
      '  }',
    ].join('\n'),
  },
  {
    id: 'journey',
    renderGate: 'required',
    title: 'journey diagram',
    source: [
      'journey',
      '  title Writing flow',
      '  section Draft',
      '    Type markdown: 5: User',
      '    Preview document: 4: User',
    ].join('\n'),
  },
  {
    id: 'gantt',
    renderGate: 'required',
    title: 'gantt chart',
    source: [
      'gantt',
      '  title V1 work',
      '  dateFormat  YYYY-MM-DD',
      '  section Editor',
      '  Fixtures :done, 2026-07-01, 1d',
      '  Mermaid :active, 2026-07-02, 2d',
    ].join('\n'),
  },
  {
    id: 'pie',
    renderGate: 'required',
    title: 'pie chart',
    source: ['pie title Markdown Blocks', '  "Text" : 45', '  "Mermaid" : 10', '  "Tables" : 15'].join('\n'),
  },
  {
    id: 'gitGraph',
    renderGate: 'required',
    title: 'git graph',
    source: ['gitGraph', '  commit', '  branch preview', '  checkout preview', '  commit', '  checkout main', '  merge preview'].join('\n'),
  },
  {
    id: 'mindmap',
    renderGate: 'required',
    title: 'mindmap',
    source: ['mindmap', '  root((LumaMark))', '    Editor', '      Markdown', '      Mermaid'].join('\n'),
  },
  {
    id: 'timeline',
    renderGate: 'required',
    title: 'timeline',
    source: ['timeline', '  title V1', '  Foundation : Editor core', '  Preview : Mermaid widgets', '  Quality : Fixture coverage'].join('\n'),
  },
  {
    id: 'quadrantChart',
    renderGate: 'required',
    title: 'quadrant chart',
    source: [
      'quadrantChart',
      '  title Syntax Coverage',
      '  x-axis Low Risk --> High Risk',
      '  y-axis Low Coverage --> High Coverage',
      '  quadrant-1 Watch',
      '  quadrant-2 Invest',
      '  quadrant-3 Backlog',
      '  quadrant-4 Stable',
      '  Tables: [0.70, 0.80]',
    ].join('\n'),
  },
  {
    id: 'requirementDiagram',
    renderGate: 'required',
    title: 'requirement diagram',
    source: [
      'requirementDiagram',
      '  requirement source_fidelity {',
      '    id: 1',
      '    text: Markdown source remains faithful',
      '    risk: high',
      '    verifymethod: test',
      '  }',
    ].join('\n'),
  },
  {
    id: 'sankey',
    renderGate: 'fixture-only',
    title: 'sankey beta',
    source: ['sankey-beta', 'Open,Parse,10', 'Parse,Preview,8'].join('\n'),
  },
  {
    id: 'xyChart',
    renderGate: 'fixture-only',
    title: 'xy chart beta',
    source: ['xychart-beta', '  title "Fixture Growth"', '  x-axis [Jan, Feb, Mar]', '  y-axis "Files" 0 --> 10', '  line [3, 6, 9]'].join('\n'),
  },
  {
    id: 'block',
    renderGate: 'fixture-only',
    title: 'block beta',
    source: ['block-beta', '  columns 2', '  A["Markdown"] B["Preview"]', '  A --> B'].join('\n'),
  },
] satisfies MermaidTestSample[];

export const requiredMermaidRenderSamples = mermaidTestSamples.filter(
  (sample) => sample.renderGate === 'required',
);
