# 中英文混排 Fixture

LumaMark 的目标是让 Markdown 写作保持安静、快速、可靠，同时支持 English prose in the same paragraph.

## 标题和 Heading 混合

中文标点、English punctuation, and `inline code` should all survive round-trip without normalization.

- 第一项包含 English words and 中文说明。
- Second item includes 中文、numbers 123, and punctuation: commas, periods, semicolons.
- 第三项测试空格：中文 English 中文。

> 引用里也可能出现 mixed language content, especially when users collect notes from different sources.

```ts
const title = '中英文 mixed title';
console.log(title);
```

最后一段保留原始换行和 UTF-8 文本。
