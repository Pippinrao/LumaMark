export type MermaidRenderGate = 'fixture-only' | 'required';

export type MermaidTestSample = {
  id: string;
  renderGate: MermaidRenderGate;
  source: string;
  title: string;
};

export const mermaidTestSamples: MermaidTestSample[] = [
  {
    id: 'flowchart',
    renderGate: 'required',
    title: 'flowchart',
    source: ['flowchart TD', '  A[Open Markdown] --> B{Valid?}', '  B --> C[Preview]'].join('\n'),
  },
  {
    id: 'graph',
    renderGate: 'required',
    title: 'legacy graph flowchart',
    source: ['graph TD', '  A[Typora style] --> B[Mermaid preview]'].join('\n'),
  },
  {
    id: 'flowchartElk',
    renderGate: 'required',
    title: 'flowchart elk',
    source: ['flowchart-elk TD', '  A --> B', '  B --> C'].join('\n'),
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
    id: 'classDiagram-v2',
    renderGate: 'required',
    title: 'class diagram v2',
    source: ['classDiagram-v2', '  class Document', '  Document : +save()'].join('\n'),
  },
  {
    id: 'stateDiagram',
    renderGate: 'required',
    title: 'legacy state diagram',
    source: ['stateDiagram', '  [*] --> Editing', '  Editing --> Preview'].join('\n'),
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
    id: 'c4Context',
    renderGate: 'required',
    title: 'C4 context diagram',
    source: [
      'C4Context',
      '  title System Context',
      '  Person(user, "Writer")',
      '  System(app, "LumaMark")',
      '  Rel(user, app, "Writes Markdown")',
    ].join('\n'),
  },
  {
    id: 'sankey',
    renderGate: 'required',
    title: 'sankey beta',
    source: ['sankey-beta', 'Open,Parse,10', 'Parse,Preview,8'].join('\n'),
  },
  {
    id: 'xyChart',
    renderGate: 'required',
    title: 'xy chart beta',
    source: ['xychart-beta', '  title "Fixture Growth"', '  x-axis [Jan, Feb, Mar]', '  y-axis "Files" 0 --> 10', '  line [3, 6, 9]'].join('\n'),
  },
  {
    id: 'block',
    renderGate: 'required',
    title: 'block beta',
    source: ['block-beta', '  columns 2', '  A["Markdown"] B["Preview"]', '  A --> B'].join('\n'),
  },
  {
    id: 'packet',
    renderGate: 'required',
    title: 'packet diagram',
    source: ['packet-beta', '  0-15: "Source Port"', '  16-31: "Destination Port"'].join('\n'),
  },
  {
    id: 'radar',
    renderGate: 'required',
    title: 'radar beta',
    source: ['radar-beta', '  axis Speed, Quality, Focus', '  curve LumaMark{4, 5, 4}'].join('\n'),
  },
  {
    id: 'architecture',
    renderGate: 'required',
    title: 'architecture beta',
    source: [
      'architecture-beta',
      '  group app(cloud)[LumaMark]',
      '  service editor(server)[Editor] in app',
      '  service renderer(server)[Renderer] in app',
      '  editor:R --> L:renderer',
    ].join('\n'),
  },
  {
    id: 'kanban',
    renderGate: 'required',
    title: 'kanban',
    source: [
      'kanban',
      '  todo[Todo]',
      '    docs[Check Mermaid syntax]',
      '  done[Done]',
      '    render[Render preview]',
    ].join('\n'),
  },
  {
    id: 'treemap',
    renderGate: 'required',
    title: 'treemap',
    source: ['treemap-beta', '  "Documents"', '    "Markdown": 10', '    "Mermaid": 4'].join('\n'),
  },
  {
    id: 'venn',
    renderGate: 'required',
    title: 'venn beta',
    source: [
      'venn-beta',
      '  set A [Markdown]',
      '  set B [Preview]',
      '  union A,B [LumaMark]',
    ].join('\n'),
  },
  {
    id: 'info',
    renderGate: 'fixture-only',
    title: 'info diagram',
    source: 'info',
  },
  {
    id: 'treeView',
    renderGate: 'fixture-only',
    title: 'tree view beta',
    source: ['treeView-beta', '  root', '    src', '      editor.ts'].join('\n'),
  },
];

export const requiredMermaidRenderSamples = mermaidTestSamples.filter(
  (sample) => sample.renderGate === 'required',
);
