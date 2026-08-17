> Language: **English** · [中文](../zh/product/V1_PRODUCT_REQUIREMENTS.md)

# V1 Product Requirements

> **Historical / frozen Alpha baseline — NOT current execution source of truth.**
>
> This document archives the Foundation / MarkText+ V1 scope and acceptance criteria. Do not use it to infer current implementation status or execution order. Current scope, sequencing, and exit gates live only in [Typora Parity Implementation Plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md).

## What this document was for

This was the Alpha product-requirements baseline for a daily-usable Typora-like Markdown editor. V1 prioritized a stable, fluent, trustworthy core writing path over feature breadth.

Users were expected to: open Markdown files; edit smoothly; use common Markdown syntax with WYSIWYG feedback; use Mermaid; save without unrelated source changes; and switch between Chinese and English UI.

### Core scope (historical)

- **Editor:** headings, bold/italic/strikethrough, blockquotes, ordered/unordered/task lists, horizontal rules, inline code, fenced code blocks, links, image references, Mermaid fenced blocks. WYSIWYG via CodeMirror decorations/widgets with Markdown source as the only source of truth—no rich-text AST as primary data, no auto-format of unedited regions.
- **Files:** open/save/save-as, recent files, workspace folder + file tree, dirty-state cues; save must keep unrelated diff at zero and preserve blank lines and unedited structure.
- **Mermaid:** detect fences, async preview that must not block typing, understandable failure UI, cache keyed by source/theme/config/version with cancellation on stale work.
- **Shell UX:** Typora-like file-mode layout (menu bar; sidebar tabs for files/outline; single central editor); light/dark themes; settings; command palette; shortcuts.
- **i18n:** Simplified Chinese and English as equal-class UI languages for all visible copy.
- **Performance targets (historical):** open budgets for 1MB/5MB docs; 10MB editable without freeze; typing and scroll responsiveness under load.

The Chinese full text also records Alpha non-goals, acceptance language, and quality expectations for that baseline era.

## Links

- [Chinese full text](../zh/product/V1_PRODUCT_REQUIREMENTS.md)
- [Current execution plan](../roadmap/TYPORA_PARITY_IMPLEMENTATION_PLAN.md)
