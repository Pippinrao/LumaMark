# Comprehensive Markdown Fixture

This document combines CommonMark, GFM, and Typora-like live preview cases in one stable file.

中文 English mixed paragraph with **bold**, *italic*, ***strong emphasis***, ~~deleted text~~, `inline code`, an escaped asterisk \*literal\*, and a hard line break here.  
The next line must stay in the same paragraph after a hard break.

<https://example.com/lumamark> and [LumaMark docs](https://example.com/docs) appear beside an image:

![Diagram alt text](./images/sample.png)

---

> A blockquote can contain **formatting**.
>
> - quoted list item
> - another quoted item

1. Ordered item
2. Ordered item with nested bullets
   - Nested bullet
   - Nested task marker text

- [x] Preserve source bytes
- [ ] Render live preview
- [ ] Keep Mermaid async

| Feature | Owner | Status |
| :--- | :---: | ---: |
| Editor | Core | Ready |
| Mermaid | Widgets | Pending |
| 中文 | 混排 | 通过 |

```ts
const markdown = '**not rendered inside code**';
console.log(markdown);
```

<section data-fixture="html-block">
  <p>HTML block should round-trip unchanged.</p>
</section>

Final paragraph keeps the fixture from ending immediately after an HTML block.
