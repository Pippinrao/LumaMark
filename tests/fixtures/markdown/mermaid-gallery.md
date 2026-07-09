# Mermaid Gallery Fixture

```mermaid
flowchart TD
  A[Open Markdown] --> B{Valid?}
  B --> C[Preview]
```

```mermaid
graph TD
  A[Typora style] --> B[Mermaid preview]
```

```mermaid
flowchart-elk TD
  A --> B
  B --> C
```

```mermaid
sequenceDiagram
  participant User
  participant LumaMark
  User->>LumaMark: Open document
  LumaMark-->>User: Render preview
```

```mermaid
classDiagram
  class Document {
    +string title
    +save()
  }
  Document <|-- MarkdownDocument
```

```mermaid
classDiagram-v2
  class Document
  Document : +save()
```

```mermaid
stateDiagram
  [*] --> Editing
  Editing --> Preview
```

```mermaid
stateDiagram-v2
  [*] --> Editing
  Editing --> Preview
  Preview --> Editing
```

```mermaid
erDiagram
  DOCUMENT ||--o{ BLOCK : contains
  BLOCK {
    string type
    string source
  }
```

```mermaid
journey
  title Writing flow
  section Draft
    Type markdown: 5: User
    Preview document: 4: User
```

```mermaid
gantt
  title V1 work
  dateFormat  YYYY-MM-DD
  section Editor
  Fixtures :done, 2026-07-01, 1d
  Mermaid :active, 2026-07-02, 2d
```

```mermaid
pie title Markdown Blocks
  "Text" : 45
  "Mermaid" : 10
  "Tables" : 15
```

```mermaid
gitGraph
  commit
  branch preview
  checkout preview
  commit
  checkout main
  merge preview
```

```mermaid
mindmap
  root((LumaMark))
    Editor
      Markdown
      Mermaid
```

```mermaid
timeline
  title V1
  Foundation : Editor core
  Preview : Mermaid widgets
  Quality : Fixture coverage
```

```mermaid
quadrantChart
  title Syntax Coverage
  x-axis Low Risk --> High Risk
  y-axis Low Coverage --> High Coverage
  quadrant-1 Watch
  quadrant-2 Invest
  quadrant-3 Backlog
  quadrant-4 Stable
  Tables: [0.70, 0.80]
```

```mermaid
requirementDiagram
  requirement source_fidelity {
    id: 1
    text: Markdown source remains faithful
    risk: high
    verifymethod: test
  }
```

```mermaid
C4Context
  title System Context
  Person(user, "Writer")
  System(app, "LumaMark")
  Rel(user, app, "Writes Markdown")
```

```mermaid
sankey-beta
Open,Parse,10
Parse,Preview,8
```

```mermaid
xychart-beta
  title "Fixture Growth"
  x-axis [Jan, Feb, Mar]
  y-axis "Files" 0 --> 10
  line [3, 6, 9]
```

```mermaid
block-beta
  columns 2
  A["Markdown"] B["Preview"]
  A --> B
```

```mermaid
packet-beta
  0-15: "Source Port"
  16-31: "Destination Port"
```

```mermaid
radar-beta
  axis Speed, Quality, Focus
  curve LumaMark{4, 5, 4}
```

```mermaid
architecture-beta
  group app(cloud)[LumaMark]
  service editor(server)[Editor] in app
  service renderer(server)[Renderer] in app
  editor:R --> L:renderer
```

```mermaid
kanban
  todo[Todo]
    docs[Check Mermaid syntax]
  done[Done]
    render[Render preview]
```

```mermaid
treemap-beta
  "Documents"
    "Markdown": 10
    "Mermaid": 4
```

```mermaid
venn-beta
  set A [Markdown]
  set B [Preview]
  union A,B [LumaMark]
```

Gallery text after all diagrams.
