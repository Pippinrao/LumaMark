> Language: **English** · [中文](../../zh/product/typora-competitive-analysis/README.md)

# Typora topic competitive analysis (index)

English index for LumaMark’s **18 topic competitive-analysis reports** against the Typora public baseline. Full report bodies remain in Chinese under `docs/zh/product/typora-competitive-analysis/`.

## Snapshot warning

Many report bodies retain a **2026-07-12 analysis snapshot** (executive summary / status matrices) for historical forensics. Do not treat those sections alone as current capability. Current execution route: [Typora Parity Implementation Plan](../../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md). Later Chinese banners record implementation updates; English stubs do not restate those updates.

## Purpose

- Navigate per-topic gaps between Typora baseline facts and LumaMark evidence (code, tests, fixtures, runtime probes).
- Keep fixed topic ownership so the same gap is not maintained in multiple reports.
- Share status vocabulary and review gates (full detail in Chinese README).

## Not for

- Not a second Typora fact library — cite [typora-baseline](../typora-baseline/README.md).
- Not a substitute for product strategy, architecture ADRs, or the active implementation plan.

## Topic index

| File | Fixed responsibility | Chinese full text |
|---|---|---|
| [00-live-preview-model.md](00-live-preview-model.md) | Cross-cutting live-preview / source model gaps | [中文](../../zh/product/typora-competitive-analysis/00-live-preview-model.md) |
| [01-paragraphs-and-breaks.md](01-paragraphs-and-breaks.md) | Paragraphs, soft/hard breaks, blank lines, `<br>` | [中文](../../zh/product/typora-competitive-analysis/01-paragraphs-and-breaks.md) |
| [02-headings.md](02-headings.md) | ATX/Setext headings create/present/focus/level/nav | [中文](../../zh/product/typora-competitive-analysis/02-headings.md) |
| [03-blockquotes.md](03-blockquotes.md) | Blockquote create/continue/exit/nest/fidelity | [中文](../../zh/product/typora-competitive-analysis/03-blockquotes.md) |
| [04-lists-and-task-lists.md](04-lists-and-task-lists.md) | Ordered/unordered/task lists and checkbox UX | [中文](../../zh/product/typora-competitive-analysis/04-lists-and-task-lists.md) |
| [05-emphasis-and-inline-spans.md](05-emphasis-and-inline-spans.md) | Emphasis and inline span parse/expand/commands | [中文](../../zh/product/typora-competitive-analysis/05-emphasis-and-inline-spans.md) |
| [06-links.md](06-links.md) | Links, anchors, open/copy/paste, safety | [中文](../../zh/product/typora-competitive-analysis/06-links.md) |
| [07-images.md](07-images.md) | Images preview, paths, refresh, fidelity | [中文](../../zh/product/typora-competitive-analysis/07-images.md) |
| [08-code-blocks.md](08-code-blocks.md) | Fenced/indented code blocks and highlight | [中文](../../zh/product/typora-competitive-analysis/08-code-blocks.md) |
| [09-math.md](09-math.md) | Inline/block math render and focus edit | [中文](../../zh/product/typora-competitive-analysis/09-math.md) |
| [10-tables.md](10-tables.md) | Tables create/edit/align/mouse-keyboard | [中文](../../zh/product/typora-competitive-analysis/10-tables.md) |
| [11-mermaid-and-diagrams.md](11-mermaid-and-diagrams.md) | Mermaid/diagrams async render and fences | [中文](../../zh/product/typora-competitive-analysis/11-mermaid-and-diagrams.md) |
| [12-footnotes.md](12-footnotes.md) | Footnote refs/defs, navigation, a11y | [中文](../../zh/product/typora-competitive-analysis/12-footnotes.md) |
| [13-horizontal-rules.md](13-horizontal-rules.md) | Horizontal rules create/delete/ambiguity | [中文](../../zh/product/typora-competitive-analysis/13-horizontal-rules.md) |
| [14-yaml-front-matter.md](14-yaml-front-matter.md) | YAML front matter identify/edit/validate | [中文](../../zh/product/typora-competitive-analysis/14-yaml-front-matter.md) |
| [15-toc.md](15-toc.md) | In-doc TOC derive/update/navigate | [中文](../../zh/product/typora-competitive-analysis/15-toc.md) |
| [16-callouts.md](16-callouts.md) | Callouts / alerts type, gate, degrade | [中文](../../zh/product/typora-competitive-analysis/16-callouts.md) |
| [17-html-and-embeds.md](17-html-and-embeds.md) | HTML/embeds preview, safety, degrade | [中文](../../zh/product/typora-competitive-analysis/17-html-and-embeds.md) |

## Full Chinese index

- [Chinese README (status vocabulary, maintenance gates, ownership rules)](../../zh/product/typora-competitive-analysis/README.md)
