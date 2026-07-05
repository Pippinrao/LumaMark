# GFM Edge Cases

| Left | Center | Right | Escaped |
| :--- | :---: | ---: | --- |
| value |  | 42 | one \| two |
| 中文 | mixed English | 7 | pipe \| kept |

- [x] Completed task
- [ ] Open task
- [ ] Task with `inline code`
- [ ] Task with ~~strike~~ text

Nested list:

1. Parent
   1. Child ordered
      - Child bullet
        - [ ] Deep task
2. Next parent

```markdown
- [x] literal task inside fenced code
| not | a | rendered | table |
```mermaid
flowchart TD
  A --> B
```
```

Paragraph after code confirms the fence closed correctly.
