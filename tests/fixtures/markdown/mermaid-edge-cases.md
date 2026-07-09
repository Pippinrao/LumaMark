# Mermaid Edge Cases

Uppercase info string:

```MERMAID
flowchart LR
  A --> B
```

Metadata-like info string:

```mermaid {theme: "neutral"}
sequenceDiagram
  A->>B: metadata info string
```

Invalid diagram that should show a localized error widget:

```mermaid
this is not valid mermaid
```

Long but simple graph:

```mermaid
flowchart TD
  A0 --> A1
  A1 --> A2
  A2 --> A3
  A3 --> A4
  A4 --> A5
  A5 --> A6
  A6 --> A7
  A7 --> A8
```

Consecutive blocks:

```mermaid
pie title Small
  "A" : 1
  "B" : 2
```
```mermaid
stateDiagram-v2
  [*] --> Ready
```

Additional modern Mermaid diagrams:

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
info
```

```mermaid
treeView-beta
  root
    src
      editor.ts
```

Text after edge cases.
